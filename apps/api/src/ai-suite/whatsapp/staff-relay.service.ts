import Anthropic from '@anthropic-ai/sdk'
import { getAvailableSlots, createAppointment } from '../booking/booking.service'
import { sendWhatsAppMessage } from './whatsapp.service'
import { prisma } from '../../lib/prisma'

export const STAFF_NUMBER = '+256763430276'

export interface AlertMeta {
  alertMessageId: string | null
  patientPhone:   string
  patientName:    string
  concernSummary: string
}

async function findSoonestSlotToday(serviceId: string) {
  // daysAhead=1 scopes to the next 24 hours (today's remaining slots)
  const slots = await getAvailableSlots(serviceId, undefined, 1)
  if (slots.length === 0) return null
  return slots.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())[0]
}

export async function handleStaffReply(
  conversationId: string,
  staffMessage:   string,
  meta:           AlertMeta
): Promise<void> {
  const { patientPhone, patientName, concernSummary } = meta
  const firstName = patientName.split(' ')[0] || patientName

  const isGoAhead = /^(continue|go ahead|proceed|yes|emergency|book (them|him|her)|fit (them|him|her) in|squeeze (them|him|her) in|sort (them|him|her) out)/i.test(staffMessage.trim())

  console.log(`[StaffRelay] mode=${isGoAhead ? 'FAST_TRACK' : 'RELAY'} for ${patientPhone}, conv=${conversationId}`)

  if (isGoAhead) {
    // ── MODE 1: Fast-track booking ──────────────────────────────────────────

    // Find best service (prefer emergency/consultation, fall back to first active)
    const services = await prisma.service.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
    })
    const service = services.find(s => /emergency|consult/i.test(s.name)) ?? services[0]
    if (!service) {
      await sendWhatsAppMessage(STAFF_NUMBER, `No active services found — please book manually for ${firstName}.`)
      return
    }

    const slot = await findSoonestSlotToday(service.id)

    if (!slot) {
      await sendWhatsAppMessage(
        STAFF_NUMBER,
        `No slots left today for ${firstName} — want me to offer them the earliest slot tomorrow instead?`
      )
      return
    }

    // createAppointment handles patient lookup/creation from phone
    const localPhone = patientPhone.replace(/^\+256/, '0')
    const patient = await prisma.patient.findFirst({
      where: { OR: [{ phone: patientPhone }, { phone: localPhone }] },
    })

    await createAppointment(patient?.id ?? null, slot.doctorId, service.id, slot.startAt, patientPhone)

    const time        = new Date(slot.startAt).toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' })
    const drFirstName = slot.doctorName.replace(/^Dr\s+/, '').split(' ')[0]

    const patientMsg  = `Good news, ${firstName}! Our team can fit you in TODAY at ${time} with Dr ${drFirstName} 😊 Please come in as soon as you're able. We're at Code Clinic, Kiira Road, Kamwokya 📍`

    await sendWhatsAppMessage(patientPhone, patientMsg)
    await sendWhatsAppMessage(STAFF_NUMBER, `Booked ${firstName} in for ${time} today with Dr ${drFirstName} ✅`)

    await prisma.aiMessage.create({
      data: { conversationId, role: 'AGENT', content: patientMsg },
    })

  } else {
    // ── MODE 2: Relay staff guidance to patient in Sarah's voice ────────────

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      console.error('[StaffRelay] Missing ANTHROPIC_API_KEY')
      return
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
  }
}
