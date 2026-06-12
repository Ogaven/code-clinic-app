import { Router } from 'express'
import { prisma } from '../lib/prisma'
import { getAgentReply } from '../ai-suite/agent/agent.service'
import { isAgentEnabled } from '../ai-suite/takeover/takeover.service'

const router = Router()

// POST /manychat/webhook
// Receives messages from ManyChat (Facebook + Instagram) and responds via Sarah.
router.post('/webhook', async (req, res) => {
  res.sendStatus(200) // Acknowledge immediately so ManyChat doesn't retry

  try {
    const { id, last_input_text, ig_id } = req.body as {
      id: string | number; last_input_text?: string; ig_id?: number | string
    }

    console.log('[ManyChat] Received:', JSON.stringify({ id, last_input_text, ig_id, channel: ig_id ? 'INSTAGRAM' : 'FACEBOOK' }))

    const subscriberId = String(id)
    const message      = last_input_text
    if (!subscriberId || !message) return

    const channel = ig_id ? 'INSTAGRAM' : 'FACEBOOK'
    const phoneNumber  = channel === 'FACEBOOK' ? `fb_${subscriberId}` : `ig_${subscriberId}`

    let conversation = await prisma.aiConversation.findFirst({
      where:   { phoneNumber, channel, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    })

    if (!conversation) {
      conversation = await prisma.aiConversation.create({
        data: { channel, phoneNumber, status: 'ACTIVE', agentEnabled: true },
      })
    }

    await prisma.aiMessage.create({
      data: { conversationId: conversation.id, role: 'USER', content: message },
    })

    const agentOn = await isAgentEnabled(conversation.id)
    if (!agentOn) {
      console.log(`[ManyChat/${channel}] Human takeover active — message saved, no auto-reply`)
      return
    }

    const reply = await getAgentReply(conversation.id, subscriberId, message)

    await prisma.aiMessage.create({
      data: { conversationId: conversation.id, role: 'AGENT', content: reply },
    })

    await sendManychatReply(subscriberId, reply, channel)
  } catch (err) {
    console.error('[ManyChat] Webhook error:', err)
  }
})

export async function sendManychatReply(subscriberId: string, text: string, channel = 'FACEBOOK'): Promise<void> {
  const apiKey = process.env.MANYCHAT_API_KEY
  if (!apiKey) {
    console.warn('[ManyChat] MANYCHAT_API_KEY not set — reply not sent')
    return
  }

  const sendUrl = channel === 'INSTAGRAM'
    ? 'https://api.manychat.com/ig/sending/sendContent'
    : 'https://api.manychat.com/fb/sending/sendContent'

  const res = await fetch(sendUrl, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      subscriber_id: subscriberId,
      data: {
        version: 'v2',
        content: {
          messages: [{ type: 'text', text }],
        },
      },
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    console.error('[ManyChat] Failed to send reply:', errText)
  } else {
    console.log(`[ManyChat] Reply sent to subscriber ${subscriberId}`)
  }
}

export default router
