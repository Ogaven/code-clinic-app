import { Router } from 'express'
import { takeoverConversation, handbackConversation } from './takeover.service'
import { prisma } from '../../lib/prisma'

const router = Router()

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
// Returns conversations filtered by ?channel=whatsapp|instagram|facebook|website
// Ordered by most recently updated conversation first.
router.get('/conversations', async (req, res) => {
  try {
    const channelParam = (req.query.channel as string | undefined)?.toUpperCase()
    const where = channelParam ? { channel: channelParam } : {}
    const conversations = await prisma.aiConversation.findMany({
      where,
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

// POST /ai-suite/conversations/:conversationId/send
// Staff sends a message directly while in human-takeover mode.
router.post('/conversations/:conversationId/send', async (req, res) => {
  try {
    const { text } = req.body as { text?: string }
    if (!text?.trim()) return res.status(400).json({ error: 'text required' })

    const conversation = await prisma.aiConversation.findUnique({
      where: { id: req.params.conversationId },
    })
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' })

    await prisma.aiMessage.create({
      data: {
        conversationId: req.params.conversationId,
        role:    'AGENT',
        content: text.trim(),
      },
    })

    if (conversation.channel === 'WHATSAPP') {
      const { sendWhatsAppMessage } = await import('../whatsapp/whatsapp.service')
      await sendWhatsAppMessage(conversation.phoneNumber, text.trim())
    } else if (conversation.channel === 'SMS') {
      const { sendWhatsAppMessage } = await import('../whatsapp/whatsapp.service')
      await sendWhatsAppMessage(conversation.phoneNumber, text.trim())
    } else if (conversation.channel === 'FACEBOOK' || conversation.channel === 'INSTAGRAM') {
      const phone = conversation.phoneNumber
      if (phone.startsWith('fb_') || phone.startsWith('ig_')) {
        const subscriberId = phone.replace(/^(fb_|ig_)/, '')
        const { sendManychatReply } = await import('../../routes/manychat')
        await sendManychatReply(subscriberId, text.trim())
      } else {
        const { sendSocialReply } = await import('../facebook/facebook.routes')
        await sendSocialReply(phone, text.trim(), conversation.channel as 'FACEBOOK' | 'INSTAGRAM')
      }
    }
    // WEBSITE: no external delivery — message is visible in the widget on next poll

    res.json({ success: true })
  } catch (err: any) {
    console.error('[Takeover] send error:', err.message)
    res.status(500).json({ error: 'Failed to send message' })
  }
})

export default router
