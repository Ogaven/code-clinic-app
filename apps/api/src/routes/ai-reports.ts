import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { adminOnly, clinicalStaff } from '../middleware/rbac'
import { prisma } from '../lib/prisma'
import { checkAndSendAppointmentConfirmations } from '../ai-suite/scheduler/followup.service'

const router = Router()

// GET /ai-suite/followup-report
// Returns recent FOLLOWUP and MISSED_APPOINTMENT messages sent, grouped by date.
router.get('/followup-report', requireAuth, clinicalStaff, async (_req, res) => {
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

    const messages = await prisma.aiScheduledMessage.findMany({
      where: {
        templateType: { in: ['FOLLOWUP', 'MISSED_APPOINTMENT'] },
        sent:         true,
        scheduledFor: { gte: since },
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
// Returns appointment confirmation messages sent in the last 30 days.
router.get('/confirmation-report', requireAuth, clinicalStaff, async (_req, res) => {
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

    const confirmations = await prisma.aiScheduledMessage.findMany({
      where: {
        templateType: 'APPOINTMENT_CONFIRMATION',
        sent:         true,
        scheduledFor: { gte: since },
      },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
      },
      orderBy: { scheduledFor: 'desc' },
      take: 200,
    })

    // Also pull corresponding appointment statuses
    const patientIds = [...new Set(confirmations.map(c => c.patientId))]
    const upcomingAppts = await prisma.appointment.findMany({
      where: {
        patientId: { in: patientIds },
        startAt:   { gte: since },
      },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true } },
        doctor:  { include: { user: { select: { firstName: true, lastName: true } } } },
        service: { select: { name: true } },
      },
      orderBy: { startAt: 'desc' },
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

    res.json({ confirmations: confirmationsWithReply, upcomingAppts })
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch confirmation report' })
  }
})

// POST /ai-suite/trigger/confirmations — manually trigger confirmation run (bypasses time gate)
router.post('/trigger/confirmations', requireAuth, adminOnly, async (_req, res) => {
  try {
    checkAndSendAppointmentConfirmations(true).catch(e => console.error('[TriggerConfirmations]', e))
    res.json({ message: 'Confirmation run triggered' })
  } catch (e) {
    res.status(500).json({ error: 'Failed to trigger confirmations' })
  }
})

export default router
