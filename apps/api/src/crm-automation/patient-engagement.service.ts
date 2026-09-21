// ─────────────────────────────────────────────────────────────────────────
// CRM Automation — Patient Engagement (Product Experience Closure).
//
// Existing-patient lifecycle CRM, separate from lead acquisition. Every
// function here reads fields that already existed before this milestone
// (Patient.recallStatus/treatmentPlanStatus/noShowCount/lateCancelCount,
// computed daily by patient-tags.service.ts's runDailyPatientTagDerivation)
// — nothing new is scored or derived, and nothing here enrols anyone in a
// message sequence. These are READ views plus, for treatment follow-up, a
// lightweight owner assignment reusing the existing generic Task model
// (schema.prisma) rather than a new column or a second treatment-plan model.
//
// Recall/treatment-incomplete/repeated-no-show used to be surfaced as
// categories inside Needs Attention. They moved here because Needs
// Attention is now scoped to LEADS specifically (see needs-attention.
// service.ts's header) — these are existing-PATIENT concerns and now have
// their own dedicated homes under CRM > Patient Engagement instead.
// ─────────────────────────────────────────────────────────────────────────
import { prisma } from '../lib/prisma'
import { computeRecallStatus } from './patient-tags.service'

const TREATMENT_FOLLOWUP_TASK_TITLE = 'Treatment follow-up'

// Used ONLY to compute a read-time ESTIMATE for patients with no staff-set
// recallInterval — never written to the database. Six months is a
// conservative, industry-standard general-checkup cadence; a patient here
// is always clearly labeled "estimated" so staff know the interval wasn't
// confirmed. See patient-tags.service.ts's computeRecallStatus/
// RECALL_INTERVAL_DAYS for the same thresholds this reuses.
const ESTIMATED_DEFAULT_INTERVAL = 'SIX_MONTH'

export interface RecallPatientRow {
  id: string; firstName: string; lastName: string; phone: string
  recallInterval: string | null; tagsUpdatedAt: Date | null
  estimated: boolean
}

export interface RecallBucket {
  key: 'DUE' | 'OVERDUE_30' | 'OVERDUE_90' | 'OVERDUE_180_PLUS'
  label: string
  count: number
  patients: RecallPatientRow[]
}

// Real last-completed-appointment data for active patients who have never
// had a recall interval set by staff (recallInterval IS NULL) — so
// computeRecallStatus's real bug (silently NOT_DUE forever without an
// interval) never hides a patient who genuinely hasn't been seen in a long
// time. Read-time only; never persisted to Patient.recallInterval/recallStatus.
async function estimatedRecallCandidates(): Promise<Array<{ id: string; firstName: string; lastName: string; phone: string; lastCompletedAt: Date; status: string }>> {
  const rows = await prisma.$queryRaw<Array<{ id: string; firstName: string; lastName: string; phone: string; lastCompletedAt: Date }>>`
    SELECT p.id, p."firstName", p."lastName", p.phone, la."lastCompletedAt"
    FROM patients p
    JOIN (
      SELECT "patientId", MAX("startAt") AS "lastCompletedAt"
      FROM appointments WHERE status = 'COMPLETED' GROUP BY "patientId"
    ) la ON la."patientId" = p.id
    WHERE p."isActive" = true AND p."recallInterval" IS NULL
  `
  const now = new Date()
  return rows
    .map(r => ({ ...r, status: computeRecallStatus(ESTIMATED_DEFAULT_INTERVAL, r.lastCompletedAt, now) }))
    .filter(r => r.status !== 'NOT_DUE')
}

// A. Recall — due/overdue-30/90/180+. Combines two sources so a missing
// staff-set recallInterval can never hide a real gap in care:
//   1. Patient.recallStatus, computed daily from a CONFIRMED recallInterval
//      (see patient-tags.service.ts) — precise, not an estimate.
//   2. Patients with NO recallInterval set at all, estimated read-time
//      against a default 6-month interval using their real last completed
//      appointment — clearly flagged `estimated: true`, never treated as
//      equally precise as (1), never written back to the database.
// Does not touch/activate any messaging sequence.
export async function recallOverview(): Promise<{ buckets: RecallBucket[]; totalNeedingAttention: number; totalEstimated: number }> {
  const [confirmed, estimated] = await Promise.all([
    prisma.patient.findMany({
      where:  { isActive: true, recallStatus: { in: ['DUE', 'OVERDUE_30', 'OVERDUE_90', 'OVERDUE_180_PLUS'] } },
      select: { id: true, firstName: true, lastName: true, phone: true, recallStatus: true, recallInterval: true, tagsUpdatedAt: true },
      orderBy: { tagsUpdatedAt: 'asc' },
    }),
    estimatedRecallCandidates(),
  ])

  const confirmedRows: Array<RecallPatientRow & { status: string }> = confirmed.map(p => ({
    id: p.id, firstName: p.firstName, lastName: p.lastName, phone: p.phone,
    recallInterval: p.recallInterval, tagsUpdatedAt: p.tagsUpdatedAt, estimated: false, status: p.recallStatus,
  }))
  const estimatedRows: Array<RecallPatientRow & { status: string }> = estimated.map(p => ({
    id: p.id, firstName: p.firstName, lastName: p.lastName, phone: p.phone,
    recallInterval: null, tagsUpdatedAt: p.lastCompletedAt, estimated: true, status: p.status,
  }))
  const allRows = [...confirmedRows, ...estimatedRows]

  const bucketDefs: Array<{ key: RecallBucket['key']; label: string }> = [
    { key: 'DUE', label: 'Due' },
    { key: 'OVERDUE_30', label: 'Overdue 30+ days' },
    { key: 'OVERDUE_90', label: 'Overdue 90+ days' },
    { key: 'OVERDUE_180_PLUS', label: 'Overdue 180+ days (dormant)' },
  ]

  const buckets = bucketDefs.map(def => {
    const matching = allRows.filter(p => p.status === def.key)
    return {
      key: def.key,
      label: def.label,
      count: matching.length,
      patients: matching.map(({ status: _status, ...p }) => p),
    }
  })

  return { buckets, totalNeedingAttention: allRows.length, totalEstimated: estimatedRows.length }
}

export interface TreatmentFollowUpItem {
  id: string
  firstName: string
  lastName: string
  phone: string
  tagsUpdatedAt: Date | null
  ownerId: string | null
  ownerName: string | null
  taskStatus: 'OPEN' | 'DONE' | 'DISMISSED' | null
  stage: 'INCOMPLETE' | 'PROPOSED_STALE'
}

const PROPOSED_STALE_DAYS = 14

// B. Treatment Follow-up — combines two real signals so this list is never
// empty just because staff have never used the pipeline's specific
// "Follow-up Due" stage:
//   1. Patient.treatmentPlanStatus === 'INCOMPLETE' — the canonical signal,
//      derived in real time from TreatmentPlan.stage === 'Follow-up Due'
//      (see patient-tags.service.ts's syncTreatmentPlanStatusFromPipeline).
//   2. treatmentPlanStatus === 'PROPOSED' (Consulted/Treatment Presented)
//      with no tag update in PROPOSED_STALE_DAYS — real patients who were
//      consulted/quoted but never moved to accepted/declined/follow-up,
//      clearly labeled "stale proposal" rather than conflated with (1)'s
//      precise pipeline signal.
// Owner assignment reuses the existing generic Task model (entityType=
// 'PATIENT') instead of a new column — the same model Collections and Lead
// follow-ups already use.
export async function treatmentFollowUpList(): Promise<TreatmentFollowUpItem[]> {
  const staleCutoff = new Date(Date.now() - PROPOSED_STALE_DAYS * 86_400_000)

  const [incomplete, proposedStale] = await Promise.all([
    prisma.patient.findMany({
      where:  { isActive: true, treatmentPlanStatus: 'INCOMPLETE' },
      select: { id: true, firstName: true, lastName: true, phone: true, tagsUpdatedAt: true },
      orderBy: { tagsUpdatedAt: 'asc' },
    }),
    prisma.patient.findMany({
      where:  { isActive: true, treatmentPlanStatus: 'PROPOSED', tagsUpdatedAt: { lt: staleCutoff } },
      select: { id: true, firstName: true, lastName: true, phone: true, tagsUpdatedAt: true },
      orderBy: { tagsUpdatedAt: 'asc' },
    }),
  ])

  const patients = [
    ...incomplete.map(p => ({ ...p, stage: 'INCOMPLETE' as const })),
    ...proposedStale.map(p => ({ ...p, stage: 'PROPOSED_STALE' as const })),
  ]
  if (patients.length === 0) return []

  const tasks = await prisma.task.findMany({
    where:  { entityType: 'PATIENT', entityId: { in: patients.map(p => p.id) }, title: TREATMENT_FOLLOWUP_TASK_TITLE, status: { not: 'DONE' } },
    select: { entityId: true, assignedToId: true, status: true, assignedTo: { select: { firstName: true, lastName: true } } },
  })
  const taskByPatient = new Map(tasks.map(t => [t.entityId, t]))

  return patients.map(p => {
    const task = taskByPatient.get(p.id)
    return {
      id: p.id, firstName: p.firstName, lastName: p.lastName, phone: p.phone, tagsUpdatedAt: p.tagsUpdatedAt, stage: p.stage,
      ownerId: task?.assignedToId ?? null,
      ownerName: task?.assignedTo ? `${task.assignedTo.firstName} ${task.assignedTo.lastName}` : null,
      taskStatus: (task?.status as 'OPEN' | 'DISMISSED' | undefined) ?? null,
    }
  })
}

// Idempotent by (entityType, entityId, title): reassigning just updates the
// existing open task rather than creating a duplicate one every time staff
// change their mind about who owns a case.
export async function assignTreatmentFollowUpOwner(patientId: string, ownerId: string | null): Promise<void> {
  const existing = await prisma.task.findFirst({
    where: { entityType: 'PATIENT', entityId: patientId, title: TREATMENT_FOLLOWUP_TASK_TITLE, status: { not: 'DONE' } },
  })
  if (existing) {
    await prisma.task.update({ where: { id: existing.id }, data: { assignedToId: ownerId } })
    return
  }
  await prisma.task.create({
    data: { entityType: 'PATIENT', entityId: patientId, title: TREATMENT_FOLLOWUP_TASK_TITLE, assignedToId: ownerId, status: 'OPEN' },
  })
}

export interface ReactivationCandidate {
  id: string
  firstName: string
  lastName: string
  phone: string
  reason: 'DORMANT_180_PLUS' | 'REPEATED_NO_SHOW' | 'DORMANT_ESTIMATED'
  recallStatus: string
  noShowCount: number
  lateCancelCount: number
  estimated: boolean
}

// Real historical no-show count, read directly from Appointment rows —
// independent of Patient.noShowCount, which only started incrementing once
// recordVisitFlag() was wired into scheduling.ts (2026-09-14) and has no
// backfill from appointments that predate that. This lets genuinely
// repeat-no-show patients surface immediately instead of waiting weeks for
// the counter to catch up. Real data only — counts actual NO_SHOW rows.
async function patientsWithRepeatedHistoricalNoShows(): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<Array<{ patientId: string }>>`
    SELECT "patientId" FROM appointments WHERE status = 'NO_SHOW' AND "patientId" IS NOT NULL
    GROUP BY "patientId" HAVING COUNT(*) >= 2
  `
  return new Set(rows.map(r => r.patientId))
}

// C. Reactivation — a coherent view of who's actually disengaged:
//   1. Confirmed dormant by recall (180+ days overdue on a staff-set interval)
//   2. Repeat no-show/late-cancel pattern (2+), from either the live rollup
//      counters OR real historical Appointment.status='NO_SHOW' rows —
//      whichever shows it, since the rollup counters have no backfill
//   3. Estimated-dormant: no recallInterval set at all, but genuinely no
//      completed visit in 180+ days (read-time only, see recallOverview's
//      estimatedRecallCandidates — never persisted, always flagged)
// Read-only; the existing recall_dormant_reactivation sequence (patient-tags
// milestone) stays DRAFT and is never activated from here.
export async function reactivationCandidates(): Promise<ReactivationCandidate[]> {
  const [patients, historicalNoShowIds, estimatedDormant] = await Promise.all([
    prisma.patient.findMany({
      where: {
        isActive: true,
        OR: [
          { recallStatus: 'OVERDUE_180_PLUS' },
          { noShowCount: { gte: 2 } },
          { lateCancelCount: { gte: 2 } },
        ],
      },
      select: { id: true, firstName: true, lastName: true, phone: true, recallStatus: true, noShowCount: true, lateCancelCount: true, tagsUpdatedAt: true },
      orderBy: { tagsUpdatedAt: 'desc' },
    }),
    patientsWithRepeatedHistoricalNoShows(),
    estimatedRecallCandidates(),
  ])

  const confirmedIds = new Set(patients.map(p => p.id))
  const confirmed: ReactivationCandidate[] = patients.map(p => ({
    id: p.id, firstName: p.firstName, lastName: p.lastName, phone: p.phone,
    reason: p.recallStatus === 'OVERDUE_180_PLUS' ? 'DORMANT_180_PLUS' : 'REPEATED_NO_SHOW',
    recallStatus: p.recallStatus, noShowCount: p.noShowCount, lateCancelCount: p.lateCancelCount, estimated: false,
  }))

  // Real historical no-shows for a patient the live counter missed.
  const extraHistoricalNoShowIds = [...historicalNoShowIds].filter(id => !confirmedIds.has(id))
  const extraHistorical = extraHistoricalNoShowIds.length
    ? await prisma.patient.findMany({
        where: { id: { in: extraHistoricalNoShowIds }, isActive: true },
        select: { id: true, firstName: true, lastName: true, phone: true, recallStatus: true, noShowCount: true, lateCancelCount: true },
      })
    : []
  for (const p of extraHistorical) {
    confirmedIds.add(p.id)
    confirmed.push({
      id: p.id, firstName: p.firstName, lastName: p.lastName, phone: p.phone,
      reason: 'REPEATED_NO_SHOW', recallStatus: p.recallStatus, noShowCount: p.noShowCount, lateCancelCount: p.lateCancelCount, estimated: false,
    })
  }

  const estimated: ReactivationCandidate[] = estimatedDormant
    .filter(p => p.status === 'OVERDUE_180_PLUS' && !confirmedIds.has(p.id))
    .map(p => ({
      id: p.id, firstName: p.firstName, lastName: p.lastName, phone: p.phone,
      reason: 'DORMANT_ESTIMATED', recallStatus: 'NOT_DUE', noShowCount: 0, lateCancelCount: 0, estimated: true,
    }))

  return [...confirmed, ...estimated]
}
