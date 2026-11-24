import OpenAI from 'openai'
import { DEEPSEEK_BASE_URL, getAiProviderConfiguration } from './provider-config'

/**
 * Server-side DeepSeek adapter. This is deliberately not wired to patient
 * conversations until consent, privacy, budget enforcement and routing tests
 * have been completed. Never log API keys, prompts or patient data.
 */
export function createDeepSeekClient(): OpenAI {
  const config = getAiProviderConfiguration()
  if (!config.deepseekConfigured) {
    throw new Error('DeepSeek API credentials are not configured')
  }
  return new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY!.trim(),
    baseURL: DEEPSEEK_BASE_URL,
    maxRetries: 0,
    timeout: 15000,
  })
}

export type RoutineMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export async function completeRoutineWithDeepSeek(messages: RoutineMessage[]): Promise<{
  text: string
  model: string
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
}> {
  const config = getAiProviderConfiguration()
  if (!config.enabled) throw new Error('Hybrid AI routing is disabled')
  if (messages.length === 0 || messages.some(m => !m.content.trim())) {
    throw new Error('Valid routine messages are required')
  }
  const client = createDeepSeekClient()
  const response = await client.chat.completions.create({
    model: config.deepseekModel,
    messages,
    temperature: 0.3,
    max_tokens: 256,
    ...{ thinking: { type: 'disabled' } },
  })
  const usage = response.usage
  if (!usage || !Number.isSafeInteger(usage.prompt_tokens) || usage.prompt_tokens <= 0 ||
      !Number.isSafeInteger(usage.completion_tokens) || usage.completion_tokens < 0) {
    throw new Error('DeepSeek response missing valid billable token usage')
  }
  const cached = (usage as typeof usage & { prompt_cache_hit_tokens?: number }).prompt_cache_hit_tokens
    ?? usage.prompt_tokens_details?.cached_tokens
  return {
    cachedInputTokens: typeof cached === 'number' && Number.isSafeInteger(cached) && cached >= 0 && cached <= usage.prompt_tokens ? cached : 0,
    text: response.choices[0]?.message?.content ?? '',
    model: response.model,
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
  }
}
