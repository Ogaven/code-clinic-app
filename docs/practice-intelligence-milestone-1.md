# Code Clinic — Practice Intelligence Milestone 1

Status: implementation specification, not production release.
Owner: clinic management approval required for targets and operational definitions.

## Product intent
Dr. Steven requests a practice-management intelligence agent with four layers:
1. Descriptive — what happened.
2. Diagnostic — why performance changed, using attributable evidence.
3. Predictive — what may happen, with uncertainty and minimum-data thresholds.
4. Prescriptive — suggested administrative actions, with human approval initially.

**Milestone 1 is read-only**: navigation, measured capacity, verified production and an evidence-backed insight foundation. No outbound messages, autonomous bookings, patient edits, clinical advice, or changes to billing transactions.

## Non-negotiable regression boundaries
- Preserve the existing appointments calendar, doctor columns, appointment cards, day/week/month modes, blocked periods, status colors, and booking/cancellation flows.
- Preserve the existing receptionist Arrived -> Waiting -> In Session -> Checkout workflow and doctor clinical workflows.
- Do not touch existing AI Suite navigation or functionality.
- Keep existing Staff URLs and RBAC functioning; only move the top-level Staff navigation link into Settings after checking access paths and regression tests.
- No historical patient backfill or synthetic production patients.
- New analytics endpoints must be read-only, permission-scoped, bounded, and timezone-aware (Africa/Kampala).
- Never treat 276 weekly appointments as a mandatory production target. It is only a reference derived from 48 weekday and 36 Saturday assumptions, not adjusted for staffing or procedure duration.

## Intended navigation
Overview | Patients | Appointments | Treatments | Billing | Practice Intelligence | AI Suite | CRM | Reports.
Settings retains Staff List, Staff Permissions, Audit Log; add Staff Availability and Goals only if missing after audit.
Preserve direct Staff URLs and access controls.

## Intended Practice Intelligence page
1. Overview: daily/weekly manager-defined production goals, approved delivered-treatment production, booked vs attended visits, actual dentist availability, used vs free clinical minutes.
2. Diagnosis: cancellations, unfilled time, staff absences, lateness, appointment confirmation failures, treatment acceptance gaps; cite underlying record counts and avoid unsupported causal certainty.
3. Forecasts: initially a clearly labeled 'Not enough reliable data' state until historical data and calibration support confidence ranges.
4. Recommendations: initially read-only suggestions; no send/reschedule/assignment actions without a separate approved workflow and authorization review.

## Data source contract to verify before implementation
- Appointment scheduled start/end, status, cancellation and confirmation timestamps.
- Dentist working hours, blocked time, leave, holidays, clinic closures.
- Patient-flow arrival, waiting, session start/end, checkout timestamps.
- Existing Treatment Plan/Pipeline/Case Acceptance integration; avoid duplicating completed sync.
- Approved clinical production ledger entries (not invoices or cash payments).
- Invoice statuses, actual payment allocations, receivables and expenses only when trustworthy.
- Role authorization and patient privacy constraints.

## Calculations and guardrails
- Available clinical minutes = staffed scheduled minutes minus overlapping leave, closures and blocked periods (avoid double counting).
- Scheduled utilization = valid booked minutes / available clinical minutes; calculate overlap and cancellation behavior explicitly, and do not assume a 30-minute slot.
- Actual attendance = attended visits / eligible scheduled visits, with clearly stated period and exclusions.
- Production = approved delivered-treatment ledger entries in Kampala-local period; show no data / zero distinctly.
- Goal comparison uses manager-entered targets with effective dates and audit history.
- Never infer true profit from invoices or collections alone. The dashboard Financial Snapshot uses only recorded invoicing, collections and approved clinical production; expenses and net income remain unavailable until reconciled with trustworthy accounting data.
- Planned accounting integration: QuickBooks will be connected in a later, separately approved milestone to improve accuracy of expenses, income classification, profitability, account balances and reconciliation. No QuickBooks connection, credentials, sync or accounting write is part of this read-only milestone.
- When QuickBooks is connected, distinguish QuickBooks accounting revenue and expenses from EMR invoices, cash collections and clinical production; define the authoritative source per KPI, mapping, sync freshness, deduplication and discrepancy handling before displaying consolidated financial metrics.
- Never claim causal attribution from correlation alone. Show missing data, confidence, and source timestamps.

## Acceptance tests before merge
- Calendar visual/function regression, including multi-doctor columns, long procedures, blocked slots, and cancellation.
- Receptionist patient-flow transitions remain unchanged.
- Doctor clinical notes/treatment workflows remain unchanged.
- Existing AI Suite remains unchanged.
- Staff direct routes and RBAC work after navigation relocation.
- Manager-only goal changes; non-managers cannot alter targets.
- Correct Kampala date boundaries, overlap/double-counting behavior, absent doctor capacity, five-minute and two-hour procedures, cancelled bookings, and empty-data states.
- No patient writes or outbound communications from read-only analytics.
- Existing API/web type checks, tests, and production builds pass.
- Merge/deploy only after explicit review of tests and rollback strategy.

## Planned delivery sequence
A. Read-only source and permissions audit (current repository).
B. New isolated Practice Intelligence route, navigation, empty/loading/error states.
C. Read-only aggregation API and evidence-backed KPIs, with tests.
D. Overview dashboard summary; Staff navigation relocation with regression tests.
E. Later, separately reviewed diagnostic, forecasting and staff-approved agentic actions.

Do not claim any milestone is deployed until production commit, API health, and role-specific user workflows have been verified.
