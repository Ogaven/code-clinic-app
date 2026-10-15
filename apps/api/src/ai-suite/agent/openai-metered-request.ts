import type { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { markBudgetOutcomeUnknown, reserveBudgetAtomic, settleBudgetAtomic } from './ai-budget-postgres'

/**
 * Opt-in OpenAI metering boundary. No existing patient, booking, or social
 * workflow uses this yet. Callers must supply verified pricing and a
 * conservative reservation covering the maximum possible tool/model spend.
 * This function never logs prompts, responses or patient identifiers.
 */
export type MeteredOpenAiUsage = {
  inputTokens: number
  outputTokens: number
  cachedInputTokens?: number
}

export async function runMeteredOpenAiRequest<T extends { usage: MeteredOpenAiUsage }>(
  db: PrismaClient,
  args: {
    reserveUsd: number
    actualCostUsd: (usage: MeteredOpenAiUsage) => number
    execute: () => Promise<T>
  },
): Promise<{ result: T; actualUsd: number; overrun: boolean }> {
  if (!Number.isFinite(args.reserveUsd) || args.reserveUsd <= 0) {
    throw new Error('Invalid verified OpenAI cost reservation')
  }
  const requestId = randomUUID()
  const reservation = await reserveBudgetAtomic(db, {
    requestId, provider: 'openai', estimatedUsd: args.reserveUsd,
  })
  try {
    const result = await args.execute()
    const usage = result.usage
    if (!usage || !Number.isSafeInteger(usage.inputTokens) || usage.inputTokens <= 0 ||
        !Number.isSafeInteger(usage.outputTokens) || usage.outputTokens < 0 ||
        (usage.cachedInputTokens !== undefined &&
          (!Number.isSafeInteger(usage.cachedInputTokens) || usage.cachedInputTokens < 0 ||
            usage.cachedInputTokens > usage.inputTokens))) {
      throw new Error('Missing or invalid OpenAI billable usage')
    }
    const actualUsd = args.actualCostUsd(usage)
    if (!Number.isFinite(actualUsd) || actualUsd < 0) {
      throw new Error('Unverifiable OpenAI provider cost')
    }
    const settled = await settleBudgetAtomic(db, {
      requestId, month: reservation.month, actualUsd,
    })
    return { result, actualUsd, overrun: settled.overrun }
  } catch (error) {
    // A failed upstream call may still have been billed. Retain its reservation.
    await markBudgetOutcomeUnknown(db, { requestId, month: reservation.month })
      .catch(() => { /* Preserve original error; do not release commitment. */ })
    throw error
  }
}
