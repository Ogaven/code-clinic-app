import { sendWhatsAppMessage } from '../whatsapp/whatsapp.service'
import { prisma } from '../../lib/prisma'

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
          `Hi ${p.firstName}! 😊 Your appointment has been confirmed:\n\n` +
          `📅 ${dayDate}\n` +
          `⏰ ${time}\n` +
          `👨‍⚕️ ${doc}\n` +
          `🦷 ${svc}\n` +
          `📍 Code Clinic, Kamwokya\n\n` +
          `Reply YES to confirm or NO to cancel.`
        break
      case 'rescheduled':
        message =
          `Hi ${p.firstName}! Your appointment has been rescheduled to:\n\n` +
          `📅 ${dayDate}\n` +
          `⏰ ${time}\n` +
          `👨‍⚕️ ${doc}\n\n` +
          `Reply YES to confirm or call 0741 087667.`
        break
      case 'cancelled':
        message =
          `Hi ${p.firstName}, your appointment on ${shortDate} has been cancelled. ` +
          `Reply to rebook anytime 😊`
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
