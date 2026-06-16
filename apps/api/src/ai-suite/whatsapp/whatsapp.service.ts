import { getAgentReply, getAgentReplyV2, V2_TEST_NUMBERS } from '../agent/agent.service'
import { isAgentEnabled, takeoverConversation } from '../takeover/takeover.service'
import { setBookingState } from '../booking/booking.state'
import { createEscalation, notifyJulian } from '../../services/agent/guards/escalation'
import { formatUgandaPhone } from '../sms/sms.service'
import { prisma } from '../../lib/prisma'

// ── Strip markdown from Sarah's replies before sending via WhatsApp ──────────

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/_{1,2}(.*?)_{1,2}/g, '$1')
    .replace(/#{1,6}\s/g, '')
    .replace(/`(.*?)`/g, '$1')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/^\s*[-*]\s/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ── Next 8am EAT (UTC+3, no DST) ─────────────────────────────────────────────

function getNext8amUTC(): Date {
  // 8am EAT = 5am UTC
  const now = new Date()
  const today8am = new Date(now)
  today8am.setUTCHours(5, 0, 0, 0)
  if (now >= today8am) today8am.setUTCDate(today8am.getUTCDate() + 1)
  return today8am
}

// ── Clinic hours check (EAT) ──────────────────────────────────────────────────

function isClinicOpen(): boolean {
  const now  = new Date()
  const eat  = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Nairobi' }))
  const day  = eat.getDay()
  const mins = eat.getHours() * 60 + eat.getMinutes()
  const mmdd = `${String(eat.getMonth() + 1).padStart(2, '0')}-${String(eat.getDate()).padStart(2, '0')}`
  const ugandaHolidays = [
    '01-01', '01-26', '02-16', '03-08',
    '04-03', '04-06', // Good Friday & Easter Monday 2026
    '05-01', '06-03', '06-09', '10-09', '12-25', '12-26',
  ]
  if (ugandaHolidays.includes(mmdd)) return false
  if (day === 0) return false
  if (day === 6) return mins >= 9 * 60 && mins < 15 * 60
  return mins >= 8 * 60 && mins < 18 * 60
}


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

    let isNewConversation = !conversation

    if (!conversation) {
      const recentConv = await prisma.aiConversation.findFirst({
        where: {
          phoneNumber: from,
          channel:     'WHATSAPP',
          updatedAt:   { gte: new Date(Date.now() - 48 * 60 * 60 * 1000) },
        },
        orderBy: { updatedAt: 'desc' },
      })
      if (recentConv) {
        conversation = await prisma.aiConversation.update({
          where: { id: recentConv.id },
          data:  { status: 'ACTIVE' },
        })
        isNewConversation = false
      } else {
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
    // Bump updatedAt so inbox sorts this conversation to the top
    await prisma.aiConversation.update({
      where: { id: conversation.id },
      data:  { updatedAt: new Date() },
    })

    // ── 4. New conversation greeting ─────────────────────────────────────────
    // First-ever message from this number: send opening greeting, store it, return.
    // Their actual request will be processed on the next message.
    if (isNewConversation) {
      const greeting = `Hello 😊 Thanks for reaching out to Code Clinic, this is Sarah. How may I brighten your smile today?`
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
          await sendWhatsAppMessage(from, stripMarkdown(reply), wamid)
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
          await sendWhatsAppMessage(from, stripMarkdown(reply), wamid)
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
          await sendWhatsAppMessage(from, stripMarkdown(reply), wamid)
          return
        }
      }
    }

    // ── 6b. Template button reply detection ──────────────────────────────────
    // Patients tapping WhatsApp template buttons send the button label as text.
    // Handle these warmly without calling Claude.
    {
      const bt = text.trim()
      const btLower = bt.toLowerCase()
      type ButtonHandler = () => Promise<string>
      const buttonReplies: Record<string, ButtonHandler> = {
        '😊 feeling great': async () => {
          return `So glad to hear that! 🥳 Your health is our priority. Don't forget to book your next check-up — just reply BOOK when you're ready 😊`
        },
        '😐 could be better': async () => {
          return `Oh, I'm sorry to hear that 😔 Can you tell me more about what you're experiencing? I'll make sure the doctor follows up with you right away.`
        },
        '📅 book appointment': async () => {
          setBookingState(from, { state: 'AWAITING_SERVICE' })
          return `Of course! 😊 What service are you looking for? We offer consultations, cleaning, fillings, extractions, braces, whitening and more.`
        },
        '📅 book now': async () => {
          setBookingState(from, { state: 'AWAITING_SERVICE' })
          return `Wonderful! 😊 Let's get you booked in. What service are you looking for?`
        },
        '❓ ask a question': async () => {
          return `Of course, go ahead! 😊 I'm here to help.`
        },
        'not now': async () => {
          return `No worries at all! 😊 We're here whenever you're ready. Take care!`
        },
      }
      const buttonHandler = buttonReplies[btLower]
      if (buttonHandler) {
        const buttonResponse = await buttonHandler()
        await prisma.aiMessage.create({
          data: { conversationId: conversation.id, role: 'AGENT', content: buttonResponse },
        })
        await sendWhatsAppMessage(from, stripMarkdown(buttonResponse))
        return
      }
    }

    // ── 7. Get Sarah's reply from Claude ──────────────────────────────────────
    // V2 feature flag: Claude-tool-driven flow for test numbers only.
    // All other numbers use the V1 state-machine flow unchanged.
    const agentReply = V2_TEST_NUMBERS.has(from)
      ? await getAgentReplyV2(conversation.id, from, text)
      : await getAgentReply(conversation.id, from, text)

    // ── 7b. Escalation detection ──────────────────────────────────────────────
    // If Sarah's reply indicates she's handing off to Julian, trigger the full
    // escalation flow: create DB record, silence the bot, notify Julian.
    const escalationPhrases = ['julian', 'pass you to', 'connect you with', 'hand you over', 'colleague']
    const agentTriggeredEscalation = escalationPhrases.some(p => agentReply.toLowerCase().includes(p))

    if (agentTriggeredEscalation) {
      try {
        await createEscalation({
          patientId:   patient?.id,
          phoneNumber: from,
          channel:     'WHATSAPP',
          reason:      `Sarah escalated to Julian — patient message: ${text.slice(0, 200)}`,
          transcript:  text,
        })
        await takeoverConversation(conversation.id, 'auto-escalation')
        if (isClinicOpen()) {
          await notifyJulian(from, text)
        }
        console.log(`[WhatsApp] Escalated conversation ${conversation.id} to Julian (clinic ${isClinicOpen() ? 'open' : 'closed'})`)
      } catch (err: any) {
        console.error('[WhatsApp] Escalation flow error:', err.message)
      }
    }

    // ── 7c. Rating detection ─────────────────────────────────────────────────
    // If patient sends a bare 1–5 number (or "X stars"), persist as PatientFeedback.
    // Low scores (≤3) trigger an escalation to Julian.
    if (patient) {
      const ratingMatch = text.trim().match(/^([1-5])(?:\s*stars?)?$/i)
      if (ratingMatch) {
        const score = parseInt(ratingMatch[1])
        try {
          await prisma.patientFeedback.create({
            data: { patientId: patient.id, rating: score, channel: 'WHATSAPP' },
          })
        } catch (err: any) {
          console.error('[Feedback] Save failed:', err.message)
        }
        if (score <= 3) {
          try {
            await createEscalation({
              patientId:  patient.id,
              phoneNumber: from,
              channel:    'WHATSAPP',
              reason:     `Low rating: ${score}/5 stars`,
              transcript: text,
            })
            if (isClinicOpen()) {
              await notifyJulian(from, `⚠️ Patient gave ${score}/5 stars — needs follow-up call.`)
            }
          } catch (err: any) {
            console.error('[Feedback] Escalation failed:', err.message)
          }
        }
      }
    }

    // ── 8. After-hours follow-up queue ───────────────────────────────────────
    // If clinic is closed and this is a known patient, queue a morning check-in
    // so the team can proactively follow up when they open at 8am EAT.
    if (!isClinicOpen() && patient) {
      try {
        const existing = await prisma.outboundQueue.findFirst({
          where: {
            patientId:  patient.id,
            agentMode:  'MORNING_FOLLOWUP',
            status:     'PENDING',
            scheduledFor: { gt: new Date() },
          },
        })
        if (!existing) {
          await prisma.outboundQueue.create({
            data: {
              patientId:    patient.id,
              phoneNumber:  from,
              agentMode:    'MORNING_FOLLOWUP',
              reason:       `After-hours message: ${text.slice(0, 200)}`,
              scheduledFor: getNext8amUTC(),
              status:       'PENDING',
            },
          })
        }
      } catch (err: any) {
        console.error('[WhatsApp] After-hours queue error:', err.message)
      }

      // If message is very short (< 5 words) it may indicate a missed-call attempt —
      // queue a dedicated missed_call_followup template for morning delivery.
      const wordCount = text.trim().split(/\s+/).filter(Boolean).length
      if (wordCount < 5) {
        try {
          const existingMissed = await prisma.outboundQueue.findFirst({
            where: {
              patientId:  patient.id,
              agentMode:  'MISSED_CALL_FOLLOWUP',
              status:     'PENDING',
              scheduledFor: { gt: new Date() },
            },
          })
          if (!existingMissed) {
            await prisma.outboundQueue.create({
              data: {
                patientId:    patient.id,
                phoneNumber:  from,
                agentMode:    'MISSED_CALL_FOLLOWUP',
                reason:       `Short after-hours message: "${text.slice(0, 100)}"`,
                scheduledFor: getNext8amUTC(),
                status:       'PENDING',
              },
            })
          }
        } catch (err: any) {
          console.error('[WhatsApp] Missed call queue error:', err.message)
        }
      }
    }

    // ── 9. Persist Sarah's reply ──────────────────────────────────────────────
    await prisma.aiMessage.create({
      data: {
        conversationId: conversation.id,
        role:           'AGENT',
        content:        agentReply,
      },
    })

    // ── 10. Deliver Sarah's reply via Africa's Talking ────────────────────────
    await sendWhatsAppMessage(from, stripMarkdown(agentReply), wamid)

  } catch (err) {
    console.error('[WhatsApp] processInbound error:', err)
  }
}

// Exported so schedulers (reminder, followup) can send outbound WhatsApp messages
export async function sendWhatsAppMessage(to: string, body: string, _replyToMessageId?: string): Promise<string | null> {
  const apiKey   = process.env.AT_API_KEY
  const username = process.env.AT_USERNAME
  const waNumber = process.env.AT_WHATSAPP_NUMBER || process.env.WHATSAPP_PHONE_NUMBER

  if (!apiKey || !username || !waNumber) {
    console.error('[WhatsApp] Missing AT_API_KEY, AT_USERNAME, or WHATSAPP_PHONE_NUMBER env vars')
    return null
  }

  const normalizedTo = formatUgandaPhone(to)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const AfricasTalking = require('africastalking')
  const at = AfricasTalking({ apiKey, username })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resp: any = await at.WHATSAPP.sendMessage({ waNumber, phoneNumber: normalizedTo, body: { message: body } })
  // AT returns the Meta wamid in one of these shapes depending on API version
  const msgId: string | null = resp?.messageId ?? resp?.data?.messageId ?? resp?.recipients?.[0]?.messageId ?? null
  console.log(`[WhatsApp] Sent to ${normalizedTo}: ${body.slice(0, 60)}... (msgId: ${msgId ?? 'unknown'})`)
  return msgId
}

export async function notifyReceptionistUnreachable(patientName: string, phone: string): Promise<void> {
  try {
    const receptionists = await prisma.user.findMany({ where: { role: 'RECEPTIONIST', isActive: true } })
    for (const r of receptionists) {
      await prisma.notification.create({
        data: {
          userId: r.id,
          title:  'Patient Unreachable on WhatsApp',
          body:   `Patient ${patientName} (${phone}) could not be reached on WhatsApp. Please call them directly.`,
          type:   'SYSTEM',
          isRead: false,
        },
      })
    }
  } catch (e: any) {
    console.error('[WhatsApp] Failed to notify receptionist:', e?.message || JSON.stringify(e) || 'unknown error')
  }
}

// Send a WhatsApp template message (for approved AT templates).
// Falls back silently — callers should send plain text on catch if needed.
export async function sendWhatsAppTemplate(
  to: string,
  templateName: string,
  params: string[],
): Promise<void> {
  const apiKey   = process.env.AT_API_KEY
  const username = process.env.AT_USERNAME
  const waNumber = process.env.AT_WHATSAPP_NUMBER || process.env.WHATSAPP_PHONE_NUMBER

  if (!apiKey || !username || !waNumber) {
    console.error('[WhatsApp] Missing AT credentials for template send')
    return
  }

  const normalizedTo = formatUgandaPhone(to)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const AfricasTalking = require('africastalking')
  const at = AfricasTalking({ apiKey, username })
  await at.WHATSAPP.sendMessage({
    waNumber,
    phoneNumber: normalizedTo,
    body: {
      type: 'template',
      template: {
        name: templateName,
        language: { code: 'en' },
        components: [{
          type: 'body',
          parameters: params.map(p => ({ type: 'text', text: p })),
        }],
      },
    },
  })
  console.log(`[WhatsApp] Template '${templateName}' sent to ${to}`)
}
