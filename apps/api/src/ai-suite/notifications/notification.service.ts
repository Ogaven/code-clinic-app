import { PrismaClient } from '@prisma/client'
import { sendWhatsAppMessage } from '../whatsapp/whatsapp.service'

const prisma = new PrismaClient()

export type NotificationType = 'booked' | 'rescheduled' | 'cancelled' | 'reminder'

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
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Kampala',
    })
    const shortDate = appt.startAt.toLocaleDateString('en-UG', {
      weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Kampala',
    })
    const time = appt.startAt.toLocaleTimeString('en-UG', {
      hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Kampala',
    })
    const svc = appt.service.name

    let message = ''
    switch (type) {
      case 'booked':
        message =
          `Hi ${p.firstName}! 😊 Your appointment has been confirmed:\n\n` +
          `📅 Date: ${dayDate}\n` +
          `⏰ Time: ${time}\n` +
          `👨‍⚕️ Doctor: ${doc}\n` +
          `🦷 Service: ${svc}\n` +
          `📍 Code Clinic, Old Kira Road, Kamwokya\n\n` +
          `Reply CONFIRM to confirm or CANCEL to cancel. See you soon!`
        break
      case 'rescheduled':
        message =
          `Hi ${p.firstName}! Your appointment has been rescheduled:\n\n` +
          `📅 New Date: ${dayDate}\n` +
          `⏰ New Time: ${time}\n` +
          `👨‍⚕️ Doctor: ${doc}\n` +
          `🦷 Service: ${svc}\n\n` +
          `Reply CONFIRM to confirm this new time or call us at 0741 087667 if you need to discuss.`
        break
      case 'cancelled':
        message =
          `Hi ${p.firstName}, your appointment on ${shortDate} at ${time} with ${doc} has been cancelled.\n\n` +
          `If this was a mistake or you'd like to rebook, just reply here and we'll sort it out for you 😊`
        break
      case 'reminder':
        message =
          `Hi ${p.firstName}! 👋 Just a reminder that you have an appointment tomorrow:\n\n` +
          `📅 ${dayDate} at ${time}\n` +
          `👨‍⚕️ ${doc} — ${svc}\n` +
          `📍 Code Clinic, Kamwokya\n\n` +
          `Reply YES to confirm you'll be coming or NO if you need to reschedule.`
        break
    }

    if (!message) return
    await sendWhatsAppMessage(p.phone, message)
    console.log(`[Notification] Sent '${type}' to ${p.firstName} ${p.lastName} (${p.phone})`)
  } catch (err: any) {
    console.error('[Notification] Failed to send notification:', err.message)
  }
}
