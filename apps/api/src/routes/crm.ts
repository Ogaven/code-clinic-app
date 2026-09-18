import { Router, Request, Response } from 'express'
import { requireAuth } from '../middleware/auth'
import { requireRole, adminAndReceptionist } from '../middleware/rbac'
import { prisma } from '../lib/prisma'
import { phoneVariants } from '../utils/phone'
import { findOrCreateLeadForChannel, handleNewLeadCreated } from '../crm-automation/lead-intake.service'
import { transitionLeadStage, convertLeadOnBooking } from '../crm-automation/lead-stage.service'

const router = Router()

// ── Leads ────────────────────────────────────────────────────────
// CRM lead routes are ADMIN/RECEPTIONIST only — the only two roles with a
// leads UI at all ((admin)/leads and (receptionist)/receptionist/leads;
// DOCTOR/ACCOUNTS/DEVELOPER are redirected away from /leads in
// (admin)/layout.tsx and have no leads route of their own). This matches the
// adminAndReceptionist gate already used for every lead-automation action in
// crm-automation.ts — these general-purpose routes were the one place still
// missing it (previously requireAuth-only, so ANY authenticated role could
// read/write lead data with no clinical or business need to).
router.get('/leads', requireAuth, adminAndReceptionist, async (req: Request, res: Response) => {
  try {
    const { source, status, q } = req.query
    const where: any = {}
    if (source && source !== 'all') where.source = String(source)
    if (status && status !== 'all') where.status = String(status)
    if (q) {
      const qStr = String(q)
      where.OR = [
        { name:  { contains: qStr, mode: 'insensitive' } },
        // Matched against every historical phone format for near-complete numbers;
        // shorter typeahead digit strings fall back to a plain substring match.
        ...(qStr.replace(/\D/g, '').length >= 9
          ? phoneVariants(qStr).map(v => ({ phone: { contains: v } }))
          : [{ phone: { contains: qStr.replace(/[\s-]/g, '') } }]),
        { email: { contains: qStr, mode: 'insensitive' } },
      ]
    }
    const leads = await prisma.lead.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
    })
    res.json(leads)
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch leads' })
  }
})

router.post('/leads', requireAuth, adminAndReceptionist, async (req: Request, res: Response) => {
  const { name, phone, email, source, status, notes, lastMessage } = req.body
  if (!source) return res.status(400).json({ error: 'Source is required' })
  try {
    const createData = {
      name:        name        || null,
      phone:       phone       || null,
      email:       email       || null,
      source:      source,
      status:      status      || 'NEW',
      stage:       status      || 'NEW',
      notes:       notes       || null,
      lastMessage: lastMessage || null,
    }

    // Routed through the single lead-creation orchestration entry point
    // (Part K) — dedupes by phone (when provided) so re-adding the same
    // walk-in/manual contact never creates a second Lead row. No phone means
    // nothing to dedupe on, so it always creates (matches every other
    // channel's behavior: phone is the one reliable identity key here).
    // handleNewLeadCreated performs source attribution, owner routing, task
    // creation, owner notification, dry-run-gated acknowledgement, and starts
    // the 15-minute SLA clock — replacing the old unconditional real
    // WhatsApp send that used to live here.
    let lead
    if (phone) {
      ({ lead } = await findOrCreateLeadForChannel({
        where: { phone, status: { notIn: ['CONVERTED', 'LOST'] } },
        createData,
        onExistingMessage: lastMessage || undefined,
      }))
    } else {
      lead = await prisma.lead.create({ data: createData })
      handleNewLeadCreated(lead).catch((e: any) => console.error('[CRM] New lead automation failed:', e?.message))
    }

    res.status(201).json(lead)
  } catch (e) {
    res.status(500).json({ error: 'Failed to create lead' })
  }
})

router.get('/leads/:id', requireAuth, adminAndReceptionist, async (req: Request, res: Response) => {
  try {
    const lead = await prisma.lead.findUnique({ where: { id: req.params.id } })
    if (!lead) return res.status(404).json({ error: 'Lead not found' })
    res.json(lead)
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch lead' })
  }
})

// `status` (and its mirror `stage`) is intentionally excluded from the
// free-form field update below. Lead.status has exactly one legitimate write
// path — transitionLeadStage() (lead-stage.service.ts) — which is what
// records LeadStageHistory, enforces the LOST-reason requirement, and emits
// automation events. Writing `status` directly here used to silently bypass
// all of that (confirmed in production: leads reached CONTACTED with zero
// LeadStageHistory rows). A caller that wants to change stage is now routed
// through the same service every other stage-change entry point uses.
router.patch('/leads/:id', requireAuth, adminAndReceptionist, async (req: Request, res: Response) => {
  const { status, score, notes, name, phone, email, lastMessage, convertedToPatientId, assignedTo, reason } = req.body
  try {
    if (status !== undefined) {
      await transitionLeadStage(req.params.id, status, { changedBy: req.user!.id, trigger: 'MANUAL', reason })
    }

    const data: any = {}
    if (score               !== undefined) data.score = score
    if (notes               !== undefined) data.notes = notes
    if (name                !== undefined) data.name = name
    if (phone               !== undefined) data.phone = phone
    if (email               !== undefined) data.email = email
    if (lastMessage         !== undefined) data.lastMessage = lastMessage
    if (convertedToPatientId !== undefined) data.convertedToPatientId = convertedToPatientId
    // assignedTo stores a User.id (the same id space the frontend already
    // reads from GET /employees and from the logged-in user's own record) —
    // validated here since Lead.assignedTo carries no Prisma foreign key.
    if (assignedTo          !== undefined) {
      if (assignedTo === null) {
        data.assignedTo = null
      } else {
        const owner = await prisma.user.findUnique({ where: { id: String(assignedTo) }, select: { id: true } })
        if (!owner) return res.status(400).json({ error: 'assignedTo must be a valid user id' })
        data.assignedTo = owner.id
      }
    }

    const lead = Object.keys(data).length > 0
      ? await prisma.lead.update({ where: { id: req.params.id }, data })
      : await prisma.lead.findUniqueOrThrow({ where: { id: req.params.id } })
    res.json(lead)
  } catch (e: any) {
    res.status(e.message?.includes('required') ? 400 : 500).json({ error: e.message || 'Failed to update lead' })
  }
})

// Convert lead to patient
router.post('/leads/:id/convert', requireAuth, adminAndReceptionist, async (req: Request, res: Response) => {
  try {
    const lead = await prisma.lead.findUnique({ where: { id: req.params.id } })
    if (!lead) return res.status(404).json({ error: 'Lead not found' })
    if (lead.status === 'CONVERTED') return res.status(400).json({ error: 'Already converted' })

    // Split name into first/last (best effort)
    const nameParts   = (lead.name || '').trim().split(/\s+/)
    const firstName   = nameParts[0] || 'Unknown'
    const lastName    = nameParts.slice(1).join(' ') || '-'

    // Phone required for patient — use lead phone or placeholder
    const phone = lead.phone || '+256000000000'

    // Check if patient with this phone already exists
    let patient = await prisma.patient.findFirst({ where: { phone } })
    if (!patient) {
      patient = await prisma.patient.create({
        data: {
          firstName,
          lastName,
          phone,
          email:  lead.email  || null,
          status: 'UPCOMING',
        },
      })
    }

    // Link the patient, then mark CONVERTED through the single write path
    // (transitionLeadStage via convertLeadOnBooking) so this manual-convert
    // button produces the same LeadStageHistory row and automation event as
    // every other route into CONVERTED.
    await prisma.lead.update({ where: { id: lead.id }, data: { convertedToPatientId: patient.id } })
    const updated = await convertLeadOnBooking(lead.id)

    res.json({ lead: updated, patient })
  } catch (e) {
    console.error('[CRM] Convert lead error:', e)
    res.status(500).json({ error: 'Failed to convert lead' })
  }
})

router.delete('/leads/:id', requireAuth, requireRole('ADMIN'), async (req: Request, res: Response) => {
  try {
    await prisma.lead.delete({ where: { id: req.params.id } })
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete lead' })
  }
})

// Quiz Funnels moved to routes/quiz-funnels.ts (mounted at /quiz-funnels) --
// this stub passed raw objects into Quiz's String-typed questions/resultText
// columns, which Prisma would reject at runtime, and never populated
// Lead.quizId/quizAnswers. Superseded, not extended.

// ── QR Captures ──────────────────────────────────────────────────

router.get('/qr', requireAuth, adminAndReceptionist, async (_req: Request, res: Response) => {
  try {
    const captures = await prisma.qRCapture.findMany({ orderBy: { createdAt: 'desc' } })
    res.json(captures)
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch QR captures' })
  }
})

router.post('/qr', requireAuth, requireRole('ADMIN'), async (req: Request, res: Response) => {
  const { name, formConfig, destination } = req.body
  if (!name) return res.status(400).json({ error: 'Name is required' })
  try {
    const capture = await prisma.qRCapture.create({
      data: {
        name,
        formConfig:  formConfig  || {},
        destination: destination || 'CRM',
        scanCount: 0,
      },
    })
    res.status(201).json(capture)
  } catch (e) {
    res.status(500).json({ error: 'Failed to create QR capture' })
  }
})

// ── Website Visitors ──────────────────────────────────────────────

router.get('/visitors', requireAuth, adminAndReceptionist, async (_req: Request, res: Response) => {
  try {
    const visitors = await prisma.websiteVisitor.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    res.json(visitors)
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch visitors' })
  }
})

export default router
