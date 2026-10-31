import { beforeEach, describe, expect, it, vi } from 'vitest'

const { upsert, findMany, updateMany, update, social, comment, lead } = vi.hoisted(() => ({
  upsert: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn(),
  social: vi.fn(), comment: vi.fn(), lead: vi.fn(),
}))
vi.mock('../lib/prisma', () => ({ prisma: { metaInboundEvent: { upsert, findMany, updateMany, update } } }))
vi.mock('../ai-suite/facebook/facebook.routes', () => ({
  processSocialMessage: social, processComment: comment, processLeadAdSubmission: lead,
}))
import { enqueueMetaEvent, metaEventKey, processMetaInboxBatch } from '../services/meta-inbound-inbox'

beforeEach(() => {
  vi.clearAllMocks()
  upsert.mockResolvedValue({})
  findMany.mockResolvedValue([])
  updateMany.mockResolvedValue({ count: 1 })
  update.mockResolvedValue({})
  social.mockResolvedValue(undefined)
  comment.mockResolvedValue(undefined)
  lead.mockResolvedValue(undefined)
})

describe('durable Meta inbox', () => {
  const payload = { object: 'instagram', kind: 'message', event: { sender: { id: 'patient-1' }, message: { mid: 'm1', text: 'Hello' } } }
  it('uses stable keys to deduplicate redeliveries', async () => {
    expect(metaEventKey('meta', payload)).toBe(metaEventKey('meta', payload))
    expect(metaEventKey('meta', payload)).not.toBe(metaEventKey('other', payload))
    const body = { object: 'instagram', entry: [{ messaging: [payload.event] }] }
    await enqueueMetaEvent(body)
    await enqueueMetaEvent(body)
    expect(upsert).toHaveBeenCalledTimes(2)
    expect(upsert.mock.calls[0][0].where.eventKey).toBe(upsert.mock.calls[1][0].where.eventKey)
  })
  it('rejects malformed entry collections rather than acknowledging them', async () => {
    await expect(enqueueMetaEvent({ object: 'page', entry: {} as any })).rejects.toThrow('entry must be an array')
    await expect(enqueueMetaEvent({ object: 'instagram', entry: [{ messaging: {} }] as any })).rejects.toThrow('messaging')
    await expect(enqueueMetaEvent({ object: 'page', entry: [{ changes: {} }] as any })).rejects.toThrow('changes')
    expect(upsert).not.toHaveBeenCalled()
  })
  it('ignores echoed messages', async () => {
    await enqueueMetaEvent({ object: 'page', entry: [{ messaging: [{ message: { text: 'reply', is_echo: true } }] }] })
    expect(upsert).not.toHaveBeenCalled()
  })
  it('dispatches and completes a claimed event', async () => {
    findMany.mockResolvedValue([{ id: 'e1', status: 'PENDING', attempts: 0, payload: JSON.stringify(payload) }])
    await processMetaInboxBatch()
    expect(social).toHaveBeenCalledWith('patient-1', 'Hello', 'INSTAGRAM', 'm1')
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'e1', status: 'PROCESSING', attempts: 1 }, data: expect.objectContaining({ status: 'COMPLETED' }) }))
  })
  it('marks an expired lease failed after eight attempts without redispatch', async () => {
    findMany.mockResolvedValue([{ id: 'e8', status: 'PROCESSING', attempts: 8, payload: JSON.stringify(payload) }])
    await processMetaInboxBatch()
    expect(social).not.toHaveBeenCalled()
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'e8', status: 'PROCESSING', attempts: 8 },
      data: expect.objectContaining({ status: 'FAILED' }),
    }))
  })
  it('does not dispatch when another worker wins the claim', async () => {
    findMany.mockResolvedValue([{ id: 'e1', status: 'PENDING', attempts: 0, payload: JSON.stringify(payload) }])
    updateMany.mockResolvedValueOnce({ count: 0 })
    await processMetaInboxBatch()
    expect(social).not.toHaveBeenCalled()
  })
  it('schedules a retry when a handler throws', async () => {
    findMany.mockResolvedValue([{ id: 'e1', status: 'PENDING', attempts: 0, payload: JSON.stringify(payload) }])
    social.mockRejectedValueOnce(new Error('Meta API unavailable'))
    await processMetaInboxBatch()
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'e1', status: 'PROCESSING', attempts: 1 }, data: expect.objectContaining({ status: 'PENDING' }) }))
  })
})
