import { Router } from 'express'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'

const router = Router()

type PatientEntry = { name: string; service: string; date: string; value: number }

// GET /reports/case-acceptance?from=YYYY-MM-DD&to=YYYY-MM-DD&doctorId=...
router.get('/case-acceptance', requireAuth, async (req, res) => {
  try {
    const eatOffset  = 3 * 60 * 60 * 1000
    const eatNow     = new Date(Date.now() + eatOffset)
    const defaultFrom = new Date(Date.UTC(eatNow.getUTCFullYear(), eatNow.getUTCMonth(), 1))
    const defaultTo   = new Date(Date.UTC(eatNow.getUTCFullYear(), eatNow.getUTCMonth() + 1, 0, 23, 59, 59, 999))

    const fromDate = req.query.from ? new Date((req.query.from as string) + 'T00:00:00.000Z') : defaultFrom
    const toDate   = req.query.to   ? new Date((req.query.to   as string) + 'T23:59:59.999Z') : defaultTo

    const plans = await prisma.treatmentPlan.findMany({
      where: { createdAt: { gte: fromDate, lte: toDate } },
      include: {
        patient: {
          select: {
            firstName: true,
            lastName: true,
            appointments: {
              where: {
                startAt: { gte: fromDate, lte: toDate },
                status: { not: 'CANCELLED' },
              },
              include: {
                doctor: { include: { user: { select: { id: true, firstName: true, lastName: true } } } },
              },
              orderBy: { startAt: 'asc' },
              take: 1,
            },
          },
        },
      },
    })

    // Resolve service names from serviceId (no Prisma relation on TreatmentPlan)
    const serviceIds = [...new Set(plans.map((p: any) => p.serviceId).filter(Boolean))] as string[]
    const services   = serviceIds.length > 0
      ? await prisma.service.findMany({ where: { id: { in: serviceIds } }, select: { id: true, name: true } })
      : []
    const svcMap = new Map(services.map((s: any) => [s.id, s.name]))

    function proper(s: string) { return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '' }
    function patientName(p: any) { return `${proper(p.firstName)} ${proper(p.lastName)}`.trim() }

    const presented  = plans.length
    const accepted   = plans.filter((p: any) => ['In Progress', 'Completed'].includes(p.status)).length
    const followUp   = plans.filter((p: any) => p.status === 'Planned').length
    const declined   = plans.filter((p: any) => p.status === 'Declined').length
    const onHold     = plans.filter((p: any) => p.status === 'On Hold').length
    const inProgress = plans.filter((p: any) => p.status === 'In Progress').length
    const completed  = plans.filter((p: any) => p.status === 'Completed').length
    const acceptanceRate = presented > 0 ? Math.round((accepted / presented) * 100) : 0

    // Per-doctor breakdown with patient lists
    const doctorMap = new Map<string, {
      id: string
      name: string
      presented: number; accepted: number; declined: number; followUp: number; onHold: number
      patients: { accepted: PatientEntry[]; declined: PatientEntry[]; pending: PatientEntry[] }
    }>()

    for (const plan of plans as any[]) {
      const appt       = plan.patient.appointments[0]
      const doctorKey  = appt?.doctor?.id ?? 'unassigned'
      const doctorName = appt?.doctor?.user
        ? `Dr. ${proper(appt.doctor.user.firstName)} ${proper(appt.doctor.user.lastName)}`
        : 'Unassigned'

      if (!doctorMap.has(doctorKey)) {
        doctorMap.set(doctorKey, {
          id: doctorKey, name: doctorName,
          presented: 0, accepted: 0, declined: 0, followUp: 0, onHold: 0,
          patients: { accepted: [], declined: [], pending: [] },
        })
      }

      const entry = doctorMap.get(doctorKey)!
      entry.presented++

      const svcName  = plan.serviceId ? (svcMap.get(plan.serviceId) ?? plan.stage) : plan.stage
      const dateStr  = (plan.createdAt as Date).toISOString().slice(0, 10)
      const value    = Math.round(plan.costPerUnit * plan.quantity * (1 - plan.discount / 100))
      const pName    = patientName(plan.patient)
      const row      = { name: pName, service: svcName, date: dateStr, value }

      if (['In Progress', 'Completed'].includes(plan.status)) { entry.accepted++;  entry.patients.accepted.push(row) }
      else if (plan.status === 'Declined')                     { entry.declined++;  entry.patients.declined.push(row) }
      else if (plan.status === 'Planned')                      { entry.followUp++;  entry.patients.pending.push(row) }
      else if (plan.status === 'On Hold')                      { entry.onHold++ }
    }

    const byDoctor = Array.from(doctorMap.values())
      .map(d => ({ ...d, acceptanceRate: d.presented > 0 ? Math.round((d.accepted / d.presented) * 100) : 0 }))
      .sort((a, b) => b.presented - a.presented)

    res.json({
      summary: { presented, accepted, followUp, declined, onHold, acceptanceRate, target: 90 },
      byStatus: { planned: followUp, inProgress, completed, onHold, declined },
      byDoctor,
    })
  } catch (e: any) {
    console.error('[Reports] case-acceptance error:', e.message)
    res.status(500).json({ error: 'Failed to generate case acceptance report' })
  }
})

// ─── Clinical Report ──────────────────────────────────────────────────────────

const SEEN_STATUSES = new Set([
  'ARRIVED','WAITING','IN_OPERATORY','WITH_PROVIDER','SESSION_COMPLETE',
  'CHECKOUT','DEPARTED','COMPLETED','CHECKED_IN','IN_CHAIR','READY_CHECKOUT','IN_PROGRESS',
])

const REVIEW_KEYWORDS = ['recall','review','check','consult','follow']

function isReview(service: { name: string; category: string } | null): boolean {
  if (!service) return false
  const text = (service.name + ' ' + (service.category || '')).toLowerCase()
  return REVIEW_KEYWORDS.some(k => text.includes(k))
}

function cproper(s: string) { return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '' }

function parseDayRange(dateStr: string): { start: Date; end: Date } {
  const [y, m, d] = dateStr.split('-').map(Number)
  return { start: new Date(y, m - 1, d, 0, 0, 0, 0), end: new Date(y, m - 1, d, 23, 59, 59, 999) }
}

function parseWeekRange(weekStartStr: string): { start: Date; end: Date } {
  const [y, m, d] = weekStartStr.split('-').map(Number)
  return { start: new Date(y, m - 1, d, 0, 0, 0, 0), end: new Date(y, m - 1, d + 6, 23, 59, 59, 999) }
}

function todayDateStr(): string {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`
}

function currentMondayStr(): string {
  const n = new Date()
  const day = n.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const m = new Date(n); m.setDate(n.getDate() + diff); m.setHours(0,0,0,0)
  return `${m.getFullYear()}-${String(m.getMonth()+1).padStart(2,'0')}-${String(m.getDate()).padStart(2,'0')}`
}

// GET /reports/clinical?view=daily&date=YYYY-MM-DD
// GET /reports/clinical?view=weekly&weekStart=YYYY-MM-DD
router.get('/clinical', requireAuth, async (req, res) => {
  try {
    const view = ((req.query.view as string) || 'daily') as 'daily' | 'weekly'
    let start: Date, end: Date

    if (view === 'weekly') {
      const ws = (req.query.weekStart as string) || currentMondayStr()
      ;({ start, end } = parseWeekRange(ws))
    } else {
      const ds = (req.query.date as string) || todayDateStr()
      ;({ start, end } = parseDayRange(ds))
    }

    const label = view === 'weekly'
      ? `Week of ${start.toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' })}`
      : start.toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' })

    // All appointments in the period
    const appts = await prisma.appointment.findMany({
      where: { startAt: { gte: start, lte: end } },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
        doctor:  { include: { user: { select: { firstName: true, lastName: true } } } },
        service: { select: { id: true, name: true, category: true } },
      },
      orderBy: { startAt: 'asc' },
    })

    const totalScheduled = appts.length
    const seen           = appts.filter((a: any) => SEEN_STATUSES.has(a.status))
    const reviews        = appts.filter((a: any) => isReview(a.service)).length
    const confirmed      = appts.filter((a: any) => a.status === 'CONFIRMED').length
    const pending        = appts.filter((a: any) => a.status === 'PENDING').length
    const cancelled      = appts.filter((a: any) => a.status === 'CANCELLED').length
    const noShows        = appts.filter((a: any) => a.status === 'NO_SHOW').length

    // New vs Returning — check if each seen patient has any prior completed appointment
    const seenIds = [...new Set(seen.map((a: any) => a.patientId as string))]
    const priorRows = seenIds.length
      ? await prisma.appointment.findMany({
          where: {
            patientId: { in: seenIds },
            startAt:   { lt: start },
            status:    { in: ['COMPLETED','DEPARTED','SESSION_COMPLETE'] },
          },
          select: { patientId: true },
        })
      : []
    const withPrior       = new Set((priorRows as any[]).map(a => a.patientId))
    const newPatients      = seen.filter((a: any) => !withPrior.has(a.patientId)).length
    const returningPatients = seen.filter((a: any) => withPrior.has(a.patientId)).length

    // Cancelled / No-show that haven't rebooked any future appointment
    const dnAppts = appts.filter((a: any) => a.status === 'CANCELLED' || a.status === 'NO_SHOW')
    const dnIds   = [...new Set(dnAppts.map((a: any) => a.patientId as string))]
    const now     = new Date()

    const futureRows = dnIds.length
      ? await prisma.appointment.findMany({
          where: {
            patientId: { in: dnIds },
            status:    { notIn: ['CANCELLED','CANCELLED_RESCHEDULED','NO_SHOW'] },
            startAt:   { gt: now },
          },
          select: { patientId: true },
        })
      : []
    const hasRebooked            = new Set((futureRows as any[]).map(a => a.patientId))
    const cancelledNotRescheduled = appts
      .filter((a: any) => a.status === 'CANCELLED' && !hasRebooked.has(a.patientId)).length

    // Follow-up list: cancelled/no-show patients who haven't rebooked
    const followUpAppts = dnAppts.filter((a: any) => !hasRebooked.has(a.patientId))

    // Check which appointments staff have manually "contacted"
    const followUpPatientIds = followUpAppts.map((a: any) => a.patientId)
    const contactedActivities = followUpPatientIds.length
      ? await prisma.patientActivity.findMany({
          where: { patientId: { in: followUpPatientIds }, action: 'FOLLOWUP_CONTACTED' },
          select: { metadata: true, createdAt: true },
        })
      : []

    const contactedMap = new Map<string, string>()
    for (const act of contactedActivities as any[]) {
      try {
        const meta = JSON.parse(act.metadata || '{}')
        if (meta.appointmentId && !contactedMap.has(meta.appointmentId))
          contactedMap.set(meta.appointmentId, (act.createdAt as Date).toISOString())
      } catch {}
    }

    const followUpList = followUpAppts.map((a: any) => ({
      appointmentId: a.id,
      patientId:     a.patientId,
      patientName:   `${cproper(a.patient.firstName)} ${cproper(a.patient.lastName)}`.trim(),
      phone:         a.patient.phone,
      originalDate:  (a.startAt as Date).toISOString(),
      service:       a.service?.name  || '—',
      doctor:        a.doctor?.user
        ? `Dr. ${cproper(a.doctor.user.firstName)} ${cproper(a.doctor.user.lastName)}`
        : '—',
      reason:        a.status,
      daysSince:     Math.max(0, Math.floor((now.getTime() - (a.startAt as Date).getTime()) / 86400000)),
      followUpSent:   a.followUpSent,
      followUpSentAt: a.followUpSentAt ? (a.followUpSentAt as Date).toISOString() : null,
      contactedAt:    contactedMap.get(a.id) || null,
    }))

    res.json({
      period:  { view, start: start.toISOString(), end: end.toISOString(), label },
      metrics: { totalScheduled, totalSeen: seen.length, newPatients, returningPatients,
                 reviews, confirmed, pending, cancelled, noShows, cancelledNotRescheduled },
      followUpList,
    })
  } catch (e: any) {
    console.error('[Reports] clinical error:', e.message)
    res.status(500).json({ error: 'Failed to generate clinical report' })
  }
})

// POST /reports/clinical/contact/:appointmentId  — staff marks patient as manually contacted
router.post('/clinical/contact/:appointmentId', requireAuth, async (req, res) => {
  try {
    const appt = await prisma.appointment.findUnique({
      where:  { id: req.params.appointmentId },
      select: { id: true, patientId: true },
    })
    if (!appt) { res.status(404).json({ error: 'Not found' }); return }

    const u = req.user!
    await prisma.patientActivity.create({
      data: {
        patientId: appt.patientId,
        userId:    u.id,
        userName:  `${u.firstName} ${u.lastName}`.trim() || 'Staff',
        action:    'FOLLOWUP_CONTACTED',
        metadata:  JSON.stringify({ appointmentId: appt.id }),
      },
    })
    res.json({ ok: true })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

export default router
