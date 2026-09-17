# Code Clinic production completion record

## 2026-09-17 — reconnaissance and first correction

Repository: https://github.com/Ogaven/code-clinic-app
Inspected main commit: `e63351786682c62d07c274105a3e07b0708c220f` (2026-09-16).
Working branch: `feature/crm-revenue-closure`.

This is a **source-code baseline**, not a verified production baseline.
The production HTTPS connection timed out. No authenticated database, server,
PM2, runtime environment, deployment-state file, or Meta account was available.
No current production counts, enabled flags, or migration application status
can be asserted from this inspection. Historical counts in commit messages
are not current data.

GitHub's default branch is `railway/code-change-3PyDX6`, not main. It points
at old Railway work; all implementation here explicitly uses current main.
GitHub reports pull=true and push=false for the connected account.
There were no open PRs when inspected.

## CRM

**Working in source:** shared lead intake, source field, configurable source
routing and round-robin, owner filters, staff follow-up tasks, first-human
reply timestamps, SLA sweeps, qualification intent, append-only history on
centralized transitions, consent logging, patient tag derivation, sequences,
waitlist, backlog previews, and reporting UI/API.

**Partial:** tasks exist but the CRM automation router has no unified needs-
attention task queue. LeadsPipeline has owner/unassigned filters; this does
not close overdue task, unanswered enquiry, qualified-unbooked, no-show,
cancellation, and treatment opportunity workflows. Ownership is a nullable
string rather than a foreign key; routing targets are validated at creation,
but owner backfill and current operational configuration remain unverified.
Round-robin cursor reads/writes are not serialized for concurrent intake.

**Missing:** structured campaign/ad/form/landing-page attribution on Lead,
native ScoreApp ingestion, native Meta Lead Ads `leadgen` processing,
complete acquisition-to-collected-revenue reporting, and historical owner-only
backfill tooling with preview and audit. Do not assign named staff without
reading current staff/configuration and reviewing a concrete preview.

**Found and corrected in this branch:** conversion reporting previously
counted history rows rather than distinct leads. Re-entering a stage inflated
counts, and direct conversions were divided by unrelated earlier-stage
cohorts. It now counts distinct leads, requires evidence of both milestones
for later-stage rates, reports missing history, and returns null when a rate
has no denominator. The UI displays an unavailable rate as a dash.
These are lifetime milestone rates, not evidence of ordered progression or
an appointment/attendance/revenue funnel.

## Lead ingestion

**Implemented in source:** WhatsApp, website chat/form, Facebook/Instagram
messages and comments, internal quizzes, and manual/walk-in leads feed the
shared orchestration. Source and quiz data exist. Live provider connectivity
was not tested.

**Missing:** ScoreApp and Meta Lead Ads/Instant Forms. An internal quiz route
is not a ScoreApp integration. No `scoreapp` or `leadgen` implementation was
found. Future work needs authenticated inbound payloads, durable external
submission identifiers and duplicate protection, immutable attribution, input
validation, honest consent evidence, and configuration instructions. Secrets,
tokens, form/account IDs, subscription setup, and approved messaging must be
supplied/verified by the operator; never invent them.

## Automation

**Implemented:** central tag events, sequence enrollment/dispatch, stop on
reply/booking/treatment changes, SLA escalation, consent audit, STOP/START
convergence, waitlist match preview, review request and backlog foundations.
Daily patient-tag derivation now has a boot-time run on main (`18e48c9`).

**Dormant by business policy:** marketing, backlog re-engagement, review
requests, missed-call text-back, patient SMS, and calling require their own
configuration/activation. Source flags cannot prove live runtime state.
The requirements matrix includes contradictory historical waitlist flag notes;
verify runtime rather than copying either claim.

Birthday source schedules a staff birthday alert; patient greetings remain
manual. SMS fails with SMS_NOT_CONFIGURED rather than using WhatsApp as an
implicit replacement. Test mode disables CRM live gates. No flags were changed.

## Appointments / treatment / revenue linkage

**Working in source:** scheduling calls checkAndConvertLeadOnBooking;
treatment single/bulk start paths use the same matching service. Matching
prefers an explicit patient link, then normalized phone, only for QUALIFIED
leads, and avoids stealing a link to a different patient. Bookings exit active
lead nurturing. Existing treatment/case-acceptance sync was preserved.

Patient, Appointment, TreatmentPlan, Invoice, and Payment models provide
real links for further reporting. Invoice has totalUGX and paidUGX; Payment
has amountUGX and paidAt. These are different measures, not interchangeable.

**Missing/unsafe to infer:** lead CONVERTED currently also means patient
conversion or booking/treatment start; it does not prove attendance, accepted
treatment, invoiced value, or collection. Lead.convertedToPatientId is a plain
nullable string with no Prisma relation and may be shared by multiple leads.
Campaign-to-payment attribution is absent. Patient lifetime payments cannot
simply be copied onto every linked lead/campaign. Unlinked or ambiguous
payments must remain unattributed; pre-acquisition revenue must not be counted
as acquired revenue without a reviewed model and dates.

Legacy /crm lead PATCH and manual convert paths directly update stage/status,
bypassing centralized history and exit handling. Repair these paths before
claiming full historical funnel coverage; do not manufacture missing history.

## Meta / WhatsApp

Main includes separate patient delivery and staff escalation health,
MetaDeliveryFailure persistence, billing evidence, and notification dedup.
The latest commit fixes template-first staff alerts and removes staff failures
from patient health. Actual provider errors, billing state, approved template
availability, and staff delivery remain unverified. No test messages were sent.

## Mobile / PWA

Main includes mobile role navigation, shared profile UI, install helpers,
manifest/service worker, local Questrial font, separate profile/settings,
and mobile navigation/service-worker tests. Existing design was preserved.
Light/dark styles exist; no browser-based theme/width verification was done.

Known gaps confirmed in source: pushsubscriptionchange resubscribes without
persisting keys to the server; unsubscribe suppresses server deletion errors.
Subscription ownership is transferred by authenticated upsert, with existing
ownership tests; its shared-device lifecycle needs operational review.
Attendance stores geofence configuration but check-in/check-out do not read
or enforce it. Do not describe radius enforcement as implemented.

## Security — critical source findings

1. **Corrected here:** patient CRM tag and consent GET/PATCH/POST routes lacked
   the doctor/patient relationship guard used by patient profiles. All four
   now run the existing guard after auth/RBAC. Unrelated doctors receive 404
   before patient data is read or changed.
2. **Corrected here:** Reception could read and write clinical riskFlags,
   contradicting the existing taxonomy requirement. Reception responses now
   omit the field and attempts to set it return 403. Existing financial
   redaction and Admin/related-Doctor clinical access are preserved.
3. **Still open:** inspected WhatsApp/Facebook/Instagram inbound handlers
   acknowledge/process POST bodies without HMAC signature verification; main
   does not retain raw request bytes or apply an equivalent middleware.
   GET verify-token handshakes do not authenticate inbound POST payloads.
   WhatsApp also logs the full inbound payload. Before adding acquisition
   webhooks, implement raw-body signature verification across existing paths,
   verify correct app secrets/channel mapping, and remove patient payload logs.
   Do not deploy a fail-closed guard until production secrets are verified,
   because an unconfigured guard would interrupt legitimate channel traffic.
4. **Still open:** general /crm read/create/update/convert routes mostly
   require authentication only, unlike narrower CRM automation RBAC. Review
   role ownership before changing policy; current source does not prove least
   privilege across CRM. No claim of a complete security audit is made.
5. Main documents medicalNotesEncrypted as plaintext at the application
   field boundary. Key management and a controlled migration remain necessary;
   see docs/security/MEDICAL_NOTES_ENCRYPTION_TODO.md. Infrastructure/disk
   encryption was not inspected.

## Database

PostgreSQL / Prisma 5.22 client, packages/database workspace. Nine migration
SQL directories are present, latest 20260915090000_meta_delivery_failure.
Applied production migrations and drift are **unknown**. Local Prisma client
generation succeeded and does not apply migrations or query production.
No schema, migration, database, financial, patient, or appointment changes
were made by this work.

## Deployment

Current DEPLOYMENT.md and CLAUDE.md prescribe atomic API/web releases,
separate runtime classification, lock, candidate web smoke test, static-asset
and build-ID checks, health verification, and automatic rollback. Routine
entrypoint: bash deploy.sh --yes. Source must be committed and pushed;
GitHub Actions deploys main pushes. Schema application remains a separate
backup-and-review operation. No deployment was attempted.

## Stale / unmerged work

Main already contains the CRM, recent admin mobile, clinic operations,
Meta billing, and security work from multiple feature/release branches.
Examples: clinic-operations-close-out equals main; crm-tag-automation is
32 commits behind, admin-mobile-ux-rebuild 9 behind, dr-steven-crm-final
19 behind, and meta-billing-analytics 16 behind with no unique commits.

Branches with unique commits require patch review, not blind merge:
knowledge-studio-multimedia-final (45 behind / 4 unique), doctor-app-final
(72 / 6), knowledge-studio (79 / 6), mobile-pwa-navigation-final (45 / 1),
receptionist-staff-attendance (49 / 2), system-finalization (72 / 11).
Unique SHAs alone do not mean unique functionality: main already includes
Knowledge Studio ingestion/media tests and mobile PWA components. Inspect
specific patch equivalence before carrying anything forward.

## Smallest safe implementation sequence

1. Ship reviewed patient CRM access/reporting corrections, after current
   production baseline and web/API release states can be inspected.
2. Close existing webhook authentication and payload-log exposure after
   verifying app secrets. Narrow general CRM RBAC and unify its transition
   paths; retain documented manual overrides and never backfill invented stages.
3. Run a read-only lead/staff/routing/history/relationship audit. Build an
   actionable queue from real tasks/events with explicit priority reasons.
   Preview owner-only backfill, then request approval for the exact changes.
4. Add immutable acquisition metadata and durable external submission
   idempotency with an additive reviewed migration. Implement ScoreApp and
   native Meta leadgen using their actual current provider contracts; test
   retries, invalid signatures, invalid fields, and consent/duplicate handling.
5. Report booking, attendance, accepted treatment, invoicing, and payment
   separately, with reviewed time windows and unambiguous attribution.
   Show unattributed/ambiguous data explicitly and restrict financial reports.
6. Build management views from verified metrics, then close PWA/mobile gaps.
   Patient-facing automation remains a separate explicit activation decision.

## First milestone files

- apps/api/src/routes/crm-automation.ts — patient scoping and risk flag policy.
- apps/api/src/crm-automation/reporting.service.ts — unique lead/cohort rates.
- apps/web/app/(admin)/admin/crm-automation/page.tsx — report meaning/unavailable rates.
- apps/api/src/__tests__/crm-automation/patient-route-access.test.ts — synthetic
  HTTP requests through the actual Express routing/middleware chain.
- apps/api/src/__tests__/crm-automation/reporting.test.ts — repeat-stage,
  skipped-stage, missing-history, and empty-denominator regressions.
- docs/crm/PRODUCTION_COMPLETION_RECORD.md — this record.

Validation and publishing results are recorded below when checks finish.

## Validation results

- API Vitest: 55 files, **431 tests passed** (including new regression coverage).
  The pnpm invocation ran the complete suite despite supplied file filters.
- Web Vitest: 4 files, **37 tests passed**.
- API tsc --noEmit: passed.
- Web tsc --noEmit: passed.
- API build (client generation + tsc): passed.
- Next.js production build: passed, all 111 static pages generated.
- git diff --check: passed.
- Existing tooling notices: pnpm 11 ignores the legacy onlyBuiltDependencies
  package.json field; dependencies were installed with scripts disabled and
  Prisma generation run explicitly. Vite CJS/Browserslist notices did not
  fail verification. No dependency/lockfile changes were included.
- No browser visual QA or live production verification was performed.
- GitHub connection is read-only; branch/PR publication is blocked.
  Changes are committed locally on the focused feature branch.
- Production status: **unchanged by this work; live version unverified**.

## Human action required

Grant the connected GitHub account write access to Ogaven/code-clinic-app
and provide a supported authenticated production connection so deployed
SHAs, health/static assets, PM2, migration state, and read-only aggregate
CRM data can be checked. Do not send secrets or patient exports in chat.
Correct the repository default branch only after the owner confirms it
should be main. Verify Meta app secrets/channel account mapping before
shipping webhook signature enforcement. Review the ownership/backfill
preview before any live data change. No patient communication is authorized
by this implementation record.
