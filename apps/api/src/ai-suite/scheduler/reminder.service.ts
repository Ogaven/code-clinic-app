import { sendWhatsAppMessage, sendWhatsAppTemplate } from '../whatsapp/whatsapp.service'
import { prisma } from '../../lib/prisma'
import { getGreetingName, guardianTitle, normalizeRelation } from '../../utils/nameHelper'
import { resolveOutboundRecipient, alertStaffMinorNoGuardian, hasOutboundConsent } from './guardian-routing.service'
import { notifyJulian } from '../../services/agent/guards/escalation'

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
      patient: { isActive: true },
    },
    include: {
      patient: { select: { id: true, firstName: true, lastName: true, phone: true, dob: true, nextOfKinName: true, nextOfKinRelation: true, guardianId: true, familyAccountId: true, guardian: { select: { phone: true } } } },
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

    if (!(await hasOutboundConsent(patient.id))) {
      console.log(`[Reminder] Skipping ${patient.firstName} — opted out of bot communications`)
      continue
    }

    // ── Resolve recipient (guardian routing for minors) ───────────────────────
    const channel   = 'WHATSAPP'
    const greetName = getGreetingName(patient)
    const routing   = await resolveOutboundRecipient(patient, greetName)
    if (!routing.ok) {
      console.warn(`[Reminder] Skipping ${patient.firstName} — minor with no active guardian`)
      await alertStaffMinorNoGuardian(`${patient.firstName} ${patient.lastName}`, 'reminder')
      continue
    }
    const { phone: recipientPhone, name: recipientName, isGuardian } = routing.recipient

    // ── Build message ─────────────────────────────────────────────────────────
    const time = appt.startAt.toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi',
    }).toLowerCase()
    const dayDate = appt.startAt.toLocaleDateString('en-UG', {
      weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Nairobi',
    })
    const doctor   = `Dr ${appt.doctor.user.firstName}`
    const relation = normalizeRelation(patient.nextOfKinRelation)

    let message: string
    let templateAddr: string
    if (isGuardian) {
      const title = guardianTitle(routing.recipient.relation, recipientName)
      templateAddr = title
      message =
        `Hi ${title}! 😊 This is Sarah from Code Clinic, just a friendly reminder that ${greetName}'s appointment is tomorrow:\n\n` +
        `📅 ${dayDate} at ${time}\n` +
        `👨‍⚕️ with ${doctor} for ${appt.service.name}\n` +
        `📍 Code Clinic, Kamwokya.\n\n` +
        `Reply YES to confirm or NO if you'd like to reschedule.`
    } else {
      templateAddr = greetName
      message =
        `Hi ${greetName}! 😊 This is Sarah from Code Clinic, just a friendly reminder that your appointment is tomorrow:\n\n` +
        `📅 ${dayDate} at ${time}\n` +
        `👨‍⚕️ with ${doctor} for ${appt.service.name}\n` +
        `📍 Code Clinic, Kamwokya.\n\n` +
        `Reply YES to confirm or NO if you'd like to reschedule.`
    }

    // ── Send ──────────────────────────────────────────────────────────────────
    try {
      const templateName = process.env.WA_TEMPLATE_REMINDER_NAME
      if (templateName) {
        try {
          await sendWhatsAppTemplate(recipientPhone, templateName, [
            templateAddr,
            dayDate,
            time,
            appt.service.name,
            doctor,
          ], false)
        } catch {
          await sendWhatsAppMessage(recipientPhone, message)
        }
      } else {
        await sendWhatsAppMessage(recipientPhone, message)
      }
    } catch (err: any) {
      console.error(`[Reminder] Send failed for ${recipientPhone}:`, err.message ?? err)
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

  // ── 1-hour reminder ───────────────────────────────────────────────────────
  const window1hStart = new Date(now.getTime() + 55 * 60 * 1000)
  const window1hEnd   = new Date(now.getTime() + 65 * 60 * 1000)

  const appointments1h = await prisma.appointment.findMany({
    where: {
      startAt: { gte: window1hStart, lte: window1hEnd },
      status:  { in: ['CONFIRMED', 'PENDING'] },
      patient: { isActive: true },
    },
    include: {
      patient: { select: { id: true, firstName: true, lastName: true, phone: true, dob: true, nextOfKinName: true, guardianId: true, familyAccountId: true, guardian: { select: { phone: true } } } },
      doctor:  { include: { user: { select: { firstName: true } } } },
    },
  })

  for (const appt1h of appointments1h) {
    const pat1h = appt1h.patient
    const alreadySent1h = await prisma.aiScheduledMessage.findFirst({
      where: {
        patientId:    pat1h.id,
        templateType: 'REMINDER_1H',
        sent:         true,
        scheduledFor: {
          gte: new Date(appt1h.startAt.getTime() - 30 * 60 * 1000),
          lte: new Date(appt1h.startAt.getTime() + 30 * 60 * 1000),
        },
      },
    })
    if (alreadySent1h) continue

    if (!(await hasOutboundConsent(pat1h.id))) {
      console.log(`[Reminder 1h] Skipping ${pat1h.firstName} — opted out of bot communications`)
      continue
    }

    const name1h     = getGreetingName(pat1h)
    const routing1h  = await resolveOutboundRecipient(pat1h, name1h)
    if (!routing1h.ok) {
      console.warn(`[Reminder 1h] Skipping ${pat1h.firstName} — minor with no active guardian`)
      await alertStaffMinorNoGuardian(`${pat1h.firstName} ${pat1h.lastName}`, '1-hour reminder')
      continue
    }
    const { phone: recipientPhone1h, name: addr1h, isGuardian: isGuardian1h } = routing1h.recipient
    const doc1h    = `Dr ${appt1h.doctor.user.firstName}`
    const title1h  = isGuardian1h ? guardianTitle(routing1h.recipient.relation, addr1h) : addr1h
    const msg1h    = isGuardian1h
      ? `Hi ${title1h}! Just a friendly reminder that ${name1h}'s appointment with ${doc1h} is in 1 hour 😊 See you soon!`
      : `Hi ${name1h}! Just a friendly reminder that your appointment with ${doc1h} is in 1 hour 😊 See you soon!`
    try {
      await sendWhatsAppMessage(recipientPhone1h, msg1h)
    } catch (err: any) {
      console.error(`[Reminder 1h] Send failed for ${recipientPhone1h}:`, err.message ?? err)
      continue
    }

    await prisma.aiScheduledMessage.create({
      data: {
        patientId:    pat1h.id,
        channel:      'WHATSAPP',
        templateType: 'REMINDER_1H',
        scheduledFor: appt1h.startAt,
        sent:         true,
        content:      msg1h,
      },
    })

    let conv1h = await prisma.aiConversation.findFirst({
      where:   { phoneNumber: pat1h.phone, channel: 'WHATSAPP', status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    })
    if (!conv1h) {
      conv1h = await prisma.aiConversation.create({
        data: { patientId: pat1h.id, channel: 'WHATSAPP', phoneNumber: pat1h.phone, status: 'ACTIVE', agentEnabled: true },
      })
    }
    await prisma.aiMessage.create({
      data: { conversationId: conv1h.id, role: 'AGENT', content: msg1h },
    })

    console.log(`[Reminder 1h] Sent to ${pat1h.firstName} ${pat1h.lastName} (${pat1h.phone})`)
  }
}

// ── checkAndAlertNoResponders ─────────────────────────────────────────────────
// Runs every hour. For appointments starting 2–4 hours from now where a 24h
// reminder was sent but the patient never replied — alert Julian once per slot.

export async function checkAndAlertNoResponders(): Promise<void> {
  const now        = new Date()
  const window2h   = new Date(now.getTime() + 2 * 60 * 60 * 1000)
  const window4h   = new Date(now.getTime() + 4 * 60 * 60 * 1000)

  const appointments = await prisma.appointment.findMany({
    where: {
      startAt: { gte: window2h, lte: window4h },
      status:  { in: ['CONFIRMED', 'PENDING'] },
      patient: { isActive: true },
    },
    include: {
      patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
      doctor:  { include: { user: { select: { firstName: true } } } },
    },
  })

  if (appointments.length === 0) return

  console.log(`[NoShowAlert] Checking ${appointments.length} appointment(s) in the 2–4h window`)

  for (const appt of appointments) {
    const patient = appt.patient

    // Was a 24h REMINDER sent for this appointment?
    const reminder = await prisma.aiScheduledMessage.findFirst({
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
    if (!reminder) continue

    // Already alerted Julian for this slot?
    const alreadyAlerted = await prisma.aiScheduledMessage.findFirst({
      where: {
        patientId:    patient.id,
        templateType: 'NOSHOW_ALERT',
        scheduledFor: {
          gte: new Date(appt.startAt.getTime() - 2 * 60 * 60 * 1000),
          lte: new Date(appt.startAt.getTime() + 2 * 60 * 60 * 1000),
        },
      },
    })
    if (alreadyAlerted) continue

    // Did the patient reply after the reminder was sent?
    const conv = await prisma.aiConversation.findFirst({
      where:   { phoneNumber: patient.phone, channel: 'WHATSAPP' },
      orderBy: { createdAt: 'desc' },
    })
    if (conv) {
      const patientReply = await prisma.aiMessage.findFirst({
        where: {
          conversationId: conv.id,
          role:           'USER',
          createdAt:      { gte: reminder.createdAt },
        },
      })
      if (patientReply) continue
    }

    const time = appt.startAt.toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi',
    }).toLowerCase()
    const doctor = `Dr ${appt.doctor.user.firstName}`

    await notifyJulian(
      patient.phone,
      `📵 No response to reminder — ${patient.firstName} ${patient.lastName} (${patient.phone}) has not confirmed their appointment today at ${time} with ${doctor}. Please call to confirm.`
    )

    await prisma.aiScheduledMessage.create({
      data: {
        patientId:    patient.id,
        channel:      'WHATSAPP',
        templateType: 'NOSHOW_ALERT',
        scheduledFor: appt.startAt,
        sent:         true,
        content:      `No-response alert sent to Julian — ${patient.firstName} at ${time} with ${doctor}`,
      },
    })

    console.log(`[NoShowAlert] Alerted Julian — ${patient.firstName} ${patient.lastName} at ${time} with ${doctor}`)
  }
}
