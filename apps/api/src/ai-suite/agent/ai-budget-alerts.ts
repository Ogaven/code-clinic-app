import { AI_BUDGET_USD } from './provider-config'

export type AiBudgetAlertLevel = 'warning' | 'critical'

/**
 * Returns only thresholds newly crossed by the latest recorded cost.
 * This is a pure decision helper, not an outbound notification or a spending cap.
 * Persist alert delivery state before wiring notifications to avoid duplicates.
 */
export function newlyCrossedAiBudgetAlerts(
  previousTotalUsd: number,
  currentTotalUsd: number,
): AiBudgetAlertLevel[] {
  if (![previousTotalUsd, currentTotalUsd].every(n => Number.isFinite(n) && n >= 0) ||
      currentTotalUsd < previousTotalUsd) {
    throw new Error('Invalid AI budget totals')
  }
  const alerts: AiBudgetAlertLevel[] = []
  if (previousTotalUsd < AI_BUDGET_USD.warning && currentTotalUsd >= AI_BUDGET_USD.warning) {
    alerts.push('warning')
  }
  if (previousTotalUsd < AI_BUDGET_USD.critical && currentTotalUsd >= AI_BUDGET_USD.critical) {
    alerts.push('critical')
  }
  return alerts
}
