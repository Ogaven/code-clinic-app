import { AI_BUDGET_USD, type AiProvider } from './provider-config'

export type AiBudgetSnapshot = {
  openaiSpentUsd: number
  deepseekSpentUsd: number
}

export type AiBudgetDecision = {
  allowed: boolean
  reason: 'within_budget' | 'provider_limit' | 'combined_limit' | 'invalid_usage'
  warnings: ('warning' | 'critical')[]
  providerRemainingUsd: number
  totalRemainingUsd: number
}

/**
 * Pure policy evaluation. Callers must supply provider-billed costs, including
 * outstanding reserved requests, from an authoritative accounting store.
 * This module does not itself enforce limits or claim the upstream provider
 * can be stopped at an exact amount.
 */
export function evaluateAiBudget(
  provider: AiProvider,
  snapshot: AiBudgetSnapshot,
  estimatedRequestUsd: number,
): AiBudgetDecision {
  const spent = provider === 'openai' ? snapshot.openaiSpentUsd : snapshot.deepseekSpentUsd
  const total = snapshot.openaiSpentUsd + snapshot.deepseekSpentUsd
  const providerLimit = AI_BUDGET_USD[provider]
  const valid = [spent, total, snapshot.openaiSpentUsd, snapshot.deepseekSpentUsd, estimatedRequestUsd]
    .every(value => Number.isFinite(value) && value >= 0)
  const providerRemainingUsd = valid ? Math.max(0, providerLimit - spent) : 0
  const totalRemainingUsd = valid ? Math.max(0, AI_BUDGET_USD.total - total) : 0
  const projected = total + estimatedRequestUsd
  const warnings: AiBudgetDecision['warnings'] = []
  if (valid && projected >= AI_BUDGET_USD.warning) warnings.push('warning')
  if (valid && projected >= AI_BUDGET_USD.critical) warnings.push('critical')
  return {
    allowed: valid && estimatedRequestUsd <= providerRemainingUsd && estimatedRequestUsd <= totalRemainingUsd,
    reason: !valid ? 'invalid_usage'
      : estimatedRequestUsd > totalRemainingUsd ? 'combined_limit'
      : estimatedRequestUsd > providerRemainingUsd ? 'provider_limit'
      : 'within_budget',
    warnings,
    providerRemainingUsd,
    totalRemainingUsd,
  }
}
