import { describe, expect, it } from 'vitest'
import { evaluateAiBudget } from './ai-budget-policy'

describe('monthly hybrid provider allocations', () => {
  it('denies OpenAI once its $10 allocation is consumed', () => {
    const result = evaluateAiBudget('openai', { openaiSpentUsd: 10, deepseekSpentUsd: 0 }, 0.01)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('provider_limit')
  })

  it('denies DeepSeek once its $5 allocation is consumed', () => {
    const result = evaluateAiBudget('deepseek', { openaiSpentUsd: 0, deepseekSpentUsd: 5 }, 0.01)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('provider_limit')
  })

  it('rejects requests exceeding the remaining combined budget', () => {
    const result = evaluateAiBudget('openai', { openaiSpentUsd: 9.9, deepseekSpentUsd: 4.9 }, 0.3)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('combined_limit')
  })

  it('raises warning and critical flags as usage approaches $15', () => {
    const result = evaluateAiBudget('deepseek', { openaiSpentUsd: 9, deepseekSpentUsd: 2.9 }, 0.2)
    expect(result.allowed).toBe(true)
    expect(result.warnings).toContain('warning')
    expect(result.warnings).toContain('critical')
  })

  it('rejects non-finite provider estimates', () => {
    const result = evaluateAiBudget('deepseek', { openaiSpentUsd: 1, deepseekSpentUsd: 1 }, Number.NaN)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('invalid_usage')
  })
})
