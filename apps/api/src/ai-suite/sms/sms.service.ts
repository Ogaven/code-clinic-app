import { getAgentReply } from '../agent/agent.service'
import { isAgentEnabled } from '../takeover/takeover.service'
import { prisma } from '../../lib/prisma'

// ── Phone number normalisation (Uganda) ───────────────────────────────────────

export function formatUgandaPhone(phone: string): string {
  const cleaned = phone.replace(/[\s\-().]/g, '')
  if (cleaned.startsWith('+'))   return cleaned           // +256... already correct
  if (cleaned.startsWith('256')) return `+${cleaned}`     // 256... → +256...
  if (cleaned.startsWith('0'))   return `+256${cleaned.slice(1)}`  // 07... → +2567...
  if (/^[74]/.test(cleaned))     return `+256${cleaned}`  // 7... or 4... → +2567... / +2564...
  return cleaned
}

// ── Send SMS — redirected to WhatsApp ─────────────────────────────────────────

export async function sendSMS(to: string, message: string): Promise<void> {
  const { sendWhatsAppMessage } = await import('../whatsapp/whatsapp.service')
  await sendWhatsAppMessage(to, message)
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
    const agentReply = await getAgentReply(conversation.id, from, text)

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
