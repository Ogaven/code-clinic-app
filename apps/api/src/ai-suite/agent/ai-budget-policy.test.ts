import { describe, expect, it } from 'vitest'
import { evaluateAiBudget } from './ai-budget-policy'

describe('hybrid AI budget policy', () => {
  it('allows affordable requests', () => {
    expect(evaluateAiBudget('deepseek', { openaiSpentUsd: 3, deepseekSpentUsd: 1 }, 0.2).allowed).toBe(true)
  })
  it('enforces the five dollar DeepSeek allocation', () => {
    const result = evaluateAiBudget('deepseek', { openaiSpentUsd: 3, deepseekSpentUsd: 4.9 }, 0.2)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('provider_limit')
  })
  it('enforces the ten dollar OpenAI allocation', () => {
    const result = evaluateAiBudget('openai', { openaiSpentUsd: 9.9, deepseekSpentUsd: 1 }, 0.2)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('provider_limit')
  })
  it('rejects invalid and untrusted accounting values', () => {
    expect(evaluateAiBudget('openai', { openaiSpentUsd: NaN, deepseekSpentUsd: 0 }, 0.1).reason).toBe('invalid_usage')
    expect(evaluateAiBudget('deepseek', { openaiSpentUsd: 0, deepseekSpentUsd: -1 }, 0.1).allowed).toBe(false)
    expect(evaluateAiBudget('openai', { openaiSpentUsd: 0, deepseekSpentUsd: 0 }, -1).allowed).toBe(false)
  })
  it('reports ten and twelve dollar thresholds', () => {
    const result = evaluateAiBudget('openai', { openaiSpentUsd: 7.5, deepseekSpentUsd: 4.4 }, 0.2)
    expect(result.warnings).toEqual(['warning', 'critical'])
  })
  it('permits exact remaining balance', () => {
    expect(evaluateAiBudget('deepseek', { openaiSpentUsd: 10, deepseekSpentUsd: 4.5 }, 0.5).allowed).toBe(true)
  })
})
