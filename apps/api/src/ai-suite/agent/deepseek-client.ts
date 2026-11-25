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

type ChatRequest = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming

// A single turn has no access to clinic tools or records. Callers must validate
// tool arguments and structured responses before taking any local action.
export async function completeDeepSeekTurn(
  client: OpenAI,
  model: string,
  request: Pick<ChatRequest, 'messages' | 'tools' | 'tool_choice' | 'response_format'>,
) {
  const params = {
    ...request,
    model,
    max_tokens: 256,
    temperature: 0.3,
    thinking: { type: 'disabled' },
  }
  const response = await client.chat.completions.create(params)
  const usage = response.usage
  if (!usage || !Number.isSafeInteger(usage.prompt_tokens) || usage.prompt_tokens <= 0 ||
      !Number.isSafeInteger(usage.completion_tokens) || usage.completion_tokens < 0) {
    throw new Error('DeepSeek response missing valid billable token usage')
  }
  const cached = (usage as typeof usage & { prompt_cache_hit_tokens?: number }).prompt_cache_hit_tokens
    ?? usage.prompt_tokens_details?.cached_tokens
  const message = response.choices[0]?.message
  if (!message || !response.model) throw new Error('DeepSeek response missing a message or model')
  return {
    cachedInputTokens: typeof cached === 'number' && Number.isSafeInteger(cached) && cached >= 0 && cached <= usage.prompt_tokens ? cached : 0,
    message,
    model: response.model,
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
  }
}

export async function completeRoutineWithDeepSeek(messages: RoutineMessage[]) {
  const config = getAiProviderConfiguration()
  if (!config.enabled) throw new Error('Hybrid AI routing is disabled')
  if (messages.length === 0 || messages.some(m => !m.content.trim())) {
    throw new Error('Valid routine messages are required')
  }
  const { message, ...usage } = await completeDeepSeekTurn(createDeepSeekClient(), config.deepseekModel, { messages })
  return { ...usage, text: message.content ?? '' }
}
