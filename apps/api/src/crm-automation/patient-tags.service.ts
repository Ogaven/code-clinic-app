// ─────────────────────────────────────────────────────────────────────────
// CRM Automation — Patient Tag Taxonomy write path + derived-tag job
// (Part A schema wiring, Part B event emission, Part E collections routing).
//
// applyPatientTagUpdate() is the single place any Patient CRM tag is ever
// written from — the manual PATCH endpoint and the daily derived-tag job
// both go through it. That's what makes tag changes genuinely event-driven:
// the emitAutomationEvent() call happens inline, at the point of the write,
// for every field whose stored value actually changed. Nothing polls
// Patient rows to decide what to enroll — the daily job below only decides
// what the new *value* of a time-derived field should be; the write (and
// the event it emits) is the same code path a human edit would take.
// ─────────────────────────────────────────────────────────────────────────
import { prisma } from '../lib/prisma'
import type { Patient, Prisma } from '@prisma/client'
import { emitAutomationEvent, exitActiveEnrollments } from './automation-events.service'
import { PATIENT_RECALL_CONFLICT_GROUP, PATIENT_TREATMENT_FOLLOWUP_CONFLICT_GROUP } from './sequence-groups'

// Fields whose change is meaningful enough to drive automation (Part B's
// worked examples: recall_status -> overdue_30, treatment_plan_status ->
// incomplete, balance_status -> owing, plus the value/lifecycle fields
// reporting depends on). Not every column on Patient needs to emit an event.
const WATCHED_FIELDS = [
  'recallStatus',
  'treatmentPlanStatus',
  'balanceStatus',
  'lifecycleStage',
  'valueTier',
  'declineReason',
] as const

type WatchedField = (typeof WATCHED_FIELDS)[number]

export type PatientTagUpdateInput = Partial<
  Pick<
    Patient,
    | 'treatmentTypes'
    | 'treatmentPlanStatus'
    | 'recallInterval'
    | 'providerId'
    | 'lifecycleStage'
    | 'recallStatus'
    | 'declineReason'
    | 'declineReasonNote'
    | 'paymentType'
    | 'balanceStatus'
    | 'balanceAgingBucket'
    | 'valueTier'
    | 'riskFlags'
    | 'crmReferralSource'
    | 'crmReferredByPatientId'
    | 'commsChannelPref'
    | 'languagePref'
    | 'waitlistAvailable'
    | 'negativeExperience'
  >
>

export async function applyPatientTagUpdate(
  patientId: string,
  updates: PatientTagUpdateInput,
  actorUserId: string | null // null = system/automated
): Promise<Patient> {
  const before = await prisma.patient.findUniqueOrThrow({ where: { id: patientId } })

  // Referral relationship consistency: a "Referred By" patient link only
  // means something while the source is actually PATIENT_REFERRAL. If the
  // caller is changing the source away from that (and didn't also supply a
  // new crmReferredByPatientId in the same request), clear the stale link
  // rather than leaving a dangling relationship the UI would otherwise have
  // to explain away. Never runs when crmReferralSource isn't part of this
  // update at all, so plain edits to other fields are unaffected.
  const effectiveUpdates: PatientTagUpdateInput = { ...updates }
  if (
    'crmReferralSource' in effectiveUpdates &&
    effectiveUpdates.crmReferralSource !== 'PATIENT_REFERRAL' &&
    !('crmReferredByPatientId' in effectiveUpdates)
  ) {
    effectiveUpdates.crmReferredByPatientId = null
  }

  const updated = await prisma.patient.update({
    where: { id: patientId },
    data: {
      ...(effectiveUpdates as Prisma.PatientUpdateInput),
      tagsUpdatedAt: new Date(),
      tagsUpdatedBy: actorUserId,
    },
  })

  for (const field of WATCHED_FIELDS as readonly WatchedField[]) {
    if (!(field in updates)) continue
    const fromValue = before[field] as unknown
    const toValue = updated[field] as unknown
    if (fromValue === toValue) continue

    await emitAutomationEvent({
      entityType: 'PATIENT',
      entityId:   patientId,
      eventType:  `${camelToSnake(field)}_changed`,
      fromValue:  fromValue == null ? null : String(fromValue),
      toValue:    toValue == null ? null : String(toValue),
      metadata:   { actorUserId },
    })
  }

  // Part E — special routing: balance owing + treatment plan incomplete must
  // never sit in a general marketing sequence; it needs its own collections
  // case with staff ownership instead.
  await syncCollectionsCase(updated)

  // Part D — an excluding tag change should end any conflicting active
  // marketing enrollment immediately (e.g. balance moves to OWING while
  // treatment is INCOMPLETE, or a decline is logged).
  if (updated.balanceStatus === 'OWING' && updated.treatmentPlanStatus === 'INCOMPLETE') {
    await exitActiveEnrollments('PATIENT', patientId, 'EXITED_TAG_CHANGE', 'moved_to_collections')
  }

  // Part D — recall condition resolved (a completed appointment moved the
  // patient off DUE/OVERDUE_* back to NOT_DUE) stops the recall reminder
  // sequence specifically, without touching any unrelated active enrollment
  // (e.g. a separate treatment-follow-up sequence) the patient may also hold.
  if (before.recallStatus !== 'NOT_DUE' && updated.recallStatus === 'NOT_DUE') {
    await exitActiveEnrollments('PATIENT', patientId, 'EXITED_TAG_CHANGE', 'recall_resolved', {
      conflictGroup: PATIENT_RECALL_CONFLICT_GROUP,
    })
  }

  // Part D — treatment issue resolved (no longer INCOMPLETE, whichever way it
  // resolved) stops the treatment-follow-up sequence specifically.
  if (before.treatmentPlanStatus === 'INCOMPLETE' && updated.treatmentPlanStatus !== 'INCOMPLETE') {
    await exitActiveEnrollments('PATIENT', patientId, 'EXITED_TAG_CHANGE', 'treatment_resolved', {
      conflictGroup: PATIENT_TREATMENT_FOLLOWUP_CONFLICT_GROUP,
    })
  }

  return updated
}

function camelToSnake(s: string): string {
  return s.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`)
}

async function syncCollectionsCase(patient: Patient): Promise<void> {
  const needsCollections = patient.balanceStatus === 'OWING' && patient.treatmentPlanStatus === 'INCOMPLETE'
  const existing = await prisma.collectionsCase.findUnique({ where: { patientId: patient.id } })

  if (needsCollections && !existing) {
    await prisma.collectionsCase.create({
      data: {
        patientId: patient.id,
        status:    'OPEN',
        reason:    'BALANCE_OWING_TREATMENT_INCOMPLETE',
      },
    })
    return
  }

  if (!needsCollections && existing && existing.status !== 'CLOSED') {
    await prisma.collectionsCase.update({
      where: { patientId: patient.id },
      data:  { status: 'CLOSED', resolvedAt: new Date() },
    })
  }
}

// ── Visit flags (no-show / late-cancel) — Part A "track count/history" ─────
// Called from the existing appointment status-update path when an
// appointment is marked NO_SHOW, or cancelled within the late-cancel window.
// Increments the rollup counters on Patient (the Appointment rows themselves
// already ARE the history) and emits the corresponding automation event.
export async function recordVisitFlag(patientId: string, flag: 'NO_SHOW' | 'LATE_CANCEL'): Promise<void> {
  const field = flag === 'NO_SHOW' ? 'noShowCount' : 'lateCancelCount'
  const before = await prisma.patient.findUniqueOrThrow({ where: { id: patientId }, select: { [field]: true } as any })
  const updated = await prisma.patient.update({
    where: { id: patientId },
    data:  { [field]: { increment: 1 } },
  })

  await emitAutomationEvent({
    entityType: 'PATIENT',
    entityId:   patientId,
    eventType:  `visit_flag_${flag.toLowerCase()}`,
    fromValue:  String((before as any)[field]),
    toValue:    String((updated as any)[field]),
  })
}

// ── Treatment-plan-status derivation (Part C) ───────────────────────────────
// Patient.treatmentPlanStatus (the CRM tag) used to be 100% staff-entered.
// It is derived here from TreatmentPlan.stage — the SAME canonical pipeline
// column the Treatment Pipeline board and Case Acceptance report already
// read (see routes/pipeline.ts's VALID_STAGES) — never a second source of
// truth. 'Follow-up Due' is reused as-is: it is already the pipeline's own
// designated "this plan needs follow-up" marker, so it maps directly to the
// CRM tag's INCOMPLETE value instead of this file inventing a new staleness
// heuristic. A patient can have multiple plans; the most actionable one wins
// (INCOMPLETE > PROPOSED > ACCEPTED > DECLINED > NONE) so a single stalled
// plan is never hidden behind an unrelated accepted one.
const TREATMENT_INCOMPLETE_STAGE = 'Follow-up Due'
const TREATMENT_PROPOSED_STAGES = ['Consulted', 'Treatment Presented']
const TREATMENT_ACCEPTED_STAGES = ['Accepted & Scheduled', 'Accepted & Unscheduled', 'Completed']
const TREATMENT_DECLINED_STAGES = ['Declined']

export function deriveTreatmentPlanStatusFromStages(stages: string[]): string {
  if (stages.length === 0) return 'NONE'
  if (stages.includes(TREATMENT_INCOMPLETE_STAGE)) return 'INCOMPLETE'
  if (stages.some(s => TREATMENT_PROPOSED_STAGES.includes(s))) return 'PROPOSED'
  if (stages.some(s => TREATMENT_ACCEPTED_STAGES.includes(s))) return 'ACCEPTED'
  if (stages.every(s => TREATMENT_DECLINED_STAGES.includes(s))) return 'DECLINED'
  return 'NONE'
}

// Called synchronously (fire-and-forget from the route's perspective) right
// after any TreatmentPlan stage/status write in routes/pipeline.ts, and as a
// nightly safety net in runDailyPatientTagDerivation below for any plan
// change that reaches TreatmentPlan through a path that doesn't call this
// directly. Writes through applyPatientTagUpdate like every other tag, so it
// emits treatment_plan_status_changed and the INCOMPLETE-resolved exit above
// exactly like a manual edit would.
export async function syncTreatmentPlanStatusFromPipeline(patientId: string): Promise<void> {
  const [plans, patient] = await Promise.all([
    prisma.treatmentPlan.findMany({ where: { patientId }, select: { stage: true } }),
    prisma.patient.findUnique({ where: { id: patientId }, select: { treatmentPlanStatus: true } }),
  ])
  if (!patient) return
  const newStatus = deriveTreatmentPlanStatusFromStages(plans.map(p => p.stage))
  if (newStatus !== patient.treatmentPlanStatus) {
    await applyPatientTagUpdate(patientId, { treatmentPlanStatus: newStatus as any }, null)
  }
}

// ── Daily derived-tag job (Part A time-derived fields) ──────────────────────
// Recomputes recallStatus, balanceStatus/balanceAgingBucket, lifecycleStage
// and valueTier from data that already exists elsewhere in the schema
// (Appointment, Invoice, Patient.accountBalance, Patient.treatmentTypes).
// Only patients whose derived value actually changed are written — and that
// write goes through applyPatientTagUpdate, so the event/enrollment engine
// sees it exactly like a manual edit. This is the "event source", not a
// polling trigger: the poll only computes a candidate value, the SAME shared
// write path decides whether that's a change worth emitting.
const RECALL_INTERVAL_DAYS: Record<string, number> = {
  THREE_MONTH: 90,
  SIX_MONTH: 180,
  TWELVE_MONTH: 365,
}

function computeRecallStatus(recallInterval: string | null, lastCompletedAt: Date | null, now: Date): string {
  if (!recallInterval || !lastCompletedAt) return 'NOT_DUE'
  const intervalDays = RECALL_INTERVAL_DAYS[recallInterval]
  if (!intervalDays) return 'NOT_DUE'
  const dueDate = new Date(lastCompletedAt.getTime() + intervalDays * 86_400_000)
  const daysPastDue = Math.floor((now.getTime() - dueDate.getTime()) / 86_400_000)
  if (daysPastDue < 0) return 'NOT_DUE'
  if (daysPastDue < 30) return 'DUE'
  if (daysPastDue < 90) return 'OVERDUE_30'
  if (daysPastDue < 180) return 'OVERDUE_90'
  return 'OVERDUE_180_PLUS'
}

function computeBalanceAgingBucket(oldestUnpaidCreatedAt: Date | null, now: Date): string | null {
  if (!oldestUnpaidCreatedAt) return null
  const ageDays = Math.floor((now.getTime() - oldestUnpaidCreatedAt.getTime()) / 86_400_000)
  if (ageDays < 30) return 'CURRENT'
  if (ageDays < 60) return '30'
  if (ageDays < 90) return '60'
  if (ageDays < 120) return '90'
  return '90_PLUS'
}

export async function runDailyPatientTagDerivation(): Promise<{ scanned: number; updated: number }> {
  const now = new Date()
  const patients = await prisma.patient.findMany({
    where: { isActive: true },
    select: {
      id: true, createdAt: true, accountBalance: true, recallInterval: true,
      recallStatus: true, balanceStatus: true, balanceAgingBucket: true,
      lifecycleStage: true, valueTier: true, treatmentTypes: true,
      treatmentPlanStatus: true,
    },
  })

  let updatedCount = 0

  for (const p of patients) {
    const lastCompleted = await prisma.appointment.findFirst({
      where:   { patientId: p.id, status: 'COMPLETED' },
      orderBy: { startAt: 'desc' },
      select:  { startAt: true },
    })
    const oldestUnpaid = await prisma.invoice.findFirst({
      where:   { patientId: p.id, status: { in: ['UNPAID', 'PARTIAL', 'OVERDUE'] } },
      orderBy: { createdAt: 'asc' },
      select:  { createdAt: true },
    })
    // Safety-net catch-all — the real-time trigger is routes/pipeline.ts
    // calling syncTreatmentPlanStatusFromPipeline() directly on every stage/
    // status write. This only catches a plan that changed through some other
    // path, mirroring how recall/balance already have both a real-time
    // trigger elsewhere AND this nightly recomputation.
    const plans = await prisma.treatmentPlan.findMany({ where: { patientId: p.id }, select: { stage: true } })

    const newRecallStatus = computeRecallStatus(p.recallInterval, lastCompleted?.startAt ?? null, now)
    const newBalanceStatus = p.accountBalance > 0 ? 'OWING' : 'CURRENT'
    const newBalanceAgingBucket = newBalanceStatus === 'OWING' ? computeBalanceAgingBucket(oldestUnpaid?.createdAt ?? null, now) : null
    const daysSinceCreated = Math.floor((now.getTime() - p.createdAt.getTime()) / 86_400_000)
    const newLifecycleStage = daysSinceCreated <= 90 ? 'NEW' : 'ESTABLISHED'
    const newValueTier = p.treatmentTypes.some(t => t === 'ORTHO' || t === 'IMPLANT') ? 'HIGH_VALUE' : 'STANDARD'
    const newTreatmentPlanStatus = deriveTreatmentPlanStatusFromStages(plans.map(pl => pl.stage))

    const updates: PatientTagUpdateInput = {}
    if (newRecallStatus !== p.recallStatus) updates.recallStatus = newRecallStatus as any
    if (newBalanceStatus !== p.balanceStatus) updates.balanceStatus = newBalanceStatus as any
    if (newBalanceAgingBucket !== p.balanceAgingBucket) updates.balanceAgingBucket = newBalanceAgingBucket
    if (newLifecycleStage !== p.lifecycleStage) updates.lifecycleStage = newLifecycleStage as any
    if (newValueTier !== p.valueTier) updates.valueTier = newValueTier as any
    if (newTreatmentPlanStatus !== p.treatmentPlanStatus) updates.treatmentPlanStatus = newTreatmentPlanStatus as any

    if (Object.keys(updates).length > 0) {
      await applyPatientTagUpdate(p.id, updates, null)
      updatedCount++
    }
  }

  return { scanned: patients.length, updated: updatedCount }
}