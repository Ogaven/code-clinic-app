import { describe, expect, it } from 'vitest'
import { parseOpenAiResponsesUsage } from './openai-responses-usage'

describe('OpenAI Responses API usage parsing', () => {
  it('extracts input, output and cached input token counts', () => {
    expect(parseOpenAiResponsesUsage({
      usage: { input_tokens: 200, output_tokens: 15, input_tokens_details: { cached_tokens: 100 } },
    })).toEqual({ inputTokens: 200, outputTokens: 15, cachedInputTokens: 100 })
  })

  it('supports responses with no cached token breakdown', () => {
    expect(parseOpenAiResponsesUsage({
      usage: { input_tokens: 12, output_tokens: 0 },
    }).cachedInputTokens).toBe(0)
  })

  it.each([
    {},
    { usage: null },
    { usage: { input_tokens: 0, output_tokens: 1 } },
    { usage: { input_tokens: 10 } },
    { usage: { input_tokens: 10, output_tokens: -1 } },
    { usage: { input_tokens: 10, output_tokens: 1, input_tokens_details: { cached_tokens: 11 } } },
    { usage: { input_tokens: 10.5, output_tokens: 1 } },
  ])('rejects missing or malformed upstream usage %#', response => {
    expect(() => parseOpenAiResponsesUsage(response)).toThrow('invalid billable usage')
  })
})
