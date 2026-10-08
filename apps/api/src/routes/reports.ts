import { Router } from 'express'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { adminOnly } from '../middleware/rbac'
import { buildExecutiveReport, type ExecutivePeriod } from '../services/executive-report.service'
import { sendExecutiveReportEmail } from '../services/communications/email'
import { startOfKampalaDay, endOfKampalaDay, startOfKampalaWeek, startOfKampalaMonth, startOfNextKampalaMonth, kampalaTodayRange } from '../utils/kampala-time'
import { getPatientActivitySummary, getAppointmentStatusBreakdown, getPatientsSeen, splitNewAndReturning, ATTENDED_STATUSES } from '../services/patient-analytics.service'
import { isAccepted, isDeclined, computeMoneyAtRisk } from '../services/treatment-classification.service'

const router = Router()

// Admin-only management brief. Preview is read-only; email is sent only by an
// explicit admin test-send request. No scheduler is enabled in this phase.
router.get('/executive', requireAuth, adminOnly, async (req, res) => {
  try {
    const period: ExecutivePeriod = req.query.period === 'monthly' ? 'monthly' : 'weekly'
    res.json(await buildExecutiveReport(period))
  } catch (e: any) {
    console.error('[Reports] executive error:', e.message)
    res.status(500).json({ error: 'Failed to generate executive report' })
  }
})
router.post('/executive/test-email', requireAuth, adminOnly, async (req, res) => {
  try {
    const period: ExecutivePeriod = req.body?.period === 'monthly' ? 'monthly' : 'weekly'
    const to = String(req.body?.to || '').trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { res.status(400).json({ error: 'A valid test recipient email is required' }); return }
    const report = await buildExecutiveReport(period)
    await sendExecutiveReportEmail(to, report)
    res.json({ ok: true, to, period: report.period })
  } catch (e: any) {
    console.error('[Reports] executive test email error:', e.message)
    res.status(500).json({ error: 'Failed to send executive report test email' })
  }
})

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
        appointments: { select: { status: true, createdAt: true } },
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

    // A doctor with one accepted plan out of one presentation must not appear
    // to outperform a doctor who handled a full clinic load. Count distinct
    // patients who actually reached a clinical/checkout state in this period.
    const seenStatuses = [
      'ARRIVED', 'WAITING', 'IN_OPERATORY', 'WITH_PROVIDER', 'SESSION_COMPLETE',
      'CHECKOUT', 'DEPARTED', 'COMPLETED', 'CHECKED_IN', 'IN_CHAIR', 'READY_CHECKOUT',
    ] as const
    const seenAppointments = await prisma.appointment.findMany({
      where: {
        startAt: { gte: fromDate, lte: toDate },
        status: { in: [...seenStatuses] as any },
      },
      select: {
        patientId: true,
        doctorId: true,
        doctor: { include: { user: { select: { firstName: true, lastName: true } } } },
      },
    })
    const seenByDoctor = new Map<string, Set<string>>()
    const seenDoctorNames = new Map<string, string>()
    for (const appointment of seenAppointments as any[]) {
      if (!seenByDoctor.has(appointment.doctorId)) seenByDoctor.set(appointment.doctorId, new Set())
      seenByDoctor.get(appointment.doctorId)!.add(appointment.patientId)
      if (appointment.doctor?.user) {
        seenDoctorNames.set(appointment.doctorId, `Dr. ${proper(appointment.doctor.user.firstName)} ${proper(appointment.doctor.user.lastName)}`)
      }
    }

    function proper(s: string) { return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '' }
    function patientName(p: any) { return `${proper(p.firstName)} ${proper(p.lastName)}`.trim() }

    const presented  = plans.length
    const accepted   = plans.filter((p: any) => isAccepted(p)).length
    const followUp   = plans.filter((p: any) => p.status === 'Planned').length
    const declined   = plans.filter((p: any) => isDeclined(p)).length
    const onHold     = plans.filter((p: any) => p.status === 'On Hold').length
    const inProgress = plans.filter((p: any) => p.status === 'In Progress').length
    const completed  = plans.filter((p: any) => p.status === 'Completed').length
    const acceptanceRate = presented > 0 ? Math.round((accepted / presented) * 100) : 0

    // Shared definition (treatment-classification.service.ts), same number
    // pipeline.ts's "Money at Risk" KPI card shows — not a second, possibly
    // disagreeing definition of the same metric name.
    const moneyAtRisk = computeMoneyAtRisk(
      (plans as any[]).map(p => ({ status: p.status, appointments: p.appointments, value: Math.round(p.costPerUnit * p.quantity - p.discount) })),
    )

    // Per-doctor breakdown with patient lists
    const doctorMap = new Map<string, {
      id: string
      name: string
      presented: number; accepted: number; declined: number; followUp: number; onHold: number
      highValuePresented: number; highValueAccepted: number
      patients: { accepted: PatientEntry[]; declined: PatientEntry[]; pending: PatientEntry[] }
    }>()

    // Explicitly requested revenue-driving procedures. Keep this list narrow
    // and auditable rather than guessing from patient names or financial data.
    const highValueProcedure = (service: string) =>
      /\b(crown|crowns|aligner|aligners|brace|braces)\b/i.test(service)

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
          highValuePresented: 0, highValueAccepted: 0,
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
      const isHighValue = highValueProcedure(String(svcName || ''))
      if (isHighValue) entry.highValuePresented++

      if (isAccepted(plan))                                    { entry.accepted++; if (isHighValue) entry.highValueAccepted++; entry.patients.accepted.push(row) }
      else if (isDeclined(plan))                               { entry.declined++;  entry.patients.declined.push(row) }
      else if (plan.status === 'Planned')                      { entry.followUp++;  entry.patients.pending.push(row) }
      else if (plan.status === 'On Hold')                      { entry.onHold++ }
    }

    // Include doctors who saw patients even when no treatment plan was created;
    // otherwise low/zero presentation activity disappears from the report.
    for (const [doctorId, patientIds] of seenByDoctor) {
      if (!doctorMap.has(doctorId)) {
        doctorMap.set(doctorId, {
          id: doctorId,
          name: seenDoctorNames.get(doctorId) ?? 'Unknown doctor',
          presented: 0, accepted: 0, declined: 0, followUp: 0, onHold: 0,
          highValuePresented: 0, highValueAccepted: 0,
          patients: { accepted: [], declined: [], pending: [] },
        })
      }
    }

    const activeVolumes = Array.from(seenByDoctor.values()).map(s => s.size).filter(n => n > 0)
    const patientVolumeBenchmark = activeVolumes.length > 0
      ? Math.max(1, Math.round(activeVolumes.reduce((sum, n) => sum + n, 0) / activeVolumes.length))
      : 1

    const byDoctor = Array.from(doctorMap.values())
      .map(d => {
        const patientsSeen = seenByDoctor.get(d.id)?.size ?? 0
        const rawAcceptanceRate = d.presented > 0 ? Math.round((d.accepted / d.presented) * 100) : 0
        const volumeFactor = Math.min(1, patientsSeen / patientVolumeBenchmark)
        let acceptanceRate = Math.round(rawAcceptanceRate * volumeFactor)

        // A 100% result made only from low-volume routine cases must not read as
        // target achievement. Until at least one requested high-value procedure
        // (crown/aligner/braces) is accepted, keep the score below the 70% band.
        if (d.highValueAccepted === 0) acceptanceRate = Math.min(acceptanceRate, 69)

        return {
          ...d,
          patientsSeen,
          rawAcceptanceRate,
          patientVolumeBenchmark,
          acceptanceRate,
        }
      })
      .sort((a, b) => b.acceptanceRate - a.acceptanceRate || b.patientsSeen - a.patientsSeen)

    const scoredDoctors = byDoctor.filter(d => d.patientsSeen > 0 || d.presented > 0)
    const adjustedClinicAcceptanceRate = scoredDoctors.length > 0
      ? Math.round(scoredDoctors.reduce((sum, d) => sum + d.acceptanceRate, 0) / scoredDoctors.length)
      : 0

    res.json({
      summary: { presented, accepted, followUp, declined, onHold, completed, moneyAtRisk, acceptanceRate: adjustedClinicAcceptanceRate, rawAcceptanceRate: acceptanceRate, target: 90, patientVolumeBenchmark },
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

// Clinic-approved classifications: ordinary consultations and Check & Treat
// appointments are not review or hygiene-recall visits.
const REVIEW_SERVICES = [
  'review examination',
  'myobrace review',
  'aligners review',
  'orthodontic review appointment',
]
const RECALL_SERVICES = [
  'periodontal maintenance',
  'recall hygiene visit',
]
function normalizedServiceName(service: { name: string; category: string } | null): string {
  return (service?.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\\s+/g, ' ')
}
function isReview(service: { name: string; category: string } | null): boolean {
  return REVIEW_SERVICES.includes(normalizedServiceName(service))
}
function isRecall(service: { name: string; category: string } | null): boolean {
  return RECALL_SERVICES.includes(normalizedServiceName(service))
}
function isReviewOrRecall(service: { name: string; category: string } | null): boolean {
  return isReview(service) || isRecall(service)
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
    // "attended appointments" (an appointment-count) is a different quantity
    // from "Patients Seen" (a distinct-patient count) whenever any patient
    // has more than one attended appointment in the period — a patient with
    // two visits this week is one "Patient Seen" but two attended
    // appointments. The Total Scheduled reconciliation below is an
    // appointment-level equation, so it must use the appointment count;
    // "Patients Seen" (below) must use the patient count so it reconciles
    // exactly against New + Active, matching the same definition Dashboard
    // uses (clinical.ts) via this same canonical service.
    const appointmentsAttended = statusBreakdown.buckets.seen
    const newPatients       = activitySummary.newPatients
    const returningPatients = activitySummary.returningPatients
    const totalSeen         = newPatients + returningPatients
    // Reviews/Recalls is a sub-classification WITHIN the seen population
    // (the original business definition), not a tag over every scheduled
    // appointment regardless of outcome — an appointment that was cancelled
    // or never attended was never actually "reviewed". Scoping to
    // ATTENDED_STATUSES keeps this consistent with how "seen" is defined
    // everywhere else (patient-analytics.service.ts) and keeps it a strict
    // subset of totalSeen, never double-counted against the reconciled
    // Confirmed/Pending/Cancelled/No-show/Seen buckets that sum to
    // totalScheduled above.
    const reviews           = appts.filter((a: any) => ATTENDED_STATUSES.includes(a.status) && isReviewOrRecall(a.service)).length

    // Cancelled / No-show that haven't rebooked any future appointment, plus
    // Pending appointments whose scheduled time has already passed without
    // ever being confirmed or attended — staff never heard back and the slot
    // has now lapsed, so it genuinely needs follow-up the same way a
    // cancellation does. (Pending appointments still in the future are not
    // "needing follow-up" yet — the confirmation workflow still has time to
    // reach the patient normally.)
    const dnAppts      = appts.filter((a: any) => a.status === 'CANCELLED' || a.status === 'NO_SHOW')
    const dnIds        = [...new Set(dnAppts.map((a: any) => a.patientId as string))]
    const now          = new Date()
    const overduePendingAppts = appts.filter((a: any) => a.status === 'PENDING' && (a.startAt as Date) < now)

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

    // Follow-up list: cancelled/no-show patients who haven't rebooked, plus
    // overdue-pending patients. Each appointment lands in exactly one of
    // these buckets (CANCELLED/NO_SHOW/PENDING are mutually exclusive
    // AppointmentStatus values), so no appointment is listed twice.
    const followUpAppts = [
      ...dnAppts.filter((a: any) => !hasRebooked.has(a.patientId)),
      ...overduePendingAppts,
    ]

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

    // Read-only drill-down records use the same canonical patient classification
    // as the displayed metrics. Imported patients with unknown history remain
    // excluded from New/Active and from the reconciled Patients Seen count.
    const seen = await getPatientsSeen(range)
    const classified = await splitNewAndReturning(seen.patientIds, start)
    const classifiedIds = new Set([...classified.newIds, ...classified.returningIds])
    const newIds = new Set(classified.newIds)
    const returningIds = new Set(classified.returningIds)
    const patientRows = new Map<string, any>()
    for (const a of appts as any[]) {
      if (!ATTENDED_STATUSES.includes(a.status) || !classifiedIds.has(a.patientId)) continue
      if (!patientRows.has(a.patientId)) patientRows.set(a.patientId, a)
    }
    const toRow = (a: any) => ({
      appointmentId: a.id,
      patientId: a.patientId,
      patientName: `${cproper(a.patient.firstName)} ${cproper(a.patient.lastName)}`.trim(),
      phone: a.patient.phone,
      originalDate: (a.startAt as Date).toISOString(),
      service: a.service?.name || '—',
      doctor: a.doctor?.user
        ? `Dr. ${cproper(a.doctor.user.firstName)} ${cproper(a.doctor.user.lastName)}`
        : '—',
    })
    const patientDrilldowns = {
      seen: [...patientRows.entries()].filter(([id]) => classifiedIds.has(id)).map(([, a]) => toRow(a)),
      new: [...patientRows.entries()].filter(([id]) => newIds.has(id)).map(([, a]) => toRow(a)),
      active: [...patientRows.entries()].filter(([id]) => returningIds.has(id)).map(([, a]) => toRow(a)),
      reviews: (appts as any[]).filter(a => ATTENDED_STATUSES.includes(a.status) && isReviewOrRecall(a.service)).map(toRow),
    }

    res.json({
      period:  { view, start: start.toISOString(), end: end.toISOString(), label },
      metrics: { totalScheduled, appointmentsAttended, totalSeen, newPatients, returningPatients,
                 reviews, confirmed, pending, cancelled, rescheduled, noShows },
      followUpList,
      patientDrilldowns,
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
