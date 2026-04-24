import { Router } from 'express'
import { PrismaClient } from '@prisma/client'
import { takeoverConversation, handbackConversation } from './takeover.service'

const router = Router()
const prisma = new PrismaClient()

// POST /ai-suite/takeover/:conversationId
// Staff member takes over a conversation — Sarah goes silent.
router.post('/takeover/:conversationId', async (req, res) => {
  try {
    const staffId = (req.body.staffId as string | undefined) ?? 'unknown'
    await takeoverConversation(req.params.conversationId, staffId)
    res.json({ success: true })
  } catch (err: any) {
    console.error('[Takeover] takeover error:', err.message)
    res.status(500).json({ error: 'Failed to take over conversation' })
  }
})

// POST /ai-suite/handback/:conversationId
// Staff hands the conversation back to Sarah.
router.post('/handback/:conversationId', async (req, res) => {
  try {
    await handbackConversation(req.params.conversationId)
    res.json({ success: true })
  } catch (err: any) {
    console.error('[Takeover] handback error:', err.message)
    res.status(500).json({ error: 'Failed to hand back conversation' })
  }
})

// GET /ai-suite/conversations
// Returns all conversations with last message, patient name, channel, agent status.
// Ordered by most recently updated conversation first.
router.get('/conversations', async (_req, res) => {
  try {
    const conversations = await prisma.aiConversation.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        patient: {
          select: { firstName: true, lastName: true },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    })

    res.json(
      conversations.map(c => ({
        id:           c.id,
        channel:      c.channel,
        phoneNumber:  c.phoneNumber,
        status:       c.status,
        agentEnabled: c.agentEnabled,
        patientName:  c.patient
          ? `${c.patient.firstName} ${c.patient.lastName}`
          : null,
        lastMessage: c.messages[0] ?? null,
        createdAt:   c.createdAt,
        updatedAt:   c.updatedAt,
      }))
    )
  } catch (err: any) {
    console.error('[Takeover] conversations list error:', err.message)
    res.status(500).json({ error: 'Failed to fetch conversations' })
  }
})

// GET /ai-suite/conversations/:conversationId/messages
// Returns all messages for a conversation in chronological order.
router.get('/conversations/:conversationId/messages', async (req, res) => {
  try {
    const messages = await prisma.aiMessage.findMany({
      where:   { conversationId: req.params.conversationId },
      orderBy: { createdAt: 'asc' },
    })
    res.json(messages)
  } catch (err: any) {
    console.error('[Takeover] messages fetch error:', err.message)
    res.status(500).json({ error: 'Failed to fetch messages' })
  }
})

export default router
