import { afterEach, describe, expect, it } from 'vitest'
import { AI_BUDGET_USD, chooseAiProvider, getAiProviderConfiguration } from './provider-config'

const originalHybrid = process.env.HYBRID_AI_ENABLED
const originalDeepSeek = process.env.DEEPSEEK_API_KEY

afterEach(() => {
  if (originalHybrid === undefined) delete process.env.HYBRID_AI_ENABLED
  else process.env.HYBRID_AI_ENABLED = originalHybrid
  if (originalDeepSeek === undefined) delete process.env.DEEPSEEK_API_KEY
  else process.env.DEEPSEEK_API_KEY = originalDeepSeek
})

describe('hybrid AI provider foundation', () => {
  it('keeps the combined budget at fifteen dollars', () => {
    expect(AI_BUDGET_USD.openai + AI_BUDGET_USD.deepseek).toBe(AI_BUDGET_USD.total)
    expect(AI_BUDGET_USD.warning).toBeLessThan(AI_BUDGET_USD.critical)
    expect(AI_BUDGET_USD.critical).toBeLessThan(AI_BUDGET_USD.total)
  })

  it('defaults to OpenAI while hybrid routing is disabled', () => {
    delete process.env.HYBRID_AI_ENABLED
    process.env.DEEPSEEK_API_KEY = 'test-key'
    expect(chooseAiProvider('routine')).toBe('openai')
  })

  it('requires a configured DeepSeek key before routing routine traffic', () => {
    process.env.HYBRID_AI_ENABLED = 'true'
    delete process.env.DEEPSEEK_API_KEY
    expect(chooseAiProvider('routine')).toBe('openai')
    expect(getAiProviderConfiguration().deepseekConfigured).toBe(false)
  })

  it('routes only explicitly routine requests to DeepSeek when enabled', () => {
    process.env.HYBRID_AI_ENABLED = 'true'
    process.env.DEEPSEEK_API_KEY = 'test-key'
    expect(chooseAiProvider('routine')).toBe('deepseek')
    for (const workload of ['sensitive', 'booking', 'clinical', 'unknown'] as const) {
      expect(chooseAiProvider(workload)).toBe('openai')
    }
  })
})
