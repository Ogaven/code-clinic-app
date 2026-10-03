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
// NOT covered by this helper: Pipeline's "Money at Risk" and "Avg Days to
// Schedule" still read `stage` directly (Accepted & Unscheduled / Accepted
// & Scheduled) — deliberately left unchanged. Redefining what those two
// metrics MEAN (e.g. deriving "scheduled" from some other signal) would be
// a workflow redesign, out of scope here; `status` alone has no equivalent
// "accepted but not yet booked" state to borrow. Since `stage` is rarely
// populated in practice, these two metrics are likely under-reporting in
// production today — a real, pre-existing gap, not something this file
// silently reinterprets.
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
