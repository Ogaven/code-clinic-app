import { isPatientDecision } from '../utils/treatment-decision'
import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { prisma } from '../lib/prisma'
import { authenticatedDoctorId } from '../lib/doctor-access'
import { checkAndConvertLeadOnTreatmentStart, checkAndConvertLeadsForPatients } from '../crm-automation/lead-patient-link.service'
import { syncTreatmentPlanStatusFromPipeline } from '../crm-automation/patient-tags.service'
import { checkTreatmentFollowUpTransition } from '../crm-automation/treatment-followup-transition-guard.service'
import { logAudit } from '../services/audit.service'
import { notifyUsers } from '../services/notification.service'
import { parseFollowUpFields, NON_ACTIONABLE_STATUSES } from '../utils/treatment-followup'
import { isAccepted, isDeclined, computeMoneyAtRisk, computeAvgDaysToSchedule } from '../services/treatment-classification.service'

// ── Staff operational notifications (event hooks around the existing,
// already-verified stage/status transitions — never a new status/stage) ────
//
// Fire-and-forget, wrapped so a notification failure can never break the
// underlying transition response. Full clinical detail (patient name/tooth)
// only in the in-app `body`, which only the authenticated recipient ever
// sees; the push-visible `pushBody` stays generic per the lock-screen
// privacy requirement — same split treatment-followup-alerts.service.ts
// already uses for this exact model.
// Exported (like notifyStaffOfDeliveryFailure in whatsapp.routes.ts) for
// direct unit testing rather than only through full HTTP route requests.
export async function notifyDoctorAssigned(doctorId: string, patientId: string): Promise<void> {
  try {
    const doctor = await prisma.doctor.findUnique({ where: { id: doctorId }, select: { userId: true } })
    if (!doctor) return
    await notifyUsers({
      userIds: [doctor.userId],
      type: 'SYSTEM',
      title: 'Treatment case assigned',
      body: 'A treatment case has been assigned to you. Tap to review.',
      href: `/patients/${patientId}`,
      category: 'treatment.assigned',
    })
  } catch (e: any) {
    console.error('[Pipeline] notifyDoctorAssigned failed:', e?.message)
  }
}

export async function notifyTreatmentNeedsScheduling(patientId: string): Promise<void> {
  try {
    const staff = await prisma.user.findMany({
      where: { role: { in: ['RECEPTIONIST', 'ADMIN'] }, isActive: true },
      select: { id: true },
    })
    await notifyUsers({
      userIds: staff.map(u => u.id),
      type: 'SYSTEM',
      title: 'Treatment needs scheduling',
      body: 'An accepted treatment case needs scheduling. Tap to review.',
      href: `/patients/${patientId}`,
      category: 'treatment.needs_scheduling',
    })
  } catch (e: any) {
    console.error('[Pipeline] notifyTreatmentNeedsScheduling failed:', e?.message)
  }
}

// Mirrors clinical.ts's logActivity — writes to the patient's activity
// timeline. Duplicated locally (rather than imported) since clinical.ts
// doesn't export its copy; kept intentionally identical in shape.
async function logPatientActivity(patientId: string, userId: string, userName: string, action: string) {
  try {
    await prisma.patientActivity.create({ data: { patientId, userId, userName, action } })
  } catch (e) {
    console.error('[Pipeline] activity log failed:', e)
  }
}

const router = Router()

const VALID_STAGES = [
  'Consulted',
  'Treatment Presented',
  'Accepted & Scheduled',
  'Accepted & Unscheduled',
  'Completed',
  'Declined',
  'Follow-up Due',
]

// Same vocabulary as the Treatment Plan status dropdown in the patient profile
// (apps/web/.../patients/[id]/page.tsx) and Case Acceptance's report (reports.ts).
// Kept in sync deliberately — this is the shared source of truth all three read.
const VALID_STATUSES = ['Planned', 'In Progress', 'Completed', 'On Hold', 'Declined', 'Cancelled']

function followUpAttemptError(attemptCount: number, minimumAttempts: number) {
  return {
    error: `Record at least ${minimumAttempts} contact attempts before moving an active treatment follow-up to Consultation or On Hold`,
    code: 'TREATMENT_FOLLOWUP_ATTEMPTS_REQUIRED',
    attemptCount,
    minimumAttempts,
  }
}

// ── Africa/Kampala calendar boundaries ──────────────────────────────────────
// Kampala is a fixed UTC+3 offset with no DST, so "local midnight" for any
// Y-M-D is always exactly 3 hours behind that same Y-M-D at UTC midnight.
// Computed explicitly here rather than relying on the API process's TZ env
// var (main.ts sets it, but a KPI boundary shouldn't silently depend on that).
const KAMPALA_OFFSET_MS = 3 * 60 * 60 * 1000

function kampalaYMD(d: Date = new Date()): { y: number; m: number; day: number } {
  const shifted = new Date(d.getTime() + KAMPALA_OFFSET_MS)
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth(), day: shifted.getUTCDate() }
}
function kampalaMidnightUTC(y: number, m: number, day: number): Date {
  return new Date(Date.UTC(y, m, day, 0, 0, 0, 0) - KAMPALA_OFFSET_MS)
}

type PeriodKey = 'today' | 'week' | 'month' | 'all' | 'custom'

// Resolves a period key into a half-open [start, end) UTC instant range
// (end === null means "all time", i.e. no upper or lower bound at all).
function resolvePeriod(key: string, customStart?: string, customEnd?: string): { start: Date | null; end: Date | null; label: string } {
  const { y, m, day } = kampalaYMD()

  if (key === 'today') {
    return { start: kampalaMidnightUTC(y, m, day), end: kampalaMidnightUTC(y, m, day + 1), label: 'Today' }
  }
  if (key === 'week') {
    // Monday-Sunday, same convention as AdminAppointmentsList.tsx / dashboard.
    const dow = new Date(Date.UTC(y, m, day)).getUTCDay() // 0=Sun..6=Sat
    const monday = day - (dow === 0 ? 6 : dow - 1)
    return { start: kampalaMidnightUTC(y, m, monday), end: kampalaMidnightUTC(y, m, monday + 7), label: 'This Week' }
  }
  if (key === 'month') {
    return { start: kampalaMidnightUTC(y, m, 1), end: kampalaMidnightUTC(y, m + 1, 1), label: 'This Month' }
  }
  if (key === 'custom' && customStart && customEnd) {
    const [sy, sm, sd] = customStart.split('-').map(Number)
    const [ey, em, ed] = customEnd.split('-').map(Number)
    return { start: kampalaMidnightUTC(sy, sm - 1, sd), end: kampalaMidnightUTC(ey, em - 1, ed + 1), label: `${customStart} to ${customEnd}` }
  }
  return { start: null, end: null, label: 'All Time' }
}

// GET /pipeline/treatment?period=today|week|month|all|custom&start=YYYY-MM-DD&end=YYYY-MM-DD
// Returns treatment plans enriched with service name, doctor name, computed value,
// days since creation, plus aggregate metrics for the dashboard strip.
//
// `plans` (the board) is scoped to the SAME createdAt cohort as the period-scoped
// KPI metrics below — selecting Today/Week/Month filters both together, matching
// the period selector's own promise. `period=all` returns everything, unfiltered.
// Money at Risk and Avg Days to Schedule remain deliberately all-time regardless
// of `period` — see the comment above `moneyAtRisk`.
router.get('/treatment', requireAuth, async (req, res) => {
  try {
    if (!['ADMIN', 'RECEPTIONIST', 'DOCTOR'].includes(req.user!.role)) { res.status(403).json({ error: 'Access denied' }); return }
    const doctorId = await authenticatedDoctorId(prisma, req.user!)
    if (req.user!.role === 'DOCTOR' && !doctorId) { res.status(404).json({ error: 'Doctor record not found' }); return }
    const periodKey = ((req.query.period as string) || 'month') as PeriodKey
    const { start: periodStart, end: periodEnd, label: periodLabel } =
      resolvePeriod(periodKey, req.query.start as string | undefined, req.query.end as string | undefined)
    const plans = await prisma.treatmentPlan.findMany({
      where: doctorId ? { doctorId } : {},
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, patientNumber: true } },
        doctor: { include: { user: { select: { firstName: true, lastName: true } } } },
        appointments: { select: { status: true, createdAt: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    // Batch-fetch services referenced by any plan
    const serviceIds = [...new Set(plans.map(p => p.serviceId).filter(Boolean))] as string[]
    const serviceMap = new Map<string, string>()
    if (serviceIds.length > 0) {
      const services = await prisma.service.findMany({
        where:  { id: { in: serviceIds } },
        select: { id: true, name: true },
      })
      services.forEach(s => serviceMap.set(s.id, s.name))
    }

    // Batch-fetch most recent non-cancelled appointment per patient to surface doctor name
    const patientIds = [...new Set(plans.map(p => p.patientId))]
    const doctorByPatient = new Map<string, string>()
    if (patientIds.length > 0) {
      const appts = await prisma.appointment.findMany({
        where: {
          patientId: { in: patientIds },
          status:    { notIn: ['CANCELLED'] },
        },
        include: {
          doctor: { include: { user: { select: { firstName: true, lastName: true } } } },
        },
        orderBy: { createdAt: 'desc' },
      })
      appts.forEach(a => {
        if (!doctorByPatient.has(a.patientId)) {
          doctorByPatient.set(
            a.patientId,
            `Dr. ${a.doctor.user.firstName} ${a.doctor.user.lastName}`,
          )
        }
      })
    }

    const now = new Date()

    const enriched = plans.map(p => {
      const value     = Number(p.costPerUnit) * p.quantity - Number(p.discount)
      const daysSince = Math.floor((now.getTime() - new Date(p.createdAt).getTime()) / 86_400_000)
      const treatmentName = p.serviceId
        ? (serviceMap.get(p.serviceId) || 'Unknown Service')
        : (p.notes?.split('\n')[0]?.slice(0, 60) || 'General')
      return {
        ...p,
        costPerUnit:   Number(p.costPerUnit),
        discount:      Number(p.discount),
        treatmentName,
        doctorName:    p.doctor ? `Dr. ${p.doctor.user.firstName} ${p.doctor.user.lastName}` : 'Unassigned',
        value,
        daysSince,
      }
    })

    // ── Metrics ──────────────────────────────────────────────────────────────
    // Period-scoped cohort: plans PRESENTED (createdAt) within the selected
    // window. `periodStart === null` means "all time" — every plan qualifies.
    const inPeriod = periodStart
      ? enriched.filter(p => {
          const t = new Date(p.createdAt).getTime()
          return t >= periodStart.getTime() && t < periodEnd!.getTime()
        })
      : enriched

    const presentedValue = inPeriod.reduce((s, p) => s + p.value, 0)

    // "Accepted Value" for the period = of the plans PRESENTED in this window,
    // how much value (by current status) has been accepted — the same
    // cohort-by-presentation-date methodology Case Acceptance's report uses,
    // since TreatmentPlan has no separate "accepted at" timestamp to filter by.
    // Reads TreatmentPlan.status via the shared treatment-classification
    // service — the SAME field and SAME function Case Acceptance's report
    // (reports.ts) uses, so the two can never silently disagree on what
    // "accepted" means. Previously read `stage` here instead, a field
    // that's barely ever written by any current staff-facing action (see
    // treatment-classification.service.ts's header comment) — a plan could
    // be `status: 'In Progress'` (genuinely underway) yet still read
    // `stage: 'Consulted'` (its untouched default), so this board's own
    // "Accepted" KPI could silently diverge from Case Acceptance's.
    const acceptedValue = inPeriod
      .filter(p => isAccepted(p))
      .reduce((s, p) => s + p.value, 0)

    const presentedForRate = inPeriod
      .filter(p => !isDeclined(p))
      .reduce((s, p) => s + p.value, 0)
    const conversionRate = presentedForRate > 0
      ? Math.round((acceptedValue / presentedForRate) * 100)
      : 0

    // Money at Risk and Avg Days to Schedule are deliberately NOT period-scoped.
    // Both describe CURRENT operational state — an unscheduled-but-accepted plan
    // presented three months ago is still real money at risk today, and hiding
    // it just because it wasn't presented "this week" would be actively
    // misleading, not just imprecise. Always computed from the full, unfiltered
    // pipeline regardless of the selected period — labelled "All time" in the UI.
    //
    // KNOWN GAP (not changed by this pass — see treatment-classification.
    // service.ts's header comment): this specifically needs the "accepted
    // but not yet booked" vs "accepted and scheduled" distinction, which
    // only `stage` encodes — `status` has no equivalent intermediate state.
    // Since `stage` is rarely written by any current staff-facing action,
    // this metric likely under-reports in production today. Fixing that
    // would mean deciding how/whether staff should start setting stage
    // explicitly (a workflow change), not a read-time reinterpretation —
    // intentionally left alone here. Computed via the shared
    // computeMoneyAtRisk so Case Acceptance's report can show the exact
    // same figure instead of a second, possibly-drifting definition.
    const moneyAtRisk = computeMoneyAtRisk(enriched)
    const avgDaysToSchedule = computeAvgDaysToSchedule(enriched)

    // ── Follow Up queue ─────────────────────────────────────────────────────
    // A separate, cross-cutting view of plans the patient asked to be
    // followed up on (followUpAt set) — orthogonal to the status columns
    // above, NOT a new status/stage value. A plan keeps whatever status/stage
    // it already has (Planned, On Hold, even Declined-then-reconsidered) and
    // simply also appears here while its follow-up is still outstanding.
    // Deliberately all-time like Money at Risk, not period-scoped — a
    // follow-up set last month is still live work today. Excludes the same
    // non-actionable statuses the alert scheduler already excludes (Completed/
    // Cancelled/Declined) so a resolved or declined plan can't sit in both the
    // "Declined" column and this queue at once.
    const followUps = enriched
      .filter(p => p.followUpAt && !NON_ACTIONABLE_STATUSES.includes(p.status) && p.patientDecision !== 'Declined' && p.patientDecision !== 'Deferred' && !p.clinicalReviewRequired)
      .sort((a, b) => new Date(a.followUpAt!).getTime() - new Date(b.followUpAt!).getTime())

    // Stage 1 accountability uses only explicitly scheduled, actionable cases.
    // No historical auto-enrolment or fabricated denominators.
    const assigned = followUps.filter(p => !!p.coordinatorId && !!p.nextAction?.trim())
    // Calendar-day accountability: a follow-up due later today is due today,
    // not overdue until the next Kampala calendar day begins.
    const today = kampalaYMD(now)
    const todayStart = kampalaMidnightUTC(today.y, today.m, today.day).getTime()
    const tomorrowStart = kampalaMidnightUTC(today.y, today.m, today.day + 1).getTime()
    const due = followUps.filter(p => new Date(p.followUpAt!).getTime() < tomorrowStart)
    const overdue = followUps.filter(p => new Date(p.followUpAt!).getTime() < todayStart)
    // The event log records the due-date snapshot for every new resolution.
    // Count only these verified events; historical audit entries lack this evidence.
    const resolutionEvents = await prisma.treatmentFollowUpEvent.findMany({
      where: { eventType: 'FOLLOW_UP_COMPLETED', ...(doctorId ? { treatmentPlan: { doctorId } } : {}) },
      select: { createdAt: true, previousValues: true },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    })
    const assessedCompletions = resolutionEvents.map(event => {
      const values = event.previousValues
      if (!values || typeof values !== 'object' || Array.isArray(values)) return null
      const dueAt = (values as Record<string, unknown>).followUpAt
      if (typeof dueAt !== 'string' || !Number.isFinite(Date.parse(dueAt))) return null
      const dueDay = kampalaYMD(new Date(dueAt))
      const completedDay = kampalaYMD(event.createdAt)
      const dueKey = Date.UTC(dueDay.y, dueDay.m, dueDay.day)
      const completedKey = Date.UTC(completedDay.y, completedDay.m, completedDay.day)
      return { onTime: completedKey <= dueKey }
    }).filter((event): event is { onTime: boolean } => event !== null)
    const completedOnTime = assessedCompletions.filter(event => event.onTime).length
    const coordinationMetrics = {
      active: followUps.length,
      assignedWithNextAction: assigned.length,
      assignmentCoveragePct: followUps.length ? Math.round(assigned.length / followUps.length * 100) : null,
      due: due.length,
      overdue: overdue.length,
      unassigned: followUps.filter(p => !p.coordinatorId).length,
      clinicalReviewHeld: enriched.filter(p => p.clinicalReviewRequired && !NON_ACTIONABLE_STATUSES.includes(p.status)).length,
      onTimeCompletionPct: assessedCompletions.length ? Math.round(completedOnTime / assessedCompletions.length * 100) : null,
      verifiedCompletions: assessedCompletions.length,
      completedOnTime,
      completionSampleLimit: 1000,
    }

    // Manual triage only: recently created, actionable unscheduled plans.
    // This is read-only discovery, never enrollment or automated patient contact.
    const triageCutoff = new Date(now.getTime() - 30 * 86_400_000)
    const coordinationNeedsAttention = enriched
      .filter(p => new Date(p.createdAt) >= triageCutoff && !p.followUpAt &&
        !NON_ACTIONABLE_STATUSES.includes(p.status) &&
        p.patientDecision !== 'Declined' && p.patientDecision !== 'Deferred' &&
        (!p.coordinatorId || !p.nextAction?.trim() || !p.patientDecision || p.clinicalReviewRequired))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 100)

    res.json({
      plans:   inPeriod,
      followUps,
      coordinationNeedsAttention,
      coordinationMetrics,
      metrics: { presentedValue, acceptedValue, conversionRate, moneyAtRisk, avgDaysToSchedule },
      period:  { key: periodKey, start: periodStart?.toISOString() ?? null, end: periodEnd?.toISOString() ?? null, label: periodLabel },
    })
  } catch (e) {
    console.error('[Pipeline] fetch error:', e)
    res.status(500).json({ error: 'Failed to fetch treatment pipeline' })
  }
})

// PATCH /pipeline/treatment/:id/stage
router.patch('/treatment/:id/stage', requireAuth, async (req, res) => {
  try {
    const { stage } = req.body
    if (!stage || !VALID_STAGES.includes(stage)) {
      res.status(400).json({ error: `Invalid stage. Must be one of: ${VALID_STAGES.join(', ')}` }); return
    }
    if (!['ADMIN', 'RECEPTIONIST', 'DOCTOR'].includes(req.user!.role)) { res.status(403).json({ error: 'Access denied' }); return }
    const doctorId = await authenticatedDoctorId(prisma, req.user!)
    if (req.user!.role === 'DOCTOR' && !doctorId) { res.status(404).json({ error: 'Doctor record not found' }); return }
    // Read the pre-transition stage so the notification below only fires on
    // an actual A->B change, never a no-op re-save of the same stage.
    const before = await prisma.treatmentPlan.findFirst({
      where: { id: req.params.id, ...(doctorId ? { doctorId } : {}) },
      select: { id: true, stage: true, patientId: true, followUpAt: true },
    })
    if (!before) { res.status(404).json({ error: 'Treatment plan not found' }); return }

    // Only active follow-up cases are gated. Returning to Consultation is a
    // manual follow-up disposition, so require the clinic's three separately
    // recorded contact attempts before allowing the transition.
    if (stage === 'Consulted' && before.stage !== stage && before.followUpAt) {
      const check = await checkTreatmentFollowUpTransition(before)
      if (!check.allowed) { res.status(409).json(followUpAttemptError(check.attemptCount, check.minimumAttempts)); return }
    }

    const result = await prisma.treatmentPlan.updateMany({ where: { id: req.params.id, ...(doctorId ? { doctorId } : {}) }, data: { stage } })
    if (result.count !== 1) { res.status(404).json({ error: 'Treatment plan not found' }); return }
    logAudit({ userId: req.user!.id, actionType: 'STATUS_CHANGE', entityType: 'TREATMENT_PLAN', entityId: req.params.id, entityName: `Pipeline stage -> ${stage}`, req })

    // Staff operational notification — patient accepted treatment, reception
    // needs to schedule it. Only on the actual transition into this stage,
    // never re-fired for a plan that was already there.
    if (before.stage !== stage && stage === 'Accepted & Unscheduled') {
      notifyTreatmentNeedsScheduling(before.patientId).catch(() => {})
    }

    // CRM Automation (Part C) — re-derive the patient's treatmentPlanStatus
    // CRM tag from the canonical pipeline stage (never a second source of
    // truth). Fire-and-forget: never blocks or fails the stage-update response.
    prisma.treatmentPlan.findUnique({ where: { id: req.params.id }, select: { patientId: true } })
      .then(plan => plan && syncTreatmentPlanStatusFromPipeline(plan.patientId))
      .catch((e: any) => console.error('[CrmAutomation] syncTreatmentPlanStatusFromPipeline failed:', e?.message))

    res.json({ id: req.params.id, stage })
  } catch (e) {
    console.error('[Pipeline] stage update error:', e)
    res.status(500).json({ error: 'Failed to update stage' })
  }
})

// PATCH /pipeline/treatment/:id/status — moves a card between Pipeline's board
// columns AND updates the real Treatment Plan status in one write, since the
// board now reads/writes this same field (not the separate `stage` column).
// Optionally also accepts the internal follow-up/hold fields (followUpAt,
// followUpReason, followUpNote, doctorId) in the SAME request, so the "On
// Hold" board modal can set status + follow-up details in one round trip —
// purely additive, the status write semantics below are unchanged.
router.patch('/treatment/:id/status', requireAuth, async (req, res) => {
  try {
    const { status } = req.body
    if (!status || !VALID_STATUSES.includes(status)) {
      res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` }); return
    }
    if (!['ADMIN', 'RECEPTIONIST', 'DOCTOR'].includes(req.user!.role)) { res.status(403).json({ error: 'Access denied' }); return }
    const doctorId = req.user!.role === 'DOCTOR' ? await authenticatedDoctorId(prisma, req.user!) : null
    if (req.user!.role === 'DOCTOR' && !doctorId) { res.status(404).json({ error: 'Doctor record not found' }); return }
    const { data: followUpData, error: followUpError } = parseFollowUpFields(req.body)
    if (followUpError) { res.status(400).json({ error: followUpError }); return }
    // Pre-write snapshot so a doctorId reassignment in this same request can
    // be detected as an actual A->B change below (updateMany doesn't return rows).
    const before = await prisma.treatmentPlan.findFirst({
      where: { id: req.params.id, ...(doctorId ? { doctorId } : {}) },
      select: { id: true, doctorId: true, patientId: true, status: true, followUpAt: true },
    })
    if (!before) { res.status(404).json({ error: 'Treatment plan not found' }); return }

    // A plan can be put On Hold and assigned its first follow-up in the same
    // request. That initial setup must remain possible. The three-attempt gate
    // applies only when an already-active follow-up case is manually moved to
    // On Hold after outreach has begun.
    if (status === 'On Hold' && before.status !== status && before.followUpAt) {
      const check = await checkTreatmentFollowUpTransition(before)
      if (!check.allowed) { res.status(409).json(followUpAttemptError(check.attemptCount, check.minimumAttempts)); return }
    }

    const result = await prisma.treatmentPlan.updateMany({
      where: { id: req.params.id, ...(doctorId ? { doctorId } : {}) },
      data:  { status, ...followUpData },
    })
    if (result.count !== 1) { res.status(404).json({ error: 'Treatment plan not found' }); return }
    logAudit({ userId: req.user!.id, actionType: 'STATUS_CHANGE', entityType: 'TREATMENT_PLAN', entityId: req.params.id, entityName: `Status -> ${status}`, notes: followUpData.followUpAt ? `follow-up set: ${followUpData.followUpAt}` : undefined, req })

    // Staff operational notification — a clinician was newly assigned/
    // reassigned to this case in the same request that changed status.
    if ('doctorId' in followUpData && followUpData.doctorId && followUpData.doctorId !== before.doctorId) {
      notifyDoctorAssigned(followUpData.doctorId, before.patientId).catch(() => {})
    }

    // CRM Automation (Part N) — "treatment started" -> a QUALIFIED lead
    // matching this patient auto-converts. updateMany doesn't return the
    // row, so patientId/phone are fetched with one small follow-up read,
    // only when status is actually the "started" transition.
    if (status === 'In Progress') {
      prisma.treatmentPlan.findUnique({ where: { id: req.params.id }, select: { patient: { select: { id: true, phone: true } } } })
        .then(plan => plan && checkAndConvertLeadOnTreatmentStart(plan.patient))
        .catch((e: any) => console.error('[CrmAutomation] checkAndConvertLeadOnTreatmentStart failed:', e?.message))
    }

    // CRM Automation (Part C) — re-derive the patient's treatmentPlanStatus
    // CRM tag from the canonical pipeline status on every status write.
    prisma.treatmentPlan.findUnique({ where: { id: req.params.id }, select: { patientId: true } })
      .then(plan => plan && syncTreatmentPlanStatusFromPipeline(plan.patientId))
      .catch((e: any) => console.error('[CrmAutomation] syncTreatmentPlanStatusFromPipeline failed:', e?.message))

    res.json({ id: req.params.id, status, ...followUpData })
  } catch (e) {
    console.error('[Pipeline] status update error:', e)
    res.status(500).json({ error: 'Failed to update status' })
  }
})

// GET /pipeline/treatment/coordinators — active staff eligible to own a case.
router.get('/treatment/coordinators', requireAuth, async (req, res) => {
  try {
    if (!['ADMIN', 'RECEPTIONIST', 'DOCTOR'].includes(req.user!.role)) { res.status(403).json({ error: 'Access denied' }); return }
    const staff = await prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'RECEPTIONIST'] }, isActive: true },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    })
    res.json({ coordinators: staff })
  } catch (error) {
    console.error('[Pipeline] coordinator list failed:', error)
    res.status(500).json({ error: 'Failed to load coordinators' })
  }
})

// GET /pipeline/treatment/:id/coordination-history — immutable Stage 1 event log.
router.get('/treatment/:id/coordination-history', requireAuth, async (req, res) => {
  try {
    if (!['ADMIN', 'RECEPTIONIST', 'DOCTOR'].includes(req.user!.role)) { res.status(403).json({ error: 'Access denied' }); return }
    const doctorId = await authenticatedDoctorId(prisma, req.user!)
    if (req.user!.role === 'DOCTOR' && !doctorId) { res.status(404).json({ error: 'Doctor record not found' }); return }
    const plan = await prisma.treatmentPlan.findFirst({ where: { id: req.params.id, ...(doctorId ? { doctorId } : {}) }, select: { id: true } })
    if (!plan) { res.status(404).json({ error: 'Treatment plan not found' }); return }
    const events = await prisma.treatmentFollowUpEvent.findMany({ where: { treatmentPlanId: plan.id }, orderBy: { createdAt: 'desc' }, take: 100 })
    res.json({ events })
  } catch (error) {
    console.error('[Pipeline] coordination history failed:', error)
    res.status(500).json({ error: 'Failed to load coordination history' })
  }
})

// PATCH /pipeline/treatment/:id/coordination — Stage 1 staff-only coordination.
// Deliberately separate from clinical status/stage and patient messaging.
router.patch('/treatment/:id/coordination', requireAuth, async (req, res) => {
  try {
    if (!['ADMIN', 'RECEPTIONIST', 'DOCTOR'].includes(req.user!.role)) { res.status(403).json({ error: 'Access denied' }); return }
    const doctorId = req.user!.role === 'DOCTOR' ? await authenticatedDoctorId(prisma, req.user!) : null
    if (req.user!.role === 'DOCTOR' && !doctorId) { res.status(404).json({ error: 'Doctor record not found' }); return }
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) { res.status(400).json({ error: 'Invalid request body' }); return }
    const { patientDecision, coordinatorId, clinicalReviewRequired, followUpAt } = req.body
    const changes: Record<string, any> = {}
    if ('patientDecision' in req.body) {
      if (patientDecision !== null && !isPatientDecision(patientDecision)) { res.status(400).json({ error: 'Invalid patient decision' }); return }
      changes.patientDecision = patientDecision
    }
    for (const key of ['decisionReason', 'nextAction'] as const) {
      if (key in req.body) {
        const value = req.body[key]
        if (value !== null && (typeof value !== 'string' || value.length > 2000)) { res.status(400).json({ error: 'Invalid ' + key }); return }
        changes[key] = value?.trim() || null
      }
    }
    if ('coordinatorId' in req.body) {
      if (coordinatorId !== null && (typeof coordinatorId !== 'string' || coordinatorId.length > 200 || (coordinatorId.length > 0 && !coordinatorId.trim()))) { res.status(400).json({ error: 'Invalid coordinatorId' }); return }
      if (coordinatorId) {
        const owner = await prisma.user.findFirst({ where: { id: coordinatorId, isActive: true, role: { in: ['ADMIN', 'RECEPTIONIST'] } }, select: { id: true } })
        if (!owner) { res.status(400).json({ error: 'Coordinator must be an active authorised staff member' }); return }
      }
      changes.coordinatorId = coordinatorId || null
    }
    if ('clinicalReviewRequired' in req.body) {
      if (typeof clinicalReviewRequired !== 'boolean') { res.status(400).json({ error: 'Invalid clinicalReviewRequired' }); return }
      if (clinicalReviewRequired === false && req.user!.role !== 'DOCTOR') { res.status(403).json({ error: 'A doctor must clear the clinical hold' }); return }
      changes.clinicalReviewRequired = clinicalReviewRequired
    }
    if ('followUpAt' in req.body) {
      const parsed = parseFollowUpFields({ followUpAt })
      if (parsed.error) { res.status(400).json({ error: parsed.error }); return }
      changes.followUpAt = parsed.data.followUpAt
    }
    if (!Object.keys(changes).length) { res.status(400).json({ error: 'No coordination fields provided' }); return }
    const where = { id: req.params.id, ...(doctorId ? { doctorId } : {}) }
    const before = await prisma.treatmentPlan.findFirst({ where, select: { id: true, doctorId: true, status: true, patientDecision: true, decisionReason: true, coordinatorId: true, nextAction: true, clinicalReviewRequired: true, followUpAt: true } })
    if (!before) { res.status(404).json({ error: 'Treatment plan not found' }); return }
    const effectiveDecision = changes.patientDecision !== undefined ? changes.patientDecision : before.patientDecision
    const effectiveDate = changes.followUpAt !== undefined ? changes.followUpAt : before.followUpAt
    const effectiveHold = changes.clinicalReviewRequired !== undefined ? changes.clinicalReviewRequired : before.clinicalReviewRequired
    if (effectiveDate && NON_ACTIONABLE_STATUSES.includes(before.status)) {
      res.status(409).json({ error: 'Completed, cancelled or declined treatment cannot have an active routine follow-up' }); return
    }
    if (effectiveDate && ['Declined', 'Deferred'].includes(effectiveDecision ?? '')) {
      res.status(409).json({ error: 'Declined or deferred decisions cannot retain an active routine follow-up date' }); return
    }
    if (effectiveDate && effectiveHold) {
      res.status(409).json({ error: 'Clinical-review cases must be cleared by a doctor before routine follow-up is scheduled' }); return
    }
    // Atomic write and append-only history: no partial state without its event.
    const updated = await prisma.$transaction(async tx => {
      const count = await tx.treatmentPlan.updateMany({
        where: {
          ...where,
          doctorId: before.doctorId,
          status: before.status,
          patientDecision: before.patientDecision,
          coordinatorId: before.coordinatorId,
          decisionReason: before.decisionReason,
          nextAction: before.nextAction,
          clinicalReviewRequired: before.clinicalReviewRequired,
          followUpAt: before.followUpAt,
        },
        data: changes,
      })
      if (count.count !== 1) throw new Error('COORDINATION_CHANGED')
      await tx.treatmentFollowUpEvent.create({ data: { treatmentPlanId: before.id, actorId: req.user!.id, eventType: 'COORDINATION_UPDATED', previousValues: { ...before, followUpAt: before.followUpAt?.toISOString() ?? null }, newValues: { ...changes, ...(changes.followUpAt instanceof Date ? { followUpAt: changes.followUpAt.toISOString() } : {}) } } })
      return tx.treatmentPlan.findUniqueOrThrow({ where: { id: before.id } })
    })
    res.json({ id: updated.id, patientDecision: updated.patientDecision, decisionReason: updated.decisionReason, coordinatorId: updated.coordinatorId, nextAction: updated.nextAction, clinicalReviewRequired: updated.clinicalReviewRequired, followUpAt: updated.followUpAt })
  } catch (error) {
    if (error instanceof Error && error.message === 'COORDINATION_CHANGED') { res.status(409).json({ error: 'Coordination changed by another staff member; reload and try again' }); return }
    console.error('[Pipeline] coordination update failed:', error)
    res.status(500).json({ error: 'Failed to update treatment coordination' })
  }
})

// PATCH /pipeline/treatment/:id/follow-up — sets/edits the internal follow-up
// / hold-scheduling fields WITHOUT touching `status`. For plans already On
// Hold (or any plan, per the underlying task) that need their follow-up date,
// reason, note, or assigned clinician updated after the fact. Internal-only —
// never triggers any patient-facing message.
router.patch('/treatment/:id/follow-up', requireAuth, async (req, res) => {
  try {
    if (!['ADMIN', 'RECEPTIONIST', 'DOCTOR'].includes(req.user!.role)) { res.status(403).json({ error: 'Access denied' }); return }
    const doctorId = await authenticatedDoctorId(prisma, req.user!)
    if (req.user!.role === 'DOCTOR' && !doctorId) { res.status(404).json({ error: 'Doctor record not found' }); return }
    const { data: followUpData, error: followUpError } = parseFollowUpFields(req.body)
    if (followUpError) { res.status(400).json({ error: followUpError }); return }
    if (Object.keys(followUpData).length === 0) { res.status(400).json({ error: 'No follow-up fields provided' }); return }
    // A doctor may edit follow-up details for their own plans, but must not
    // transfer plan ownership through this general-purpose follow-up endpoint.
    if (req.user!.role === 'DOCTOR' && 'doctorId' in followUpData && followUpData.doctorId !== doctorId) {
      res.status(403).json({ error: 'Doctors cannot reassign treatment ownership through follow-up editing' }); return
    }
    // General follow-up edits must not create an unowned clinical plan.
    if ('doctorId' in followUpData && !followUpData.doctorId) {
      res.status(400).json({ error: 'A treating doctor is required; follow-up editing cannot unassign the treatment plan' }); return
    }
    const before = await prisma.treatmentPlan.findFirst({
      where: { id: req.params.id, ...(doctorId ? { doctorId } : {}) },
      select: { doctorId: true, patientId: true, status: true, patientDecision: true, clinicalReviewRequired: true, followUpAt: true },
    })
    if (!before) { res.status(404).json({ error: 'Treatment plan not found' }); return }
    if ('doctorId' in followUpData && req.user!.role !== 'DOCTOR' && followUpData.doctorId !== before.doctorId) {
      const targetDoctor = await prisma.doctor.findUnique({ where: { id: followUpData.doctorId }, select: { id: true, userId: true } })
      if (!targetDoctor) { res.status(400).json({ error: 'The selected treating doctor does not exist' }); return }
      const activeUser = await prisma.user.findFirst({ where: { id: targetDoctor.userId, isActive: true, role: 'DOCTOR' }, select: { id: true } })
      if (!activeUser) { res.status(400).json({ error: 'The selected treating doctor must have an active doctor account' }); return }
    }
    const scheduledAt = 'followUpAt' in followUpData ? followUpData.followUpAt : before.followUpAt
    // An empty follow-up date must not bypass clinical-state checks when the
    // same request also changes the assigned clinician or other follow-up fields.
    if (scheduledAt && (NON_ACTIONABLE_STATUSES.includes(before.status) || ['Declined', 'Deferred'].includes(before.patientDecision ?? '') || before.clinicalReviewRequired)) {
      res.status(409).json({ error: 'This treatment is not eligible for routine follow-up scheduling' }); return
    }
    // Preserve the current clinical eligibility state and append an event in the
    // same transaction. A concurrent decision or hold must not be overwritten.
    await prisma.$transaction(async tx => {
      const result = await tx.treatmentPlan.updateMany({
        where: {
          id: req.params.id, ...(doctorId ? { doctorId } : {}),
          status: before.status, patientDecision: before.patientDecision,
          clinicalReviewRequired: before.clinicalReviewRequired, followUpAt: before.followUpAt,
          doctorId: before.doctorId,
        },
        data: followUpData,
      })
      if (result.count !== 1) throw new Error('FOLLOW_UP_CHANGED')
      await tx.treatmentFollowUpEvent.create({ data: {
        treatmentPlanId: req.params.id, actorId: req.user!.id, eventType: 'FOLLOW_UP_UPDATED',
        previousValues: { followUpAt: before.followUpAt?.toISOString() ?? null, doctorId: before.doctorId },
        newValues: {
          ...followUpData,
          ...(followUpData.followUpAt instanceof Date ? { followUpAt: followUpData.followUpAt.toISOString() } : {}),
        },
      } })
    })
    try {
      await logAudit({ userId: req.user!.id, actionType: 'UPDATE', entityType: 'TREATMENT_PLAN', entityId: req.params.id, entityName: 'Follow-up updated', notes: JSON.stringify(followUpData), req })
    } catch (auditError) {
      console.error('[Pipeline] follow-up updated but secondary audit logging failed:', auditError)
    }

    if (before && 'doctorId' in followUpData && followUpData.doctorId && followUpData.doctorId !== before.doctorId) {
      notifyDoctorAssigned(followUpData.doctorId, before.patientId).catch(() => {})
    }

    res.json({ id: req.params.id, ...followUpData })
  } catch (e) {
    if (e instanceof Error && e.message === 'FOLLOW_UP_CHANGED') { res.status(409).json({ error: 'Follow-up changed by another staff member; reload and try again' }); return }
    console.error('[Pipeline] follow-up update error:', e)
    res.status(500).json({ error: 'Failed to update follow-up' })
  }
})

// POST /pipeline/treatment/:id/follow-up/resolve — mark an internal follow-up
// as Completed or Dismissed (clearing it from the due/upcoming/overdue queue),
// or Reschedule it to a new date. Distinct from PATCH /follow-up so the board
// can offer an explicit "resolve" action with its own audit trail, separate
// from a plain date edit. Internal-only — never messages the patient.
router.post('/treatment/:id/follow-up/resolve', requireAuth, async (req, res) => {
  try {
    if (!['ADMIN', 'RECEPTIONIST', 'DOCTOR'].includes(req.user!.role)) { res.status(403).json({ error: 'Access denied' }); return }
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) { res.status(400).json({ error: 'Invalid request body' }); return }
    const { resolution, note, rescheduleTo } = req.body as { resolution: 'COMPLETED' | 'DISMISSED' | 'RESCHEDULED'; note?: string; rescheduleTo?: string }
    if (!['COMPLETED', 'DISMISSED', 'RESCHEDULED'].includes(resolution)) {
      res.status(400).json({ error: 'resolution must be COMPLETED, DISMISSED, or RESCHEDULED' }); return
    }
    if (typeof note !== 'string' || !note.trim() || note.length > 2000) { res.status(400).json({ error: 'An outcome note is required (maximum 2000 characters)' }); return }
    const doctorId = req.user!.role === 'DOCTOR' ? await authenticatedDoctorId(prisma, req.user!) : null
    if (req.user!.role === 'DOCTOR' && !doctorId) { res.status(404).json({ error: 'Doctor record not found' }); return }

    const plan = await prisma.treatmentPlan.findFirst({
      where: { id: req.params.id, ...(doctorId ? { doctorId } : {}) },
      select: { id: true, doctorId: true, patientId: true, toothNumber: true, followUpNote: true, followUpAt: true, status: true, patientDecision: true, clinicalReviewRequired: true },
    })
    if (!plan) { res.status(404).json({ error: 'Treatment plan not found' }); return }

    if (!plan.followUpAt) {
      res.status(409).json({ error: 'No active follow-up is scheduled for this treatment plan' }); return
    }
    if (resolution === 'RESCHEDULED' && (['Declined', 'Deferred'].includes(plan.patientDecision ?? '') || NON_ACTIONABLE_STATUSES.includes(plan.status))) {
      res.status(409).json({ error: 'This treatment is not eligible for routine follow-up rescheduling' }); return
    }
    if (resolution === 'RESCHEDULED' && plan.clinicalReviewRequired) { res.status(409).json({ error: 'Clinical review must be cleared before routine follow-up rescheduling' }); return }
    // A clinical hold may be dismissed or completed, but must not be rescheduled as routine outreach.
    // The hold flag itself remains unchanged until a doctor explicitly clears it.
    let newFollowUpAt: Date | null = null
    if (resolution === 'RESCHEDULED') {
      if (!rescheduleTo) { res.status(400).json({ error: 'rescheduleTo is required when resolution is RESCHEDULED' }); return }
      if (typeof rescheduleTo !== 'string' || !rescheduleTo.trim()) { res.status(400).json({ error: 'Invalid rescheduleTo date' }); return }
      const parsed = parseFollowUpFields({ followUpAt: rescheduleTo })
      if (parsed.error || !(parsed.data.followUpAt instanceof Date)) { res.status(400).json({ error: 'Invalid rescheduleTo date' }); return }
      const d = parsed.data.followUpAt as Date
      newFollowUpAt = d
    }

    // The append-only TreatmentFollowUpEvent is the durable resolution history.
    // Prefix the plan note as a convenient staff-facing summary; secondary
    // audit and activity logs are best-effort after the transaction commits.
    const stamp = `[${resolution}${req.user!.firstName ? ` by ${req.user!.firstName} ${req.user!.lastName}` : ''} on ${new Date().toISOString().slice(0, 10)}]${note ? ` ${note}` : ''}`
    // Keep the visible note concise; full prior outcomes remain in the append-only event history.
    const updatedNote = stamp

    await prisma.$transaction(async tx => {
      // Optimistic concurrency: a follow-up must not be resolved twice against
      // the same scheduled date. The event is committed only with the update.
      const changed = await tx.treatmentPlan.updateMany({
        where: {
          id: plan.id, doctorId: plan.doctorId,
          followUpAt: plan.followUpAt, followUpNote: plan.followUpNote,
          status: plan.status, patientDecision: plan.patientDecision,
          clinicalReviewRequired: plan.clinicalReviewRequired,
        },
        data: { followUpAt: newFollowUpAt, followUpNote: updatedNote },
      })
      if (changed.count !== 1) throw new Error('FOLLOW_UP_CHANGED')
      await tx.treatmentFollowUpEvent.create({ data: {
        treatmentPlanId: plan.id, actorId: req.user!.id, eventType: 'FOLLOW_UP_' + resolution,
        previousValues: { followUpAt: plan.followUpAt?.toISOString() ?? null, followUpNote: plan.followUpNote },
        newValues: { followUpAt: newFollowUpAt?.toISOString() ?? null, followUpNote: updatedNote }, outcome: note.trim(),
      } })
    })

    // The transactional follow-up event is the durable audit record. Secondary
    // logging must not make a committed outcome appear to have failed.
    try {
      await logAudit({ userId: req.user!.id, actionType: 'STATUS_CHANGE', entityType: 'TREATMENT_PLAN', entityId: plan.id, entityName: `Follow-up resolved: ${resolution}`, notes: note, req })
    } catch (auditError) {
      console.error('[Pipeline] follow-up committed but secondary audit logging failed:', auditError)
    }
    // The treatment update and append-only outcome event are already committed.
    // A secondary timeline failure must not return 500 and invite staff to repeat a completed action.
    try {
      await logPatientActivity(plan.patientId, req.user!.id, `${req.user!.firstName} ${req.user!.lastName}`, `Treatment follow-up ${resolution.toLowerCase()}: ${plan.toothNumber || 'General'}${note ? ` — ${note}` : ''}`)
    } catch (activityError) {
      console.error('[Pipeline] follow-up committed but patient activity timeline failed:', activityError)
    }

    res.json({ id: plan.id, resolution, followUpAt: newFollowUpAt })
  } catch (e) {
    if (e instanceof Error && e.message === 'FOLLOW_UP_CHANGED') { res.status(409).json({ error: 'Follow-up was changed by another staff member; reload and try again' }); return }
    console.error('[Pipeline] follow-up resolve error:', e)
    res.status(500).json({ error: 'Failed to resolve follow-up' })
  }
})

// PATCH /pipeline/treatment/bulk-status — apply the same status to multiple plans
router.patch('/treatment/bulk-status', requireAuth, async (req, res) => {
  try {
    const { ids, status } = req.body as { ids: string[]; status: string }
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'ids must be a non-empty array' }); return
    }
    if (!status || !VALID_STATUSES.includes(status)) {
      res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` }); return
    }
    if (!['ADMIN', 'RECEPTIONIST', 'DOCTOR'].includes(req.user!.role)) { res.status(403).json({ error: 'Access denied' }); return }
    const doctorId = await authenticatedDoctorId(prisma, req.user!)
    if (req.user!.role === 'DOCTOR' && !doctorId) { res.status(404).json({ error: 'Doctor record not found' }); return }

    if (status === 'On Hold') {
      const plansToCheck = await prisma.treatmentPlan.findMany({
        where: { id: { in: ids }, ...(doctorId ? { doctorId } : {}), followUpAt: { not: null }, status: { not: 'On Hold' } },
        select: { id: true, patientId: true, followUpAt: true },
      })
      for (const plan of plansToCheck) {
        const check = await checkTreatmentFollowUpTransition(plan)
        if (!check.allowed) { res.status(409).json({ ...followUpAttemptError(check.attemptCount, check.minimumAttempts), treatmentPlanId: plan.id }); return }
      }
    }

    // CRM Automation (Part N) — fetch the affected patients BEFORE the bulk
    // write (updateMany doesn't return rows), so a bulk "In Progress" move
    // auto-converts a matching QUALIFIED lead per affected patient exactly
    // like the single-plan endpoint does. One query for all plans, not N+1.
    const affectedPatients = status === 'In Progress'
      ? await prisma.treatmentPlan.findMany({
          where:  { id: { in: ids }, ...(doctorId ? { doctorId } : {}) },
          select: { patient: { select: { id: true, phone: true } } },
          distinct: ['patientId'],
        })
      : []

    // CRM Automation (Part C) — every bulk status change needs its affected
    // patients' treatmentPlanStatus CRM tag re-derived, not just the
    // "In Progress" lead-conversion case above. Fetched once regardless of
    // `status`, before the write, same distinct-patientId shape as above.
    const affectedPatientIdsForSync = await prisma.treatmentPlan.findMany({
      where:  { id: { in: ids }, ...(doctorId ? { doctorId } : {}) },
      select: { patientId: true },
      distinct: ['patientId'],
    })

    const result = await prisma.treatmentPlan.updateMany({
      where: { id: { in: ids }, ...(doctorId ? { doctorId } : {}) },
      data:  { status },
    })

    if (affectedPatients.length > 0) {
      checkAndConvertLeadsForPatients(affectedPatients.map(p => p.patient))
        .catch((e: any) => console.error('[CrmAutomation] bulk checkAndConvertLeadsForPatients failed:', e?.message))
    }

    for (const { patientId } of affectedPatientIdsForSync) {
      syncTreatmentPlanStatusFromPipeline(patientId)
        .catch((e: any) => console.error('[CrmAutomation] bulk syncTreatmentPlanStatusFromPipeline failed:', e?.message))
    }

    res.json({ updated: result.count })
  } catch (e) {
    console.error('[Pipeline] bulk status update error:', e)
    res.status(500).json({ error: 'Failed to bulk update statuses' })
  }
})

// PATCH /pipeline/treatment/bulk — apply the same stage to multiple plans
router.patch('/treatment/bulk', requireAuth, async (req, res) => {
  try {
    const { ids, stage } = req.body as { ids: string[]; stage: string }
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'ids must be a non-empty array' }); return
    }
    if (!stage || !VALID_STAGES.includes(stage)) {
      res.status(400).json({ error: `Invalid stage. Must be one of: ${VALID_STAGES.join(', ')}` }); return
    }
    if (!['ADMIN', 'RECEPTIONIST', 'DOCTOR'].includes(req.user!.role)) { res.status(403).json({ error: 'Access denied' }); return }
    const doctorId = await authenticatedDoctorId(prisma, req.user!)
    if (req.user!.role === 'DOCTOR' && !doctorId) { res.status(404).json({ error: 'Doctor record not found' }); return }

    if (stage === 'Consulted') {
      const plansToCheck = await prisma.treatmentPlan.findMany({
        where: { id: { in: ids }, ...(doctorId ? { doctorId } : {}), followUpAt: { not: null }, stage: { not: 'Consulted' } },
        select: { id: true, patientId: true, followUpAt: true },
      })
      for (const plan of plansToCheck) {
        const check = await checkTreatmentFollowUpTransition(plan)
        if (!check.allowed) { res.status(409).json({ ...followUpAttemptError(check.attemptCount, check.minimumAttempts), treatmentPlanId: plan.id }); return }
      }
    }

    // CRM Automation (Part C) — fetched before the write, same shape as bulk-status.
    const affectedPatientIdsForSync = await prisma.treatmentPlan.findMany({
      where:  { id: { in: ids }, ...(doctorId ? { doctorId } : {}) },
      select: { patientId: true },
      distinct: ['patientId'],
    })

    const result = await prisma.treatmentPlan.updateMany({
      where: { id: { in: ids }, ...(doctorId ? { doctorId } : {}) },
      data:  { stage },
    })

    for (const { patientId } of affectedPatientIdsForSync) {
      syncTreatmentPlanStatusFromPipeline(patientId)
        .catch((e: any) => console.error('[CrmAutomation] bulk syncTreatmentPlanStatusFromPipeline failed:', e?.message))
    }

    res.json({ updated: result.count })
  } catch (e) {
    console.error('[Pipeline] bulk stage update error:', e)
    res.status(500).json({ error: 'Failed to bulk update stages' })
  }
})

// DELETE /pipeline/treatment/bulk — remove multiple plans (must be BEFORE /:id)
router.delete('/treatment/bulk', requireAuth, async (req, res) => {
  try {
    if (!['ADMIN', 'RECEPTIONIST'].includes(req.user!.role)) { res.status(403).json({ error: 'Access denied' }); return }
    const { ids } = req.body as { ids: string[] }
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'ids must be a non-empty array' }); return
    }
    const result = await prisma.treatmentPlan.deleteMany({ where: { id: { in: ids } } })
    res.json({ deleted: result.count })
  } catch (e) {
    console.error('[Pipeline] bulk delete error:', e)
    res.status(500).json({ error: 'Failed to bulk delete plans' })
  }
})

// DELETE /pipeline/treatment/:id — remove a plan from the pipeline
router.delete('/treatment/:id', requireAuth, async (req, res) => {
  try {
    if (!['ADMIN', 'RECEPTIONIST'].includes(req.user!.role)) { res.status(403).json({ error: 'Access denied' }); return }
    await prisma.treatmentPlan.delete({ where: { id: req.params.id } })
    res.json({ ok: true })
  } catch (e) {
    console.error('[Pipeline] delete error:', e)
    res.status(500).json({ error: 'Failed to delete plan' })
  }
})

// GET /pipeline/needs-review — plans that are stale and need Justine's attention
router.get('/needs-review', requireAuth, async (req, res) => {
  try {
    const doctorId = await authenticatedDoctorId(prisma, req.user!)
    if (req.user!.role === 'DOCTOR' && !doctorId) { res.status(404).json({ error: 'Doctor record not found' }); return }
    const now = new Date()
    const sixtyDaysAgo  = new Date(now.getTime() - 60  * 86_400_000)
    const ninetyDaysAgo = new Date(now.getTime() - 90  * 86_400_000)

    // Consulted > 60 days (consult only, no follow-up action)
    const consultStale = await prisma.treatmentPlan.findMany({
      where:   { stage: 'Consulted', createdAt: { lt: sixtyDaysAgo }, ...(doctorId ? { doctorId } : {}) },
      include: { patient: { select: { id: true, firstName: true, lastName: true, phone: true, patientNumber: true } } },
      orderBy: { createdAt: 'asc' },
    })

    // Accepted & Unscheduled or Accepted & Scheduled > 90 days (money at risk / stuck)
    const acceptedStale = await prisma.treatmentPlan.findMany({
      where: {
        stage:     { in: ['Accepted & Unscheduled', 'Accepted & Scheduled', 'Treatment Presented', 'Follow-up Due'] },
        updatedAt: { lt: ninetyDaysAgo },
        ...(doctorId ? { doctorId } : {}),
      },
      include: { patient: { select: { id: true, firstName: true, lastName: true, phone: true, patientNumber: true } } },
      orderBy: { updatedAt: 'asc' },
    })

    // Enrich with last appointment date per patient
    const allPatientIds = [...new Set([
      ...consultStale.map(p => p.patientId),
      ...acceptedStale.map(p => p.patientId),
    ])]

    const lastAppts = allPatientIds.length > 0
      ? await prisma.appointment.findMany({
          where:   { patientId: { in: allPatientIds }, status: { notIn: ['CANCELLED', 'NO_SHOW'] } },
          select:  { patientId: true, startAt: true },
          orderBy: { startAt: 'desc' },
        })
      : []

    const lastApptByPatient = new Map<string, Date>()
    lastAppts.forEach(a => {
      if (!lastApptByPatient.has(a.patientId)) lastApptByPatient.set(a.patientId, a.startAt)
    })

    const enrich = (plan: any) => ({
      id:            plan.id,
      patientId:     plan.patientId,
      patientName:   `${plan.patient.firstName} ${plan.patient.lastName}`,
      patientNumber: plan.patient.patientNumber,
      phone:         plan.patient.phone,
      stage:         plan.stage,
      daysSince:     Math.floor((now.getTime() - new Date(plan.updatedAt || plan.createdAt).getTime()) / 86_400_000),
      createdAt:     plan.createdAt,
      updatedAt:     plan.updatedAt,
      lastApptDate:  lastApptByPatient.get(plan.patientId) ?? null,
      treatmentName: plan.notes?.split('\n')[0]?.slice(0, 60) || 'General',
      value:         Number(plan.costPerUnit) * plan.quantity - Number(plan.discount),
    })

    res.json({
      consultOnly:   consultStale.map(enrich),
      stuckPlans:    acceptedStale.map(enrich),
      total:         consultStale.length + acceptedStale.length,
    })
  } catch (e) {
    console.error('[Pipeline] needs-review error:', e)
    res.status(500).json({ error: 'Failed to fetch needs-review plans' })
  }
})

export default router
