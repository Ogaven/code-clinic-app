import { prisma } from '../lib/prisma'

const CONTACT_ATTEMPT_ACTION = 'TREATMENT_FOLLOWUP_CONTACT_ATTEMPT'
export const MINIMUM_TREATMENT_FOLLOWUP_ATTEMPTS = 3

export interface TreatmentFollowUpTransitionPlan {
  id: string
  patientId: string
  followUpAt: Date | null
}

export interface TreatmentFollowUpTransitionCheck {
  allowed: boolean
  attemptCount: number
  minimumAttempts: number
}

/**
 * Count plan-specific follow-up contact attempts stored in the existing
 * append-only PatientActivity timeline. Activities are patient-scoped, so we
 * filter metadata by treatmentPlanId before counting.
 */
export async function countTreatmentFollowUpAttempts(planId: string, patientId: string): Promise<number> {
  const activities = await prisma.patientActivity.findMany({
    where: { patientId, action: CONTACT_ATTEMPT_ACTION },
    select: { metadata: true },
  })

  let count = 0
  for (const activity of activities) {
    try {
      const metadata = JSON.parse(activity.metadata ?? '{}')
      if (metadata.treatmentPlanId === planId) count += 1
    } catch {
      // Ignore malformed historical metadata. It cannot safely prove that a
      // contact attempt belongs to this treatment plan.
    }
  }
  return count
}

/**
 * The three-attempt requirement applies only to plans with an active internal
 * follow-up date. Ordinary clinical plans remain untouched.
 */
export async function checkTreatmentFollowUpTransition(
  plan: TreatmentFollowUpTransitionPlan,
): Promise<TreatmentFollowUpTransitionCheck> {
  if (!plan.followUpAt) {
    return { allowed: true, attemptCount: 0, minimumAttempts: MINIMUM_TREATMENT_FOLLOWUP_ATTEMPTS }
  }

  const attemptCount = await countTreatmentFollowUpAttempts(plan.id, plan.patientId)
  return {
    allowed: attemptCount >= MINIMUM_TREATMENT_FOLLOWUP_ATTEMPTS,
    attemptCount,
    minimumAttempts: MINIMUM_TREATMENT_FOLLOWUP_ATTEMPTS,
  }
}
