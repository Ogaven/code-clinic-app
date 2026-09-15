import { Router } from 'express'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { startOfKampalaDay, endOfKampalaDay, startOfKampalaWeek, startOfKampalaMonth, startOfNextKampalaMonth, kampalaTodayRange } from '../utils/kampala-time'
import { getPatientActivitySummary, getAppointmentStatusBreakdown, ATTENDED_STATUSES } from '../services/patient-analytics.service'

const router = Router()

type PatientEntry = { name: string; service: string; date: string; value: number }

// GET /reports/case-acceptance?from=YYYY-MM-DD&to=YYYY-MM-DD&doctorId=...
router.get('/case-acceptance', requireAuth, async (req, res) => {
  try {
    const now = new Date()
    const defaultFrom = startOfKampalaMonth(now)
    const defaultTo   = new Date(startOfNextKampalaMonth(now).getTime() - 1)

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
      // discount is a flat UGX amount, not a percentage — confirmed by the
      // patient-profile Treatment Plan form, which literally labels the field
      // "Discount (UGX)" and treats it as `costPerUnit * quantity - discount`
      // everywhere (apps/web/app/(admin)/patients/[id]/page.tsx), same as
      // pipeline.ts. This previously multiplied by (1 - discount/100), which
      // is a percentage formula applied to a currency amount — for any plan
      // with a real UGX discount (e.g. 100,000), that produced wildly wrong
      // (often deeply negative) values instead of a simple subtraction.
      const value    = Math.round(plan.costPerUnit * plan.quantity - plan.discount)
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
// Status breakdown / patient-activity numbers below come from the canonical
// patient-analytics.service.ts (shared with Dashboard) rather than a
// locally-duplicated status set.

const REVIEW_KEYWORDS = ['recall','review','check','consult','follow']

function isReview(service: { name: string; category: string } | null): boolean {
  if (!service) return false
  const text = (service.name + ' ' + (service.category || '')).toLowerCase()
  return REVIEW_KEYWORDS.some(k => text.includes(k))
}

function cproper(s: string) { return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '' }

// A browser-supplied Y-M-D (or Y-M) string names a Kampala calendar date/
// month, not a UTC one. Anchor it to a UTC instant safely inside that
// Kampala day (noon UTC = 15:00 Kampala, still the same calendar date since
// the offset is only +3h with no DST) so the shared kampala-time helpers can
// resolve the correct Kampala-midnight boundaries regardless of the API
// host's system timezone.
function kampalaAnchor(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0, 0))
}

function parseDayRange(dateStr: string): { start: Date; end: Date } {
  const [y, m, d] = dateStr.split('-').map(Number)
  const anchor = kampalaAnchor(y, m, d)
  return { start: startOfKampalaDay(anchor), end: endOfKampalaDay(anchor) }
}

function parseWeekRange(weekStartStr: string): { start: Date; end: Date } {
  const [y, m, d] = weekStartStr.split('-').map(Number)
  const start = startOfKampalaWeek(kampalaAnchor(y, m, d))
  const end   = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000)
  return { start, end }
}

function parseMonthRange(monthStr: string): { start: Date; end: Date } {
  const [y, m] = monthStr.split('-').map(Number)
  const start = startOfKampalaMonth(kampalaAnchor(y, m, 15))
  const nextY  = m === 12 ? y + 1 : y
  const nextM  = m === 12 ? 1 : m + 1
  const end    = startOfKampalaMonth(kampalaAnchor(nextY, nextM, 15))
  return { start, end }
}

// GET /reports/clinical?view=daily&date=YYYY-MM-DD
// GET /reports/clinical?view=weekly&weekStart=YYYY-MM-DD
// GET /reports/clinical?view=monthly&month=YYYY-MM
router.get('/clinical', requireAuth, async (req, res) => {
  try {
    const view = ((req.query.view as string) || 'daily') as 'daily' | 'weekly' | 'monthly'
    let start: Date, end: Date

    if (view === 'weekly') {
      if (req.query.weekStart) {
        ;({ start, end } = parseWeekRange(req.query.weekStart as string))
      } else {
        start = startOfKampalaWeek()
        end   = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000)
      }
    } else if (view === 'monthly') {
      if (req.query.month) {
        ;({ start, end } = parseMonthRange(req.query.month as string))
      } else {
        start = startOfKampalaMonth()
        end   = startOfKampalaMonth(new Date(start.getTime() + 32 * 24 * 60 * 60 * 1000))
      }
    } else {
      if (req.query.date) {
        ;({ start, end } = parseDayRange(req.query.date as string))
      } else {
        ;({ start, end } = kampalaTodayRange())
      }
    }

    const label = view === 'weekly'
      ? `Week of ${start.toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric', timeZone: 'Africa/Kampala' })}`
      : view === 'monthly'
      ? start.toLocaleDateString('en-GB', { month:'long', year:'numeric', timeZone: 'Africa/Kampala' })
      : start.toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric', timeZone: 'Africa/Kampala' })

    const range = { start, end }

    // All appointments in the period (half-open [start, end), same
    // convention as the shared patient-analytics service below, so the
    // "seen" set used for reviews/follow-up matches the canonical one).
    const appts = await prisma.appointment.findMany({
      where: { startAt: { gte: start, lt: end } },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
        doctor:  { include: { user: { select: { firstName: true, lastName: true } } } },
        service: { select: { id: true, name: true, category: true } },
      },
      orderBy: { startAt: 'asc' },
    })

    // Canonical status breakdown + patient-activity summary — shared with
    // Dashboard via patient-analytics.service.ts so both surfaces agree on
    // what "seen"/"new"/"returning" and each status bucket mean. Buckets
    // always sum exactly to scheduledTotal (every AppointmentStatus value is
    // assigned to exactly one bucket, including IMPORTED under "seen").
    const [statusBreakdown, activitySummary] = await Promise.all([
      getAppointmentStatusBreakdown(range),
      getPatientActivitySummary(range),
    ])

    const totalScheduled   = statusBreakdown.scheduledTotal
    const confirmed        = statusBreakdown.buckets.confirmed
    const pending           = statusBreakdown.buckets.pending
    const cancelled         = statusBreakdown.buckets.cancelled
    const noShows           = statusBreakdown.buckets.noShow
    const rescheduled       = statusBreakdown.buckets.rescheduled
    const totalSeen         = statusBreakdown.buckets.seen
    const newPatients       = activitySummary.newPatients
    const returningPatients = activitySummary.returningPatients
    // Reviews/Recalls is a sub-classification WITHIN the seen population
    // (the original business definition), not a tag over every scheduled
    // appointment regardless of outcome — an appointment that was cancelled
    // or never attended was never actually "reviewed". Scoping to
    // ATTENDED_STATUSES keeps this consistent with how "seen" is defined
    // everywhere else (patient-analytics.service.ts) and keeps it a strict
    // subset of totalSeen, never double-counted against the reconciled
    // Confirmed/Pending/Cancelled/No-show/Seen buckets that sum to
    // totalScheduled above.
    const reviews           = appts.filter((a: any) => ATTENDED_STATUSES.includes(a.status) && isReview(a.service)).length

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
    // Still used to drive the "Needs Follow-up" list below — whether a
    // cancelled/no-show patient has rebooked is a per-patient signal inside
    // that list, not a separate top-level reconciliation bucket (Cancelled
    // is just Cancelled — see statusBreakdown.buckets.cancelled above).
    const hasRebooked = new Set((futureRows as any[]).map(a => a.patientId))

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
      metrics: { totalScheduled, totalSeen, newPatients, returningPatients,
                 reviews, confirmed, pending, cancelled, rescheduled, noShows },
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
