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
  lastCompletedAt: Date | null; dueAt: Date | null
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
    SELECT p.id, p."firstName", p."lastName", p.phone, MAX(a."startAt") AS "lastCompletedAt"
    FROM patients p
    JOIN appointments a ON a."patientId" = p.id AND a.status = 'COMPLETED'
    JOIN services s ON s.id = a."serviceId"
    WHERE p."isActive" = true AND p."recallInterval" IS NULL
      AND LOWER(TRIM(REGEXP_REPLACE(TRIM(s.name), '[^a-zA-Z0-9]+', ' ', 'g'))) IN (
        'periodontal maintenance', 'recall hygiene visit', 'periodontal maintenance recall hygiene visit'
      )
    GROUP BY p.id, p."firstName", p."lastName", p.phone
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
      where:  { isActive: true, recallInterval: { not: null } },
      select: { id: true, firstName: true, lastName: true, phone: true, recallStatus: true, recallInterval: true, tagsUpdatedAt: true },
      orderBy: { tagsUpdatedAt: 'asc' },
    }),
    estimatedRecallCandidates(),
  ])

  // Only completed hygiene appointments establish a recall baseline.
  // A subsequent consultation, review or Check & Treat must not reset it.
  const completedVisits = confirmed.length ? await prisma.appointment.findMany({
    where: {
      patientId: { in: confirmed.map(p => p.id) },
      status: 'COMPLETED',
    },
    select: { patientId: true, startAt: true, service: { select: { name: true } } },
    orderBy: { startAt: 'desc' },
  }) : []
  const latestVisitByPatient = new Map<string, Date>()
  const hygieneServices = new Set(['periodontal maintenance', 'recall hygiene visit', 'periodontal maintenance recall hygiene visit'])
  for (const visit of completedVisits) {
    const normalized = visit.service.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    if (!hygieneServices.has(normalized)) continue
    if (!latestVisitByPatient.has(visit.patientId)) latestVisitByPatient.set(visit.patientId, visit.startAt)
  }
  const intervalDays: Record<string, number> = { THREE_MONTH: 90, SIX_MONTH: 180, TWELVE_MONTH: 365 }
  const dueAt = (visit: Date | null, interval: string | null): Date | null =>
    visit && interval && intervalDays[interval]
      ? new Date(visit.getTime() + intervalDays[interval] * 86_400_000)
      : null

  const now = new Date()
  const confirmedRows: Array<RecallPatientRow & { status: string }> = confirmed
    .filter(p => latestVisitByPatient.has(p.id))
    .map(p => {
      const lastCompletedAt = latestVisitByPatient.get(p.id)!
      return {
        id: p.id, firstName: p.firstName, lastName: p.lastName, phone: p.phone,
        recallInterval: p.recallInterval, tagsUpdatedAt: p.tagsUpdatedAt,
        lastCompletedAt, dueAt: dueAt(lastCompletedAt, p.recallInterval),
        estimated: false, status: computeRecallStatus(p.recallInterval, lastCompletedAt, now),
      }
    }).filter(p => p.status !== 'NOT_DUE')
  const estimatedRows: Array<RecallPatientRow & { status: string }> = estimated.map(p => ({
    id: p.id, firstName: p.firstName, lastName: p.lastName, phone: p.phone,
    recallInterval: null, tagsUpdatedAt: p.lastCompletedAt,
    lastCompletedAt: p.lastCompletedAt, dueAt: dueAt(p.lastCompletedAt, 'SIX_MONTH'),
    estimated: true, status: p.status,
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
  treatmentPlanId: string
  firstName: string
  lastName: string
  phone: string
  procedure: string
  dentistNote: string | null
  followUpReason: string | null
  followUpNote: string | null
  followUpAt: Date
  nextReminderAt: Date
  attemptCount: number
  ownerId: string | null
  ownerName: string | null
  taskStatus: 'OPEN' | 'DONE' | 'DISMISSED' | null
}

// Use the SAME plan-level predicate as the Treatment Pipeline's Follow Up
// queue. A stale proposal alone is not a scheduled follow-up. This endpoint
// is read-only; no patient messaging or automatic pipeline transitions.
export async function treatmentFollowUpList(): Promise<TreatmentFollowUpItem[]> {
  const plans = await prisma.treatmentPlan.findMany({
    where: {
      followUpAt: { not: null },
      status: { notIn: ['Completed', 'Cancelled', 'Declined'] },
      patient: { isActive: true },
    },
    select: {
      id: true, patientId: true, stage: true, status: true, notes: true,
      followUpAt: true, followUpReason: true, followUpNote: true,
      patient: { select: { firstName: true, lastName: true, phone: true } },
    },
    orderBy: { followUpAt: 'asc' },
  })
  if (plans.length === 0) return []

  const tasks = await prisma.task.findMany({
    where: {
      entityType: 'PATIENT',
      entityId: { in: [...new Set(plans.map(p => p.patientId))] },
      title: TREATMENT_FOLLOWUP_TASK_TITLE,
      status: { not: 'DONE' },
    },
    select: {
      entityId: true, assignedToId: true, status: true,
      assignedTo: { select: { firstName: true, lastName: true } },
    },
  })
  // Latest staff-entered reminder is a CRM worklist projection only:
  // do not mutate the dentist's original followUpAt or pipeline status.
  const activities = await prisma.patientActivity.findMany({
    where: {
      patientId: { in: [...new Set(plans.map(p => p.patientId))] },
      action: 'TREATMENT_FOLLOWUP_CONTACT_ATTEMPT',
    },
    select: { metadata: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })
  const attemptByPlan = new Map<string, { count: number; reminder: Date | null }>()
  const planIds = new Set(plans.map(p => p.id))
  for (const activity of activities) {
    try {
      const meta = JSON.parse(activity.metadata ?? '{}')
      if (!planIds.has(meta.treatmentPlanId)) continue
      const previous = attemptByPlan.get(meta.treatmentPlanId)
      const reminder = typeof meta.nextReminderAt === 'string' && Number.isFinite(Date.parse(meta.nextReminderAt))
        ? new Date(meta.nextReminderAt) : null
      attemptByPlan.set(meta.treatmentPlanId, { count: (previous?.count ?? 0) + 1, reminder })
    } catch { /* Ignore unrelated or malformed legacy activity metadata. */ }
  }
  const taskByPatient = new Map(tasks.map(t => [t.entityId, t]))
  return plans.map(p => {
    const task = taskByPatient.get(p.patientId)
    return {
      id: p.patientId,
      treatmentPlanId: p.id,
      firstName: p.patient.firstName,
      lastName: p.patient.lastName,
      phone: p.patient.phone,
      procedure: p.stage,
      dentistNote: p.notes,
      followUpReason: p.followUpReason,
      followUpNote: p.followUpNote,
      followUpAt: p.followUpAt!,
      nextReminderAt: attemptByPlan.get(p.id)?.reminder ?? p.followUpAt!,
      attemptCount: attemptByPlan.get(p.id)?.count ?? 0,
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
  reason: 'LAST_VISIT_2_YEARS' | 'LAST_VISIT_3_YEARS' | 'LAST_VISIT_5_YEARS'
  lastVisitAt: Date
  yearsSinceVisit: 2 | 3 | 5
}

// Staff-only reactivation audiences, segmented by the most recent COMPLETED
// appointment of any service. A recent completed visit always excludes a
// patient even if their historical recall/no-show flags are stale.
// Buckets are exclusive: 5+ years, 3-<5 years, 2-<3 years.
export async function reactivationCandidates(): Promise<ReactivationCandidate[]> {
  const now = new Date()
  const cutoff = new Date(now)
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 2)
  const latestVisits = await prisma.appointment.groupBy({
    by: ['patientId'],
    where: { status: 'COMPLETED' },
    _max: { startAt: true },
  })
  const dormant = latestVisits.filter(v => v._max.startAt && v._max.startAt <= cutoff)
  if (!dormant.length) return []
  const patients = await prisma.patient.findMany({
    where: { isActive: true, id: { in: dormant.map(v => v.patientId) } },
    select: { id: true, firstName: true, lastName: true, phone: true },
  })
  const byId = new Map(patients.map(p => [p.id, p]))
  const three = new Date(now)
  three.setUTCFullYear(three.getUTCFullYear() - 3)
  const five = new Date(now)
  five.setUTCFullYear(five.getUTCFullYear() - 5)
  return dormant.flatMap(v => {
    const p = byId.get(v.patientId)
    const lastVisitAt = v._max.startAt
    if (!p || !lastVisitAt) return []
    const yearsSinceVisit: 2 | 3 | 5 = lastVisitAt <= five ? 5 : lastVisitAt <= three ? 3 : 2
    const reason: ReactivationCandidate['reason'] = yearsSinceVisit === 5 ? 'LAST_VISIT_5_YEARS' : yearsSinceVisit === 3 ? 'LAST_VISIT_3_YEARS' : 'LAST_VISIT_2_YEARS'
    return [{ ...p, reason, lastVisitAt, yearsSinceVisit }]
  }).sort((a, b) => a.lastVisitAt.getTime() - b.lastVisitAt.getTime())
}
