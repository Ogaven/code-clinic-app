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

  const updated = await prisma.patient.update({
    where: { id: patientId },
    data: {
      ...(updates as Prisma.PatientUpdateInput),
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

    const newRecallStatus = computeRecallStatus(p.recallInterval, lastCompleted?.startAt ?? null, now)
    const newBalanceStatus = p.accountBalance > 0 ? 'OWING' : 'CURRENT'
    const newBalanceAgingBucket = newBalanceStatus === 'OWING' ? computeBalanceAgingBucket(oldestUnpaid?.createdAt ?? null, now) : null
    const daysSinceCreated = Math.floor((now.getTime() - p.createdAt.getTime()) / 86_400_000)
    const newLifecycleStage = daysSinceCreated <= 90 ? 'NEW' : 'ESTABLISHED'
    const newValueTier = p.treatmentTypes.some(t => t === 'ORTHO' || t === 'IMPLANT') ? 'HIGH_VALUE' : 'STANDARD'

    const updates: PatientTagUpdateInput = {}
    if (newRecallStatus !== p.recallStatus) updates.recallStatus = newRecallStatus as any
    if (newBalanceStatus !== p.balanceStatus) updates.balanceStatus = newBalanceStatus as any
    if (newBalanceAgingBucket !== p.balanceAgingBucket) updates.balanceAgingBucket = newBalanceAgingBucket
    if (newLifecycleStage !== p.lifecycleStage) updates.lifecycleStage = newLifecycleStage as any
    if (newValueTier !== p.valueTier) updates.valueTier = newValueTier as any

    if (Object.keys(updates).length > 0) {
      await applyPatientTagUpdate(p.id, updates, null)
      updatedCount++
    }
  }

  return { scanned: patients.length, updated: updatedCount }
}