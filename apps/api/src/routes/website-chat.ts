import { Router } from 'express'
import { prisma } from '../lib/prisma'
import { getAgentReplyV2OpenAI } from '../ai-suite/agent/agent.service'
import { findOrCreateLeadForChannel } from '../crm-automation/lead-intake.service'

const router = Router()

// POST /website-chat/session
// Called by the widget on first open. Returns Sarah's greeting for new sessions,
// or the conversation history for returning visitors.

router.post('/session', async (req, res) => {
  try {
    const { sessionId } = req.body
    if (!sessionId) return res.status(400).json({ error: 'sessionId required' })

    const existing = await prisma.aiConversation.findFirst({
      where:   { phoneNumber: sessionId, channel: 'WEBSITE', status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    })

    if (existing) {
      const messages = await prisma.aiMessage.findMany({
        where:   { conversationId: existing.id, role: { in: ['USER', 'AGENT'] } },
        orderBy: { createdAt: 'asc' },
        select:  { role: true, content: true },
        take:    50,
      })
      return res.json({ sessionId, isNew: false, messages })
    }

    const conv = await prisma.aiConversation.create({
      data: { channel: 'WEBSITE', phoneNumber: sessionId, status: 'ACTIVE', agentEnabled: true },
    })

    const greeting = `Hello! 😊 I'm Sarah from Code Clinic. How may I brighten your smile today?`
    await prisma.aiMessage.create({
      data: { conversationId: conv.id, role: 'AGENT', content: greeting },
    })

    res.json({ sessionId, isNew: true, greeting })
  } catch (err: any) {
    console.error('[WebsiteChat] /session error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

// POST /website-chat/message
// Takes { sessionId, message }, runs it through Sarah, returns { reply }.

router.post('/message', async (req, res) => {
  try {
    const { sessionId, message } = req.body
    if (!sessionId || !message?.trim()) {
      return res.status(400).json({ error: 'sessionId and message required' })
    }

    let conv = await prisma.aiConversation.findFirst({
      where:   { phoneNumber: sessionId, channel: 'WEBSITE', status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    })
    if (!conv) {
      conv = await prisma.aiConversation.create({
        data: { channel: 'WEBSITE', phoneNumber: sessionId, status: 'ACTIVE', agentEnabled: true },
      })
    }

    await prisma.aiMessage.create({
      data: { conversationId: conv.id, role: 'USER', content: message },
    })

    // Website visitors must enter the same CRM lifecycle as WhatsApp and
    // social-channel enquiries. The widget session id is the stable identity
    // available before the visitor supplies a phone/email, so use it for
    // deduplication without pretending it is a real phone number.
    await findOrCreateLeadForChannel({
      where:      { provider: 'WEBSITE_CHAT', externalSubmissionId: sessionId, status: { notIn: ['CONVERTED', 'LOST'] } },
      createData: {
        source: 'WEBSITE',
        status: 'NEW',
        stage: 'NEW',
        lastMessage: message,
        provider: 'WEBSITE_CHAT',
        externalSubmissionId: sessionId,
      },
      onExistingMessage: message,
      intakeOptions: { skipAcknowledgement: true },
      // CommsChannel has no WEBSITE enum today. Do not fabricate consent on a
      // different channel; the website message itself is still recorded as
      // genuine inbound CRM activity by findOrCreateLeadForChannel().
    })

    const reply = await getAgentReplyV2OpenAI(conv.id, sessionId, message, 'WEBSITE')

    await prisma.aiMessage.create({
      data: { conversationId: conv.id, role: 'AGENT', content: reply },
    })

    res.json({ reply, sessionId })
  } catch (err: any) {
    console.error('[WebsiteChat] /message error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

export default router
