import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// ── Take over a conversation (disable Sarah, flag for human) ──────────────────

export async function takeoverConversation(
  conversationId: string,
  staffId: string
): Promise<void> {
  await prisma.aiConversation.update({
    where: { id: conversationId },
    data: {
      agentEnabled: false,
      status:       'HUMAN_TAKEOVER',
    },
  })

  await prisma.aiMessage.create({
    data: {
      conversationId,
      role:     'SYSTEM',
      content:  `Conversation taken over by staff member at ${new Date().toISOString()}.`,
      metadata: JSON.stringify({ staffId, takenOverAt: new Date().toISOString() }),
    },
  })

  console.log(`[Takeover] Conversation ${conversationId} taken over by staff ${staffId}`)
}

// ── Hand back a conversation to Sarah ─────────────────────────────────────────

export async function handbackConversation(conversationId: string): Promise<void> {
  await prisma.aiConversation.update({
    where: { id: conversationId },
    data: {
      agentEnabled: true,
      status:       'ACTIVE',
    },
  })

  await prisma.aiMessage.create({
    data: {
      conversationId,
      role:    'SYSTEM',
      content: 'Agent resumed by staff.',
    },
  })

  console.log(`[Takeover] Conversation ${conversationId} handed back to agent`)
}

// ── Check whether Sarah is allowed to reply ───────────────────────────────────

export async function isAgentEnabled(conversationId: string): Promise<boolean> {
  const conv = await prisma.aiConversation.findUnique({
    where:  { id: conversationId },
    select: { agentEnabled: true },
  })
  // Default true if conversation not found (shouldn't happen but safe fallback)
  return conv?.agentEnabled ?? true
}
