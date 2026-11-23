import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { enqueueMessage } from '../ai-suite/whatsapp/message-buffer'

const { claimSharedWhatsAppMessage, createMany, processInbound } = vi.hoisted(() => ({
  claimSharedWhatsAppMessage: vi.fn(), createMany: vi.fn(), processInbound: vi.fn(),
}))

vi.mock('../lib/redis', () => ({ claimSharedWhatsAppMessage }))
vi.mock('../lib/prisma', () => ({ prisma: { processedWamid: { createMany } } }))
vi.mock('../ai-suite/whatsapp/whatsapp.service', () => ({ processInbound }))

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
  processInbound.mockResolvedValue(undefined)
})
afterEach(() => vi.useRealTimers())

it('processes one message when PostgreSQL is down and Redis grants ownership', async () => {
  claimSharedWhatsAppMessage.mockResolvedValue(true)
  createMany.mockRejectedValue({ code: 'P1001' })
  enqueueMessage('+256700000101', 'Hello', 'wan-redis-granted')
  enqueueMessage('+256700000101', 'Hello', 'wan-redis-granted')
  await vi.advanceTimersByTimeAsync(1600)
  expect(createMany).toHaveBeenCalledTimes(2)
  expect(processInbound).toHaveBeenCalledTimes(1)
})

it('suppresses a message already claimed by another worker through Redis', async () => {
  claimSharedWhatsAppMessage.mockResolvedValue(false)
  enqueueMessage('+256700000102', 'Hello', 'wan-redis-held')
  await vi.advanceTimersByTimeAsync(1600)
  expect(createMany).not.toHaveBeenCalled()
  expect(processInbound).not.toHaveBeenCalled()
})
