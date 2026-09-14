import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { adminAndReceptionist, clinicalStaff } from '../middleware/rbac'
import { prisma } from '../lib/prisma'
import { checkAndSendAppointmentConfirmations, checkAndSendPostAppointmentFollowups } from '../ai-suite/scheduler/followup.service'
import { authenticatedDoctorId } from '../lib/doctor-access'
import { kampalaTomorrowRange } from '../utils/kampala-time'

const router = Router()

// GET /ai-suite/followup-report
// Returns recent FOLLOWUP and MISSED_APPOINTMENT messages sent, grouped by date.
router.get('/followup-report', requireAuth, clinicalStaff, async (req, res) => {
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const doctorId = await authenticatedDoctorId(prisma, req.user!)
    if (req.user!.role === 'DOCTOR' && !doctorId) { res.status(404).json({ error: 'Doctor record not found' }); return }
    const patientScope = doctorId ? { patient: { appointments: { some: { doctorId } } } } : {}

    const messages = await prisma.aiScheduledMessage.findMany({
      where: {
        templateType: { in: ['FOLLOWUP', 'MISSED_APPOINTMENT'] },
        sent:         true,
        scheduledFor: { gte: since },
        ...patientScope,
      },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
      },
      orderBy: { scheduledFor: 'desc' },
      take: 200,
    })

    const notes = await prisma.treatmentNote.findMany({
      where: {
        followUpStatus: { not: 'NONE' },
        updatedAt:      { gte: since },
        ...patientScope,
      },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
        author:  { select: { firstName: true, lastName: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    })

    // Batch-fetch reply status: get all USER messages from relevant phone numbers
    // since the earliest scheduledFor, to avoid N+1 queries.
    const phones = [...new Set(messages.map(m => m.patient?.phone).filter(Boolean) as string[])]
    const earliest = messages.length > 0 ? messages[messages.length - 1].scheduledFor : since

    const replyMessages = phones.length > 0 ? await prisma.aiMessage.findMany({
      where: {
        role:       'USER',
        createdAt:  { gte: earliest },
        conversation: { phoneNumber: { in: phones } },
      },
      include: { conversation: { select: { phoneNumber: true } } },
      orderBy:  { createdAt: 'asc' },
    }) : []

    const replyMap = new Map<string, typeof replyMessages>()
    for (const rm of replyMessages) {
      const phone = rm.conversation.phoneNumber
      if (!replyMap.has(phone)) replyMap.set(phone, [])
      replyMap.get(phone)!.push(rm)
    }

    const messagesWithReply = messages.map(m => {
      const phone      = m.patient?.phone
      if (!phone) return { ...m, replied: false, replyContent: null, replyAt: null }
      const replies    = replyMap.get(phone) || []
      const firstReply = replies.find(r => r.createdAt >= m.scheduledFor)
      return { ...m, replied: !!firstReply, replyContent: firstReply?.content ?? null, replyAt: firstReply?.createdAt ?? null }
    })

    res.json({ messages: messagesWithReply, notes })
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch follow-up report' })
  }
})

// GET /ai-suite/confirmation-report
// Returns:
//  - confirmations: APPOINTMENT_CONFIRMATION messages sent in the last 30 days (log view)
//  - tomorrowAppointments: EVERY real appointment for tomorrow (Kampala time), each with a
//    computed confirmationStatus reflecting only states that actually exist in the data —
//    NOT_SENT / AWAITING_REPLY / CONFIRMED / CANCEL_REQUESTED / RESCHEDULE_REQUESTED / FAILED.
//    CANCEL_REQUESTED/RESCHEDULE_REQUESTED come from the strict reply fast-path
//    (confirmation-reply.service.ts) which never itself sets Appointment.status —
//    a real "Cancelled" appointment simply drops out of this list on the next fetch
//    once staff (or the general agent flow) actually cancels it.
//  - eligibleTomorrowCount: appointments tomorrow that have NOT yet had a confirmation sent —
//    the number the frontend's "Send confirmation messages to X eligible appointments" dialog uses.
router.get('/confirmation-report', requireAuth, clinicalStaff, async (req, res) => {
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const doctorId = await authenticatedDoctorId(prisma, req.user!)
    if (req.user!.role === 'DOCTOR' && !doctorId) { res.status(404).json({ error: 'Doctor record not found' }); return }
    const patientScope = doctorId ? { patient: { appointments: { some: { doctorId } } } } : {}

    // ── Confirmation message log (last 30 days) ────────────────────────────────
    const confirmations = await prisma.aiScheduledMessage.findMany({
      where: {
        templateType: 'APPOINTMENT_CONFIRMATION',
        sent:         true,
        scheduledFor: { gte: since },
        ...patientScope,
      },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
      },
      orderBy: { scheduledFor: 'desc' },
      take: 200,
    })

    // Batch-fetch reply status for confirmation messages
    const cPhones   = [...new Set(confirmations.map(c => c.patient?.phone).filter(Boolean) as string[])]
    const cEarliest = confirmations.length > 0 ? confirmations[confirmations.length - 1].scheduledFor : since

    const cReplyMsgs = cPhones.length > 0 ? await prisma.aiMessage.findMany({
      where: {
        role:       'USER',
        createdAt:  { gte: cEarliest },
        conversation: { phoneNumber: { in: cPhones } },
      },
      include: { conversation: { select: { phoneNumber: true } } },
      orderBy:  { createdAt: 'asc' },
    }) : []

    const cReplyMap = new Map<string, typeof cReplyMsgs>()
    for (const rm of cReplyMsgs) {
      const phone = rm.conversation.phoneNumber
      if (!cReplyMap.has(phone)) cReplyMap.set(phone, [])
      cReplyMap.get(phone)!.push(rm)
    }

    const confirmationsWithReply = confirmations.map(c => {
      const phone      = c.patient?.phone
      if (!phone) return { ...c, replied: false, replyContent: null, replyAt: null }
      const replies    = cReplyMap.get(phone) || []
      const firstReply = replies.find(r => r.createdAt >= c.scheduledFor)
      return { ...c, replied: !!firstReply, replyContent: firstReply?.content ?? null, replyAt: firstReply?.createdAt ?? null }
    })

    // ── Tomorrow's real appointments, with a real confirmation status ──────────
    const { start: tomorrowStart, end: tomorrowEnd } = kampalaTomorrowRange()
    const tomorrowAppointmentsRaw = await prisma.appointment.findMany({
      where: {
        startAt: { gte: tomorrowStart, lt: tomorrowEnd },
        status:  { in: ['PENDING', 'CONFIRMED'] }, // excludes CANCELLED/NO_SHOW/RESCHEDULED/CANCELLED_RESCHEDULED
        ...(doctorId ? { doctorId } : {}),
      },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
        doctor:  { include: { user: { select: { firstName: true, lastName: true } } } },
        service: { select: { name: true } },
      },
      orderBy: { startAt: 'asc' },
      take: 200,
    })

    const tomorrowPatientIds = [...new Set(tomorrowAppointmentsRaw.map(a => a.patientId))]
    const tomorrowConfirmationMsgs = tomorrowPatientIds.length > 0 ? await prisma.aiScheduledMessage.findMany({
      where: {
        patientId:    { in: tomorrowPatientIds },
        templateType: 'APPOINTMENT_CONFIRMATION',
        sent:         true,
        scheduledFor: { gte: tomorrowStart, lt: tomorrowEnd },
      },
    }) : []
    const confirmationByPatientId = new Map(tomorrowConfirmationMsgs.map(m => [m.patientId, m]))

    const tPhones = [...new Set(tomorrowAppointmentsRaw.map(a => a.patient?.phone).filter(Boolean) as string[])]
    const tEarliest = tomorrowConfirmationMsgs.length > 0
      ? tomorrowConfirmationMsgs.reduce((min, m) => (m.createdAt < min ? m.createdAt : min), tomorrowConfirmationMsgs[0].createdAt)
      : tomorrowStart

    // AGENT messages (delivery status + confirmation-reply-fast-path tags) and
    // USER messages (raw reply detection) for these phones since the earliest send.
    const tConvMsgs = tPhones.length > 0 ? await prisma.aiMessage.findMany({
      where: {
        createdAt:    { gte: tEarliest },
        conversation: { phoneNumber: { in: tPhones } },
      },
      include: { conversation: { select: { phoneNumber: true } } },
      orderBy:  { createdAt: 'asc' },
    }) : []

    const msgsByPhone = new Map<string, typeof tConvMsgs>()
    for (const m of tConvMsgs) {
      const phone = m.conversation.phoneNumber
      if (!msgsByPhone.has(phone)) msgsByPhone.set(phone, [])
      msgsByPhone.get(phone)!.push(m)
    }

    let eligibleTomorrowCount = 0
    const tomorrowAppointments = tomorrowAppointmentsRaw.map(appt => {
      const scheduledMsg = confirmationByPatientId.get(appt.patientId)

      if (!scheduledMsg) {
        eligibleTomorrowCount++
        return {
          id: appt.id, patient: appt.patient, doctor: appt.doctor, service: appt.service,
          startAt: appt.startAt, status: appt.status,
          confirmationStatus: 'NOT_SENT' as const,
          confirmationSentAt: null, repliedAt: null, deliveryStatus: null,
        }
      }

      const phone     = appt.patient?.phone
      const phoneMsgs = phone ? (msgsByPhone.get(phone) || []) : []

      // Live delivery status: nearest AGENT message at/after the send — its
      // `status` field is kept current by the Meta status webhook (see
      // whatsapp.routes.ts) via wamid, so 'failed' here is real, not guessed.
      const agentMsg = phoneMsgs.find(m => m.role === 'AGENT' && m.createdAt >= scheduledMsg.createdAt)
      const deliveryStatus = agentMsg?.status ?? scheduledMsg.deliveryStatus ?? null

      // Strict classification tag written by the confirmation-reply fast-path (if any).
      const classifiedMsg = phoneMsgs.find(m =>
        m.role === 'AGENT' && m.createdAt >= scheduledMsg.createdAt &&
        typeof m.metadata === 'string' && m.metadata.includes('"type":"confirmation_reply"')
      )
      let classification: string | null = null
      if (classifiedMsg?.metadata) {
        try { classification = JSON.parse(classifiedMsg.metadata).classification ?? null } catch { /* ignore malformed metadata */ }
      }

      const repliedMsg = phoneMsgs.find(m => m.role === 'USER' && m.createdAt >= scheduledMsg.createdAt)

      let confirmationStatus: 'FAILED' | 'CANCEL_REQUESTED' | 'RESCHEDULE_REQUESTED' | 'CONFIRMED' | 'AWAITING_REPLY'
      if (deliveryStatus === 'failed') confirmationStatus = 'FAILED'
      else if (classification === 'CANCEL_REQUESTED') confirmationStatus = 'CANCEL_REQUESTED'
      else if (classification === 'RESCHEDULE_REQUESTED') confirmationStatus = 'RESCHEDULE_REQUESTED'
      else if (classification === 'CONFIRM' || appt.status === 'CONFIRMED') confirmationStatus = 'CONFIRMED'
      else confirmationStatus = 'AWAITING_REPLY'

      return {
        id: appt.id, patient: appt.patient, doctor: appt.doctor, service: appt.service,
        startAt: appt.startAt, status: appt.status,
        confirmationStatus,
        confirmationSentAt: scheduledMsg.createdAt,
        repliedAt: repliedMsg?.createdAt ?? null,
        deliveryStatus,
      }
    })

    res.json({ confirmations: confirmationsWithReply, tomorrowAppointments, eligibleTomorrowCount })
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch confirmation report' })
  }
})

// POST /ai-suite/trigger/followups — manually trigger post-appointment follow-up run
router.post('/trigger/followups', requireAuth, adminAndReceptionist, async (_req, res) => {
  try {
    const result = await checkAndSendPostAppointmentFollowups(true)
    res.json({ sent: result.sent, skipped: result.skipped })
  } catch (e) {
    res.status(500).json({ error: 'Failed to trigger follow-ups' })
  }
})

// POST /ai-suite/trigger/confirmations — manually trigger confirmation run (bypasses time gate).
// Awaited (not fire-and-forget) so the response can carry real counts — including
// `outsideWindow`, the count of sends that fell back to free text outside Meta's
// 24h session window — for the dashboard to surface to staff immediately.
router.post('/trigger/confirmations', requireAuth, adminAndReceptionist, async (_req, res) => {
  try {
    const result = await checkAndSendAppointmentConfirmations(true)
    res.json({ message: 'Confirmation run complete', ...result })
  } catch (e) {
    res.status(500).json({ error: 'Failed to trigger confirmations' })
  }
})

export default router
