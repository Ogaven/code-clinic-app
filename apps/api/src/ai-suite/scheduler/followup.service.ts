import { sendWhatsAppMessage, sendWhatsAppTemplate } from '../whatsapp/whatsapp.service'
import { sendSMS } from '../sms/sms.service'
import { prisma } from '../../lib/prisma'

// EAT hour helper (UTC+3)
function eatHour(): number {
  return parseInt(
    new Date().toLocaleTimeString('en-US', { hour: 'numeric', hour12: false, timeZone: 'Africa/Nairobi' })
  )
}

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

// ── processAfterHoursQueue ────────────────────────────────────────────────────
// Runs every hour. Finds MORNING_FOLLOWUP entries scheduled for <= now and sends
// a warm "good morning" check-in to patients who messaged after hours.

export async function processAfterHoursQueue(): Promise<void> {
  const now = new Date()

  const entries = await prisma.outboundQueue.findMany({
    where: {
      agentMode:    { in: ['MORNING_FOLLOWUP', 'MISSED_CALL_FOLLOWUP'] },
      status:       'PENDING',
      scheduledFor: { lte: now },
    },
    include: {
      patient: { select: { id: true, firstName: true, phone: true } },
    },
    take: 50,
  })

  if (entries.length === 0) return
  console.log(`[AfterHoursQueue] Processing ${entries.length} morning follow-up(s)`)

  for (const entry of entries) {
    const name = entry.patient?.firstName || 'there'

    let templateName: string | undefined
    let message: string

    if (entry.agentMode === 'MISSED_CALL_FOLLOWUP') {
      templateName = process.env.WA_TEMPLATE_MISSED_CALL_NAME || 'cc_missed_call_followup'
      message = `Hi ${name}! 😊 We're now open at Code Clinic. We noticed your message last night — how can we help you today?`
    } else {
      templateName = process.env.WA_TEMPLATE_AFTER_HOURS_NAME
      message = `Good morning ${name}! 😊 Code Clinic is now open. You messaged us last night — how can we help you today?`
    }

    try {
      if (templateName) {
        try {
          await sendWhatsAppTemplate(entry.phoneNumber, templateName, [name])
        } catch {
          await sendWhatsAppMessage(entry.phoneNumber, message)
        }
      } else {
        await sendWhatsAppMessage(entry.phoneNumber, message)
      }
      await prisma.outboundQueue.update({
        where: { id: entry.id },
        data:  { status: 'COMPLETED', outcome: 'Morning follow-up sent', lastAttempted: now },
      })
      console.log(`[AfterHoursQueue] Sent morning follow-up to ${entry.phoneNumber}`)
    } catch (err: any) {
      console.error(`[AfterHoursQueue] Send failed for ${entry.phoneNumber}:`, err.message)
      await prisma.outboundQueue.update({
        where: { id: entry.id },
        data:  { attempts: { increment: 1 }, lastAttempted: now },
      })
    }
  }
}

// ── checkAndSendPostAppointmentFollowups ──────────────────────────────────────
// Runs every hour between 8–9 AM EAT. Finds appointments from yesterday that
// are COMPLETED/CONFIRMED (not cancelled, not no-show) and haven't been followed
// up yet. Sends personalised post-appointment check-in via WhatsApp template or
// plain text, injects doctor notes as SYSTEM context, marks followUpSent = true.

export async function checkAndSendPostAppointmentFollowups(): Promise<void> {
  // Only run between 8 AM and 9 AM EAT (UTC+3 = 5–6 AM UTC)
  const nowUTC = new Date()
  const eatHour = parseInt(
    nowUTC.toLocaleTimeString('en-US', { hour: 'numeric', hour12: false, timeZone: 'Africa/Nairobi' })
  )
  if (eatHour < 8 || eatHour >= 9) return

  const yesterday = new Date(nowUTC)
  yesterday.setDate(yesterday.getDate() - 1)
  const startOfYesterday = new Date(yesterday.toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' }) + 'T00:00:00+03:00')
  const endOfYesterday   = new Date(yesterday.toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' }) + 'T23:59:59+03:00')

  let appointments: any[]
  try {
    appointments = await prisma.appointment.findMany({
      where: {
        startAt:      { gte: startOfYesterday, lte: endOfYesterday },
        status:       { in: ['COMPLETED', 'CONFIRMED'] },
        followUpSent: false,
      },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
        doctor:  { include: { user: { select: { firstName: true, lastName: true } } } },
        service: { select: { name: true } },
      },
    })
  } catch (err: any) {
    console.error('[PostApptFollowup] Query failed (followUpSent field may need migration):', err.message)
    return
  }

  if (appointments.length === 0) return
  console.log(`[PostApptFollowup] Processing ${appointments.length} post-appointment follow-up(s)`)

  for (const appt of appointments) {
    const patient     = appt.patient
    const doctorName  = `Dr ${appt.doctor.user.firstName} ${appt.doctor.user.lastName}`
    const procedure   = (appt.service?.name || 'your appointment').toLowerCase()
    const patientName = patient.firstName || 'there'

    try {
      // ── Send template or fall back to plain text ───────────────────────────
      const templateName = process.env.WA_TEMPLATE_POST_APPT_NAME
      const plainMsg = `Good morning ${patientName}! 😊 This is Sarah from Code Clinic. You had your ${procedure} with ${doctorName} yesterday — how are you feeling today?`

      if (templateName) {
        try {
          await sendWhatsAppTemplate(patient.phone, templateName, [patientName, procedure, doctorName])
        } catch {
          await sendWhatsAppMessage(patient.phone, plainMsg)
        }
      } else {
        await sendWhatsAppMessage(patient.phone, plainMsg)
      }

      // ── Inject appointment context into conversation so Sarah can use it ───
      if (appt.notes) {
        let conv = await prisma.aiConversation.findFirst({
          where: { phoneNumber: patient.phone, channel: 'WHATSAPP', status: 'ACTIVE' },
          orderBy: { createdAt: 'desc' },
        })
        if (!conv) {
          conv = await prisma.aiConversation.create({
            data: { patientId: patient.id, channel: 'WHATSAPP', phoneNumber: patient.phone, status: 'ACTIVE', agentEnabled: true },
          })
        }
        await prisma.aiMessage.create({
          data: {
            conversationId: conv.id,
            role:    'SYSTEM',
            content: `[POST-APPOINTMENT CONTEXT] Patient had ${procedure} with ${doctorName} yesterday. Doctor notes: ${appt.notes}. Use this context to follow up naturally and answer recovery questions.`,
          },
        })
      }

      // ── Mark as followed up ────────────────────────────────────────────────
      await prisma.appointment.update({
        where: { id: appt.id },
        data:  { followUpSent: true },
      })

      console.log(`[PostApptFollowup] Sent to ${patient.firstName} ${patient.lastName} (${patient.phone})`)
    } catch (err: any) {
      console.error(`[PostApptFollowup] Failed for appointment ${appt.id}:`, err.message)
    }
  }
}

// ── checkAndSendMissedCallFollowups ───────────────────────────────────────────
// Runs every 30 min. Finds voice agent calls < 10s in the last 30 min where the
// caller has not booked, and sends the cc_missed_call_followup template.

export async function checkAndSendMissedCallFollowups(): Promise<void> {
  const now         = new Date()
  const windowStart = new Date(now.getTime() - 35 * 60 * 1000)  // 35 min window (5 min buffer)

  let shortCalls: any[]
  try {
    shortCalls = await prisma.agentLog.findMany({
      where: {
        channel:    'VOICE',
        callSid:    { not: null },
        durationSec: { lt: 10, not: null },
        patientId:  { not: null },
        createdAt:  { gte: windowStart },
      },
      include: {
        patient: { select: { id: true, firstName: true, phone: true } },
      },
      take: 50,
    })
  } catch (err: any) {
    console.error('[MissedCallFollowup] Query failed:', err.message)
    return
  }

  if (shortCalls.length === 0) return
  console.log(`[MissedCallFollowup] Found ${shortCalls.length} short call(s)`)

  for (const call of shortCalls) {
    const patient = call.patient
    if (!patient?.phone) continue

    // Dedup: already sent a missed call followup for this patient in last 24h
    const alreadySent = await prisma.aiScheduledMessage.findFirst({
      where: {
        patientId:    patient.id,
        templateType: 'MISSED_CALL',
        sent:         true,
        scheduledFor: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
      },
    })
    if (alreadySent) continue

    // Skip if patient booked after the call
    const recentBooking = await prisma.appointment.findFirst({
      where: {
        patientId: patient.id,
        createdAt: { gte: call.createdAt },
      },
    })
    if (recentBooking) continue

    const templateName = process.env.WA_TEMPLATE_MISSED_CALL_NAME || 'cc_missed_call_followup'
    const firstName    = patient.firstName || 'there'
    try {
      try {
        await sendWhatsAppTemplate(patient.phone, templateName, [firstName])
      } catch {
        await sendWhatsAppMessage(
          patient.phone,
          `Hi ${firstName}! 😊 We noticed you tried reaching us at Code Clinic earlier. Sorry we missed you! How can we help? Just reply here or call us on +256 394 836 298.`
        )
      }

      await prisma.aiScheduledMessage.create({
        data: {
          patientId:    patient.id,
          channel:      'WHATSAPP',
          templateType: 'MISSED_CALL',
          scheduledFor: now,
          sent:         true,
          content:      `Missed call followup sent to ${patient.phone}`,
        },
      })
      console.log(`[MissedCallFollowup] Sent to ${patient.firstName} (${patient.phone})`)
    } catch (err: any) {
      console.error(`[MissedCallFollowup] Failed for ${patient.phone}:`, err.message)
    }
  }
}

// ── checkAndSendReactivationMessages ──────────────────────────────────────────
// Runs daily at 10 AM EAT. Finds patients with no appointment in 90+ days and
// sends the cc_patient_reactivation template to win them back.

export async function checkAndSendReactivationMessages(): Promise<void> {
  if (eatHour() < 10 || eatHour() >= 11) return  // only 10–11 AM EAT

  const now          = new Date()
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)

  // Patients who have had at least one appointment but none in the last 90 days
  const dormantPatients = await prisma.patient.findMany({
    where: {
      isActive: true,
      appointments: {
        some: { startAt: { lt: ninetyDaysAgo } },
        none: { startAt: { gte: ninetyDaysAgo } },
      },
    },
    select: { id: true, firstName: true, phone: true },
    take: 100,
  })

  if (dormantPatients.length === 0) return
  console.log(`[Reactivation] Found ${dormantPatients.length} dormant patient(s)`)

  for (const patient of dormantPatients) {
    if (!patient.phone) continue

    // Dedup: already sent reactivation in last 90 days
    const alreadySent = await prisma.aiScheduledMessage.findFirst({
      where: {
        patientId:    patient.id,
        templateType: 'REACTIVATION',
        sent:         true,
        scheduledFor: { gte: ninetyDaysAgo },
      },
    })
    if (alreadySent) continue

    const templateName = process.env.WA_TEMPLATE_REACTIVATION_NAME || 'cc_patient_reactivation'
    const firstName    = patient.firstName || 'there'
    try {
      try {
        await sendWhatsAppTemplate(patient.phone, templateName, [firstName])
      } catch {
        await sendWhatsAppMessage(
          patient.phone,
          `Hi ${firstName}! 😊 It's been a while since we've seen you at Code Clinic. We hope you're doing well! When you're ready for your next visit, we're here for you — just reply or call us on +256 394 836 298.`
        )
      }

      await prisma.aiScheduledMessage.create({
        data: {
          patientId:    patient.id,
          channel:      'WHATSAPP',
          templateType: 'REACTIVATION',
          scheduledFor: now,
          sent:         true,
          content:      `Reactivation message sent to ${patient.phone}`,
        },
      })
      console.log(`[Reactivation] Sent to ${patient.firstName} (${patient.phone})`)
    } catch (err: any) {
      console.error(`[Reactivation] Failed for ${patient.phone}:`, err.message)
    }
  }
}
