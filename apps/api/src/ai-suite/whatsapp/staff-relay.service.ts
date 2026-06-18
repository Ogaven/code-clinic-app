import Anthropic from '@anthropic-ai/sdk'
import { findSoonestAvailableSlot, createAppointment } from '../booking/booking.service'
import { clearBookingState } from '../booking/booking.state'
import { sendWhatsAppMessage } from './whatsapp.service'
import { prisma } from '../../lib/prisma'

export const STAFF_NUMBER = '+256763430276'

export interface AlertMeta {
  alertMessageId: string | null
  patientPhone:   string
  patientName:    string
  concernSummary: string
}

// Keywords that indicate a message is actual clinical/action guidance (not a meta-comment or ack)
const ACTION_KEYWORDS = [
  'tell them', 'let them know', 'let him know', 'let her know', 'pass on',
  'should', 'can use', 'can take', 'can come', 'is normal', 'not normal',
  'rinse', 'take ', 'apply', 'call us', 'call the', 'come in', 'come back',
  'come to', 'advise', 'recommend', 'give them', 'use ', 'avoid', 'stop ',
  "don't", 'do not', 'see them', 'see the', 'bring', 'ice ',
  'salt water', 'painkiller', 'ibuprofen', 'antibiotics',
  'nothing to worry', 'normal after', 'will go away', 'fine to',
  'okay to', 'appointment', 'schedule', 'rest', 'swelling',
  'bleeding', 'pain', 'treatment', 'medication', 'dose', 'tablet',
  'it should', 'go away', 'be fine', 'is fine', 'is ok', 'it will',
  'have them', 'ask them', 'no need to worry', 'inform them',
]

// Returns false for short acks, questions, or meta-comments that must not be relayed to patients.
function looksLikeActualAdvice(msg: string): boolean {
  const trimmed = msg.trim()
  const lower   = trimmed.toLowerCase()

  // Staff questions are never patient advice
  if (/^(which|who|what|where|when|how|is this|are they|can you|did they|have they|does)\b/i.test(trimmed)) return false
  if (trimmed.endsWith('?')) return false

  const wordCount = trimmed.split(/\s+/).filter(Boolean).length

  // Fewer than 3 words (e.g. "Okay", "Got it") — never relay
  if (wordCount < 3) return false

  // 3–11 words: only relay if it contains a clear action/clinical keyword
  if (wordCount < 12) {
    return ACTION_KEYWORDS.some(kw => lower.includes(kw))
  }

  // 12+ words: substantive enough to assume it's real guidance
  return true
}

export async function handleStaffReply(
  conversationId: string,
  staffMessage:   string,
  meta:           AlertMeta
): Promise<'BOOKED' | 'RELAYED' | 'NO_SLOTS' | 'AMBIGUOUS'> {
  const { patientPhone, patientName, concernSummary } = meta
  const firstName = patientName.split(' ')[0] || patientName

  const isDismissal = /\b(leave it|never mind|forget it|no need|not needed|sorted|disregard|no thanks|don'?t bother|just leave|cancel that|ignore it)\b/i.test(staffMessage.trim())
  if (isDismissal) {
    console.log(`[StaffRelay] Dismissal detected — not re-prompting`)
    await sendWhatsAppMessage(STAFF_NUMBER, `Got it, no problem! Let me know if anything comes up 😊`)
    return 'AMBIGUOUS'
  }

  const isGoAhead = /^(continue|go ahead|proceed|yes|emergency|book (them|him|her)|fit (them|him|her) in|squeeze (them|him|her) in|sort (them|him|her) out)/i.test(staffMessage.trim())

  console.log(`[StaffRelay] mode=${isGoAhead ? 'FAST_TRACK' : 'RELAY'} for ${patientPhone}, conv=${conversationId}`)

  if (isGoAhead) {
    // ── MODE 1: Fast-track booking ──────────────────────────────────────────

    const slot = await findSoonestAvailableSlot(1)

    if (!slot) {
      await sendWhatsAppMessage(
        STAFF_NUMBER,
        `No slots left today for ${firstName} — want me to offer them the earliest slot tomorrow instead?`
      )
      return 'NO_SLOTS'
    }

    const localPhone = patientPhone.replace(/^\+256/, '0')
    const patient = await prisma.patient.findFirst({
      where: { OR: [{ phone: patientPhone }, { phone: localPhone }] },
    })

    await createAppointment(patient?.id ?? null, slot.doctorId, slot.serviceId, slot.startAt, patientPhone)
    clearBookingState(patientPhone)

    const time        = new Date(slot.startAt).toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' })
    const drFirstName = slot.doctorName.replace(/^Dr\s+/, '').split(' ')[0]

    const patientMsg  = `Good news, ${firstName}! Our team can fit you in TODAY at ${time} with Dr ${drFirstName} 😊 Please come in as soon as you're able. We're at Code Clinic, Kiira Road, Kamwokya 📍`

    await sendWhatsAppMessage(patientPhone, patientMsg)
    await sendWhatsAppMessage(STAFF_NUMBER, `Booked ${firstName} in for ${time} today with Dr ${drFirstName} ✅`)

    await prisma.aiMessage.create({
      data: { conversationId, role: 'AGENT', content: patientMsg },
    })

    return 'BOOKED'

  } else {
    // ── MODE 2: Relay staff guidance to patient in Sarah's voice ────────────

    // Guard: only relay messages that look like actual clinical guidance.
    // Short acks, questions, and meta-comments must never be sent to patients.
    if (!looksLikeActualAdvice(staffMessage)) {
      console.log(`[StaffRelay] Ambiguous message from staff — asking for clarification, not relaying`)
      await sendWhatsAppMessage(
        STAFF_NUMBER,
        `Got it! Did you want me to pass something along to ${firstName}? Just send me the advice and I'll relay it in Sarah's voice, or reply "continue" to fast-track a booking 😊`
      )
      return 'AMBIGUOUS'
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      console.error('[StaffRelay] Missing ANTHROPIC_API_KEY')
      return 'RELAYED'
    }

    const anthropic = new Anthropic({ apiKey })
    const res = await anthropic.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 200,
      system:     'You are Sarah, a warm dental assistant at Code Clinic in Kampala. Write in plain conversational text only. No em dashes, no asterisks, no markdown.',
      messages: [{
        role:    'user',
        content: `Your colleague at the front desk just told you: "${staffMessage}" regarding a patient who said: "${concernSummary}". Relay this to the patient in your own warm words, as if you just checked with your colleague and came back with an answer. Keep it under 3 sentences.`,
      }],
    })

    const block     = res.content[0]
    const relayText = block?.type === 'text'
      ? block.text.trim()
      : `Hi ${firstName}, I just checked with my colleague — ${staffMessage}`

    await sendWhatsAppMessage(patientPhone, relayText)
    await prisma.aiMessage.create({
      data: { conversationId, role: 'AGENT', content: relayText },
    })
    await sendWhatsAppMessage(STAFF_NUMBER, `Got it, I've let ${firstName} know 😊`)

    return 'RELAYED'
  }
}
