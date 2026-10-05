// Canonical, single source of truth for a TreatmentPlan's commercial
// classification (Presented / Accepted / Declined), shared by Case
// Acceptance (reports.ts) and the Treatment Pipeline's KPI strip
// (pipeline.ts) so the two can never silently disagree on what "accepted"
// means.
//
// Why `status`, not `stage`: TreatmentPlan carries two independent fields —
// `status` (Planned/In Progress/Completed/On Hold/Declined/Cancelled),
// actively maintained by staff through the Pipeline board's status columns
// (drag-and-drop, dropdown, PATCH /pipeline/treatment/:id/status), and
// `stage` (Consulted/Treatment Presented/Accepted & Scheduled/Accepted &
// Unscheduled/Completed/Declined/Follow-up Due), a richer intended workflow
// that in practice is barely ever written by any current staff-facing UI
// action — confirmed by grep (the only frontend caller of PATCH .../stage is
// the Needs Review backlog's "Mark Completed"/"Mark Declined" buttons,
// which only ever write 'Completed' or 'Declined') and independently
// acknowledged by crm-automation/patient-engagement.service.ts's own
// comment ("this list is never empty just because staff have never used
// the pipeline's specific 'Follow-up Due' stage"). Before this file,
// Case Acceptance read `status` and the Pipeline's acceptedValue/
// conversionRate read `stage` — two different, independently-maintained
// fields that could silently diverge. `status` is the one staff actually
// keep current, so it's the canonical field here.
//
// Avg Days to Schedule still reads `stage` directly in pipeline.ts,
// untouched — out of scope here. Money at Risk ALSO still reads `stage`
// directly (Accepted & Unscheduled), its definition deliberately
// unchanged — computeMoneyAtRisk below only centralizes that existing
// read so Case Acceptance's report can show the identical figure instead
// of a second, possibly-drifting definition of the same metric name.
// Redefining what either metric MEANS (e.g. deriving "scheduled" from
// some other signal) would be a workflow redesign, out of scope here;
// `status` alone has no equivalent "accepted but not yet booked" state to
// borrow. Since `stage` is rarely populated in practice, both metrics are
// likely under-reporting in production today — a real, pre-existing gap,
// not something this file silently reinterprets.
export const ACCEPTED_STATUSES = ['In Progress', 'Completed'] as const

export interface ClassifiablePlan {
  status: string
}

// Every plan handed to these functions is already "presented" by virtue of
// having been queried in range — there is no separate presented/not-
// presented flag on TreatmentPlan, and both existing systems already treat
// "exists in this date range" as the full presented set (no status
// exclusion). Kept as an explicit named function anyway, rather than just
// `plans.length`, so a future status addition that SHOULD be excluded from
// "presented" has one obvious place to encode that -- not because today's
// rule is complex.
export function isPresented(_plan: ClassifiablePlan): boolean {
  return true
}

export function isAccepted(plan: ClassifiablePlan): boolean {
  return (ACCEPTED_STATUSES as readonly string[]).includes(plan.status)
}

export function isDeclined(plan: ClassifiablePlan): boolean {
  return plan.status === 'Declined'
}

export function isCancelled(plan: ClassifiablePlan): boolean {
  return plan.status === 'Cancelled'
}

export interface TreatmentAppointmentRef {
  status: string
  createdAt: Date | string
}

// Appointment statuses that no longer represent a live booking for a treatment.
// A rescheduled booking remains live when the appointment row itself is the
// current booking; explicit cancellation/no-show does not.
const INACTIVE_TREATMENT_APPOINTMENT_STATUSES = new Set([
  'CANCELLED',
  'CANCELLED_RESCHEDULED',
  'NO_SHOW',
])

export interface TreatmentSchedulingPlan extends ClassifiablePlan {
  value: number
  appointments?: TreatmentAppointmentRef[]
}

export function activeTreatmentAppointment<T extends TreatmentSchedulingPlan>(plan: T): TreatmentAppointmentRef | null {
  return (plan.appointments ?? [])
    .filter(a => !INACTIVE_TREATMENT_APPOINTMENT_STATUSES.has(a.status))
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())[0] ?? null
}

// Money at Risk is accepted treatment value without a live appointment explicitly
// linked to that treatment plan. We intentionally do not infer links from another
// appointment belonging to the same patient.
export function computeMoneyAtRisk<T extends TreatmentSchedulingPlan>(plans: T[]): number {
  return plans
    .filter(p => isAccepted(p) && !activeTreatmentAppointment(p))
    .reduce((s, p) => s + p.value, 0)
}

export function computeAvgDaysToSchedule<T extends TreatmentSchedulingPlan & { acceptedAt?: Date | string | null; createdAt: Date | string }>(plans: T[]): number {
  const scheduled = plans
    .map(plan => ({ plan, appointment: activeTreatmentAppointment(plan) }))
    .filter((x): x is { plan: T; appointment: TreatmentAppointmentRef } => x.appointment !== null)

  if (!scheduled.length) return 0

  const totalDays = scheduled.reduce((sum, { plan, appointment }) => {
    // Until a dedicated acceptedAt timestamp exists, createdAt is the stable,
    // non-mutating cohort timestamp. Crucially, we no longer use plan.updatedAt,
    // which changes for unrelated edits.
    const acceptedAt = new Date(plan.acceptedAt ?? plan.createdAt).getTime()
    const scheduledAt = new Date(appointment.createdAt).getTime()
    return sum + Math.max(0, (scheduledAt - acceptedAt) / 86_400_000)
  }, 0)

  return Math.round(totalDays / scheduled.length)
}
