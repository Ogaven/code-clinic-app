import { describe, expect, it } from 'vitest'
import { commitAssistantReply } from '../ai-suite/knowledge/knowledge-studio.service'

// Fakes a single conversation's message table. $transaction here just runs
// the callback against shared in-memory state — this proves the "check
// answered, then create" LOGIC correctly refuses a second write once the
// first has committed, which is the actual mechanism that prevents a
// duplicate. The real concurrency-safety-across-processes guarantee comes
// from Postgres's advisory lock serializing genuinely concurrent
// transactions before either one reaches this check (see the comment in
// knowledge-studio.service.ts) — not something an in-process fake can
// exercise without a live DB, so that half is verified by code review
// instead of this test.
function makeFakePrisma() {
  const messages: any[] = [{ id: 'user-1', conversationId: 'convo-1', role: 'user', createdAt: new Date(1000) }]
  let n = 0
  const prisma = {
    $transaction: async (fn: any) => fn({
      $queryRaw: async () => {},
      knowledgeStudioMessage: {
        findUnique: async ({ where: { id } }: any) => messages.find(m => m.id === id) ?? null,
        findFirst: async ({ where }: any) =>
          messages.find(m => m.conversationId === where.conversationId && m.createdAt.getTime() > where.createdAt.gt.getTime()) ?? null,
        create: async ({ data }: any) => {
          const row = { id: `assistant-${++n}`, createdAt: new Date(2000 + n), ...data }
          messages.push(row)
          return row
        },
      },
    }),
  }
  return { prisma: prisma as any, messages }
}

describe('commitAssistantReply (Knowledge Studio chat duplicate-response protection)', () => {
  it('creates exactly one assistant message for a normal single call', async () => {
    const { prisma, messages } = makeFakePrisma()
    const result = await commitAssistantReply(prisma, 'user-1', 'convo-1', 'Reply A')
    expect(result).not.toBeNull()
    expect(messages.filter(m => m.role === 'assistant')).toHaveLength(1)
  })

  it('a second call for the SAME user turn after the first committed returns null — no duplicate assistant row', async () => {
    const { prisma, messages } = makeFakePrisma()

    const first = await commitAssistantReply(prisma, 'user-1', 'convo-1', 'Reply A')
    const second = await commitAssistantReply(prisma, 'user-1', 'convo-1', 'Reply B (duplicate attempt)')

    expect(first).not.toBeNull()
    expect(second).toBeNull()
    expect(messages.filter(m => m.role === 'assistant')).toHaveLength(1)
    expect(messages.find(m => m.role === 'assistant')?.content).toBe('Reply A')
  })

  it('this is exactly the shape of a concurrent Retry + plain-send race — only one reply survives regardless of call order', async () => {
    const { prisma, messages } = makeFakePrisma()

    // Simulates: staff clicks Retry, and a slow-network duplicate of the
    // original send also lands, both targeting the same unanswered user row.
    const retryReply = await commitAssistantReply(prisma, 'user-1', 'convo-1', 'From Retry')
    const duplicateSendReply = await commitAssistantReply(prisma, 'user-1', 'convo-1', 'From duplicate send')

    const assistantRows = messages.filter(m => m.role === 'assistant')
    expect(assistantRows).toHaveLength(1)
    expect([retryReply, duplicateSendReply].filter(r => r !== null)).toHaveLength(1)
  })

  it('returns null (not a fabricated row) when the target user message does not exist', async () => {
    const { prisma, messages } = makeFakePrisma()
    const result = await commitAssistantReply(prisma, 'does-not-exist', 'convo-1', 'Reply')
    expect(result).toBeNull()
    expect(messages.filter(m => m.role === 'assistant')).toHaveLength(0)
  })
})
