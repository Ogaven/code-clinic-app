import type { PrismaClient } from '@prisma/client'
import {
  acknowledgeDeliveredAiBudgetAlert,
  listPendingAiBudgetAlerts,
  type PendingAiBudgetAlert,
} from './ai-budget-alert-outbox'

export type AiBudgetAlertDelivery = (alert: PendingAiBudgetAlert) => Promise<void>

/**
 * Explicitly invoked alert delivery batch.
 * A failed delivery remains PENDING for retry; no provider credentials or
 * patient information are included in alert payloads.
 *
 * The injected sender must resolve only after its delivery provider accepts
 * the notification. Do not wire this to a timer without staff recipient
 * configuration and a production migration check.
 */
export async function dispatchPendingAiBudgetAlerts(
  db: Pick<PrismaClient, 'aiBudgetAlert'>,
  deliver: AiBudgetAlertDelivery,
  limit = 20,
): Promise<{ delivered: number; failed: number }> {
  const alerts = await listPendingAiBudgetAlerts(db, limit)
  let delivered = 0
  let failed = 0
  for (const alert of alerts) {
    try {
      await deliver(alert)
      if (await acknowledgeDeliveredAiBudgetAlert(db, alert.id)) delivered += 1
    } catch {
      // Never acknowledge failed or uncertain delivery.
      failed += 1
    }
  }
  return { delivered, failed }
}
