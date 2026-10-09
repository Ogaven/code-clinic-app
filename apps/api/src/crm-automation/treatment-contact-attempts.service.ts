import { prisma } from '../lib/prisma'

// Reuse the existing append-only patient activity timeline: no schema
// migration or production data rewrite is required.
const ACTION = 'TREATMENT_FOLLOWUP_CONTACT_ATTEMPT'
const METHODS = new Set(['PHONE', 'WHATSAPP', 'SMS', 'EMAIL', 'IN_PERSON', 'OTHER'])
const OUTCOMES = new Set(['NO_ANSWER', 'REACHED', 'CALL_BACK', 'DECLINED', 'OTHER'])

export interface ContactAttemptInput {
  method: string
  outcome: string
  comment: string
  nextReminderAt?: string | null
}

export function validateContactAttempt(input: ContactAttemptInput): string | null {
  if (!METHODS.has(input.method)) return 'Invalid contact method'
  if (!OUTCOMES.has(input.outcome)) return 'Invalid contact outcome'
  if (typeof input.comment !== 'string' || !input.comment.trim() || input.comment.length > 2000) return 'Comment is required (maximum 2000 characters)'
  if (input.nextReminderAt != null && (!input.nextReminderAt || !Number.isFinite(Date.parse(input.nextReminderAt)))) return 'Invalid next reminder date'
  return null
}

export async function listTreatmentContactAttempts(planId: string) {
  const plan = await prisma.treatmentPlan.findUnique({
    where: { id: planId },
    select: { patientId: true },
  })
  if (!plan) return null
  const activities = await prisma.patientActivity.findMany({
    where: { patientId: plan.patientId, action: ACTION },
    orderBy: { createdAt: 'asc' },
    select: { id: true, userId: true, userName: true, createdAt: true, metadata: true },
  })
  return activities.flatMap(a => {
    try {
      const metadata = JSON.parse(a.metadata ?? '{}')
      if (metadata.treatmentPlanId !== planId) return []
      return [{ id: a.id, staffId: a.userId, staffName: a.userName, attemptedAt: a.createdAt,
        method: metadata.method, outcome: metadata.outcome, comment: metadata.comment,
        nextReminderAt: metadata.nextReminderAt ?? null }]
    } catch { return [] }
  })
}

export async function recordTreatmentContactAttempt(planId: string, input: ContactAttemptInput, staff: { id: string; firstName: string; lastName: string }) {
  const error = validateContactAttempt(input)
  if (error) throw new Error(error)
  const plan = await prisma.treatmentPlan.findUnique({
    where: { id: planId },
    select: { patientId: true, followUpAt: true, status: true },
  })
  if (!plan || !plan.followUpAt || ['Completed', 'Cancelled', 'Declined'].includes(plan.status)) return null
  return prisma.patientActivity.create({
    data: {
      patientId: plan.patientId,
      userId: staff.id,
      userName: `${staff.firstName} ${staff.lastName}`.trim(),
      action: ACTION,
      metadata: JSON.stringify({
        treatmentPlanId: planId, method: input.method, outcome: input.outcome,
        comment: input.comment.trim(), nextReminderAt: input.nextReminderAt ?? null,
      }),
    },
  })
}
