import { describe, expect, it } from 'vitest'
import { sameInboxMessages, type InboxMessage } from './inbox-messages'

const pending: InboxMessage = { id: 'message', role: 'AGENT', content: 'Hello', createdAt: '2026-11-25T09:00:00Z' }

describe('inbox polling', () => {
  it.each([
    [undefined, 'sent'],
    ['sent', 'delivered'],
    ['delivered', 'read'],
    ['sent', 'failed'],
  ])('refreshes the bubble when the only change is %s → %s', (status, nextStatus) => {
    expect(sameInboxMessages([{ ...pending, status }], [{ ...pending, status: nextStatus }])).toBe(false)
  })

  it('refreshes when a failure reason arrives', () => {
    const failed = { ...pending, status: 'failed' }
    expect(sameInboxMessages([failed], [{ ...failed, deliveryErrorCode: 131047 }])).toBe(false)
  })

  it('retains the previous state for a poll with identical messages', () => {
    expect(sameInboxMessages([pending], [{ ...pending }])).toBe(true)
  })
})
