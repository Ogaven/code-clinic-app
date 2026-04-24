import { PrismaClient } from '@prisma/client'
import { getAgentReply } from '../agent/agent.service'

const prisma = new PrismaClient()

const GRAPH_API_VERSION = 'v18.0'

export async function processInbound(from: string, text: string): Promise<void> {
  try {
    // ── 1. Identify patient by phone number ──────────────────────────────────
    const patient = await prisma.patient.findUnique({
      where: { phone: from },
    })

    // ── 2. Find or create an active conversation for this number ─────────────
    let conversation = await prisma.aiConversation.findFirst({
      where: {
        phoneNumber: from,
        channel:     'WHATSAPP',
        status:      'ACTIVE',
      },
      orderBy: { createdAt: 'desc' },
    })

    if (!conversation) {
      conversation = await prisma.aiConversation.create({
        data: {
          patientId:    patient?.id ?? null,
          channel:      'WHATSAPP',
          phoneNumber:  from,
          status:       'ACTIVE',
          agentEnabled: true,
        },
      })
    }

    // ── 3. Save inbound message before calling the agent ─────────────────────
    await prisma.aiMessage.create({
      data: {
        conversationId: conversation.id,
        role:           'USER',
        content:        text,
      },
    })

    // ── 4. Get Sarah's reply from Claude ──────────────────────────────────────
    const agentReply = await getAgentReply(conversation.id, from, text)

    // ── 5. Persist Sarah's reply ──────────────────────────────────────────────
    await prisma.aiMessage.create({
      data: {
        conversationId: conversation.id,
        role:           'AGENT',
        content:        agentReply,
      },
    })

    // ── 6. Deliver Sarah's reply via Meta Graph API ───────────────────────────
    await sendWhatsAppMessage(from, agentReply)

  } catch (err) {
    console.error('[WhatsApp] processInbound error:', err)
  }
}

async function sendWhatsAppMessage(to: string, body: string): Promise<void> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
  const token         = process.env.WHATSAPP_TOKEN

  if (!phoneNumberId || !token) {
    console.error('[WhatsApp] Missing WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_TOKEN env vars')
    return
  }

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body },
  }

  const response = await fetch(url, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const error = await response.text()
    console.error(`[WhatsApp] Failed to send message to ${to}:`, error)
  } else {
    console.log(`[WhatsApp] Message sent to ${to}`)
  }
}
