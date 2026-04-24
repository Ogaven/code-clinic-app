import { PrismaClient } from '@prisma/client'
import { sendWhatsAppMessage } from '../whatsapp/whatsapp.service'
import { sendSMS } from '../sms/sms.service'

const prisma = new PrismaClient()

// ── checkAndSendFollowups ─────────────────────────────────────────────────────
// Runs every hour. Finds COMPLETED appointments from 23–25 hours ago and sends a
// warm post-visit follow-up message if one hasn't been sent yet.

export async function checkAndSendFollowups(): Promise<void> {
  const now         = new Date()
  const windowStart = new Date(now.getTime() - 25 * 60 * 60 * 1000)
  const windowEnd   = new Date(now.getTime() - 23 * 60 * 60 * 1000)

  const appointments = await prisma.appointment.findMany({
    where: {
      startAt: { gte: windowStart, lte: windowEnd },
      status:  'COMPLETED',
    },
    include: {
      patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
      doctor:  { include: { user: { select: { firstName: true, lastName: true } } } },
      service: { select: { name: true } },
    },
  })

  if (appointments.length === 0) return

  console.log(`[Followup] Checking ${appointments.length} completed appointment(s)`)

  for (const appt of appointments) {
    const patient = appt.patient

    // ── Dedup: same ±2h window around appointment.startAt ────────────────────
    const alreadySent = await prisma.aiScheduledMessage.findFirst({
      where: {
        patientId:    patient.id,
        templateType: 'FOLLOWUP',
        sent:         true,
        scheduledFor: {
          gte: new Date(appt.startAt.getTime() - 2 * 60 * 60 * 1000),
          lte: new Date(appt.startAt.getTime() + 2 * 60 * 60 * 1000),
        },
      },
    })
    if (alreadySent) continue

    // ── Determine channel ─────────────────────────────────────────────────────
    const whatsappConv = await prisma.aiConversation.findFirst({
      where: { phoneNumber: patient.phone, channel: 'WHATSAPP' },
    })
    const channel = whatsappConv ? 'WHATSAPP' : 'SMS'

    // ── Build message ─────────────────────────────────────────────────────────
    const doctor  = `Dr ${appt.doctor.user.firstName} ${appt.doctor.user.lastName}`
    const message =
      `Hi ${patient.firstName}! 😊 Hope you're feeling well after your visit yesterday with ${doctor}. How are you doing? Are you following the instructions given? Feel free to reply if you have any questions — we're always here for you.\n\nSarah — Code Clinic`

    // ── Send ──────────────────────────────────────────────────────────────────
    try {
      if (channel === 'WHATSAPP') {
        await sendWhatsAppMessage(patient.phone, message)
      } else {
        await sendSMS(patient.phone, message)
      }
    } catch (err: any) {
      console.error(`[Followup] Send failed for ${patient.phone}:`, err.message ?? err)
      continue
    }

    // ── Persist AiScheduledMessage record ─────────────────────────────────────
    await prisma.aiScheduledMessage.create({
      data: {
        patientId:    patient.id,
        channel,
        templateType: 'FOLLOWUP',
        scheduledFor: appt.startAt,
        sent:         true,
        content:      message,
      },
    })

    // ── Link to conversation ──────────────────────────────────────────────────
    let conv = await prisma.aiConversation.findFirst({
      where:   { phoneNumber: patient.phone, channel, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    })
    if (!conv) {
      conv = await prisma.aiConversation.create({
        data: {
          patientId:    patient.id,
          channel,
          phoneNumber:  patient.phone,
          status:       'ACTIVE',
          agentEnabled: true,
        },
      })
    }
    await prisma.aiMessage.create({
      data: {
        conversationId: conv.id,
        role:           'AGENT',
        content:        message,
      },
    })

    console.log(
      `[Followup] Sent to ${patient.firstName} ${patient.lastName} (${patient.phone}) via ${channel}`
    )
  }
}
