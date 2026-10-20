import { describe, expect, it } from 'vitest'
import { validateProductionEntry, isCorrectionWithinDeliveredValue, productionLinksMatchPatient, isMatchingProductionReplay } from '../utils/clinical-production-validation'

const base = { sourceKey: 'unique-123', note: 'Treatment delivered and verified' }
describe('clinical production validation', () => {
  it('rejects amounts outside the database integer range', () => {
    expect(validateProductionEntry({ ...base, kind: 'DELIVERY', amountUGX: 2147483648 })).not.toBeNull()
    expect(validateProductionEntry({ ...base, kind: 'ADJUSTMENT', amountUGX: -2147483648, originalEntryId: 'entry-1' })).not.toBeNull()
    expect(validateProductionEntry({ ...base, kind: 'DELIVERY', amountUGX: 2147483647 })).toBeNull()
  })
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

describe('clinical production idempotency', () => {
  const existing = { patientId: 'patient-1', kind: 'DELIVERY' as const, amountUGX: 200000, originalEntryId: null, appointmentId: null, treatmentPlanId: null, note: 'Verified delivery', deliveredAt: new Date('2026-10-19T09:00:00Z') }
  it('accepts an identical replay', () => expect(isMatchingProductionReplay(existing, { ...existing })).toBe(true))
  it('rejects reuse of the same key with a different amount', () => expect(isMatchingProductionReplay(existing, { ...existing, amountUGX: 250000 })).toBe(false))
  it('rejects reuse of the same key for another patient', () => expect(isMatchingProductionReplay(existing, { ...existing, patientId: 'patient-2' })).toBe(false))
  it('rejects reuse of the same key for a different treatment date', () => expect(isMatchingProductionReplay(existing, { ...existing, deliveredAt: new Date('2026-10-20T09:00:00Z') })).toBe(false))
})
