import { PrismaClient } from '@prisma/client'
import { sendWhatsAppMessage } from '../whatsapp/whatsapp.service'
import { sendSMS } from '../sms/sms.service'

const prisma = new PrismaClient()

// ── checkAndSendReminders ─────────────────────────────────────────────────────
// Runs every hour. Finds appointments starting 23–25 hours from now and sends a
// "tomorrow reminder" via WhatsApp (preferred) or SMS if the patient hasn't had
// one yet for that appointment slot.

export async function checkAndSendReminders(): Promise<void> {
  const now         = new Date()
  const windowStart = new Date(now.getTime() + 23 * 60 * 60 * 1000)
  const windowEnd   = new Date(now.getTime() + 25 * 60 * 60 * 1000)

  const appointments = await prisma.appointment.findMany({
    where: {
      startAt: { gte: windowStart, lte: windowEnd },
      status:  { in: ['CONFIRMED', 'PENDING'] },
    },
    include: {
      patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
      doctor:  { include: { user: { select: { firstName: true, lastName: true } } } },
      service: { select: { name: true } },
    },
  })

  if (appointments.length === 0) return

  console.log(`[Reminder] Checking ${appointments.length} appointment(s) in the 24h window`)

  for (const appt of appointments) {
    const patient = appt.patient

    // ── Dedup: has a reminder already been sent for this specific appointment? ─
    // We use scheduledFor ≈ appointment.startAt (±2h) as the dedup key since
    // AiScheduledMessage has no appointmentId column.
    const alreadySent = await prisma.aiScheduledMessage.findFirst({
      where: {
        patientId:    patient.id,
        templateType: 'REMINDER',
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
    const time = appt.startAt.toLocaleTimeString('en-UG', {
      hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi',
    })
    const dayDate = appt.startAt.toLocaleDateString('en-UG', {
      weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Nairobi',
    })
    const doctor  = `Dr. ${appt.doctor.user.firstName} ${appt.doctor.user.lastName}`
    const message =
      `Hi ${patient.firstName}! 👋 Just a reminder that you have an appointment tomorrow:\n\n` +
      `📅 ${dayDate} at ${time}\n` +
      `👨‍⚕️ ${doctor} — ${appt.service.name}\n` +
      `📍 Code Clinic, Kamwokya\n\n` +
      `Reply YES to confirm you'll be coming or NO if you need to reschedule.`

    // ── Send ──────────────────────────────────────────────────────────────────
    try {
      if (channel === 'WHATSAPP') {
        await sendWhatsAppMessage(patient.phone, message)
      } else {
        await sendSMS(patient.phone, message)
      }
    } catch (err: any) {
      console.error(`[Reminder] Send failed for ${patient.phone}:`, err.message ?? err)
      continue
    }

    // ── Persist AiScheduledMessage record ─────────────────────────────────────
    await prisma.aiScheduledMessage.create({
      data: {
        patientId:    patient.id,
        channel,
        templateType: 'REMINDER',
        scheduledFor: appt.startAt,
        sent:         true,
        content:      message,
      },
    })

    // ── Link to conversation so staff can see it in inbox ────────────────────
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
      `[Reminder] Sent to ${patient.firstName} ${patient.lastName} (${patient.phone}) via ${channel}`
    )
  }
}
