import { beforeEach, expect, it, vi } from 'vitest'
import { drainAiUsageLogs, logAiUsage } from '../ai-suite/agent/ai-usage-log'

const { create } = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('../lib/prisma', () => ({ prisma: { aiUsageLog: { create } } }))

beforeEach(() => create.mockReset())

const event = { conversationId: 'conversation', model: 'gpt-5.6-sol', channel: 'WHATSAPP', feature: 'SARAH_RECEPTION' }

it('waits for pending writes and retries with the original event ID', async () => {
  create.mockRejectedValueOnce({ code: 'P1017' }).mockRejectedValueOnce({ code: 'P2002' })
  logAiUsage(event)
  await drainAiUsageLogs()
  expect(create).toHaveBeenCalledTimes(2)
  expect(create.mock.calls[0]).toEqual(create.mock.calls[1])
})

it('preserves costs and feature attribution if the conversation was removed', async () => {
  create.mockRejectedValueOnce({ code: 'P2003' }).mockResolvedValueOnce({})
  logAiUsage({ ...event, usage: { input_tokens: 100, output_tokens: 30 } })
  await drainAiUsageLogs()
  expect(create).toHaveBeenLastCalledWith({ data: expect.objectContaining({
    conversationId: null, feature: 'SARAH_RECEPTION', inputTokens: 100, outputTokens: 30,
  }) })
})
