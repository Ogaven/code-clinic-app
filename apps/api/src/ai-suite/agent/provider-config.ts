/**
 * Code Clinic hosted-AI provider configuration.
 *
 * Foundation only: existing Sarah and booking paths continue using OpenAI until
 * routing, usage accounting, privacy checks and fallbacks are tested.
 * Never expose provider API keys in responses or browser bundles.
 */
export type AiProvider = 'openai' | 'deepseek'
export type AiWorkload = 'routine' | 'sensitive' | 'booking' | 'clinical' | 'unknown'

export const AI_BUDGET_USD = Object.freeze({
  openai: 10,
  deepseek: 5,
  total: 15,
  warning: 10,
  critical: 12,
})

export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com'

export function getAiProviderConfiguration() {
  return {
    enabled: process.env.HYBRID_AI_ENABLED === 'true',
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY?.trim()),
    deepseekConfigured: Boolean(process.env.DEEPSEEK_API_KEY?.trim()),
    deepseekModel: process.env.DEEPSEEK_MODEL?.trim() || 'deepseek-chat',
    budgets: AI_BUDGET_USD,
  }
}

/**
 * Conservative routing: unknown, patient-specific, booking and clinical
 * requests remain with OpenAI. DeepSeek is opt-in and only for requests
 * independently classified as routine.
 *
 * Classification must happen without exposing patient data to DeepSeek.
 */
export function chooseAiProvider(workload: AiWorkload): AiProvider {
  const config = getAiProviderConfiguration()
  if (config.enabled && config.deepseekConfigured && workload === 'routine') {
    return 'deepseek'
  }
  return 'openai'
}
