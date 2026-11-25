import OpenAI from 'openai'
import { expect, it, vi } from 'vitest'
import { completeDeepSeekTurn } from './deepseek-client'

it('round-trips a synthetic availability tool and a structured booking preview through the DeepSeek wire contract', async () => {
  const model = 'deepseek-flash'
  const toolCall = { id: 'fake_call', type: 'function', function: {
    name: 'lookup_fixture_slot', arguments: '{"day":"2099-01-01"}',
  } }
  const completion = (message: Record<string, unknown>, finishReason: string) => Response.json({
    id: 'fixture-completion',
    object: 'chat.completion',
    created: 0,
    model,
    choices: [{ index: 0, message: { role: 'assistant', ...message }, finish_reason: finishReason }],
    usage: { prompt_tokens: 100, prompt_cache_hit_tokens: 20, completion_tokens: 30, total_tokens: 130 },
  })
  const fetch = vi.fn<Parameters<typeof globalThis.fetch>, ReturnType<typeof globalThis.fetch>>()
    .mockResolvedValueOnce(completion({ content: null, tool_calls: [toolCall] }, 'tool_calls'))
    .mockResolvedValueOnce(completion({ content: '{"slotId":"fixture-slot","action":"preview"}' }, 'stop'))
  const client = new OpenAI({ apiKey: 'synthetic-key', baseURL: 'https://api.deepseek.com', fetch, maxRetries: 0 })

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: 'Synthetic test. Preview a slot only. Reply in JSON with slotId and action.' },
    { role: 'user', content: 'Show a fictional slot for 2099-01-01.' },
  ]
  const first = await completeDeepSeekTurn(client, model, {
    messages,
    tools: [{ type: 'function', function: {
      name: 'lookup_fixture_slot',
      parameters: { type: 'object', properties: { day: { type: 'string' } }, required: ['day'] },
    } }],
  })
  const call = first.message.tool_calls?.[0]
  if (call?.type !== 'function') throw new Error('Missing synthetic tool call')
  expect(call.function.name).toBe('lookup_fixture_slot')
  expect(JSON.parse(call.function.arguments)).toEqual({ day: '2099-01-01' })

  const final = await completeDeepSeekTurn(client, model, {
    messages: [...messages, { role: 'assistant', tool_calls: [call] }, {
      role: 'tool', tool_call_id: call.id, content: '{"slotId":"fixture-slot"}',
    }],
    response_format: { type: 'json_object' },
  })
  expect(JSON.parse(final.message.content ?? '')).toEqual({ slotId: 'fixture-slot', action: 'preview' })
  expect(final).toMatchObject({ model, inputTokens: 100, cachedInputTokens: 20, outputTokens: 30 })
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(String(fetch.mock.calls[0][0])).toBe('https://api.deepseek.com/chat/completions')
  expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({
    model, thinking: { type: 'disabled' }, tools: [{ function: { name: 'lookup_fixture_slot' } }],
  })
  expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).toMatchObject({
    response_format: { type: 'json_object' },
    messages: expect.arrayContaining([{ role: 'tool', tool_call_id: 'fake_call', content: '{"slotId":"fixture-slot"}' }]),
  })
})
