import { Router, Request, Response } from 'express'
import { requireAuth } from '../middleware/auth'
import { requireRole, adminAndReceptionist } from '../middleware/rbac'
import { prisma } from '../lib/prisma'
import { phoneVariants } from '../utils/phone'
import { verifiedPatientNameMatches, verifiedLeadPhoneMatches } from '../crm-automation/verified-booking-guards'
import { linkVerifiedBookingInTransaction } from '../crm-automation/verified-booking-transaction'
import { previewHistoricalReconciliation } from '../crm-automation/historical-reconciliation-preview.service'
import { emitAutomationEvent, exitActiveEnrollments } from '../crm-automation/automation-events.service'
import { findOrCreateLeadForChannel, handleNewLeadCreated } from '../crm-automation/lead-intake.service'
import {
  transitionLeadStage,
  convertLeadOnBooking,
  logHumanReply,
  applyQualifyingIntent,
  markLeadLostManually,
  detectCrmQualifyingIntent,
} from '../crm-automation/lead-stage.service'

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
  const { name, phone, email, source, notes, lastMessage } = req.body
  if (!source) return res.status(400).json({ error: 'Source is required' })
  try {
    // Every lead is born NEW. Same rule as PATCH above: status has exactly one
    // legitimate write path (transitionLeadStage), so a client-supplied status
    // here is ignored rather than trusted — otherwise a lead could exist as
    // CONVERTED/QUALIFIED/LOST with zero LeadStageHistory. A caller that wants
    // a different stage right after creation should PATCH it, which already
    // goes through transitionLeadStage and records the history.
    const createData = {
      name:        name        || null,
      phone:       phone       || null,
      email:       email       || null,
      source:      source,
      status:      'NEW',
      stage:       'NEW',
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

// Historical qualification must be backed by a real inbound message in a uniquely
// matched conversation. A lead's lastMessage is not trusted as proof of direction.
router.get('/leads/:id/historical-intent-evidence', requireAuth, requireRole('ADMIN'), async (req: Request, res: Response) => {
  try {
    const lead = await prisma.lead.findUnique({ where: { id: req.params.id }, select: {
      id: true, phone: true, status: true, stage: true, convertedToPatientId: true,
    } })
    if (!lead) return res.status(404).json({ error: 'Lead not found' })
    if (!['NEW', 'CONTACTED'].includes(lead.status) || lead.stage !== lead.status || lead.convertedToPatientId) {
      return res.status(409).json({ error: 'Lead is not eligible for historical qualification' })
    }
    const digits = (lead.phone ?? '').replace(/\D/g, '')
    if (digits.length < 9) return res.json({ evidenceVerified: false, candidates: [], reason: 'No sufficiently complete lead phone number' })
    const suffix = digits.slice(-9)
    const conversations = await prisma.aiConversation.findMany({
      where: { phoneNumber: { not: '' } },
      select: { id: true, phoneNumber: true, channel: true },
    })
    const matches = conversations.filter(c => {
      const normalized = c.phoneNumber.replace(/\D/g, '')
      return normalized.length >= 9 && normalized.slice(-9) === suffix
    })
    if (matches.length !== 1) {
      return res.json({ evidenceVerified: false, candidates: [], reason: matches.length === 0
        ? 'No matching conversation' : 'Multiple matching conversations; identity needs separate review' })
    }
    const messages = await prisma.aiMessage.findMany({
      where: { conversationId: matches[0].id, role: 'USER' },
      select: { id: true, content: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: 500,
    })
    const candidates = messages.flatMap(message => {
      const intent = detectCrmQualifyingIntent(message.content)
      return intent ? [{ messageId: message.id, intent, excerpt: message.content.slice(0, 300), createdAt: message.createdAt }] : []
    })
    res.json({ evidenceVerified: false, requiresStaffConfirmation: true, candidates })
  } catch (error) {
    console.error('[CRM] Historical intent evidence lookup failed:', error)
    res.status(500).json({ error: 'Failed to retrieve historical intent evidence' })
  }
})

router.post('/leads/:id/verify-historical-intent', requireAuth, requireRole('ADMIN'), async (req: Request, res: Response) => {
  const { intent, confirmedMessage, messageId } = req.body ?? {}
  if (!['asked_pricing', 'asked_availability', 'wants_appointment'].includes(intent) ||
      confirmedMessage !== true || typeof messageId !== 'string' || !messageId.trim()) {
    return res.status(400).json({ error: 'Select an original inbound message and confirm its qualifying intent' })
  }
  try {
    const lead = await prisma.lead.findUnique({ where: { id: req.params.id }, select: {
      id: true, phone: true, status: true, stage: true, convertedToPatientId: true,
    } })
    if (!lead) return res.status(404).json({ error: 'Lead not found' })
    if (!['NEW', 'CONTACTED'].includes(lead.status) || lead.stage !== lead.status || lead.convertedToPatientId) {
      return res.status(409).json({ error: 'Lead is no longer eligible for historical qualification' })
    }
    const digits = (lead.phone ?? '').replace(/\D/g, '')
    if (digits.length < 9) return res.status(409).json({ error: 'Lead phone number cannot establish conversation linkage' })
    const suffix = digits.slice(-9)
    const conversations = await prisma.aiConversation.findMany({
      where: { phoneNumber: { not: '' } }, select: { id: true, phoneNumber: true },
    })
    const matches = conversations.filter(c => {
      const normalized = c.phoneNumber.replace(/\D/g, '')
      return normalized.length >= 9 && normalized.slice(-9) === suffix
    })
    if (matches.length !== 1) return res.status(409).json({ error: 'Conversation linkage is missing or ambiguous' })
    const message = await prisma.aiMessage.findUnique({
      where: { id: messageId }, select: { id: true, conversationId: true, role: true, content: true },
    })
    if (!message || message.role !== 'USER' || message.conversationId !== matches[0].id ||
        detectCrmQualifyingIntent(message.content) !== intent) {
      return res.status(409).json({ error: 'Selected inbound message does not verify this intent for this lead' })
    }
    const result = await prisma.$transaction(async tx => {
      const updated = await tx.lead.updateMany({
        where: { id: lead.id, status: lead.status, stage: lead.stage, convertedToPatientId: null, phone: lead.phone },
        data: { status: 'QUALIFIED', stage: 'QUALIFIED', qualifyingIntent: intent },
      })
      if (updated.count !== 1) return false
      await tx.leadStageHistory.create({ data: {
        leadId: lead.id, fromStage: lead.status, toStage: 'QUALIFIED',
        changedBy: req.user!.id, trigger: 'MANUAL',
        reason: 'historical_verified_intent:' + intent + '; inbound_message_id:' + message.id,
      } })
      return true
    })
    if (!result) return res.status(409).json({ error: 'Lead changed during verification; refresh and review again' })
    res.json({ leadId: lead.id, status: 'QUALIFIED', evidenceRecorded: true, messageId: message.id })
  } catch (error) {
    console.error('[CRM] Historical qualification verification failed:', error)
    res.status(500).json({ error: 'Failed to verify historical qualification' })
  }
})

// Read-only batch evidence triage. Never mutate lead stages based on stored excerpts.
// Matching a phone suffix is only a candidate association, not verified identity.
router.get('/leads/historical-batch-evidence-preview', requireAuth, requireRole('ADMIN'), async (req: Request, res: Response) => {
  const rawPage = req.query.page
  if (rawPage !== undefined && (typeof rawPage !== 'string' || !/^[1-9]\d{0,5}$/.test(rawPage))) {
    return res.status(400).json({ error: 'page must be a positive integer' })
  }
  const page = rawPage ? Number(rawPage) : 1
  const pageSize = 50
  try {
    const where = { status: { in: ['NEW', 'CONTACTED'] }, convertedToPatientId: null }
    const [total, leads, conversations, allLeadPhones] = await Promise.all([
      prisma.lead.count({ where }),
      prisma.lead.findMany({ where, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize, take: pageSize,
        select: { id: true, name: true, phone: true, source: true, status: true, lastMessage: true } }),
      prisma.aiConversation.findMany({ where: { phoneNumber: { not: '' } },
        select: { id: true, phoneNumber: true } }),
      prisma.lead.findMany({ where: { phone: { not: null } }, select: { id: true, phone: true } }),
    ])
    const results = []
    for (const lead of leads) {
      const intent = lead.lastMessage ? detectCrmQualifyingIntent(lead.lastMessage) : null
      if (!intent) continue
      const digits = (lead.phone ?? '').replace(/\D/g, '')
      if (digits.length < 9) {
        results.push({ leadId: lead.id, leadName: lead.name, source: lead.source, status: lead.status,
          intent, evidenceStatus: 'NO_PHONE', messageId: null })
        continue
      }
      const suffix = digits.slice(-9)
      const matchingLeadCount = allLeadPhones.filter(other => {
        const number = (other.phone ?? '').replace(/\\D/g, '')
        return number.length >= 9 && number.slice(-9) === suffix
      }).length
      if (matchingLeadCount !== 1) {
        results.push({ leadId: lead.id, leadName: lead.name, source: lead.source, status: lead.status,
          intent, evidenceStatus: 'SHARED_LEAD_PHONE', messageId: null })
        continue
      }
      const matched = conversations.filter(c => {
        const number = c.phoneNumber.replace(/\D/g, '')
        return number.length >= 9 && number.slice(-9) === suffix
      })
      if (matched.length !== 1) {
        results.push({ leadId: lead.id, leadName: lead.name, source: lead.source, status: lead.status,
          intent, evidenceStatus: matched.length ? 'AMBIGUOUS_CONVERSATIONS' : 'NO_CONVERSATION', messageId: null })
        continue
      }
      // A uniquely matching phone is still only a candidate association.
      // In particular, Facebook-originated leads need channel-specific identity proof.
      if (lead.source === 'FACEBOOK' || lead.source === 'INSTAGRAM') {
        results.push({ leadId: lead.id, leadName: lead.name, source: lead.source, status: lead.status,
          intent, evidenceStatus: 'CHANNEL_IDENTITY_UNVERIFIED', messageId: null })
        continue
      }
      const messages = await prisma.aiMessage.findMany({ where: { conversationId: matched[0].id, role: 'USER' },
        select: { id: true, content: true }, take: 500, orderBy: { createdAt: 'asc' } })
      const evidence = messages.find(message => detectCrmQualifyingIntent(message.content) === intent)
      results.push({ leadId: lead.id, leadName: lead.name, source: lead.source, status: lead.status,
        intent, evidenceStatus: evidence ? 'INBOUND_MESSAGE_CANDIDATE' : 'NO_MATCHING_INBOUND_INTENT',
        messageId: evidence?.id ?? null })
    }
    res.json({ readOnly: true, stagesChanged: 0, identityVerified: false, page, pageSize, total,
      hasMore: page * pageSize < total, results })
  } catch (error) {
    console.error('[CRM] Historical batch evidence preview failed:', error)
    res.status(500).json({ error: 'Failed to preview historical evidence' })
  }
})

// Historical intent discovery is read-only. A stored lastMessage is a hint,
// not proof that a real patient replied; staff must inspect the source record.
router.get('/leads/historical-qualification-preview', requireAuth, requireRole('ADMIN'), async (req: Request, res: Response) => {
  try {
    const pageParam = req.query.page
    if (pageParam !== undefined && (typeof pageParam !== 'string' || !/^[1-9]\d{0,5}$/.test(pageParam))) {
      return res.status(400).json({ error: 'page must be a positive integer' })
    }
    const page = pageParam ? Number(pageParam) : 1
    const pageSize = 50
    const where = { status: { in: ['NEW', 'CONTACTED'] }, convertedToPatientId: null }
    const [total, leads] = await Promise.all([
      prisma.lead.count({ where }),
      prisma.lead.findMany({
        where, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize, take: pageSize,
        select: { id: true, name: true, source: true, status: true, lastMessage: true, createdAt: true },
      }),
    ])
    const candidates = leads.flatMap(lead => {
      const intent = lead.lastMessage ? detectCrmQualifyingIntent(lead.lastMessage) : null
      return intent ? [{ leadId: lead.id, leadName: lead.name, source: lead.source, currentStage: lead.status, intent, messageExcerpt: lead.lastMessage!.slice(0, 240), createdAt: lead.createdAt }] : []
    })
    res.json({ readOnly: true, evidenceVerified: false, page, pageSize, total, hasMore: page * pageSize < total, candidates })
  } catch (error) {
    console.error('[CRM] Historical qualification preview failed:', error)
    res.status(500).json({ error: 'Failed to preview historical qualification' })
  }
})

// Read-only preview for historical booking reconciliation. Do not silently
// rewrite lead stages or infer identity from a shared family phone number.
// Only an existing explicit patient link can qualify for this preview.
router.get('/leads/automatic-reconciliation-summary', requireAuth, requireRole('ADMIN'), async (_req: Request, res: Response) => {
  try {
    res.json(await previewHistoricalReconciliation())
  } catch (error) {
    console.error('[CRM] Historical reconciliation summary failed:', error)
    res.status(500).json({ error: 'Failed to preview historical reconciliation' })
  }
})

router.get('/leads/reconciliation-preview', requireAuth, adminAndReceptionist, async (req: Request, res: Response) => {
  try {
    const pageParam = req.query.page
    const page = typeof pageParam === 'string' && /^[1-9]\d{0,5}$/.test(pageParam) ? Number(pageParam) : 1
    if (pageParam !== undefined && (typeof pageParam !== 'string' || !/^[1-9]\d{0,5}$/.test(pageParam))) {
      return res.status(400).json({ error: 'page must be a positive integer (up to 6 digits)' })
    }
    const limit = 200
    const where = {
      convertedToPatientId: { not: null },
      status: { in: ['NEW', 'CONTACTED', 'QUALIFIED'] },
    }
    const total = await prisma.lead.count({ where })
    const leads = await prisma.lead.findMany({
      where,
      select: { id: true, name: true, phone: true, status: true, convertedToPatientId: true, createdAt: true },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
    })
    const candidates = []
    for (const lead of leads) {
      if (!lead.convertedToPatientId) continue
      const booking = await prisma.appointment.findFirst({
        where: {
          patientId: lead.convertedToPatientId,
          status: { notIn: ['CANCELLED', 'NO_SHOW'] },
          createdAt: { gte: lead.createdAt },
        },
        select: { id: true, startAt: true, status: true },
        orderBy: { createdAt: 'asc' },
      })
      if (booking) {
        const patient = await prisma.patient.findUnique({
          where: { id: lead.convertedToPatientId },
          select: { firstName: true, lastName: true },
        })
        candidates.push({
          leadName: lead.name,
          leadPhone: lead.phone,
          patientName: patient ? [patient.firstName, patient.lastName].filter(Boolean).join(' ') : null,
          appointmentStartAt: booking.startAt,
          appointmentStatus: booking.status,
          leadId: lead.id,
          currentStage: lead.status,
          patientId: lead.convertedToPatientId,
          appointmentId: booking.id,
        })
      }
    }
    res.json({ readOnly: true, scanned: leads.length, total, page, limit, hasMore: page * limit < total, candidates })
  } catch {
    res.status(500).json({ error: 'Failed to preview lead reconciliation' })
  }
})

// Read-only discovery for historical leads without an explicit patient link.
// A phone match is evidence for staff review, never proof of patient identity:
// family members can share a number. Never mutate stages or create links here.
router.get('/leads/unlinked-booking-review', requireAuth, adminAndReceptionist, async (req: Request, res: Response) => {
  try {
    const rawPage = req.query.page
    if (rawPage !== undefined && (typeof rawPage !== 'string' || !/^[1-9]\d{0,5}$/.test(rawPage))) {
      return res.status(400).json({ error: 'page must be a positive integer (up to 6 digits)' })
    }
    const page = rawPage ? Number(rawPage) : 1
    const limit = 50
    const where = { convertedToPatientId: null, status: { in: ['NEW', 'CONTACTED', 'QUALIFIED'] } }
    const total = await prisma.lead.count({ where })
    const leads = await prisma.lead.findMany({
      where,
      select: { id: true, name: true, phone: true, status: true, createdAt: true, source: true },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
    })
    const candidates = []
    for (const lead of leads) {
      // Exclude session IDs, Meta PSIDs and other non-telephone identifiers.
      if (!lead.phone || !/^\+?256[0-9]{9}$|^0[0-9]{9}$/.test(lead.phone)) continue
      const patients = await prisma.patient.findMany({
        where: { phone: { in: phoneVariants(lead.phone) } },
        select: { id: true, firstName: true, lastName: true },
        take: 11,
      })
      if (patients.length === 0) continue
      const matches = []
      for (const patient of patients) {
        const booking = await prisma.appointment.findFirst({
          where: { patientId: patient.id, createdAt: { gte: lead.createdAt }, status: { notIn: ['CANCELLED', 'NO_SHOW'] } },
          select: { id: true, startAt: true, status: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        })
        if (booking) matches.push({
          patientId: patient.id,
          patientName: [patient.firstName, patient.lastName].filter(Boolean).join(' '),
          appointmentId: booking.id,
          appointmentStartAt: booking.startAt,
          appointmentStatus: booking.status,
          // The matching phone is a discovery signal, not identity verification.
          evidence: 'PHONE_MATCH_WITH_QUALIFYING_BOOKING',
          requiresStaffIdentityVerification: true,
        })
      }
      if (matches.length > 0) candidates.push({
        leadId: lead.id, leadName: lead.name, currentStage: lead.status, source: lead.source,
        matchType: 'PHONE_REVIEW_ONLY', ambiguous: patients.length !== 1,
        patientCandidateCountAtLeast: patients.length, patientCandidatesTruncated: patients.length > 10,
        requiresStaffIdentityVerification: true,
        matchingPatients: matches,
      })
    }
    res.json({ readOnly: true, requiresManualVerification: true, scanned: leads.length, total, page, limit, hasMore: page * limit < total, candidates })
  } catch {
    res.status(500).json({ error: 'Failed to review unlinked bookings' })
  }
})

// Explicit staff-confirmed historical reconciliation. Never infer identity from phone alone.
// Require the exact reviewed patient, appointment, and typed full name before writing.
router.post('/leads/:id/verify-patient-booking', requireAuth, requireRole('ADMIN'), async (req: Request, res: Response) => {
  const { patientId, appointmentId, confirmedPatientName } = req.body ?? {}
  if (typeof patientId !== 'string' || !patientId.trim() ||
      typeof appointmentId !== 'string' || !appointmentId.trim() ||
      typeof confirmedPatientName !== 'string' || !confirmedPatientName.trim()) {
    return res.status(400).json({ error: 'Patient, appointment and typed patient name are required' })
  }
  try {
    const lead = await prisma.lead.findUnique({ where: { id: req.params.id } })
    if (!lead) return res.status(404).json({ error: 'Lead not found' })
    if (!['NEW', 'CONTACTED', 'QUALIFIED'].includes(lead.status) || lead.stage !== lead.status ||
        (lead.convertedToPatientId !== null && lead.convertedToPatientId !== patientId)) {
      return res.status(409).json({ error: 'Lead is no longer eligible or is linked to another patient' })
    }
    const patient = await prisma.patient.findUnique({
      where: { id: patientId }, select: { id: true, firstName: true, lastName: true, phone: true },
    })
    if (!patient) return res.status(404).json({ error: 'Patient not found' })
    if (!verifiedPatientNameMatches(confirmedPatientName, patient.firstName, patient.lastName)) {
      return res.status(400).json({ error: 'Typed name does not match the selected patient' })
    }
    if (!verifiedLeadPhoneMatches(lead.phone, patient.phone)) {
      return res.status(409).json({ error: 'Lead and patient phone numbers do not match; investigate manually' })
    }
    const appointment = await prisma.appointment.findFirst({
      where: { id: appointmentId, patientId, createdAt: { gte: lead.createdAt },
        status: { notIn: ['CANCELLED', 'NO_SHOW'] } },
      select: { id: true },
    })
    if (!appointment) return res.status(409).json({ error: 'No eligible appointment for this patient and lead' })

    // Link, stage, and audit history are one database transaction. A failed
    // history insert rolls back both mutations, leaving no partial conversion.
    // The conditional update also requires the exact stage originally reviewed,
    // so concurrent stage changes cannot produce incorrect history entries.
    const converted = await prisma.$transaction(tx =>
      linkVerifiedBookingInTransaction(tx, lead, patient.id, req.user!.id, lead.convertedToPatientId),
    )
    if (!converted) return res.status(409).json({ error: 'Lead changed during verification; refresh and retry' })

    // Post-commit automation is best-effort. A downstream event error must
    // not report a failed conversion after the database already committed.
    try {
      await exitActiveEnrollments('LEAD', lead.id, 'EXITED_BOOKED', 'appointment_booked')
    } catch (automationError) {
      console.error('[CRM] Verified booking converted; nurture exit requires review:', automationError)
    }
    // Event delivery must still be attempted if nurture cleanup fails.
    try {
      await emitAutomationEvent({
        entityType: 'LEAD', entityId: lead.id, eventType: 'lead_stage_changed',
        fromValue: lead.status, toValue: 'CONVERTED',
        metadata: { trigger: 'MANUAL', reason: 'staff_verified_patient_booking' },
      })
    } catch (automationError) {
      console.error('[CRM] Verified booking converted; stage event requires review:', automationError)
    }
    res.json({ success: true, leadId: converted.id, stage: converted.status, patientId: patient.id, appointmentId })

  } catch (error) {
    console.error('[CRM] Verified booking reconciliation failed:', error)
    res.status(500).json({ error: 'Failed to reconcile verified booking; check the lead before retrying' })
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
// LeadStageHistory rows).
//
// A generic `status` in the PATCH body is NOT passed straight to
// transitionLeadStage() any more either — that let this route bypass the
// canonical business-rule wrappers every dedicated stage-change endpoint
// uses (POST .../log-human-reply, .../qualify, .../lost, .../converted):
// LOST/CONVERTED via raw transitionLeadStage() skipped exitActiveEnrollments()
// (an active nurture sequence kept running past a lead's terminal state), and
// QUALIFIED skipped applyQualifyingIntent()'s 48h-reply/CONTACTED
// precondition. Dispatching to the same wrapper functions here closes that
// without creating a second copy of the business logic. NEW (or any other
// stage without a canonical wrapper) still falls through to
// transitionLeadStage() directly — it remains the single write path either
// way, so LeadStageHistory is always recorded.
router.patch('/leads/:id', requireAuth, adminAndReceptionist, async (req: Request, res: Response) => {
  const { status, score, notes, name, phone, email, lastMessage, convertedToPatientId, assignedTo, reason, intent } = req.body
  // Patient linkage must pass through a dedicated, validated conversion or verification route.
  // Reject even null here to prevent silent unlinking of an already-converted lead.
  if (convertedToPatientId !== undefined) {
    return res.status(400).json({ error: 'Patient linkage cannot be changed through generic lead updates; use the verified booking or conversion workflow' })
  }
  try {
    if (status !== undefined) {
      // Stage-transition failures here are always business-rule violations
      // (missing reason/intent, wrong current stage, reply window expired),
      // never a server fault — always a 400, matching every dedicated
      // stage-change endpoint's error handling.
      try {
        switch (status) {
          case 'CONTACTED':
            await logHumanReply(req.params.id, req.user!.id)
            break
          case 'QUALIFIED':
            if (!intent) return res.status(400).json({ error: 'intent is required to move a lead to QUALIFIED (e.g. "asked_pricing", "wants_appointment")' })
            await applyQualifyingIntent(req.params.id, req.user!.id, intent)
            break
          case 'LOST':
            if (!reason) return res.status(400).json({ error: 'A loss reason is required whenever a lead moves to LOST' })
            await markLeadLostManually(req.params.id, req.user!.id, reason)
            break
          case 'CONVERTED':
            return res.status(400).json({ error: 'Use verified patient booking or lead conversion workflow to move a lead to CONVERTED' })
          default:
            await transitionLeadStage(req.params.id, status, { changedBy: req.user!.id, trigger: 'MANUAL', reason })
        }
      } catch (stageError: any) {
        return res.status(400).json({ error: stageError.message || 'Failed to change lead stage' })
      }
    }

    const data: any = {}
    if (score               !== undefined) data.score = score
    if (notes               !== undefined) data.notes = notes
    if (name                !== undefined) data.name = name
    if (phone               !== undefined) data.phone = phone
    if (email               !== undefined) data.email = email
    if (lastMessage         !== undefined) data.lastMessage = lastMessage
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
    res.status(500).json({ error: e.message || 'Failed to update lead' })
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
