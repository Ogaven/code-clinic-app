import { getAgentReplyV2OpenAI } from '../agent/agent.service'
import { isAgentEnabled } from '../takeover/takeover.service'
import { prisma } from '../../lib/prisma'

// ── Africa's Talking SMS client (lazy singleton) ──────────────────────────────
// Real carrier SMS. AT_API_KEY/AT_USERNAME are configured in production;
// when absent (local dev/test) sendSMS() falls back to the WhatsApp
// passthrough this file used exclusively before this integration.
let atSmsClientPromise: Promise<any | null> | null = null

function getAtSmsClient(): Promise<any | null> {
  if (atSmsClientPromise) return atSmsClientPromise
  atSmsClientPromise = (async () => {
    const apiKey   = process.env.AT_API_KEY
    const username = process.env.AT_USERNAME
    if (!apiKey || !username) return null
    const atModule = await import('africastalking') as any
    const init = atModule.default ?? atModule
    const AfricasTalking = init({ apiKey, username })
    return AfricasTalking.SMS
  })()
  return atSmsClientPromise
}

export function isRealSmsProviderConfigured(): boolean {
  return Boolean(process.env.AT_API_KEY && process.env.AT_USERNAME)
}

// SMS is not currently an active Code Clinic communication channel — only
// WhatsApp, Instagram, Facebook, and Website Chat are. Credentials being
// configured (isRealSmsProviderConfigured) is necessary but not sufficient:
// this is the separate, deliberate "the business has actually turned SMS on"
// switch, independent of any individual CRM feature flag (waitlist,
// sequences, missed-call text-back). Without this, turning on e.g.
// CRM_WAITLIST_AUTOMATION_LIVE for a patient whose commsChannelPref is SMS,
// or activating a sequence with an SMS-channel touch, would silently start
// sending real carrier SMS the moment credentials exist — which they already
// do in production. This must stay false until Code Clinic has an actual
// active SMS plan/service arrangement.
export function isSmsChannelActive(): boolean {
  return process.env.SMS_CHANNEL_ACTIVE === 'true'
}

// ── Send SMS ───────────────────────────────────────────────────────────────────
// Falls back to the WhatsApp passthrough whenever real SMS isn't both
// configured AND actively enabled — preserving WhatsApp as the working
// channel rather than silently failing, per the same reasoning every other
// send-capable path in this codebase already follows.

export async function sendSMS(to: string, message: string): Promise<void> {
  if (!isRealSmsProviderConfigured() || !isSmsChannelActive()) {
    const { sendWhatsAppMessage } = await import('../whatsapp/whatsapp.service')
    await sendWhatsAppMessage(to, message)
    return
  }

  const client = await getAtSmsClient()
  if (!client) {
    const { sendWhatsAppMessage } = await import('../whatsapp/whatsapp.service')
    await sendWhatsAppMessage(to, message)
    return
  }

  await client.send({
    to: [to],
    message,
    ...(process.env.AT_SENDER_ID ? { from: process.env.AT_SENDER_ID } : {}),
  })
}

// ── Process inbound SMS from Africa's Talking ─────────────────────────────────

export async function processInboundSMS(from: string, text: string): Promise<void> {
  try {
    // ── 1. Identify patient by phone ─────────────────────────────────────────
    const patient = await prisma.patient.findFirst({
      where: { phone: from },
    })

    // ── 2. Find or create active SMS conversation ─────────────────────────────
    let conversation = await prisma.aiConversation.findFirst({
      where: {
        phoneNumber: from,
        channel:     'SMS',
        status:      'ACTIVE',
      },
      orderBy: { createdAt: 'desc' },
    })

    if (!conversation) {
      conversation = await prisma.aiConversation.create({
        data: {
          patientId:    patient?.id ?? null,
          channel:      'SMS',
          phoneNumber:  from,
          status:       'ACTIVE',
          agentEnabled: true,
        },
      })
    }

    // ── 3. Save inbound message ───────────────────────────────────────────────
    await prisma.aiMessage.create({
      data: {
        conversationId: conversation.id,
        role:           'USER',
        content:        text,
      },
    })

    // ── 4. Human takeover guard ───────────────────────────────────────────────
    const agentOn = await isAgentEnabled(conversation.id)
    if (!agentOn) {
      console.log(`[SMS] Conversation ${conversation.id} in human takeover — message saved, no auto-reply`)
      return
    }

    // ── 5. Get Sarah's reply ──────────────────────────────────────────────────
    const agentReply = await getAgentReplyV2OpenAI(conversation.id, from, text, 'SMS')

    // ── 6. Persist agent reply ────────────────────────────────────────────────
    await prisma.aiMessage.create({
      data: {
        conversationId: conversation.id,
        role:           'AGENT',
        content:        agentReply,
      },
    })

    // ── 7. Send SMS reply ─────────────────────────────────────────────────────
    await sendSMS(from, agentReply)

  } catch (err) {
    console.error('[SMS] processInboundSMS error:', err)
  }
}
