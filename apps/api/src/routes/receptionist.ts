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

// ─── GET /receptionist/escalations ───────────────────────────
router.get('/escalations', requireAuth, async (_req, res) => {
  try {
    const todayStart = kampalaDay(0)
    const escalations = await prisma.agentLog.findMany({
      where: { escalated: true, createdAt: { gte: todayStart }, outcome: { not: 'RESOLVED' } },
      include: { patient: { select: { id: true, firstName: true, lastName: true, phone: true } } },
      orderBy: { createdAt: 'desc' },
    })
    res.json(escalations)
  } catch {
    res.status(500).json({ error: 'Failed to fetch escalations' })
  }
})

// ─── POST /receptionist/escalations/:id/resolve ──────────────
router.post('/escalations/:id/resolve', requireAuth, async (req, res) => {
  try {
    await prisma.agentLog.update({
      where: { id: req.params.id },
      data: { outcome: 'RESOLVED' },
    })
    res.json({ success: true })
  } catch {
    res.status(500).json({ error: 'Failed to resolve escalation' })
  }
})

// ─── GET /receptionist/notifications ─────────────────────────
router.get('/notifications', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id
    const notifications = await (prisma as any).notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    const unread = notifications.filter((n: any) => !n.isRead).length
    res.json({ notifications, unread })
  } catch {
    res.status(500).json({ error: 'Failed to fetch notifications' })
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
router.post('/messages/send', requireAuth, async (req, res) => {
  try {
    const { toRole, toUserId, subject, body, patientTag } = req.body
    const msg = await (prisma as any).internalMessage.create({
      data: {
        fromUserId: req.user!.id,
        toRole,
        toUserId,
        subject,
        body,
        patientTag,
      },
    })

    // Create notifications for recipients
    if (toRole) {
      const recipients = await prisma.user.findMany({ where: { role: toRole, isActive: true } })
      await Promise.all(recipients.map((u) =>
        (prisma as any).notification.create({
          data: {
            userId: u.id,
            type: 'MESSAGE',
            title: `Message from ${req.user!.firstName} ${req.user!.lastName}`,
            body: body.slice(0, 120),
            href: '/receptionist/communications',
          },
        })
      ))
    } else if (toUserId) {
      await (prisma as any).notification.create({
        data: {
          userId: toUserId,
          type: 'MESSAGE',
          title: `Message from ${req.user!.firstName} ${req.user!.lastName}`,
          body: body.slice(0, 120),
          href: '/receptionist/communications',
        },
      })
    }

    res.json(msg)
  } catch {
    res.status(500).json({ error: 'Failed to send message' })
  }
})

// ─── GET /receptionist/messages ──────────────────────────────
router.get('/messages', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id
    const role   = req.user!.role

    let where: any

    if (role === 'RECEPTIONIST' || role === 'ADMIN') {
      // Receptionists/admins see ALL messages to or from any doctor
      const doctorUsers = await prisma.user.findMany({
        where: { role: 'DOCTOR', isActive: true },
        select: { id: true },
      })
      const doctorIds = doctorUsers.map(u => u.id)
      where = {
        OR: [
          { fromUserId: { in: doctorIds } },
          { toUserId:   { in: doctorIds } },
        ],
      }
    } else {
      // Doctors see their own messages only
      where = {
        OR: [
          { fromUserId: userId },
          { toUserId: userId },
          { toRole: role },
        ],
      }
    }

    const msgs = await (prisma as any).internalMessage.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: 200,
    })

    // Enrich with sender/recipient names
    const userIds = [...new Set([
      ...msgs.map((m: any) => m.fromUserId),
      ...msgs.map((m: any) => m.toUserId).filter(Boolean),
    ])] as string[]
    const users = userIds.length > 0 ? await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, firstName: true, lastName: true, role: true },
    }) : []
    const userMap = Object.fromEntries(users.map(u => [u.id, u]))

    res.json(msgs.map((m: any) => ({
      ...m,
      fromUser: userMap[m.fromUserId] || null,
      toUser:   m.toUserId ? (userMap[m.toUserId] || null) : null,
    })))
  } catch {
    res.status(500).json({ error: 'Failed to fetch messages' })
  }
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
