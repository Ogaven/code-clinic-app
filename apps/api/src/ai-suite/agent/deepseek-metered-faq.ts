import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { completeRoutineWithDeepSeek } from './deepseek-client'
import { reserveBudgetAtomic, settleBudgetAtomic, markBudgetOutcomeUnknown } from './ai-budget-postgres'
import { selectSafeAiRoute, type PublicRoutineFaq } from './safe-routing'

/**
 * Deliberately isolated opt-in FAQ execution path. This is NOT attached to
 * WhatsApp, website, booking or clinical routes. No patient text or history
 * is passed to the provider; only static public questions.
 *
 * Estimated and actual costs MUST be sourced from verified model pricing.
 * This path refuses to run without a configured conservative reservation
 * and actual-cost calculator, and requires the ledger tables to exist.
 */
export type VerifiedDeepSeekPricing = {
  reserveUsd: number
  actualCostUsd: (usage: { inputTokens: number; outputTokens: number }) => number
}

export async function runMeteredPublicDeepSeekFaq(
  db: PrismaClient,
  faq: PublicRoutineFaq,
  pricing: VerifiedDeepSeekPricing,
): Promise<{ text: string; inputTokens: number; outputTokens: number; overrun: boolean }> {
  const route = selectSafeAiRoute({ workload: 'routine', publicFaq: faq, patientContextPresent: false })
  if (route.provider !== 'deepseek') throw new Error('DeepSeek FAQ routing is not enabled')
  if (!Number.isFinite(pricing.reserveUsd) || pricing.reserveUsd <= 0) throw new Error('Invalid verified pricing reservation')
  const requestId = randomUUID()
  const reservation = await reserveBudgetAtomic(db, {
    requestId, provider: 'deepseek', estimatedUsd: pricing.reserveUsd,
  })
  try {
    const reply = await completeRoutineWithDeepSeek([
      { role: 'system', content: 'Answer only with public general information. If the answer is not certain, say that clinic staff should confirm. Do not invent clinic hours, services, prices, availability or clinical advice.' },
      { role: 'user', content: route.approvedPrompt },
    ])
    // Missing or malformed usage must never be booked as zero-cost success.
    if (!Number.isSafeInteger(reply.inputTokens) || reply.inputTokens <= 0 ||
        !Number.isSafeInteger(reply.outputTokens) || reply.outputTokens < 0) {
      throw new Error('Missing or invalid DeepSeek provider token usage')
    }
    const actualUsd = pricing.actualCostUsd(reply)
    if (!Number.isFinite(actualUsd) || actualUsd < 0) throw new Error('Unverifiable provider cost')
    const settlement = await settleBudgetAtomic(db, {
      requestId, month: reservation.month, actualUsd,
    })
    return { text: reply.text, inputTokens: reply.inputTokens, outputTokens: reply.outputTokens, overrun: settlement.overrun }
  } catch (error) {
    // A timeout can occur after upstream billing. Keep reserved funds locked
    // until reconciliation instead of releasing and potentially overspending.
    await markBudgetOutcomeUnknown(db, { requestId, month: reservation.month })
      .catch(() => { /* keep original provider error */ })
    throw error
  }
}
