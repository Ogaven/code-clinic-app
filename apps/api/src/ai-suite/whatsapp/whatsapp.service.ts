import { getAgentReplyV2 } from '../agent/agent.service'
import { isAgentEnabled, takeoverConversation } from '../takeover/takeover.service'
import { setBookingState } from '../booking/booking.state'
import { createEscalation, notifyJulian } from '../../services/agent/guards/escalation'
import { formatUgandaPhone } from '../sms/sms.service'
import { prisma } from '../../lib/prisma'
import { hasOutboundConsent } from '../scheduler/guardian-routing.service'

// ── Classify outbound message type for audit log ──────────────────────────────

function classifyMessage(body: string): string {
  const b = body.toLowerCase()
  if (b.startsWith('🔔') || b.includes('lead enquiry') || b.includes('minor') && b.includes('guardian')) return 'staff_alert'
  if (b.includes('appointment') && (b.includes('tomorrow') || b.includes('reminder') || b.includes('today'))) return 'appointment_reminder'
  if (b.includes('rate') || b.includes('feedback') || b.includes('how was')) return 'followup_feedback'
  if (b.includes('we miss') || b.includes('been a while') || b.includes('due for')) return 'reactivation'
  if (b.includes('confirmed') || b.includes('booking confirmed') || b.includes('booked for')) return 'booking_confirmation'
  if (b.includes('cancelled') || b.includes('canceled')) return 'cancellation_notice'
  if (b.includes('opted out') || b.includes('unsubscribed') || b.includes('re-subscribed')) return 'consent_update'
  return 'general_reply'
}

// ── Fire-and-forget bot message audit log ─────────────────────────────────────

function logOutboundMessage(to: string, body: string, templateType: string): void {
  ;(async () => {
    try {
      const patient = await prisma.patient.findFirst({
        where: { OR: [{ phone: to }, { phone: to.replace(/^\+/, '') }, { phone: `+${to.replace(/^\+/, '')}` }] },
        select: { id: true },
      })
      await prisma.botMessageLog.create({
        data: {
          patientId:     patient?.id ?? null,
          recipientPhone: to,
          channel:        'WHATSAPP',
          templateType,
          messageBody:    body.slice(0, 4000),
        },
      })
    } catch (e: any) {
      console.error('[BotLog] Failed to write audit entry:', e?.message)
    }
  })()
}

// ── Write outbound template/scheduler sends into Sarah's own conversation memory ──
// botMessageLog is an audit trail only — getAgentReplyV2 reads aiMessage for context,
// so without this, Sarah has no memory of anything sent outside a live reply turn.
// Not called for live replies in processInbound — those are already logged at the
// point of generation, before delivery, to avoid double-logging the same message.

function logAgentMessageToConversation(to: string, content: string, wamid?: string): void {
  ;(async () => {
    try {
      const from = to.startsWith('+') ? to : `+${to}`

      let conversation = await prisma.aiConversation.findFirst({
        where:   { phoneNumber: from, channel: 'WHATSAPP', status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
      })

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
        } else {
          const patient = await prisma.patient.findFirst({ where: { phone: from } })
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

      await prisma.aiMessage.create({
        data: { conversationId: conversation.id, role: 'AGENT', content, wamid: wamid || undefined, status: wamid ? 'sent' : undefined },
      })
    } catch (e: any) {
      console.error('[WhatsApp] Failed to log outbound message to conversation:', e?.message)
    }
  })()
}

// ── Detect a bare greeting with no real content ──────────────────────────────
// Deliberately a tight allowlist, not a broad heuristic: anything not matched
// here is treated as substantive and goes to the real agent. Swallowing a real
// patient message is far worse than the real agent handling an easy greeting.

function isGreetingOnly(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[!.?~]+$/g, '').trim()
  return /^(hi+|hello+|hey+|hiya|yo|sup|howdy|hallo|good morning|good afternoon|good evening|morning|afternoon|evening)$/.test(t)
}

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


// Per-phone-number lock. AT and Meta Cloud API can both deliver the same inbound
// event concurrently (different wamids, different buffer keys), so two calls can
// race the conversation-lookup-or-create step and both conclude "new conversation".
// A time-window check (e.g. "any AGENT message in the last 60s") is itself a
// check-then-act race — it narrows the window but does not close it. Serializing
// calls per phone number closes it: the second call cannot start its own
// findFirst-or-create until the first has fully committed. Safe because the API
// runs as a single PM2 fork-mode process — no cross-process coordination needed.
const inFlightByPhone = new Map<string, Promise<void>>()

export function processInbound(from: string, text: string, wamid: string, phoneNumberId?: string): Promise<void> {
  const key   = from.startsWith('+') ? from : `+${from}`
  const prior = inFlightByPhone.get(key) ?? Promise.resolve()
  const run   = prior.catch(() => {}).then(() => processInboundLocked(from, text, wamid, phoneNumberId))
  inFlightByPhone.set(key, run)
  run.finally(() => { if (inFlightByPhone.get(key) === run) inFlightByPhone.delete(key) })
  return run
}

async function processInboundLocked(from: string, text: string, wamid: string, phoneNumberId?: string): Promise<void> {
  // Normalize to E.164: Meta webhook delivers numbers WITHOUT '+' (e.g. 256785703926).
  // Africa's Talking delivers WITH '+'. Always use the '+' form so every DB lookup matches.
  if (!from.startsWith('+')) from = `+${from}`

  try {
    // ── 1. Identify patient by phone number ──────────────────────────────────
    const patient = await prisma.patient.findFirst({
      where: { phone: from },
    })

    // ── 1b. Opt-out / opt-in detection ──────────────────────────────────────
    // Check before anything else so STOP is honoured even in human-takeover convos.
    const trimmedText = text.trim().toLowerCase()
    const STOP_WORDS  = ['stop', 'unsubscribe', 'optout', 'opt out', 'opt-out']
    if (STOP_WORDS.includes(trimmedText)) {
      if (patient) {
        await prisma.patientConsent.create({
          data: { patientId: patient.id, consentType: 'BOT_COMMUNICATION', granted: false },
        })
      }
      await sendWhatsAppMessage(from,
        `You've been unsubscribed from automated appointment reminders and updates from Code Clinic.\n\nIf you change your mind, reply START at any time. You can still message us whenever you need help 😊`
      )
      return
    }
    if (trimmedText === 'start') {
      if (patient) {
        await prisma.patientConsent.create({
          data: { patientId: patient.id, consentType: 'BOT_COMMUNICATION', granted: true },
        })
      }
      await sendWhatsAppMessage(from,
        `Welcome back! 😊 You've been re-subscribed to appointment reminders and updates from Code Clinic.`
      )
      return
    }

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
      // Alert staff for EVERY lead message so they can follow up in real-time
      const staffNumber = process.env.STAFF_WHATSAPP_NUMBER || '+256763430276'
      const preview     = text.slice(0, 200)
      sendWhatsAppMessage(
        staffNumber,
        `🔔 Lead enquiry\nPhone: ${from}\nMessage: "${preview}"${text.length > 200 ? '…' : ''}\n\nPlease follow up in the AI Suite inbox.`
      ).catch((e: any) => console.error('[Lead] Staff alert failed:', e?.message))
    }

    // ── 3. Save inbound message before calling the agent ─────────────────────
    await prisma.aiMessage.create({
      data: {
        conversationId: conversation.id,
        role:           'USER',
        content:        text,
        wamid:          wamid || undefined,
      },
    })
    // Bump updatedAt so inbox sorts this conversation to the top
    await prisma.aiConversation.update({
      where: { id: conversation.id },
      data:  { updatedAt: new Date() },
    })

    // Notify staff of new or unattended conversations (fire-and-forget)
    const patientName = patient ? `${patient.firstName} ${patient.lastName}` : from
    maybeNotifyStaff(conversation.id, from, patientName, 'WHATSAPP', isNewConversation)

    // ── 4. New conversation greeting ─────────────────────────────────────────
    // First-ever message from this number: if it's just a greeting with no real
    // content, send the canned opener and wait for their actual request. If the
    // first message already contains real content, skip straight to the real
    // agent below — never silently swallow a substantive first message.
    if (isNewConversation && isGreetingOnly(text)) {
      // Race guard: concurrent webhook deliveries can each create a new conversation before
      // the other's conversation is visible in the DB. Check across ALL conversations for this
      // phone number — if any AGENT message was sent in the last 60s, a greeting already went out.
      const alreadyGreeted = await prisma.aiMessage.findFirst({
        where: {
          role:      'AGENT',
          createdAt: { gte: new Date(Date.now() - 60 * 1000) },
          conversation: {
            phoneNumber: { in: [from, from.replace(/^\+/, '')] },
            channel:     'WHATSAPP',
          },
        },
      })
      if (alreadyGreeted) {
        console.log(`[WhatsApp] Skipping duplicate greeting for ${from} — already sent within last 60s`)
        return
      }
      const greeting = `Hello 😊 Thanks for reaching out to Code Clinic, this is Sarah. How may I brighten your smile today?`
      await prisma.aiMessage.create({
        data: { conversationId: conversation.id, role: 'AGENT', content: greeting },
      })
      await sendWhatsAppMessage(from, greeting, wamid, false)
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
          await sendWhatsAppMessage(from, stripMarkdown(reply), wamid, false)
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
          await sendWhatsAppMessage(from, stripMarkdown(reply), wamid, false)
          notifyJulian(from, `📅 ${patient.firstName} ${patient.lastName} wants to reschedule — replied to reminder: "${text.slice(0, 200)}". Sarah is handling rebooking.`).catch(() => {})
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
          await sendWhatsAppMessage(from, stripMarkdown(reply), wamid, false)
          notifyJulian(from, `❌ ${patient.firstName} ${patient.lastName} cancelled their appointment via reminder reply: "${text.slice(0, 200)}". Appointment marked CANCELLED.`).catch(() => {})
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
        await sendWhatsAppMessage(from, stripMarkdown(buttonResponse), undefined, false)
        return
      }
    }

    // ── 7. Get Sarah's reply from Claude ──────────────────────────────────────
    const agentReply = await getAgentReplyV2(conversation.id, from, text)

    // ── 7b. Rating detection ─────────────────────────────────────────────────
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
    // Short messages (< 5 words) get MISSED_CALL_FOLLOWUP; longer ones get
    // MORNING_FOLLOWUP. Only one entry per patient — checked across both modes
    // so rapid repeat messages can never produce duplicate morning send-outs.
    if (!isClinicOpen() && patient) {
      const wordCount = text.trim().split(/\s+/).filter(Boolean).length
      const mode      = wordCount < 5 ? 'MISSED_CALL_FOLLOWUP' : 'MORNING_FOLLOWUP'
      try {
        const existing = await prisma.outboundQueue.findFirst({
          where: {
            patientId:    patient.id,
            agentMode:    { in: ['MORNING_FOLLOWUP', 'MISSED_CALL_FOLLOWUP'] },
            status:       'PENDING',
            scheduledFor: { gt: new Date() },
          },
        })
        if (!existing) {
          await prisma.outboundQueue.create({
            data: {
              patientId:    patient.id,
              phoneNumber:  from,
              agentMode:    mode,
              reason:       mode === 'MISSED_CALL_FOLLOWUP'
                ? `Short after-hours message: "${text.slice(0, 100)}"`
                : `After-hours message: ${text.slice(0, 200)}`,
              scheduledFor: getNext8amUTC(),
              status:       'PENDING',
            },
          })
        }
      } catch (err: any) {
        console.error('[WhatsApp] After-hours queue error:', err.message)
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

    // ── 10. Deliver Sarah's reply ─────────────────────────────────────────────
    // Kenya number gets its own phone_number_id; Uganda (and all others) go through
    // sendWhatsAppMessage which now routes via Meta Cloud API directly.
    if (phoneNumberId === '1163288503545718') {
      await sendWhatsAppMessageDirect(from, stripMarkdown(agentReply), phoneNumberId, false)
    } else {
      await sendWhatsAppMessage(from, stripMarkdown(agentReply), wamid, false)
    }

  } catch (err) {
    console.error('[WhatsApp] processInbound error:', err)
  }
}

// Exported so schedulers (reminder, followup) can send outbound WhatsApp messages.
// Routes through Meta Cloud API directly. Throws on failure — callers must catch.
export async function sendWhatsAppMessage(to: string, body: string, _replyToMessageId?: string, logToConversation: boolean = true): Promise<string> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
  if (!phoneNumberId) throw new Error('Missing WHATSAPP_PHONE_NUMBER_ID env var')
  return sendWhatsAppMessageDirect(to, body, phoneNumberId, logToConversation)
}

// Direct Meta Cloud API send — used for numbers not provisioned on Africa's Talking.
// Sends from the given phoneNumberId using WHATSAPP_TOKEN. Zero AT involvement.
// Throws on any failure (Meta API error or network error) so callers can surface it.
export async function sendWhatsAppMessageDirect(to: string, body: string, phoneNumberId: string, logToConversation: boolean = true): Promise<string> {
  const token = process.env.WHATSAPP_TOKEN
  if (!token) throw new Error('Missing WHATSAPP_TOKEN env var')

  const normalizedTo = to.startsWith('+') ? to.slice(1) : to

  const res = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ messaging_product: 'whatsapp', to: normalizedTo, type: 'text', text: { body } }),
  })
  const json = await res.json() as {
    messages?: Array<{ id: string }>
    error?:    { message: string; code: number; error_subcode?: number }
  }

  // Meta can return HTTP 200 with an error object — treat this as a real failure
  if (json.error) {
    const detail = `#${json.error.code} ${json.error.message}`
    console.error(`[WhatsApp Direct] FAILED to +${normalizedTo}:`, detail)
    throw new Error(detail)
  }

  const msgId = json.messages?.[0]?.id ?? 'unknown'
  console.log(`[WhatsApp Direct] Sent to +${normalizedTo}: ${body.slice(0, 60)}… (msgId: ${msgId})`)
  logOutboundMessage(to, body, classifyMessage(body))
  if (logToConversation) logAgentMessageToConversation(to, body, msgId !== 'unknown' ? msgId : undefined)
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

// Fire-and-forget: create in-app notifications for RECEPTIONIST + ADMIN if this conversation
// is new OR has had no agent reply in the last hour (i.e. staff haven't attended to it).
export async function maybeNotifyStaff(
  conversationId: string,
  phone: string,
  displayName: string,
  channel: 'WHATSAPP' | 'FACEBOOK' | 'INSTAGRAM' | 'FACEBOOK_COMMENT' | 'INSTAGRAM_COMMENT',
  isNew: boolean,
): Promise<void> {
  try {
    let shouldNotify = isNew
    if (!shouldNotify) {
      const lastAgentMsg = await prisma.aiMessage.findFirst({
        where: { conversationId, role: 'AGENT' },
        orderBy: { createdAt: 'desc' },
      })
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
      shouldNotify = !lastAgentMsg || lastAgentMsg.createdAt < oneHourAgo
    }
    if (!shouldNotify) return

    const channelLabel = channel.charAt(0) + channel.slice(1).toLowerCase()
    const staff = await prisma.user.findMany({
      where: { role: { in: ['RECEPTIONIST', 'ADMIN'] }, isActive: true },
    })
    await Promise.all(
      staff.map(u => {
        const href = u.role === 'RECEPTIONIST'
          ? `/receptionist/ai-suite/inbox?phone=${encodeURIComponent(phone)}`
          : `/ai-suite/inbox?phone=${encodeURIComponent(phone)}`
        return prisma.notification.create({
          data: {
            userId: u.id,
            type:   'MESSAGE',
            title:  `New ${channelLabel} message`,
            body:   `Message from ${displayName !== phone ? displayName : phone} via ${channelLabel}`,
            href,
            isRead: false,
          },
        })
      })
    )
  } catch (e: any) {
    console.error('[Notify] maybeNotifyStaff failed:', e?.message)
  }
}

// Send a WhatsApp template message via Meta Cloud API directly.
// All cc_* templates are APPROVED in Meta. Callers must provide their own freeform
// fallback on throw — the throw-on-error contract is preserved from the old AT path.
export async function sendWhatsAppTemplate(
  to: string,
  templateName: string,
  params: string[],
  logToConversation: boolean = true,
  phoneNumberIdOverride?: string,
): Promise<void> {
  const token         = process.env.WHATSAPP_TOKEN
  const phoneNumberId = phoneNumberIdOverride ?? process.env.WHATSAPP_PHONE_NUMBER_ID
  if (!token || !phoneNumberId) {
    throw new Error('Missing WHATSAPP_TOKEN or WHATSAPP_PHONE_NUMBER_ID')
  }

  const normalizedTo = to.startsWith('+') ? to.slice(1) : to
  const components   = params.length > 0 ? [{
    type:       'body',
    parameters: params.map(p => ({ type: 'text', text: p })),
  }] : []

  const res = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      messaging_product: 'whatsapp',
      to:                normalizedTo,
      type:              'template',
      template:          { name: templateName, language: { code: 'en' }, components },
    }),
  })

  const json = await res.json() as {
    messages?: Array<{ id: string }>
    error?:    { message: string; code: number }
  }

  if (json.error) {
    const detail = `#${json.error.code} ${json.error.message}`
    console.error(`[WhatsApp] Template '${templateName}' failed:`, detail)
    throw new Error(detail)
  }

  const msgId = json.messages?.[0]?.id ?? null
  console.log(`[WhatsApp] Template '${templateName}' sent to +${normalizedTo} (wamid: ${msgId ?? 'unknown'})`)
  const logText = `[Template: ${templateName}] ${params.join(' | ')}`
  logOutboundMessage(to, logText, templateName)
  if (logToConversation) logAgentMessageToConversation(to, logText, msgId ?? undefined)
}
