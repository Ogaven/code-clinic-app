import { describe, expect, it } from 'vitest'
import { classifyHistoricalReconciliation, type ReconciliationEvidence } from './historical-reconciliation-classifier'

const base: ReconciliationEvidence = {
  status: 'NEW', stage: 'NEW', convertedToPatientId: null,
  patientLinkVerified: false, appointmentPatientId: null,
  appointmentCreatedAt: null, leadCreatedAt: new Date('2026-01-01'),
  appointmentStatus: null, phoneCandidateCount: 0,
}
describe('historical reconciliation safety classifier', () => {
  it('never promotes a unique phone match', () => {
    expect(classifyHistoricalReconciliation({ ...base, phoneCandidateCount: 1 }).classification).toBe('MANUAL_REVIEW')
  })
  it('requires manual review for shared-family phones', () => {
    expect(classifyHistoricalReconciliation({ ...base, phoneCandidateCount: 2 }).reason).toBe('multiple_patient_candidates')
  })
  it('does not treat an existing unverified link as proof', () => {
    expect(classifyHistoricalReconciliation({ ...base, convertedToPatientId: 'p1' }).reason).toBe('unverified_patient_link')
  })
  it('accepts only verified link plus qualifying patient appointment', () => {
    expect(classifyHistoricalReconciliation({ ...base, convertedToPatientId: 'p1', patientLinkVerified: true,
      appointmentPatientId: 'p1', appointmentCreatedAt: new Date('2026-01-02'), appointmentStatus: 'CONFIRMED' }).classification).toBe('ELIGIBLE')
  })
  it.each(['CANCELLED', 'CANCELLED_RESCHEDULED', 'NO_SHOW'])('rejects %s appointment', status => {
    expect(classifyHistoricalReconciliation({ ...base, convertedToPatientId: 'p1', patientLinkVerified: true,
      appointmentPatientId: 'p1', appointmentCreatedAt: new Date('2026-01-02'), appointmentStatus: status }).classification).toBe('UNMATCHED')
  })
  it('rejects appointments belonging to another patient', () => {
    expect(classifyHistoricalReconciliation({ ...base, convertedToPatientId: 'p1', patientLinkVerified: true,
      appointmentPatientId: 'p2', appointmentCreatedAt: new Date('2026-01-02'), appointmentStatus: 'CONFIRMED' }).classification).toBe('UNMATCHED')
  })
  it('rejects stale and terminal stages', () => {
    expect(classifyHistoricalReconciliation({ ...base, status: 'LOST', stage: 'LOST' }).classification).toBe('SKIPPED')
    expect(classifyHistoricalReconciliation({ ...base, status: 'NEW', stage: 'CONTACTED' }).classification).toBe('SKIPPED')
  })
  it('does not qualify an appointment before lead creation', () => {
    expect(classifyHistoricalReconciliation({ ...base, convertedToPatientId: 'p1', patientLinkVerified: true,
      appointmentPatientId: 'p1', appointmentCreatedAt: new Date('2025-12-31'), appointmentStatus: 'CONFIRMED' }).classification).toBe('UNMATCHED')
  })
})
