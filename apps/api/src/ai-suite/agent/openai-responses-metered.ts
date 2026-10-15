import type OpenAI from 'openai'
import type { PrismaClient } from '@prisma/client'
import { runMeteredOpenAiRequest } from './openai-metered-request'
import { parseOpenAiResponsesUsage } from './openai-responses-usage'

/**
 * OpenAI Responses SDK integration for the atomic budget gateway.
 * Intentionally opt-in: no existing patient workflow is rerouted.
 * Only enable after migration, billing reconciliation, and verified pricing.
 */
export async function executeMeteredOpenAiResponses(
  db: PrismaClient,
  client: OpenAI,
  request: Parameters<OpenAI['responses']['create']>[0],
  billing: {
    reserveUsd: number
    actualCostUsd: (usage: ReturnType<typeof parseOpenAiResponsesUsage>) => number
  },
) {
  return runMeteredOpenAiRequest(db, {
    reserveUsd: billing.reserveUsd,
    actualCostUsd: billing.actualCostUsd,
    execute: async () => {
      const response = await client.responses.create({ ...request, stream: false })
      return { response, usage: parseOpenAiResponsesUsage(response) }
    },
  })
}
