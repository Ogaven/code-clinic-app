import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { clinicalStaff } from '../middleware/rbac'
import { prisma } from '../lib/prisma'

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
        patient: { select: { id: true, firstName: true, lastName: true } },
        author:  { select: { firstName: true, lastName: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    })

    res.json({ messages, notes })
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

    res.json({ confirmations, upcomingAppts })
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch confirmation report' })
  }
})

export default router
