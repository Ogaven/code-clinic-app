/** Pure validation rules for staff-attested clinical production. No database writes. */
export type ProductionKind = 'DELIVERY' | 'REVERSAL' | 'ADJUSTMENT'

export function validateProductionEntry(input: {
  kind: ProductionKind
  amountUGX: number
  originalEntryId?: string | null
  sourceKey: string
  note: string
}): string | null {
  if (!Number.isSafeInteger(input.amountUGX)) return 'Amount must be an integer UGX value'
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
