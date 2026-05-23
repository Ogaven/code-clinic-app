import { getAgentReply } from '../agent/agent.service'
import { isAgentEnabled } from '../takeover/takeover.service'
import { setBookingState } from '../booking/booking.state'
import { prisma } from '../../lib/prisma'

const GRAPH_API_VERSION = 'v19.0'

export async function processInbound(from: string, text: string, wamid: string): Promise<void> {
  try {
    // ── 1. Identify patient by phone number ──────────────────────────────────
    const patient = await prisma.patient.findFirst({
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

    const isNewConversation = !conversation

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

    // ── 2b. Create or update Lead for unknown contacts ───────────────────────
    if (!patient) {
      const existingLead = await prisma.lead.findFirst({
        where:   { phone: from, status: { notIn: ['CONVERTED', 'LOST'] } },
        orderBy: { createdAt: 'desc' },
      })
      if (!existingLead) {
        await prisma.lead.create({
          data: { phone: from, source: 'WHATSAPP', status: 'NEW', stage: 'NEW', lastMessage: text },
        })
      } else {
        await prisma.lead.update({
          where: { id: existingLead.id },
          data:  { lastMessage: text },
        })
      }
    }

    // ── 3. Save inbound message before calling the agent ─────────────────────
    await prisma.aiMessage.create({
      data: {
        conversationId: conversation.id,
        role:           'USER',
        content:        text,
      },
    })

    // ── 4. New conversation greeting ─────────────────────────────────────────
    // First-ever message from this number: send opening greeting, store it, return.
    // Their actual request will be processed on the next message.
    if (isNewConversation) {
      const greeting = `Hi! 😊 Thanks for reaching out to Code Clinic, this is Sarah — how may I brighten your smile today?`
      await prisma.aiMessage.create({
        data: { conversationId: conversation.id, role: 'AGENT', content: greeting },
      })
      await sendWhatsAppMessage(from, greeting, wamid)
      return
    }

    // ── 5. Human takeover guard ───────────────────────────────────────────────
    // If a staff member has taken over this conversation, save the message
    // silently so they can read it — do NOT auto-reply.
    const agentOn = await isAgentEnabled(conversation.id)
    if (!agentOn) {
      console.log(`[WhatsApp] Conversation ${conversation.id} in human takeover — message saved, no auto-reply`)
      return
    }

    // ── 6. Reminder reply detection ───────────────────────────────────────────
    // If a reminder was sent to this patient in the last 2 hours and their
    // reply is clearly YES or NO, handle it directly without calling Claude.
    if (patient) {
      const twoHoursAgo    = new Date(Date.now() - 2 * 60 * 60 * 1000)
      const recentReminder = await prisma.aiScheduledMessage.findFirst({
        where: {
          patientId:    patient.id,
          templateType: 'REMINDER',
          sent:         true,
          createdAt:    { gte: twoHoursAgo },
        },
        orderBy: { createdAt: 'desc' },
      })

      if (recentReminder) {
        const lower = text.toLowerCase().trim()

        const isYes = [
          'yes', 'yeah', 'yep', 'yep!', 'sure', 'ok', 'okay', 'confirm',
          'i will', "i'll be there", 'will come', 'coming', 'will be there', '✓', '👍',
        ].some(w => lower.includes(w))

        const isCancel = [
          'no', 'nope', "can't", "cannot", "won't", 'wont', "i can't",
          'not coming', 'unable', 'cancel',
        ].some(w => lower.includes(w))

        const isReschedule = [
          'reschedule', 'change', 'different time', 'another time', 'move', 'postpone',
        ].some(w => lower.includes(w))

        if (isYes) {
          // Confirm their next upcoming appointment
          const upcoming = await prisma.appointment.findFirst({
            where: {
              patientId: patient.id,
              startAt:   { gt: new Date() },
              status:    { notIn: ['CANCELLED'] },
            },
            orderBy: { startAt: 'asc' },
          })

          if (upcoming) {
            await prisma.appointment.update({
              where: { id: upcoming.id },
              data:  { status: 'CONFIRMED' },
            })
          }

          const reply = `Great! We'll see you tomorrow 😊 If anything changes, just let me know!`
          await prisma.aiMessage.create({
            data: { conversationId: conversation.id, role: 'AGENT', content: reply },
          })
          await sendWhatsAppMessage(from, reply, wamid)
          return
        }

        if (isReschedule || (isCancel && lower.includes('reschedule'))) {
          // Patient wants a different time — set state and ask
          const upcoming = await prisma.appointment.findFirst({
            where: {
              patientId: patient.id,
              startAt:   { gt: new Date() },
              status:    { notIn: ['CANCELLED'] },
            },
            orderBy: { startAt: 'asc' },
          })

          if (upcoming) {
            await prisma.appointment.update({
              where: { id: upcoming.id },
              data:  { status: 'RESCHEDULED' },
            })
            setBookingState(from, {
              state:         'AWAITING_RESCHEDULE_SLOT',
              appointmentId: upcoming.id,
              serviceId:     upcoming.serviceId,
            })
          }

          const reply = `No problem! Let me help you find another time. What day works best for you? 😊`
          await prisma.aiMessage.create({
            data: { conversationId: conversation.id, role: 'AGENT', content: reply },
          })
          await sendWhatsAppMessage(from, reply, wamid)
          return
        }

        if (isCancel) {
          // Patient is cancelling — mark appointment CANCELLED
          const upcoming = await prisma.appointment.findFirst({
            where: {
              patientId: patient.id,
              startAt:   { gt: new Date() },
              status:    { notIn: ['CANCELLED'] },
            },
            orderBy: { startAt: 'asc' },
          })

          if (upcoming) {
            await prisma.appointment.update({
              where: { id: upcoming.id },
              data:  { status: 'CANCELLED', notes: 'Cancelled via WhatsApp reminder reply' },
            })
          }

          const reply = `Understood! I've cancelled your appointment. If you'd like to book again in the future, just let us know 😊`
          await prisma.aiMessage.create({
            data: { conversationId: conversation.id, role: 'AGENT', content: reply },
          })
          await sendWhatsAppMessage(from, reply, wamid)
          return
        }
      }
    }

    // ── 7. Get Sarah's reply from Claude ──────────────────────────────────────
    const agentReply = await getAgentReply(conversation.id, from, text)

    // ── 8. Persist Sarah's reply ──────────────────────────────────────────────
    await prisma.aiMessage.create({
      data: {
        conversationId: conversation.id,
        role:           'AGENT',
        content:        agentReply,
      },
    })

    // ── 9. Deliver Sarah's reply via Meta Graph API ───────────────────────────
    await sendWhatsAppMessage(from, agentReply, wamid)

  } catch (err) {
    console.error('[WhatsApp] processInbound error:', err)
  }
}

// Exported so schedulers (reminder, followup) can send outbound WhatsApp messages
export async function sendWhatsAppMessage(to: string, body: string, replyToMessageId?: string): Promise<void> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
  const token         = process.env.WHATSAPP_TOKEN

  if (!phoneNumberId || !token) {
    console.error('[WhatsApp] Missing WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_TOKEN env vars')
    return
  }

  const url     = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`
  const payload: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    ...(replyToMessageId ? { context: { message_id: replyToMessageId } } : {}),
    text: { body },
  }

  console.log('[WA SEND]', { phoneNumberId, to, url })

  const response = await fetch(url, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })

  const responseText = await response.text()
  console.log('[WA RESPONSE]', response.status, responseText)

  if (!response.ok) {
    console.error(`[WhatsApp] Failed to send message to ${to}:`, responseText)
  }
}
