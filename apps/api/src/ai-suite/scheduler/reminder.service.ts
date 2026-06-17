import { sendWhatsAppMessage, sendWhatsAppTemplate } from '../whatsapp/whatsapp.service'
import { prisma } from '../../lib/prisma'
import { getGreetingName, isMinor, normalizeRelation } from '../../utils/nameHelper'

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
      patient: { select: { id: true, firstName: true, lastName: true, phone: true, dob: true, nextOfKinName: true, nextOfKinRelation: true } },
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

    // ── Build message ─────────────────────────────────────────────────────────
    const channel = 'WHATSAPP'
    const time = appt.startAt.toLocaleTimeString('en-UG', {
      hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi',
    })
    const dayDate = appt.startAt.toLocaleDateString('en-UG', {
      weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Nairobi',
    })
    const doctor        = `Dr ${appt.doctor.user.firstName}`
    const greetName     = getGreetingName(patient)
    const minor         = isMinor(patient.dob)
    const guardianName  = minor && patient.nextOfKinName
      ? getGreetingName({ firstName: patient.nextOfKinName, lastName: '' })
      : null
    const relation      = normalizeRelation(patient.nextOfKinRelation)

    let message: string
    let templateAddr: string
    if (minor && guardianName) {
      templateAddr = guardianName
      message =
        `Hi ${guardianName}! 😊 This is Sarah from Code Clinic, just a friendly reminder that ${greetName}'s appointment is tomorrow:\n\n` +
        `📅 ${dayDate} at ${time}\n` +
        `👨‍⚕️ with ${doctor} for ${appt.service.name}\n` +
        `📍 Code Clinic, Kamwokya.\n\n` +
        `Reply YES to confirm or NO if you'd like to reschedule.`
    } else if (minor) {
      templateAddr = greetName
      message =
        `Hi there! 😊 This is Sarah from Code Clinic, just confirming ${greetName}'s appointment tomorrow:\n\n` +
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
          await sendWhatsAppTemplate(patient.phone, templateName, [
            templateAddr,
            dayDate,
            time,
            appt.service.name,
            doctor,
          ])
        } catch {
          await sendWhatsAppMessage(patient.phone, message)
        }
      } else {
        await sendWhatsAppMessage(patient.phone, message)
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
      patient: { select: { id: true, firstName: true, lastName: true, phone: true, dob: true, nextOfKinName: true } },
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

    const minor1h    = isMinor(pat1h.dob)
    const name1h     = getGreetingName(pat1h)
    const guardian1h = minor1h && pat1h.nextOfKinName
      ? getGreetingName({ firstName: pat1h.nextOfKinName, lastName: '' })
      : null
    const addressee1h = guardian1h ?? name1h
    const doc1h       = `Dr ${appt1h.doctor.user.firstName}`
    const msg1h       = minor1h
      ? `Hi ${addressee1h}! Just a friendly reminder that ${name1h}'s appointment with ${doc1h} is in 1 hour 😊 See you soon!`
      : `Hi ${name1h}! Just a friendly reminder that your appointment with ${doc1h} is in 1 hour 😊 See you soon!`

    try {
      await sendWhatsAppMessage(pat1h.phone, msg1h)
    } catch (err: any) {
      console.error(`[Reminder 1h] Send failed for ${pat1h.phone}:`, err.message ?? err)
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
