import { evaluateAiBudget, type AiBudgetSnapshot } from './ai-budget-policy'
import type { AiProvider } from './provider-config'

export type BudgetReservation = {
  id: string
  provider: AiProvider
  reservedUsd: number
}

export type BudgetLedgerState = {
  spent: AiBudgetSnapshot
  reservations: BudgetReservation[]
}

export type BudgetReservationResult =
  | { allowed: true; state: BudgetLedgerState; reservation: BudgetReservation; warnings: ('warning' | 'critical')[] }
  | { allowed: false; state: BudgetLedgerState; reason: 'duplicate' | 'within_budget' | 'provider_limit' | 'combined_limit' | 'invalid_usage' }

/**
 * Pure transitions for an authoritative ledger. The storage adapter MUST
 * execute read -> reserve -> persist as a single atomic transaction, with
 * a unique reservation ID and serialized writers. Do not use process-local
 * memory or non-atomic Redis GET/SET to enforce a production spending cap.
 */
export function reserveAiBudget(
  state: BudgetLedgerState,
  reservation: BudgetReservation,
): BudgetReservationResult {
  if (!reservation.id.trim() || state.reservations.some(item => item.id === reservation.id)) {
    return { allowed: false, state, reason: 'duplicate' }
  }
  const outstanding = state.reservations.reduce<AiBudgetSnapshot>((sum, item) => ({
    openaiSpentUsd: sum.openaiSpentUsd + (item.provider === 'openai' ? item.reservedUsd : 0),
    deepseekSpentUsd: sum.deepseekSpentUsd + (item.provider === 'deepseek' ? item.reservedUsd : 0),
  }), { openaiSpentUsd: 0, deepseekSpentUsd: 0 })
  const snapshot = {
    openaiSpentUsd: state.spent.openaiSpentUsd + outstanding.openaiSpentUsd,
    deepseekSpentUsd: state.spent.deepseekSpentUsd + outstanding.deepseekSpentUsd,
  }
  const decision = evaluateAiBudget(reservation.provider, snapshot, reservation.reservedUsd)
  if (!decision.allowed) return { allowed: false, state, reason: decision.reason }
  return {
    allowed: true,
    reservation,
    warnings: decision.warnings,
    state: { spent: { ...state.spent }, reservations: [...state.reservations, reservation] },
  }
}

/**
 * Record the actual provider cost and release the reservation together.
 * If the provider's final cost exceeds its reservation, flag an overrun in
 * the calling storage adapter; never silently treat it as within budget.
 */
export function settleAiBudget(
  state: BudgetLedgerState,
  id: string,
  actualUsd: number,
): { state: BudgetLedgerState; overrun: boolean } {
  const reservation = state.reservations.find(item => item.id === id)
  if (!reservation) throw new Error('Unknown AI budget reservation')
  if (!Number.isFinite(actualUsd) || actualUsd < 0) throw new Error('Invalid AI provider cost')
  const spent = { ...state.spent }
  if (reservation.provider === 'openai') spent.openaiSpentUsd += actualUsd
  else spent.deepseekSpentUsd += actualUsd
  return {
    overrun: actualUsd > reservation.reservedUsd,
    state: { spent, reservations: state.reservations.filter(item => item.id !== id) },
  }
}
