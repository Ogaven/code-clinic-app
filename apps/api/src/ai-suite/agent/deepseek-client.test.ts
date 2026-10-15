import { afterEach, describe, expect, it, vi } from 'vitest'
import { completeRoutineWithDeepSeek, createDeepSeekClient } from './deepseek-client'

const previous = {
  key: process.env.DEEPSEEK_API_KEY,
  enabled: process.env.HYBRID_AI_ENABLED,
}
afterEach(() => {
  vi.restoreAllMocks()
  if (previous.key === undefined) delete process.env.DEEPSEEK_API_KEY
  else process.env.DEEPSEEK_API_KEY = previous.key
  if (previous.enabled === undefined) delete process.env.HYBRID_AI_ENABLED
  else process.env.HYBRID_AI_ENABLED = previous.enabled
})

describe('DeepSeek client safety', () => {
  it('does not construct a client without a key', () => {
    delete process.env.DEEPSEEK_API_KEY
    expect(() => createDeepSeekClient()).toThrow('DeepSeek API credentials are not configured')
  })

  it('does not make requests while hybrid routing is disabled', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key'
    process.env.HYBRID_AI_ENABLED = 'false'
    await expect(completeRoutineWithDeepSeek([{ role: 'user', content: 'Hello' }])).rejects.toThrow('Hybrid AI routing is disabled')
  })

  it('rejects empty routine message payloads before making a request', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key'
    process.env.HYBRID_AI_ENABLED = 'true'
    await expect(completeRoutineWithDeepSeek([])).rejects.toThrow('Valid routine messages are required')
    await expect(completeRoutineWithDeepSeek([{ role: 'user', content: ' ' }])).rejects.toThrow('Valid routine messages are required')
  })
})
