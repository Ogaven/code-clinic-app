import { getAgentReplyV2OpenAI } from '../agent/agent.service'
import { isAgentEnabled } from '../takeover/takeover.service'
import { prisma } from '../../lib/prisma'

// ── Africa's Talking SMS client (lazy singleton) ──────────────────────────────
// Real carrier SMS.
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

// SMS is not currently an active Code Clinic patient channel — only
// WhatsApp, Instagram, Facebook, and Website Chat are, a deliberate business
// decision, not an infrastructure gap. AT_API_KEY/AT_USERNAME being present
// in an environment does NOT mean the channel is live (they genuinely are
// configured in production today): this is the separate, explicit "the
// business has actually turned SMS on" switch, independent of any CRM
// feature flag (waitlist, sequences, missed-call text-back) and of
// credential presence alone — mirrors the same "credential presence !=
// feature live" principle crm-automation/dry-run.ts already uses for
// MISSED_CALL_TEXTBACK. Flip SMS_CHANNEL_ACTIVE=true only once Code Clinic
// has an actual active SMS plan/service arrangement.
export function isSmsChannelActive(): boolean {
  return process.env.SMS_CHANNEL_ACTIVE === 'true' && isRealSmsProviderConfigured()
}

export type SmsSendResult = 'SENT' | 'SMS_NOT_CONFIGURED'

// ── Send SMS ───────────────────────────────────────────────────────────────────
// SMS must NEVER silently become WhatsApp — a caller that asked for SMS and
// can't get it needs to know that plainly, not have a different channel's
// message appear in its place under an SMS label. WhatsApp must only be
// used when a workflow explicitly selected WhatsApp. When the channel isn't
// active, this returns SMS_NOT_CONFIGURED and does not attempt any send, on
// any channel, and does not write a delivery record implying otherwise.
// (For internal staff/emergency alerts that need to survive this gate
// entirely — e.g. paging a human when WhatsApp itself is down — use
// sendStaffSMS below, not this function.)
export async function sendSMS(to: string, message: string): Promise<SmsSendResult> {
  if (!isSmsChannelActive()) {
    console.log(`[SMS] Not sent (channel inactive/not configured) — to=${to}`)
    return 'SMS_NOT_CONFIGURED'
  }

  const client = await getAtSmsClient()
  if (!client) return 'SMS_NOT_CONFIGURED' // defensive; isSmsChannelActive() already checked this

  await client.send({
    to: [to],
    message,
    ...(process.env.AT_SENDER_ID ? { from: process.env.AT_SENDER_ID } : {}),
  })
  return 'SENT'
}

// ── Send staff/internal alert SMS ───────────────────────────────────────────────
// NOT the patient-communication-channel decision sendSMS() gates on. This is
// for internal staff safety alerts (clinical concerns, escalations, "your
// WhatsApp alerts aren't delivering") that need a delivery path independent
// of WhatsApp's own failure modes — e.g. the 2026-09 Meta billing outage that
// silently swallowed staff alerts for weeks. Requires only that Africa's
// Talking credentials exist; does not require SMS_CHANNEL_ACTIVE, because
// "has Code Clinic turned SMS on as a patient channel" is a different
// question from "can we page a human when something needs attention."
// Throws on failure (no WhatsApp fallback) — callers already try WhatsApp
// first and are specifically trying an independent second channel here.
export async function sendStaffSMS(to: string, message: string): Promise<void> {
  const client = await getAtSmsClient()
  if (!client) {
    throw new Error("Africa's Talking not configured (AT_API_KEY/AT_USERNAME) — cannot send staff alert SMS")
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
    // SMS is currently a dormant channel — sendSMS never falls back to
    // WhatsApp, so a patient who somehow reaches this inbound-SMS path today
    // gets their reply saved to the conversation log but genuinely does not
    // receive it. That's the correct behavior for a channel that isn't live
    // yet; the result is logged so it's visible, not silently swallowed.
    const result = await sendSMS(from, agentReply)
    if (result === 'SMS_NOT_CONFIGURED') {
      console.warn(`[SMS] Reply not delivered — SMS channel is not active (conversation ${conversation.id})`)
    }

  } catch (err) {
    console.error('[SMS] processInboundSMS error:', err)
  }
}
