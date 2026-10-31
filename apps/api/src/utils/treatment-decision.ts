// Stage 1 decision vocabulary. This is intentionally independent of the existing
// TreatmentPlan.status and stage fields, which drive clinical and CRM workflows.
export const PATIENT_DECISIONS = [
  'Accepted',
  'Partially Accepted',
  'Undecided',
  'Deferred',
  'Declined',
] as const

export type PatientDecision = (typeof PATIENT_DECISIONS)[number]

export function isPatientDecision(value: unknown): value is PatientDecision {
  return typeof value === 'string' && PATIENT_DECISIONS.some(decision => decision === value)
}

// A recorded decline must never initiate a sales follow-up. Deferrals and
// consent/opt-out restrictions require separate staff review before contact.
export function eligibleForRoutineTreatmentFollowUp(
  decision: PatientDecision | null,
  hasContactPermission: boolean,
): boolean {
  return hasContactPermission && decision !== 'Declined' && decision !== 'Deferred' && decision !== 'Accepted'
}
