import { sendWhatsAppMessage, sendWhatsAppTemplate } from '../whatsapp/whatsapp.service'
import { prisma } from '../../lib/prisma'
import { phoneVariants } from '../../utils/phone'

export type NotificationType = 'booked' | 'rescheduled' | 'cancelled' | 'reminder'

function toProperCase(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase()
}

export async function sendAppointmentNotification(
  appointmentId: string,
  type: NotificationType,
  notify: boolean = true,
): Promise<void> {
  if (!notify) {
    console.log(`[Notification] Skipping '${type}' for appointment ${appointmentId} — staff chose not to notify`)
    return
  }
  try {
    const appt = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        patient: {
          select: {
            firstName: true, lastName: true, phone: true,
            guardianId: true,
            guardian: { select: { firstName: true, lastName: true, phone: true } },
          },
        },
        doctor:  { include: { user: { select: { firstName: true, lastName: true } } } },
        service: { select: { name: true } },
      },
    })
    if (!appt) return

    const p = appt.patient

    // Route to guardian when patient has one
    const recipientPhone  = p.guardian?.phone  || p.phone
    const recipientName   = p.guardian ? `${toProperCase(p.guardian.firstName)} ${toProperCase(p.guardian.lastName)}` : null
    const patientName     = `${toProperCase(p.firstName)} ${toProperCase(p.lastName)}`

    const doc     = `Dr. ${appt.doctor.user.firstName} ${appt.doctor.user.lastName}`
    const dayDate = appt.startAt.toLocaleDateString('en-UG', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Nairobi',
    })
    const shortDate = appt.startAt.toLocaleDateString('en-UG', {
      weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Nairobi',
    })
    const time = appt.startAt.toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi',
    }).toLowerCase()
    const svc = appt.service.name

    // Greeting: "Hi Justine! 😊 This is regarding Hezekiah..." vs direct "Hi Hezekiah!"
    const greeting = recipientName
      ? `Hi ${recipientName}! 😊 This is regarding ${patientName}...`
      : `Hi ${toProperCase(p.firstName)}!`

    let message = ''
    switch (type) {
      case 'booked':
        message =
          `${greeting} ${recipientName ? 'Their' : 'Your'} appointment has been confirmed:\n\n` +
          `📅 ${dayDate}\n` +
          `⏰ ${time}\n` +
          `👨‍⚕️ ${doc}\n` +
          `🦷 ${svc}\n` +
          `📍 Code Clinic, Kamwokya\n\n` +
          `Reply YES to confirm or NO to cancel.`
        break
      case 'rescheduled':
        message =
          `${greeting} ${recipientName ? `${patientName}'s` : 'Your'} appointment has been rescheduled to:\n\n` +
          `📅 ${dayDate}\n` +
          `⏰ ${time}\n` +
          `👨‍⚕️ ${doc}\n\n` +
          `Reply YES to confirm or call +256 394 836 298.`
        break
      case 'cancelled':
        message =
          `${greeting} ${recipientName ? `${patientName}'s` : 'Your'} appointment on ${shortDate} has been cancelled. ` +
          `Reply to rebook anytime 😊`
        break
      case 'reminder':
        message =
          `${greeting} 👋 Just a reminder that ${recipientName ? patientName + ' has' : 'you have'} an appointment tomorrow:\n\n` +
          `📅 ${dayDate} at ${time}\n` +
          `👨‍⚕️ ${doc} — ${svc}\n` +
          `📍 Code Clinic, Kamwokya\n\n` +
          `Reply YES to confirm or NO if you need to reschedule.`
        break
    }

    if (!message) return
    if (!recipientPhone) {
      console.warn(`[Notification] Skipping '${type}' — patient ${p.firstName} ${p.lastName} has no phone number`)
      return
    }
    if (type === 'booked') {
      // Dedup: skip if a booking confirmation was already sent to this phone in the last 5 minutes.
      // Prevents double-sends from create+confirm happening in rapid succession.
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)
      const recentConfirm = await prisma.botMessageLog.findFirst({
        where: {
          recipientPhone:  { in: phoneVariants(recipientPhone) },
          templateType:    { in: ['cc_booking_confirmation', 'booking_confirmation'] },
          sentAt:          { gte: fiveMinutesAgo },
        },
      })
      if (recentConfirm) {
        console.log(`[Notification] Skipping 'booked' for ${patientName} — confirmation already sent within last 5 minutes`)
        return
      }
      const templateName = process.env.WA_TEMPLATE_BOOKING_CONFIRM_NAME
      const templateAddr = recipientName ? recipientName.split(' ')[0] : toProperCase(p.firstName)
      let templateSent = false
      if (templateName) {
        try {
          await sendWhatsAppTemplate(recipientPhone, templateName, [
            templateAddr, dayDate, time, svc, doc,
          ], false)
          templateSent = true
        } catch (tmplErr: any) {
          console.warn(`[Notification] Template '${templateName}' failed, falling back to freeform:`, tmplErr?.message)
        }
      }
      if (!templateSent) await sendWhatsAppMessage(recipientPhone, message)
    } else {
      // Dedup for rescheduled/cancelled: these go out freeform (not via a
      // distinctly-typed template), so classifyMessage() buckets them as generic
      // 'general_reply' in botMessageLog and the 'booked' dedup above never sees
      // them. Without this, a staff correction (reschedule the wrong slot, then
      // immediately fix it) or an accidental double status-change sends the same
      // "your appointment has been rescheduled/cancelled" message twice in a row.
      if (type === 'rescheduled' || type === 'cancelled') {
        const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000)
        const marker = type === 'rescheduled' ? 'has been rescheduled to' : 'has been cancelled'
        const recentSame = await prisma.botMessageLog.findFirst({
          where: {
            recipientPhone: { in: phoneVariants(recipientPhone) },
            messageBody:    { contains: marker },
            sentAt:         { gte: twoMinutesAgo },
          },
        })
        if (recentSame) {
          console.log(`[Notification] Skipping '${type}' for ${patientName} — same notification already sent within last 2 minutes`)
          return
        }
      }
      await sendWhatsAppMessage(recipientPhone, message)
    }
    const logTarget = recipientName
      ? `guardian ${recipientName} (${recipientPhone}) re: ${patientName}`
      : `${patientName} (${recipientPhone})`
    console.log(`[Notification] Sent '${type}' to ${logTarget}`)

    // Log to ai_messages so Sarah has full visibility of system-sent messages
    const conv = await prisma.aiConversation.findFirst({
      where: {
        phoneNumber: { in: phoneVariants(recipientPhone) },
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
