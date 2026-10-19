import { describe, expect, it } from 'vitest'
import { validateProductionEntry, isCorrectionWithinDeliveredValue, productionLinksMatchPatient } from '../utils/clinical-production-validation'

const base = { sourceKey: 'unique-123', note: 'Treatment delivered and verified' }
describe('clinical production validation', () => {
  it('accepts positive attested delivery', () => expect(validateProductionEntry({ ...base, kind: 'DELIVERY', amountUGX: 250000 })).toBeNull())
  it('rejects unverified zero and negative deliveries', () => {
    expect(validateProductionEntry({ ...base, kind: 'DELIVERY', amountUGX: 0 })).not.toBeNull()
    expect(validateProductionEntry({ ...base, kind: 'DELIVERY', amountUGX: -1 })).not.toBeNull()
  })
  it('requires linked negative reversal', () => {
    expect(validateProductionEntry({ ...base, kind: 'REVERSAL', amountUGX: -100, originalEntryId: 'entry-1' })).toBeNull()
    expect(validateProductionEntry({ ...base, kind: 'REVERSAL', amountUGX: 100, originalEntryId: 'entry-1' })).not.toBeNull()
    expect(validateProductionEntry({ ...base, kind: 'REVERSAL', amountUGX: -100 })).not.toBeNull()
  })
  it('requires a linked nonzero adjustment', () => {
    expect(validateProductionEntry({ ...base, kind: 'ADJUSTMENT', amountUGX: 50, originalEntryId: 'entry-1' })).toBeNull()
    expect(validateProductionEntry({ ...base, kind: 'ADJUSTMENT', amountUGX: 0, originalEntryId: 'entry-1' })).not.toBeNull()
  })
  it('rejects missing reason, idempotency key and fractional UGX', () => {
    expect(validateProductionEntry({ ...base, kind: 'DELIVERY', amountUGX: 1.5 })).not.toBeNull()
    expect(validateProductionEntry({ ...base, kind: 'DELIVERY', amountUGX: 1, note: ' ' })).not.toBeNull()
    expect(validateProductionEntry({ ...base, kind: 'DELIVERY', amountUGX: 1, sourceKey: '' })).not.toBeNull()
  })
  it('prevents corrections below zero', () => {
    expect(isCorrectionWithinDeliveredValue(1000, -200, -800)).toBe(true)
    expect(isCorrectionWithinDeliveredValue(1000, -200, -801)).toBe(false)
    expect(isCorrectionWithinDeliveredValue(1000, 0, 50)).toBe(true)
  })
})

describe('clinical production link ownership', () => {
  it('accepts links belonging to the patient', () => {
    expect(productionLinksMatchPatient({ patientId: 'patient-1', appointmentPatientId: 'patient-1', treatmentPlanPatientId: 'patient-1' })).toBe(true)
  })
  it('rejects appointments belonging to another patient', () => {
    expect(productionLinksMatchPatient({ patientId: 'patient-1', appointmentPatientId: 'patient-2' })).toBe(false)
  })
  it('rejects treatment plans belonging to another patient', () => {
    expect(productionLinksMatchPatient({ patientId: 'patient-1', treatmentPlanPatientId: 'patient-2' })).toBe(false)
  })
})
