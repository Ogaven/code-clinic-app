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

export async function handleStaffReply(
  conversationId: string,
  staffMessage:   string,
  meta:           AlertMeta
): Promise<'BOOKED' | 'RELAYED' | 'NO_SLOTS'> {
  const { patientPhone, patientName, concernSummary } = meta
  const firstName = patientName.split(' ')[0] || patientName

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
