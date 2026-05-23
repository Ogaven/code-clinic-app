import { Router } from 'express'
import { getAgentReply } from '../agent/agent.service'
import { isAgentEnabled } from '../takeover/takeover.service'
import { prisma } from '../../lib/prisma'

const router = Router()

const GRAPH_VERSION = 'v24.0'

// ── Facebook Messenger ────────────────────────────────────────────────────────

// GET /ai-suite/facebook/webhook — Meta webhook verification
router.get('/facebook/webhook', (req, res) => {
  const mode      = req.query['hub.mode']
  const token     = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']

  if (mode === 'subscribe' && token === (process.env.FACEBOOK_VERIFY_TOKEN ?? 'codeclinic-facebook-2026')) {
    console.log('[Facebook] Webhook verified')
    return res.status(200).send(challenge)
  }
  res.status(403).json({ error: 'Verification failed' })
})

// POST /ai-suite/facebook/webhook — receive Messenger messages
router.post('/facebook/webhook', async (req, res) => {
  res.sendStatus(200) // Acknowledge immediately so Meta doesn't retry

  try {
    const body = req.body as any
    if (body.object !== 'page') return

    for (const entry of body.entry ?? []) {
      for (const event of entry.messaging ?? []) {
        if (!event.message?.text) continue
        await processSocialMessage(
          String(event.sender.id),
          String(event.message.text),
          'FACEBOOK',
        )
      }
    }
  } catch (err) {
    console.error('[Facebook] Webhook error:', err)
  }
})

// ── Instagram DMs ─────────────────────────────────────────────────────────────

// GET /ai-suite/instagram/webhook
router.get('/instagram/webhook', (req, res) => {
  const mode      = req.query['hub.mode']
  const token     = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']

  if (mode === 'subscribe' && token === (process.env.INSTAGRAM_VERIFY_TOKEN ?? 'codeclinic-instagram-2026')) {
    console.log('[Instagram] Webhook verified')
    return res.status(200).send(challenge)
  }
  res.status(403).json({ error: 'Verification failed' })
})

// POST /ai-suite/instagram/webhook
router.post('/instagram/webhook', async (req, res) => {
  res.sendStatus(200)

  try {
    const body = req.body as any
    if (body.object !== 'instagram') return

    for (const entry of body.entry ?? []) {
      for (const event of entry.messaging ?? []) {
        if (!event.message?.text) continue
        await processSocialMessage(
          String(event.sender.id),
          String(event.message.text),
          'INSTAGRAM',
        )
      }
    }
  } catch (err) {
    console.error('[Instagram] Webhook error:', err)
  }
})

// ── Shared processor ──────────────────────────────────────────────────────────

export async function processSocialMessage(
  senderId: string,
  text:     string,
  channel:  'FACEBOOK' | 'INSTAGRAM',
): Promise<void> {
  try {
    let conversation = await prisma.aiConversation.findFirst({
      where:   { phoneNumber: senderId, channel, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    })
    const isNew = !conversation
    if (!conversation) {
      conversation = await prisma.aiConversation.create({
        data: { channel, phoneNumber: senderId, status: 'ACTIVE', agentEnabled: true },
      })
    }

    // Create or update Lead for this social contact
    const source = channel // 'FACEBOOK' | 'INSTAGRAM'
    const existingLead = await prisma.lead.findFirst({
      where:   { phone: senderId, status: { notIn: ['CONVERTED', 'LOST'] } },
      orderBy: { createdAt: 'desc' },
    })
    if (!existingLead) {
      await prisma.lead.create({
        data: { phone: senderId, source, status: 'NEW', stage: 'NEW', lastMessage: text },
      })
    } else {
      await prisma.lead.update({
        where: { id: existingLead.id },
        data:  { lastMessage: text },
      })
    }

    await prisma.aiMessage.create({
      data: { conversationId: conversation.id, role: 'USER', content: text },
    })

    const agentOn = await isAgentEnabled(conversation.id)
    if (!agentOn) {
      console.log(`[${channel}] Human takeover — message saved, no auto-reply`)
      return
    }

    const reply = await getAgentReply(conversation.id, senderId, text)

    await prisma.aiMessage.create({
      data: { conversationId: conversation.id, role: 'AGENT', content: reply },
    })

    await sendSocialReply(senderId, reply, channel)
  } catch (err) {
    console.error(`[${channel}] processSocialMessage error:`, err)
  }
}

export async function sendSocialReply(
  recipientId: string,
  text:        string,
  channel:     'FACEBOOK' | 'INSTAGRAM',
): Promise<void> {
  // Token is stored in DB via OAuth or manual form; fall back to env var
  const config = await prisma.aiAgentConfig.findFirst()
  const token = channel === 'FACEBOOK'
    ? (config?.facebookPageAccessToken || process.env.FACEBOOK_PAGE_ACCESS_TOKEN || null)
    : (config?.instagramAccessToken    || process.env.INSTAGRAM_ACCESS_TOKEN     || null)

  if (!token) {
    console.warn(`[${channel}] No page access token configured — reply not sent`)
    return
  }

  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/me/messages`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message:   { text },
    }),
  })

  if (!res.ok) {
    console.error(`[${channel}] Failed to send reply:`, await res.text())
  }
}

export default router
