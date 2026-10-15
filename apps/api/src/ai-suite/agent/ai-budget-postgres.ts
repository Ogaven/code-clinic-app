import { Prisma, PrismaClient } from '@prisma/client'
import { evaluateAiBudget } from './ai-budget-policy'
import type { AiProvider } from './provider-config'

/**
 * PostgreSQL-backed, serialized budget reservation adapter.
 * Requires the reviewed ai_budget_months and ai_budget_reservations tables.
 * Never activate before schema deployment and historical cost reconciliation.
 */
type SqlExecutor = Pick<PrismaClient, '$transaction'>
const usd = (value: Prisma.Decimal | number | string): number => Number(value)
const monthKey = (date: Date) => date.toISOString().slice(0, 7)

export class AiBudgetExceededError extends Error {
  constructor(public readonly reason: string) {
    super('AI request cannot proceed under the configured monthly budget')
  }
}

export async function reserveBudgetAtomic(
  db: SqlExecutor,
  args: { requestId: string; provider: AiProvider; estimatedUsd: number; now?: Date },
): Promise<{ month: string; warnings: ('warning' | 'critical')[] }> {
  if (!args.requestId.trim() || !Number.isFinite(args.estimatedUsd) || args.estimatedUsd <= 0) {
    throw new AiBudgetExceededError('invalid_usage')
  }
  const month = monthKey(args.now ?? new Date())
  return db.$transaction(async tx => {
    await tx.$executeRaw`INSERT INTO ai_budget_months(month_key) VALUES (${month}) ON CONFLICT DO NOTHING`
    const rows = await tx.$queryRaw<{ openai_spent_usd: Prisma.Decimal; deepseek_spent_usd: Prisma.Decimal; historically_reconciled: boolean }[]>`
      SELECT openai_spent_usd, deepseek_spent_usd, historically_reconciled FROM ai_budget_months
      WHERE month_key = ${month} FOR UPDATE
    `
    if (rows.length !== 1) throw new Error('AI budget month ledger unavailable')
    if (rows[0].historically_reconciled !== true) {
      throw new AiBudgetExceededError('historical_spending_not_reconciled')
    }
    const outstanding = await tx.$queryRaw<{ provider: string; reserved_usd: Prisma.Decimal }[]>`
      SELECT provider, reserved_usd FROM ai_budget_reservations
      WHERE month_key = ${month} AND status IN ('RESERVED', 'UNKNOWN')
    `
    const snapshot = {
      openaiSpentUsd: usd(rows[0].openai_spent_usd) + outstanding.filter(x => x.provider === 'openai').reduce((n, x) => n + usd(x.reserved_usd), 0),
      deepseekSpentUsd: usd(rows[0].deepseek_spent_usd) + outstanding.filter(x => x.provider === 'deepseek').reduce((n, x) => n + usd(x.reserved_usd), 0),
    }
    const decision = evaluateAiBudget(args.provider, snapshot, args.estimatedUsd)
    if (!decision.allowed) throw new AiBudgetExceededError(decision.reason)
    await tx.$executeRaw`
      INSERT INTO ai_budget_reservations(request_id, month_key, provider, reserved_usd)
      VALUES (${args.requestId}, ${month}, ${args.provider}, ${args.estimatedUsd})
    `
    return { month, warnings: decision.warnings }
  }, { timeout: 10000 })
}

export async function settleBudgetAtomic(
  db: SqlExecutor,
  args: { requestId: string; month: string; actualUsd: number },
): Promise<{ overrun: boolean }> {
  if (!Number.isFinite(args.actualUsd) || args.actualUsd < 0) throw new Error('Invalid actual AI cost')
  return db.$transaction(async tx => {
    // Same lock order as reservation: month first, reservation second.
    const months = await tx.$queryRaw<{ month_key: string }[]>`
      SELECT month_key FROM ai_budget_months WHERE month_key = ${args.month} FOR UPDATE
    `
    if (months.length !== 1) throw new Error('AI budget month not found')
    const rows = await tx.$queryRaw<{ provider: string; reserved_usd: Prisma.Decimal; status: string }[]>`
      SELECT provider, reserved_usd, status FROM ai_budget_reservations
      WHERE request_id = ${args.requestId} AND month_key = ${args.month} FOR UPDATE
    `
    if (rows.length !== 1 || rows[0].status !== 'RESERVED') throw new Error('AI reservation not open')
    const provider = rows[0].provider
    if (provider === 'openai') {
      await tx.$executeRaw`UPDATE ai_budget_months SET openai_spent_usd = openai_spent_usd + ${args.actualUsd}, updated_at = now() WHERE month_key = ${args.month}`
    } else if (provider === 'deepseek') {
      await tx.$executeRaw`UPDATE ai_budget_months SET deepseek_spent_usd = deepseek_spent_usd + ${args.actualUsd}, updated_at = now() WHERE month_key = ${args.month}`
    } else throw new Error('Invalid AI provider in reservation')
    await tx.$executeRaw`
      UPDATE ai_budget_reservations SET status = 'SETTLED', actual_usd = ${args.actualUsd}, updated_at = now()
      WHERE request_id = ${args.requestId}
    `
    return { overrun: args.actualUsd > usd(rows[0].reserved_usd) }
  }, { timeout: 10000 })
}

/** Unknown upstream outcomes retain the reservation until reconciled. */
export async function markBudgetOutcomeUnknown(db: SqlExecutor, args: { requestId: string; month: string }): Promise<void> {
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT month_key FROM ai_budget_months WHERE month_key = ${args.month} FOR UPDATE`
    await tx.$executeRaw`
      UPDATE ai_budget_reservations SET status = 'UNKNOWN', updated_at = now()
      WHERE request_id = ${args.requestId} AND month_key = ${args.month} AND status = 'RESERVED'
    `
  })
}
