import { Router, Request, Response } from 'express'
import { requireAuth } from '../middleware/auth'
import { requireRole } from '../middleware/rbac'
import { prisma } from '../lib/prisma'
import { sendWhatsAppMessage } from '../ai-suite/whatsapp/whatsapp.service'
import { phoneVariants } from '../utils/phone'

const router = Router()

// ── Leads ────────────────────────────────────────────────────────

router.get('/leads', requireAuth, async (req: Request, res: Response) => {
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

router.post('/leads', requireAuth, async (req: Request, res: Response) => {
  const { name, phone, email, source, status, notes, lastMessage } = req.body
  if (!source) return res.status(400).json({ error: 'Source is required' })
  try {
    const lead = await prisma.lead.create({
      data: {
        name:        name        || null,
        phone:       phone       || null,
        email:       email       || null,
        source:      source,
        status:      status      || 'NEW',
        stage:       status      || 'NEW',
        notes:       notes       || null,
        lastMessage: lastMessage || null,
      },
    })
    res.status(201).json(lead)
    // FIX 3 — Warm Sarah message for manually-added leads with a phone number
    if (phone) {
      const firstName = (name || '').trim().split(' ')[0] || 'there'
      const warmMsg = `Hi ${firstName}! 😊 Thanks for reaching out to Code Clinic. We received your message and one of our team will be in touch shortly. Is there anything else I can help you with in the meantime?`
      sendWhatsAppMessage(String(phone), warmMsg).catch((e: any) =>
        console.error('[CRM] Lead warm message failed:', e?.message)
      )
    }
  } catch (e) {
    res.status(500).json({ error: 'Failed to create lead' })
  }
})

router.get('/leads/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const lead = await prisma.lead.findUnique({ where: { id: req.params.id } })
    if (!lead) return res.status(404).json({ error: 'Lead not found' })
    res.json(lead)
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch lead' })
  }
})

router.patch('/leads/:id', requireAuth, async (req: Request, res: Response) => {
  const { status, stage, score, notes, name, phone, email, lastMessage, convertedToPatientId } = req.body
  try {
    const data: any = {}
    if (status              !== undefined) { data.status = status; data.stage = status }
    if (stage               !== undefined) data.stage = stage
    if (score               !== undefined) data.score = score
    if (notes               !== undefined) data.notes = notes
    if (name                !== undefined) data.name = name
    if (phone               !== undefined) data.phone = phone
    if (email               !== undefined) data.email = email
    if (lastMessage         !== undefined) data.lastMessage = lastMessage
    if (convertedToPatientId !== undefined) data.convertedToPatientId = convertedToPatientId
    const lead = await prisma.lead.update({ where: { id: req.params.id }, data })
    res.json(lead)
  } catch (e) {
    res.status(500).json({ error: 'Failed to update lead' })
  }
})

// Convert lead to patient
router.post('/leads/:id/convert', requireAuth, async (req: Request, res: Response) => {
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

    // Mark lead as CONVERTED
    const updated = await prisma.lead.update({
      where: { id: lead.id },
      data:  { status: 'CONVERTED', stage: 'CONVERTED', convertedToPatientId: patient.id },
    })

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

router.get('/qr', requireAuth, async (_req: Request, res: Response) => {
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

router.get('/visitors', requireAuth, async (_req: Request, res: Response) => {
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
