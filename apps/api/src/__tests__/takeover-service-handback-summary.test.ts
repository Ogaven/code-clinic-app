// Covers apps/api/src/ai-suite/takeover/takeover.service.ts directly —
// handbackConversation now takes staffId + optional summary (previously
// captured neither), symmetric with takeoverConversation which already
// captured staffId. The summary is stored in the SYSTEM message's metadata
// so getPendingHandoffNote (patient-context.service.ts) can read it back
// without a schema migration.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = vi.hoisted(() => ({
  conversations: new Map<string, any>(),
  messages: [] as any[],
}))

vi.mock('../lib/prisma', () => ({
  prisma: {
    aiConversation: {
      update: vi.fn(async ({ where, data }: any) => {
        const conv = store.conversations.get(where.id) ?? {}
        const updated = { ...conv, ...data }
        store.conversations.set(where.id, updated)
        return updated
      }),
    },
    aiMessage: {
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `msg_${store.messages.length + 1}`, ...data }
        store.messages.push(row)
        return row
      }),
    },
  },
}))

beforeEach(() => {
  store.conversations.clear()
  store.messages.length = 0
})

describe('takeoverConversation', () => {
  it('disables the agent and records the staffId on the SYSTEM message metadata', async () => {
    const { takeoverConversation } = await import('../ai-suite/takeover/takeover.service')

    await takeoverConversation('conv-1', 'staff-1')

    expect(store.conversations.get('conv-1')).toMatchObject({ agentEnabled: false, status: 'HUMAN_TAKEOVER' })
    const msg = store.messages.find(m => m.conversationId === 'conv-1')
    expect(JSON.parse(msg.metadata).staffId).toBe('staff-1')
  })
})

describe('handbackConversation', () => {
  it('re-enables the agent and records staffId even with no summary provided', async () => {
    const { handbackConversation } = await import('../ai-suite/takeover/takeover.service')

    await handbackConversation('conv-1', 'staff-2')

    expect(store.conversations.get('conv-1')).toMatchObject({ agentEnabled: true, status: 'ACTIVE' })
    const msg = store.messages.find(m => m.conversationId === 'conv-1')
    expect(msg.content).toBe('Agent resumed by staff.')
    const meta = JSON.parse(msg.metadata)
    expect(meta.staffId).toBe('staff-2')
    expect(meta.summary).toBeNull()
  })

  it('embeds the staff summary in both the message content and metadata when provided', async () => {
    const { handbackConversation } = await import('../ai-suite/takeover/takeover.service')

    await handbackConversation('conv-1', 'staff-2', 'Patient wanted a filling, booked Tuesday 8am.')

    const msg = store.messages.find(m => m.conversationId === 'conv-1')
    expect(msg.content).toContain('Patient wanted a filling, booked Tuesday 8am.')
    expect(msg.role).toBe('SYSTEM')
    const meta = JSON.parse(msg.metadata)
    expect(meta.summary).toBe('Patient wanted a filling, booked Tuesday 8am.')
  })
})
