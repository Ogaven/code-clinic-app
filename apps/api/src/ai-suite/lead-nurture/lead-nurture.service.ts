import { sendWhatsAppMessage } from '../whatsapp/whatsapp.service'
import { prisma } from '../../lib/prisma'

// ── triggerLeadNurture ────────────────────────────────────────────────────────
// Called immediately when a quiz/scorecard form is submitted.
// Finds or creates the patient, opens a conversation, and sends the opening
// WhatsApp message.

export async function triggerLeadNurture(
  phone:      string,
  name:       string,
  quizTopic:  string,
  score?:     string,
): Promise<void> {
  const [firstName, ...rest] = name.trim().split(/\s+/)
  const lastName = rest.length > 0 ? rest.join(' ') : firstName

  let patient = await prisma.patient.findFirst({ where: { phone } })
  if (!patient) patient = await prisma.patient.create({ data: { phone, firstName, lastName } })

  let conversation = await prisma.aiConversation.findFirst({
    where:   { phoneNumber: phone, channel: 'WHATSAPP', status: 'ACTIVE' },
    orderBy: { createdAt: 'desc' },
  })
  if (!conversation) {
    conversation = await prisma.aiConversation.create({
      data: {
        patientId:    patient.id,
        channel:      'WHATSAPP',
        phoneNumber:  phone,
        status:       'ACTIVE',
        agentEnabled: true,
      },
    })
  }

  const message =
    `Hi ${firstName}! 👋 I saw you just completed our ${quizTopic} quiz at Code Clinic — great job! Based on your responses, I'd love to share some insights with you. Are you free to chat for a moment?`

  await sendWhatsAppMessage(phone, message)

  await prisma.aiMessage.create({
    data: { conversationId: conversation.id, role: 'AGENT', content: message },
  })

  await prisma.aiScheduledMessage.create({
    data: {
      patientId:    patient.id,
      channel:      'WHATSAPP',
      templateType: 'LEADNURTURE',
      scheduledFor: new Date(),
      sent:         true,
      content:      message,
    },
  })

  console.log(`[LeadNurture] Triggered for ${firstName} (${phone})`)
}

// ── scheduleFollowUpSequence ──────────────────────────────────────────────────
// Saves 3 follow-up AiScheduledMessage rows — the lead-nurture scheduler picks
// these up and sends them at the right time.

export async function scheduleFollowUpSequence(
  phone:     string,
  name:      string,
  quizTopic: string,
): Promise<void> {
  const patient = await prisma.patient.findFirst({ where: { phone } })
  if (!patient) {
    console.warn(`[LeadNurture] Patient not found for ${phone} — skipping follow-up schedule`)
    return
  }

  const [firstName] = name.trim().split(/\s+/)
  const now = Date.now()

  const sequence = [
    {
      delay:   24 * 60 * 60 * 1000,
      content: `Hi ${firstName}, just checking in — did you get a chance to look over the dental tips I shared? Any questions I can help with?`,
    },
    {
      delay:   48 * 60 * 60 * 1000,
      content: `Hey ${firstName}! 😊 Many of our patients who took the ${quizTopic} quiz found that a quick check-up helped them a lot. Would you like to book a visit?`,
    },
    {
      delay:   72 * 60 * 60 * 1000,
      content: `Hi ${firstName}, this is your last nudge from me — we'd love to see you at Code Clinic! Reply BOOK and I'll get you sorted right away 🦷`,
    },
  ]

  for (const msg of sequence) {
    await prisma.aiScheduledMessage.create({
      data: {
        patientId:    patient.id,
        channel:      'WHATSAPP',
        templateType: 'LEADNURTURE',
        scheduledFor: new Date(now + msg.delay),
        sent:         false,
        content:      msg.content,
      },
    })
  }

  console.log(`[LeadNurture] Scheduled 3 follow-ups for ${firstName} (${phone})`)
}
