import { describe, expect, it, vi } from 'vitest'

const findUnique = vi.hoisted(() => vi.fn())
vi.mock('../lib/prisma', () => ({ prisma: { aiConversation: { findUnique } } }))

import { isAgentEnabled } from '../ai-suite/takeover/takeover.service'

describe('isAgentEnabled', () => {
  it('does not allow Sarah to respond when a conversation is missing', async () => {
    findUnique.mockResolvedValueOnce(null)
    await expect(isAgentEnabled('deleted-conversation')).resolves.toBe(false)
  })
  it('respects staff takeover', async () => {
    findUnique.mockResolvedValueOnce({ agentEnabled: false })
    await expect(isAgentEnabled('human-takeover')).resolves.toBe(false)
  })
  it('permits an existing conversation explicitly enabled for Sarah', async () => {
    findUnique.mockResolvedValueOnce({ agentEnabled: true })
    await expect(isAgentEnabled('active')).resolves.toBe(true)
  })
})
