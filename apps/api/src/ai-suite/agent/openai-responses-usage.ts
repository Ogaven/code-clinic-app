import type { MeteredOpenAiUsage } from './openai-metered-request'

/**
 * Strict OpenAI Responses API usage parser for the metered gateway.
 * Do not substitute zero tokens when upstream usage is missing.
 */
export function parseOpenAiResponsesUsage(response: {
  usage?: {
    input_tokens?: number
    output_tokens?: number
    input_tokens_details?: { cached_tokens?: number }
  } | null
}): MeteredOpenAiUsage {
  const usage = response.usage
  const inputTokens = usage?.input_tokens
  const outputTokens = usage?.output_tokens
  const cachedInputTokens = usage?.input_tokens_details?.cached_tokens ?? 0
  if (!Number.isSafeInteger(inputTokens) || (inputTokens ?? 0) <= 0 ||
      !Number.isSafeInteger(outputTokens) || (outputTokens ?? -1) < 0 ||
      !Number.isSafeInteger(cachedInputTokens) || cachedInputTokens < 0 ||
      cachedInputTokens > (inputTokens ?? 0)) {
    throw new Error('OpenAI Responses API returned invalid billable usage')
  }
  return { inputTokens: inputTokens!, outputTokens: outputTokens!, cachedInputTokens }
}
