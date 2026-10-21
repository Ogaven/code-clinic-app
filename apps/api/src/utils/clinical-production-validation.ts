/** Pure validation rules for staff-attested clinical production. No database writes. */
export type ProductionKind = 'DELIVERY' | 'REVERSAL' | 'ADJUSTMENT'

export function validateProductionEntry(input: {
  kind: ProductionKind
  amountUGX: number
  originalEntryId?: string | null
  sourceKey: string
  note: string
}): string | null {
  if (!Number.isSafeInteger(input.amountUGX) || Math.abs(input.amountUGX) > 2147483647) return 'Amount must fit the supported PostgreSQL integer UGX range'
  if (input.kind === 'DELIVERY' && (input.amountUGX <= 0 || input.originalEntryId)) return 'Delivery must be positive and cannot reference an original entry'
  if (input.kind === 'REVERSAL' && (input.amountUGX >= 0 || !input.originalEntryId)) return 'Reversal must be negative and reference the original entry'
  if (input.kind === 'ADJUSTMENT' && (input.amountUGX === 0 || !input.originalEntryId)) return 'Adjustment must be nonzero and reference the original entry'
  if (!input.sourceKey.trim() || input.sourceKey.length > 128) return 'Valid idempotency key required'
  if (!input.note.trim() || input.note.length > 2000) return 'Reason or treatment note required'
  return null
}

/** Does not replace transactional database locking on the original entry. */
export function isCorrectionWithinDeliveredValue(originalAmountUGX: number, existingCorrectionsUGX: number, proposedCorrectionUGX: number): boolean {
  return Number.isSafeInteger(originalAmountUGX) && originalAmountUGX > 0 &&
    Number.isSafeInteger(existingCorrectionsUGX) && Number.isSafeInteger(proposedCorrectionUGX) &&
    originalAmountUGX + existingCorrectionsUGX + proposedCorrectionUGX >= 0
}

/** Verify linked records belong to the same patient before any ledger write. */
export function productionLinksMatchPatient(input: {
  patientId: string
  appointmentPatientId?: string | null
  treatmentPlanPatientId?: string | null
}): boolean {
  if (!input.patientId.trim()) return false
  if (input.appointmentPatientId != null && input.appointmentPatientId !== input.patientId) return false
  if (input.treatmentPlanPatientId != null && input.treatmentPlanPatientId !== input.patientId) return false
  return true
}

/** Replay protection: same key with different payload is not an idempotent retry. */
export function isMatchingProductionReplay(existing: {
  patientId: string; kind: ProductionKind; amountUGX: number; originalEntryId: string | null;
  appointmentId: string | null; treatmentPlanId: string | null; note: string; deliveredAt: Date
}, proposed: {
  patientId: string; kind: ProductionKind; amountUGX: number; originalEntryId?: string | null;
  appointmentId?: string | null; treatmentPlanId?: string | null; note: string; deliveredAt: Date
}): boolean {
  return existing.patientId === proposed.patientId && existing.kind === proposed.kind &&
    existing.amountUGX === proposed.amountUGX && existing.originalEntryId === (proposed.originalEntryId ?? null) &&
    existing.appointmentId === (proposed.appointmentId ?? null) &&
    existing.treatmentPlanId === (proposed.treatmentPlanId ?? null) &&
    existing.note === proposed.note && existing.deliveredAt.getTime() === proposed.deliveredAt.getTime()
}
