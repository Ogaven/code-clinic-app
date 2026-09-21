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

const TREATMENT_FOLLOWUP_TASK_TITLE = 'Treatment follow-up'

export interface RecallBucket {
  key: 'DUE' | 'OVERDUE_30' | 'OVERDUE_90' | 'OVERDUE_180_PLUS'
  label: string
  count: number
  patients: Array<{ id: string; firstName: string; lastName: string; phone: string; recallInterval: string | null; tagsUpdatedAt: Date | null }>
}

// A. Recall — due/overdue-30/90/180+, computed daily and already stored on
// Patient.recallStatus (see patient-tags.service.ts). This is a read of that
// existing field, grouped for display; it does not recompute anything and
// does not touch/activate any messaging sequence.
export async function recallOverview(): Promise<{ buckets: RecallBucket[]; totalNeedingAttention: number }> {
  const patients = await prisma.patient.findMany({
    where:  { isActive: true, recallStatus: { in: ['DUE', 'OVERDUE_30', 'OVERDUE_90', 'OVERDUE_180_PLUS'] } },
    select: { id: true, firstName: true, lastName: true, phone: true, recallStatus: true, recallInterval: true, tagsUpdatedAt: true },
    orderBy: { tagsUpdatedAt: 'asc' },
  })

  const bucketDefs: Array<{ key: RecallBucket['key']; label: string }> = [
    { key: 'DUE', label: 'Due' },
    { key: 'OVERDUE_30', label: 'Overdue 30+ days' },
    { key: 'OVERDUE_90', label: 'Overdue 90+ days' },
    { key: 'OVERDUE_180_PLUS', label: 'Overdue 180+ days (dormant)' },
  ]

  const buckets = bucketDefs.map(def => {
    const matching = patients.filter(p => p.recallStatus === def.key)
    return {
      key: def.key,
      label: def.label,
      count: matching.length,
      patients: matching.map(p => ({ id: p.id, firstName: p.firstName, lastName: p.lastName, phone: p.phone, recallInterval: p.recallInterval, tagsUpdatedAt: p.tagsUpdatedAt })),
    }
  })

  return { buckets, totalNeedingAttention: patients.length }
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
}

// B. Treatment Follow-up — patients whose CRM tag (Patient.treatmentPlanStatus,
// itself derived in real time from the canonical TreatmentPlan.stage pipeline
// field — see patient-tags.service.ts's syncTreatmentPlanStatusFromPipeline)
// is INCOMPLETE. Owner assignment reuses the existing generic Task model
// (entityType='PATIENT') instead of a new column — the same model Collections
// follow-up and Lead follow-ups already use.
export async function treatmentFollowUpList(): Promise<TreatmentFollowUpItem[]> {
  const patients = await prisma.patient.findMany({
    where:  { isActive: true, treatmentPlanStatus: 'INCOMPLETE' },
    select: { id: true, firstName: true, lastName: true, phone: true, tagsUpdatedAt: true },
    orderBy: { tagsUpdatedAt: 'asc' },
  })
  if (patients.length === 0) return []

  const tasks = await prisma.task.findMany({
    where:  { entityType: 'PATIENT', entityId: { in: patients.map(p => p.id) }, title: TREATMENT_FOLLOWUP_TASK_TITLE, status: { not: 'DONE' } },
    select: { entityId: true, assignedToId: true, status: true, assignedTo: { select: { firstName: true, lastName: true } } },
  })
  const taskByPatient = new Map(tasks.map(t => [t.entityId, t]))

  return patients.map(p => {
    const task = taskByPatient.get(p.id)
    return {
      id: p.id, firstName: p.firstName, lastName: p.lastName, phone: p.phone, tagsUpdatedAt: p.tagsUpdatedAt,
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
  reason: 'DORMANT_180_PLUS' | 'REPEATED_NO_SHOW'
  recallStatus: string
  noShowCount: number
  lateCancelCount: number
}

// C. Reactivation — a coherent view of who's actually disengaged: dormant by
// recall (180+ days overdue) or a repeat no-show/late-cancel pattern (2+).
// Read-only; the existing recall_dormant_reactivation sequence (patient-tags
// milestone) stays DRAFT and is never activated from here.
export async function reactivationCandidates(): Promise<ReactivationCandidate[]> {
  const patients = await prisma.patient.findMany({
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
  })

  return patients.map(p => ({
    id: p.id, firstName: p.firstName, lastName: p.lastName, phone: p.phone,
    reason: p.recallStatus === 'OVERDUE_180_PLUS' ? 'DORMANT_180_PLUS' : 'REPEATED_NO_SHOW',
    recallStatus: p.recallStatus, noShowCount: p.noShowCount, lateCancelCount: p.lateCancelCount,
  }))
}
