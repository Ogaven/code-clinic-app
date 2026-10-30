import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    $transaction: vi.fn(),
    $queryRawUnsafe: vi.fn(),
    $executeRawUnsafe: vi.fn(),
  },
}))
vi.mock('../lib/prisma', () => ({ prisma: prismaMock }))
import { persistMetaEvents, drainMetaEvents } from '../ai-suite/facebook/meta-inbox.worker'

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.$executeRawUnsafe.mockResolvedValue(1)
  prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock))
  prismaMock.$queryRawUnsafe.mockResolvedValue([])
})

describe('Meta durable inbox', () => {
  it('commits inbound events in one transaction before acknowledgment', async () => {
    await persistMetaEvents('FACEBOOK', [
      { key: 'message:one', payload: { kind: 'message', fromId: 'sender', text: 'hello', mid: 'one' } },
      { key: 'message:two', payload: { kind: 'message', fromId: 'sender', text: 'again', mid: 'two' } },
    ])
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    expect(prismaMock.$executeRawUnsafe).toHaveBeenCalledTimes(2)
    expect(prismaMock.$executeRawUnsafe.mock.calls[0][0]).toContain('ON CONFLICT')
  })

  it('propagates persistence failure so the HTTP route can return 503', async () => {
    prismaMock.$executeRawUnsafe.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(persistMetaEvents('INSTAGRAM', [
      { key: 'comment:one', payload: { kind: 'comment', commentId: 'one', postId: 'post', fromId: 'person', fromName: 'Name', text: 'Price?' } },
    ])).rejects.toThrow('database unavailable')
  })

  it('marks a successfully handled event done', async () => {
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([{
      id: 'event-1', provider: 'FACEBOOK', attempts: 1,
      payload: { kind: 'message', fromId: 'sender', text: 'hi' },
    }]).mockResolvedValue([])
    const handler = vi.fn().mockResolvedValue(undefined)
    await drainMetaEvents(handler)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(prismaMock.$executeRawUnsafe.mock.calls[0][0]).toContain(`"status"='DONE'`)
  })

  it('requeues failed work with backoff without losing the event', async () => {
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([{
      id: 'event-2', provider: 'INSTAGRAM', attempts: 2,
      payload: { kind: 'message', fromId: 'sender', text: 'hi' },
    }]).mockResolvedValue([])
    await drainMetaEvents(vi.fn().mockRejectedValue(new Error('temporary Meta outage')))
    expect(prismaMock.$executeRawUnsafe.mock.calls[0][0]).toContain(`'PENDING'`)
    expect(prismaMock.$executeRawUnsafe.mock.calls[0][3]).toContain('temporary Meta outage')
  })
  it('quarantines ambiguous Meta DM deliveries for manual reconciliation', async () => {
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([{
      id: 'event-3', provider: 'FACEBOOK', attempts: 1,
      payload: { kind: 'message', fromId: 'sender', text: 'hi' },
    }]).mockResolvedValue([])
    await drainMetaEvents(vi.fn().mockRejectedValue(new Error('META_DM_DELIVERY_UNCERTAIN timeout')))
    const args = prismaMock.$executeRawUnsafe.mock.calls[0]
    expect(args[0]).toContain('WHEN $5 OR')
    expect(args[3]).toContain('META_DM_DELIVERY_UNCERTAIN')
    expect(args[5]).toBe(true)
  })

  it('quarantines messages with no stable Meta message ID instead of retrying', async () => {
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([{
      id: 'event-4', provider: 'INSTAGRAM', attempts: 1,
      payload: { kind: 'message', fromId: 'sender', text: 'hi' },
    }]).mockResolvedValue([])
    await drainMetaEvents(vi.fn().mockRejectedValue(
      new Error('META_DM_REVIEW_REQUIRED_MISSING_MESSAGE_ID')))
    const args = prismaMock.$executeRawUnsafe.mock.calls[0]
    expect(args[0]).toContain('WHEN $5 OR')
    expect(args[3]).toContain('META_DM_REVIEW_REQUIRED_MISSING_MESSAGE_ID')
    expect(args[5]).toBe(true)
  })

})
