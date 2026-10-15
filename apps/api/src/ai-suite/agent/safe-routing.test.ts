import { afterEach, describe, expect, it, vi } from 'vitest'
import { selectSafeAiRoute } from './safe-routing'

afterEach(() => {
  delete process.env.HYBRID_AI_ENABLED
  delete process.env.DEEPSEEK_API_KEY
  vi.unstubAllEnvs()
})

describe('public-only DeepSeek routing', () => {
  it('keeps routine traffic on OpenAI when hybrid mode is disabled', () => {
    expect(selectSafeAiRoute({ workload: 'routine', publicFaq: 'clinic_hours', patientContextPresent: false }).provider).toBe('openai')
  })
  it('only passes fixed public FAQ text to DeepSeek', () => {
    vi.stubEnv('HYBRID_AI_ENABLED', 'true')
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key')
    expect(selectSafeAiRoute({ workload: 'routine', publicFaq: 'clinic_hours', patientContextPresent: false })).toEqual({
      provider: 'deepseek', approvedPrompt: 'What are Code Clinic opening hours?',
    })
  })
  it('never routes booking, clinical, sensitive or unknown requests', () => {
    vi.stubEnv('HYBRID_AI_ENABLED', 'true')
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key')
    for (const workload of ['booking', 'clinical', 'sensitive', 'unknown'] as const) {
      expect(selectSafeAiRoute({ workload }).provider).toBe('openai')
    }
  })
  it('rejects unknown FAQ keys even with a forged runtime value', () => {
    vi.stubEnv('HYBRID_AI_ENABLED', 'true')
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key')
    expect(selectSafeAiRoute({ workload: 'routine', publicFaq: 'patient_record' as 'clinic_hours', patientContextPresent: false }).provider).toBe('openai')
  })
  it('rejects patient context', () => {
    vi.stubEnv('HYBRID_AI_ENABLED', 'true')
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key')
    expect(selectSafeAiRoute({ workload: 'routine', publicFaq: 'clinic_hours', patientContextPresent: true } as never).provider).toBe('openai')
  })
})
