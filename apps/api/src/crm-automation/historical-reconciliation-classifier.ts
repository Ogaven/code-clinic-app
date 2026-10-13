/**
 * Conservative historical reconciliation classification.
 * Phone numbers and matching names are never independent identity evidence.
 * A linked patient and appointment are necessary, but not sufficient:
 * the patient-link provenance must be independently verified.
 */
export type ReconciliationDecision =
  | { classification: 'ELIGIBLE'; reason: 'verified_identity_and_qualifying_appointment' }
  | { classification: 'MANUAL_REVIEW'; reason: 'unverified_patient_link' | 'phone_match_only' | 'multiple_patient_candidates' }
  | { classification: 'UNMATCHED'; reason: 'no_patient_evidence' | 'no_qualifying_appointment' }
  | { classification: 'SKIPPED'; reason: 'terminal_or_already_converted' | 'inconsistent_stage' }

export interface ReconciliationEvidence {
  status: string
  stage: string
  convertedToPatientId: string | null
  patientLinkVerified: boolean
  appointmentPatientId: string | null
  appointmentCreatedAt: Date | null
  leadCreatedAt: Date
  appointmentStatus: string | null
  phoneCandidateCount: number
}

export function classifyHistoricalReconciliation(e: ReconciliationEvidence): ReconciliationDecision {
  if (e.status === 'CONVERTED' || e.status === 'LOST') return { classification: 'SKIPPED', reason: 'terminal_or_already_converted' }
  if (!['NEW', 'CONTACTED', 'QUALIFIED'].includes(e.status) || e.stage !== e.status)
    return { classification: 'SKIPPED', reason: 'inconsistent_stage' }
  if (!e.convertedToPatientId) {
    if (e.phoneCandidateCount > 1) return { classification: 'MANUAL_REVIEW', reason: 'multiple_patient_candidates' }
    if (e.phoneCandidateCount === 1) return { classification: 'MANUAL_REVIEW', reason: 'phone_match_only' }
    return { classification: 'UNMATCHED', reason: 'no_patient_evidence' }
  }
  if (!e.patientLinkVerified) return { classification: 'MANUAL_REVIEW', reason: 'unverified_patient_link' }
  if (!e.appointmentPatientId || e.appointmentPatientId !== e.convertedToPatientId ||
      !e.appointmentCreatedAt || e.appointmentCreatedAt < e.leadCreatedAt ||
      !e.appointmentStatus || ['CANCELLED', 'CANCELLED_RESCHEDULED', 'NO_SHOW'].includes(e.appointmentStatus))
    return { classification: 'UNMATCHED', reason: 'no_qualifying_appointment' }
  return { classification: 'ELIGIBLE', reason: 'verified_identity_and_qualifying_appointment' }
}
