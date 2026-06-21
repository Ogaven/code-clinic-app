import { sendWhatsAppMessage } from '../whatsapp/whatsapp.service'
import { prisma } from '../../lib/prisma'

export type NotificationType = 'booked' | 'rescheduled' | 'cancelled' | 'reminder'

function toProperCase(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase()
}

export async function sendAppointmentNotification(
  appointmentId: string,
  type: NotificationType,
): Promise<void> {
  try {
    const appt = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        patient: { select: { firstName: true, lastName: true, phone: true } },
        doctor:  { include: { user: { select: { firstName: true, lastName: true } } } },
        service: { select: { name: true } },
      },
    })
    if (!appt) return

    const p       = appt.patient
    const doc     = `Dr. ${appt.doctor.user.firstName} ${appt.doctor.user.lastName}`
    const dayDate = appt.startAt.toLocaleDateString('en-UG', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Nairobi',
    })
    const shortDate = appt.startAt.toLocaleDateString('en-UG', {
      weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Nairobi',
    })
    const time = appt.startAt.toLocaleTimeString('en-UG', {
      hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi',
    })
    const svc = appt.service.name

    let message = ''
    switch (type) {
      case 'booked':
        message =
          `Hi ${toProperCase(p.firstName)}! 😊 Your appointment has been confirmed:\n\n` +
          `📅 ${dayDate}\n` +
          `⏰ ${time}\n` +
          `👨‍⚕️ ${doc}\n` +
          `🦷 ${svc}\n` +
          `📍 Code Clinic, Kamwokya\n\n` +
          `Reply YES to confirm or NO to cancel.`
        break
      case 'rescheduled':
        message =
          `Hi ${toProperCase(p.firstName)}! Your appointment has been rescheduled to:\n\n` +
          `📅 ${dayDate}\n` +
          `⏰ ${time}\n` +
          `👨‍⚕️ ${doc}\n\n` +
          `Reply YES to confirm or call +256 394 836 298.`
        break
      case 'cancelled':
        message =
          `Hi ${toProperCase(p.firstName)}, your appointment on ${shortDate} has been cancelled. ` +
          `Reply to rebook anytime 😊`
        break
      case 'reminder':
        message =
          `Hi ${toProperCase(p.firstName)}! 👋 Just a reminder that you have an appointment tomorrow:\n\n` +
          `📅 ${dayDate} at ${time}\n` +
          `👨‍⚕️ ${doc} — ${svc}\n` +
          `📍 Code Clinic, Kamwokya\n\n` +
          `Reply YES to confirm you'll be coming or NO if you need to reschedule.`
        break
    }

    if (!message) return
    if (!p.phone) {
      console.warn(`[Notification] Skipping '${type}' — patient ${p.firstName} ${p.lastName} has no phone number`)
      return
    }
    await sendWhatsAppMessage(p.phone, message)
    console.log(`[Notification] Sent '${type}' to ${p.firstName} ${p.lastName} (${p.phone})`)

    // Log to ai_messages so Sarah has full visibility of system-sent messages
    const rawPhone = p.phone.replace(/^\+/, '')
    const conv = await prisma.aiConversation.findFirst({
      where: {
        OR: [{ phoneNumber: p.phone }, { phoneNumber: rawPhone }],
        channel: 'WHATSAPP',
      },
      orderBy: { updatedAt: 'desc' },
    })
    if (conv) {
      await prisma.aiMessage.create({
        data: { conversationId: conv.id, role: 'AGENT', content: message },
      })
      await prisma.aiConversation.update({
        where: { id: conv.id },
        data: { updatedAt: new Date() },
      })
    }
  } catch (err: any) {
    const msg = err?.message ?? err?.errorMessage ?? (typeof err === 'string' ? err : JSON.stringify(err))
    console.error('[Notification] Failed to send notification:', msg)
  }
}
