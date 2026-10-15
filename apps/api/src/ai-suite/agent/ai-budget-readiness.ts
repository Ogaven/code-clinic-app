import { Prisma, PrismaClient } from '@prisma/client'

/**
 * Read-only current-month ledger readiness inspection. Never assumes a newly
 * created month row proves historical provider charges have been reconciled.
 * Use provider billing dashboards as the source of truth before activation.
 */
export type AiLedgerReadiness = {
  month: string
  openaiRecordedUsd: number
  deepseekRecordedUsd: number
  outstandingReservations: number
  outstandingReservedUsd: number
  historicallyReconciled: boolean
  safeToActivate: false
}

export async function inspectAiLedgerReadiness(
  db: Pick<PrismaClient, '$queryRaw'>,
  now = new Date(),
): Promise<AiLedgerReadiness> {
  const month = now.toISOString().slice(0, 7)
  const months = await db.$queryRaw<{ openai_spent_usd: Prisma.Decimal; deepseek_spent_usd: Prisma.Decimal; historically_reconciled: boolean }[]>`
    SELECT openai_spent_usd, deepseek_spent_usd, historically_reconciled FROM ai_budget_months WHERE month_key = ${month}
  `
  const outstanding = await db.$queryRaw<{ count: bigint; amount: Prisma.Decimal }[]>`
    SELECT COUNT(*)::bigint AS count, COALESCE(SUM(reserved_usd), 0) AS amount
    FROM ai_budget_reservations WHERE month_key = ${month} AND status IN ('RESERVED', 'UNKNOWN')
  `
  return {
    month,
    openaiRecordedUsd: Number(months[0]?.openai_spent_usd ?? 0),
    deepseekRecordedUsd: Number(months[0]?.deepseek_spent_usd ?? 0),
    outstandingReservations: Number(outstanding[0]?.count ?? 0),
    outstandingReservedUsd: Number(outstanding[0]?.amount ?? 0),
    historicallyReconciled: months[0]?.historically_reconciled === true,
    safeToActivate: false,
  }
}
