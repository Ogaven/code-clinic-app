import type { PrismaClient } from '@prisma/client'

type PrismaLike = Pick<PrismaClient, '$transaction'>

// Serializes assistant-row commits per user turn across every API instance,
// for BOTH a fresh send and a retry — a duplicate/overlapping request
// (double-submit, client retry-on-timeout racing the original, or a genuine
// concurrent Retry + plain-send race) may still reach the provider and both
// produce a reply, but only ONE assistant response can ever be committed for
// a given unanswered user row: the advisory lock serializes the two
// transactions on the same DB connection pool (this covers multiple API
// instances too, since the lock lives in Postgres, not process memory), and
// the second transaction's own "is this user message still unanswered?"
// check then sees the first transaction's committed row and returns null
// instead of creating a duplicate.
//
// Extracted from the /chat route handler so it can be unit tested with a
// mocked PrismaClient (see __tests__/knowledge-studio.service.test.ts)
// without a live Postgres connection — the test's fake $transaction runs
// the two callbacks sequentially against one shared fake table, which is
// exactly what Postgres's real lock-then-reread behavior produces for two
// genuinely concurrent callers.
export async function commitAssistantReply(
  prisma: PrismaLike,
  userMessageId: string,
  conversationId: string,
  reply: string,
): Promise<any | null> {
  return prisma.$transaction(async (tx: any) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${userMessageId}))`
    const target = await tx.knowledgeStudioMessage.findUnique({ where: { id: userMessageId } })
    if (!target) return null
    const answered = await tx.knowledgeStudioMessage.findFirst({
      where: { conversationId, createdAt: { gt: target.createdAt } },
    })
    if (answered) return null
    return tx.knowledgeStudioMessage.create({
      data: { conversationId, role: 'assistant', content: reply },
    })
  }, { timeout: 15_000 })
}
