import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { prisma } from '../lib/prisma'

const router = Router()

function kampalaDay(offsetDays = 0) {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Nairobi' }))
  d.setDate(d.getDate() + offsetDays)
  d.setHours(0, 0, 0, 0)
  return d
}

// ─── GET /receptionist/dashboard-stats ───────────────────────
router.get('/dashboard-stats', requireAuth, async (_req, res) => {
  try {
    const todayStart = kampalaDay(0)
    const todayEnd   = kampalaDay(1)
    const yestStart  = kampalaDay(-1)

    const [todayAppts, yestAppts, todayPatients, yestPatients, agentPrompts, escalations] = await Promise.all([
      prisma.appointment.findMany({
        where: { startAt: { gte: todayStart, lt: todayEnd } },
        include: { patient: true },
      }),
      prisma.appointment.findMany({
        where: { startAt: { gte: yestStart, lt: todayStart } },
        include: { patient: true },
      }),
      prisma.appointment.findMany({
        where: { startAt: { gte: todayStart, lt: todayEnd } },
        include: { patient: { include: { appointments: true } } },
      }),
      prisma.appointment.findMany({
        where: { startAt: { gte: yestStart, lt: todayStart } },
        include: { patient: { include: { appointments: true } } },
      }),
      prisma.agentPrompt.findMany({ where: { isActive: true } }),
      prisma.agentLog.findMany({
        where: { escalated: true, createdAt: { gte: todayStart } },
        include: { patient: true },
        orderBy: { createdAt: 'desc' },
      }),
    ])

    const confirmed = todayAppts.filter(a => a.status === 'CONFIRMED').length
    const pending   = todayAppts.filter(a => a.status === 'PENDING').length

    // New patients = first appointment ever is today
    const newToday  = todayPatients.filter(a => a.patient.appointments.length === 1).length
    const newYest   = yestPatients.filter(a => a.patient.appointments.length === 1).length
    const retToday  = todayPatients.filter(a => a.patient.appointments.length > 1).length
    const retYest   = yestPatients.filter(a => a.patient.appointments.length > 1).length

    const pct = (a: number, b: number) => b === 0 ? 0 : Math.round(((a - b) / b) * 100)

    res.json({
      appointments: {
        total: todayAppts.length,
        confirmed,
        pending,
        inProgress: todayAppts.filter(a => a.status === 'IN_PROGRESS').length,
      },
      newPatients:      { count: newToday, pctChange: pct(newToday, newYest) },
      returningPatients:{ count: retToday, pctChange: pct(retToday, retYest) },
      aiAgents: {
        active: agentPrompts.length > 0,
        count:  agentPrompts.length,
        escalationsToday: escalations.length,
      },
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to fetch stats' })
  }
})

// ─── GET /receptionist/patient-satisfaction ──────────────────
// Internal Code Clinic feedback only. This intentionally does not label these
// ratings as Google reviews while Google Business Profile review access is pending.
router.get('/patient-satisfaction', requireAuth, async (_req, res) => {
  try {
    const feedback = await prisma.patientFeedback.findMany({
      select: { rating: true, submittedAt: true },
      orderBy: { submittedAt: 'desc' },
    })

    const total = feedback.length
    const averageRating = total
      ? Math.round((feedback.reduce((sum, row) => sum + row.rating, 0) / total) * 10) / 10
      : null
    const satisfiedCount = feedback.filter(row => row.rating >= 4).length
    const satisfactionPct = total ? Math.round((satisfiedCount / total) * 100) : null

    res.json({ total, averageRating, satisfiedCount, satisfactionPct })
  } catch {
    res.status(500).json({ error: 'Failed to fetch patient satisfaction' })
  }
})

// ─── GET /receptionist/today-appointments ────────────────────
router.get('/today-appointments', requireAuth, async (req, res) => {
  try {
    const dateParam = req.query.date as string | undefined
    let start: Date, end: Date

    if (dateParam) {
      start = new Date(dateParam); start.setHours(0, 0, 0, 0)
      end   = new Date(dateParam); end.setHours(23, 59, 59, 999)
    } else {
      start = kampalaDay(0)
      end   = kampalaDay(1)
    }

    const appointments = await prisma.appointment.findMany({
      where: { startAt: { gte: start, lt: end } },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, avatarR2Key: true, phone: true } },
        doctor:  { include: { user: { select: { firstName: true, lastName: true } } } },
        service: { select: { id: true, name: true, colour: true, durationMins: true } },
      },
      orderBy: { startAt: 'asc' },
    })

    res.json(appointments)
  } catch {
    res.status(500).json({ error: 'Failed to fetch appointments' })
  }
})

// ─── GET /receptionist/active-consultation ───────────────────
router.get('/active-consultation', requireAuth, async (_req, res) => {
  try {
    const todayStart = kampalaDay(0)
    const todayEnd   = kampalaDay(1)

    const active = await prisma.appointment.findFirst({
      where: {
        status: 'IN_PROGRESS',
        startAt: { gte: todayStart, lt: todayEnd },
      },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, dob: true, gender: true, avatarR2Key: true, phone: true } },
        doctor:  { include: { user: { select: { firstName: true, lastName: true } } } },
        service: { select: { name: true, colour: true } },
      },
      orderBy: { startAt: 'asc' },
    })

    res.json(active || null)
  } catch {
    res.status(500).json({ error: 'Failed to fetch active consultation' })
  }
})

// ─── GET /receptionist/upcoming-appointments ─────────────────
router.get('/upcoming-appointments', requireAuth, async (_req, res) => {
  try {
    const now = new Date()
    const appointments = await prisma.appointment.findMany({
      where: { startAt: { gte: now }, status: { in: ['PENDING', 'CONFIRMED'] } },
      include: {
        patient: { select: { firstName: true, lastName: true } },
        doctor:  { include: { user: { select: { firstName: true, lastName: true } } } },
        service: { select: { name: true, colour: true } },
      },
      orderBy: { startAt: 'asc' },
      take: 6,
    })
    res.json(appointments)
  } catch {
    res.status(500).json({ error: 'Failed to fetch upcoming appointments' })
  }
})

// Legacy delivery-failure notifications created before the PROVIDER_HEALTH
// migration (see whatsapp.routes.ts notifyStaffOfDeliveryFailure) — type
// SYSTEM, sent to ADMIN+RECEPTIONIST, one per ~30min for as long as Meta's
// billing issue persisted. That's since been narrowed to ADMIN-only,
// PROVIDER_HEALTH-typed, per-error-code deduped notifications, but the old
// rows are still sitting in the DB (never deleted — diagnostic history is
// preserved in MetaDeliveryFailure and here) and were flooding the ordinary
// feed for anyone who hadn't cleared them. Hide them from the LIST (and
// therefore the unread count derived from it) without ever touching the
// rows themselves — a targeted filter on this exact, superseded title/type
// combination the current code path can never produce again.
export const LEGACY_DELIVERY_FAILURE_TITLE_PREFIX = '⚠️ Staff WhatsApp alerts are failing to deliver'

export function notificationFeedWhere(userId: string) {
  return {
    userId,
    NOT: { type: 'SYSTEM', title: { startsWith: LEGACY_DELIVERY_FAILURE_TITLE_PREFIX } },
  }
}

// ─── GET /receptionist/notifications ─────────────────────────
router.get('/notifications', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id
    const notifications = await (prisma as any).notification.findMany({
      where: notificationFeedWhere(userId),
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    const unread = notifications.filter((n: any) => !n.isRead).length
    res.json({ notifications, unread })
  } catch {
    res.status(500).json({ error: 'Failed to fetch notifications' })
  }
})

// ─── PUT /receptionist/notifications/:id/read ────────────────
router.put('/notifications/:id/read', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id
    await (prisma as any).notification.updateMany({
      where: { id: req.params.id, userId },
      data: { isRead: true },
    })
    res.json({ success: true })
  } catch {
    res.status(500).json({ error: 'Failed to mark notification read' })
  }
})

// ─── PUT /receptionist/notifications/mark-read ───────────────
router.put('/notifications/mark-read', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id
    await (prisma as any).notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    })
    res.json({ success: true })
  } catch {
    res.status(500).json({ error: 'Failed to mark notifications read' })
  }
})

// ─── POST /receptionist/messages/send ────────────────────────
// Internal one-to-one staff messaging. Every conversation is scoped to two users.
router.get('/messages/contacts', requireAuth, async (req, res) => {
  try {
    const role = req.user!.role
    if (!['DOCTOR', 'ADMIN', 'RECEPTIONIST'].includes(role)) return res.status(403).json({ error: 'Forbidden' })
    const roles = role === 'DOCTOR' ? ['ADMIN', 'RECEPTIONIST'] : ['DOCTOR', ...(role === 'ADMIN' ? ['RECEPTIONIST'] : ['ADMIN'])]
    const users = await prisma.user.findMany({ where: { role: { in: roles as any }, isActive: true }, select: { id: true, firstName: true, lastName: true, role: true }, orderBy: [{ firstName: 'asc' }] })
    res.json(users)
  } catch { res.status(500).json({ error: 'Failed to load staff contacts' }) }
})

router.post('/messages/send', requireAuth, async (req, res) => {
  try {
    const senderRole = req.user!.role
    const { toUserId, body } = req.body
    if (!['DOCTOR', 'ADMIN', 'RECEPTIONIST'].includes(senderRole)) return res.status(403).json({ error: 'Forbidden' })
    if (typeof body !== 'string' || !body.trim() || body.length > 5000) return res.status(400).json({ error: 'Message must contain 1–5000 characters' })
    if (typeof toUserId !== 'string' || toUserId === req.user!.id) return res.status(400).json({ error: 'Select a recipient' })
    const recipient = await prisma.user.findFirst({ where: { id: toUserId, isActive: true }, select: { id: true, role: true } })
    const allowed = senderRole === 'DOCTOR' ? ['ADMIN', 'RECEPTIONIST'] : senderRole === 'ADMIN' ? ['DOCTOR', 'RECEPTIONIST'] : ['DOCTOR', 'ADMIN']
    if (!recipient || !allowed.includes(recipient.role)) return res.status(403).json({ error: 'Recipient not permitted' })
    const msg = await (prisma as any).internalMessage.create({
      data: { fromUserId: req.user!.id, toUserId: recipient.id, subject: 'Staff Communication', body: body.trim() },
    })
    await (prisma as any).notification.create({
      data: { userId: recipient.id, type: 'MESSAGE', title: `Message from ${req.user!.firstName} ${req.user!.lastName}`, body: body.trim().slice(0, 120), href: recipient.role === 'DOCTOR' ? '/doctor/communication' : recipient.role === 'ADMIN' ? '/communication' : '/receptionist/communication' },
    })
    res.json(msg)
  } catch { res.status(500).json({ error: 'Failed to send message' }) }
})

router.get('/messages', requireAuth, async (req, res) => {
  try {
    if (!['DOCTOR', 'ADMIN', 'RECEPTIONIST'].includes(req.user!.role)) return res.status(403).json({ error: 'Forbidden' })
    const userId = req.user!.id
    // Legacy role-wide messages intentionally excluded from private chats.
    const msgs = await (prisma as any).internalMessage.findMany({
      where: { OR: [{ fromUserId: userId, toUserId: { not: null } }, { toUserId: userId }] },
      orderBy: { createdAt: 'asc' }, take: 500,
    })
    const userIds = [...new Set(msgs.flatMap((m: any) => [m.fromUserId, m.toUserId].filter(Boolean)))] as string[]
    const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true, role: true } }) : []
    const userMap = Object.fromEntries(users.map(u => [u.id, u]))
    res.json(msgs.map((m: any) => ({ ...m, fromUser: userMap[m.fromUserId] || null, toUser: m.toUserId ? userMap[m.toUserId] || null : null })))
  } catch { res.status(500).json({ error: 'Failed to fetch messages' }) }
})

router.put('/messages/:id/read', requireAuth, async (req, res) => {
  try {
    const msg = await (prisma as any).internalMessage.findFirst({ where: { id: req.params.id, toUserId: req.user!.id } })
    if (!msg) return res.status(404).json({ error: 'Message not found' })
    await (prisma as any).internalMessage.update({ where: { id: msg.id }, data: { isRead: true } })
    res.json({ success: true })
  } catch { res.status(500).json({ error: 'Failed to mark message read' }) }
})

// ─── GET /receptionist/agent-prompts ─────────────────────────
router.get('/agent-prompts', requireAuth, async (_req, res) => {
  try {
    const prompts = await prisma.agentPrompt.findMany({ orderBy: { name: 'asc' } })
    res.json(prompts)
  } catch {
    res.status(500).json({ error: 'Failed to fetch agent prompts' })
  }
})

// ─── PATCH /receptionist/agent-prompts/:id ───────────────────
router.patch('/agent-prompts/:id', requireAuth, async (req, res) => {
  try {
    const { systemPrompt, isActive } = req.body
    const prompt = await prisma.agentPrompt.update({
      where: { id: req.params.id },
      data: {
        ...(systemPrompt !== undefined && { systemPrompt, version: { increment: 1 } }),
        ...(isActive !== undefined && { isActive }),
      },
    })
    res.json(prompt)
  } catch {
    res.status(500).json({ error: 'Failed to update agent prompt' })
  }
})

// ─── GET /receptionist/call-recordings ───────────────────────
router.get('/call-recordings', requireAuth, async (_req, res) => {
  try {
    const recordings = await prisma.callRecording.findMany({
      include: {
        agentLog: {
          include: { patient: { select: { firstName: true, lastName: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    res.json(recordings)
  } catch {
    res.status(500).json({ error: 'Failed to fetch recordings' })
  }
})

// ─── GET /receptionist/knowledge-base ────────────────────────
router.get('/knowledge-base', requireAuth, async (_req, res) => {
  try {
    const items = await prisma.knowledgeBase.findMany({
      where: { chunkIndex: 0 },
      orderBy: { createdAt: 'desc' },
    })
    res.json(items)
  } catch {
    res.status(500).json({ error: 'Failed to fetch knowledge base' })
  }
})

// ─── GET /receptionist/calendar-dates ────────────────────────
router.get('/calendar-dates', requireAuth, async (req, res) => {
  try {
    const { year, month } = req.query
    const y = parseInt(year as string) || new Date().getFullYear()
    const m = parseInt(month as string) || new Date().getMonth()
    const start = new Date(y, m, 1)
    const end   = new Date(y, m + 1, 0, 23, 59, 59)

    const appointments = await prisma.appointment.findMany({
      where: { startAt: { gte: start, lte: end }, status: { not: 'CANCELLED' } },
      select: { startAt: true, status: true },
    })

    const dateMap: Record<string, number> = {}
    appointments.forEach(a => {
      const key = a.startAt.toISOString().slice(0, 10)
      dateMap[key] = (dateMap[key] || 0) + 1
    })
    res.json(dateMap)
  } catch {
    res.status(500).json({ error: 'Failed to fetch calendar dates' })
  }
})

// ─── GET /receptionist/daily-reports ─────────────────────────
router.get('/daily-reports', requireAuth, async (_req, res) => {
  try {
    const reports = await (prisma as any).dailyPatientReport.findMany({
      orderBy: { reportDate: 'desc' },
      take: 90,
    })
    res.json(reports)
  } catch {
    res.status(500).json({ error: 'Failed to fetch daily reports' })
  }
})

// ─── GET /receptionist/daily-report?date=YYYY-MM-DD ──────────
router.get('/daily-report', requireAuth, async (req, res) => {
  try {
    const dateParam = req.query.date as string | undefined
    const dateStr   = dateParam ?? new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' })
    const reportDate = new Date(dateStr + 'T00:00:00.000Z')
    const report = await (prisma as any).dailyPatientReport.findUnique({ where: { reportDate } })
    res.json(report || null)
  } catch {
    res.status(500).json({ error: 'Failed to fetch daily report' })
  }
})

// ─── POST /receptionist/daily-report ─────────────────────────
router.post('/daily-report', requireAuth, async (req, res) => {
  try {
    const { date, newPatients, oldPatients, reviewPatients, notes } = req.body
    if (!date) return res.status(400).json({ error: 'date required (YYYY-MM-DD)' })
    const reportDate = new Date(date + 'T00:00:00.000Z')
    const report = await (prisma as any).dailyPatientReport.upsert({
      where:  { reportDate },
      create: { reportDate, newPatients: newPatients ?? 0, oldPatients: oldPatients ?? 0, reviewPatients: reviewPatients ?? 0, notes: notes ?? null, submittedById: req.user!.id },
      update: { newPatients: newPatients ?? 0, oldPatients: oldPatients ?? 0, reviewPatients: reviewPatients ?? 0, notes: notes ?? null, submittedById: req.user!.id },
    })
    res.json(report)
  } catch {
    res.status(500).json({ error: 'Failed to save daily report' })
  }
})

// ─── GET /receptionist/daily-summary ─────────────────────────
router.get('/daily-summary', requireAuth, async (req, res) => {
  try {
    const dateParam = req.query.date as string | undefined
    let start: Date, end: Date

    if (dateParam) {
      start = new Date(dateParam); start.setHours(0, 0, 0, 0)
      end   = new Date(dateParam); end.setHours(23, 59, 59, 999)
    } else {
      start = kampalaDay(0)
      end   = kampalaDay(1)
    }

    const appts = await prisma.appointment.findMany({
      where: { startAt: { gte: start, lt: end } },
      include: {
        patient: { include: { appointments: { select: { id: true } } } },
      },
    })

    const scheduled   = appts.length
    const attended    = appts.filter(a => ['IN_CHAIR', 'WITH_PROVIDER', 'READY_CHECKOUT', 'COMPLETED',
      'CHECKED_IN', 'DEPARTED', 'SESSION_COMPLETE'].includes(a.status)).length
    const departed    = appts.filter(a => ['COMPLETED', 'DEPARTED'].includes(a.status)).length
    const newPatients = appts.filter(a => a.patient.appointments.length === 1).length
    const returning   = appts.filter(a => a.patient.appointments.length > 1).length
    const cancelled   = appts.filter(a => ['CANCELLED', 'CANCELLED_RESCHEDULED'].includes(a.status)).length
    const noShows     = appts.filter(a => a.status === 'NO_SHOW').length

    res.json({ scheduled, attended, departed, newPatients, returning, cancelled, noShows })
  } catch {
    res.status(500).json({ error: 'Failed to fetch daily summary' })
  }
})

export default router
