import { prisma } from '../../lib/prisma'

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
// `summary` is the optional free-text staff type before resuming Sarah (e.g.
// "Patient wanted a filling, booked Tuesday 8am, continue from here") — kept
// in this message's metadata (not a new column) and read back by
// getPendingHandoffNote() the next time Sarah replies, same pattern takeover
// already uses for staffId. Symmetric with takeoverConversation, which was
// the only side previously capturing who acted.

export async function handbackConversation(
  conversationId: string,
  staffId: string,
  summary?: string
): Promise<void> {
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
      role:     'SYSTEM',
      content:  summary ? `Agent resumed by staff. Handoff notes: ${summary}` : 'Agent resumed by staff.',
      metadata: JSON.stringify({ staffId, summary: summary || null, handedBackAt: new Date().toISOString() }),
    },
  })

  console.log(`[Takeover] Conversation ${conversationId} handed back to agent by staff ${staffId}`)
}

// ── Check whether Sarah is allowed to reply ───────────────────────────────────

export async function isAgentEnabled(conversationId: string): Promise<boolean> {
  const conv = await prisma.aiConversation.findUnique({
    where:  { id: conversationId },
    select: { agentEnabled: true },
  })
  // Missing conversations must not trigger an unsolicited agent response.
  // Fail closed until a valid conversation record explicitly permits the agent.
  return conv?.agentEnabled === true
}


// Read the latest staff handback note without consuming or deleting clinical history.
// Only the most recent handback is relevant; a subsequent takeover supersedes it.
export async function getPendingHandoffNote(conversationId: string): Promise<string | null> {
  const messages = await prisma.aiMessage.findMany({
    where: { conversationId, role: 'SYSTEM' },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { content: true, metadata: true },
  })

  for (const message of messages) {
    if (message.content.startsWith('Conversation taken over by staff')) return null
    if (!message.content.startsWith('Agent resumed by staff.')) continue
    try {
      const metadata = message.metadata ? JSON.parse(message.metadata) : null
      const note = metadata?.summary
      return typeof note === 'string' && note.trim() ? note.trim() : null
    } catch {
      return null
    }
  }
  return null
}
