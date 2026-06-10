import { sendWhatsAppMessage, sendWhatsAppTemplate, notifyReceptionistUnreachable } from '../whatsapp/whatsapp.service'
import { prisma } from '../../lib/prisma'

// EAT hour helper (UTC+3)
function eatHour(): number {
  return parseInt(
    new Date().toLocaleTimeString('en-US', { hour: 'numeric', hour12: false, timeZone: 'Africa/Nairobi' })
  )
}

function isMinor(dob: Date | null | undefined): boolean {
  if (!dob) return false
  const age = (Date.now() - new Date(dob).getTime()) / (1000 * 60 * 60 * 24 * 365.25)
  return age < 16
}

// Returns the best greeting name: last non-Luganda word scanning backwards through full name.
// Examples: NUWAHEREZA PATIENCE → Patience, DIANA KIBUUKA → Diana, TUMWESIGYE ALEX → Alex
function getGreetingName(patient: { firstName?: string | null; lastName?: string | null } | null | undefined): string {
  if (!patient) return 'there'
  const toProper = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : ''
  const allWords = `${patient.firstName || ''} ${patient.lastName || ''}`.trim().split(/\s+/).filter(Boolean)
  if (allWords.length === 0) return 'there'
  const lugandaPrefixes = /^(MU|BA|KA|NA|WA|BU|LU|KI|MA|NY|NG|NJ|NK|SS|KK)/i
  for (let i = allWords.length - 1; i >= 0; i--) {
    const word = allWords[i]
    if (word.length > 2 && !lugandaPrefixes.test(word)) return toProper(word)
  }
  return toProper(allWords[allWords.length - 1])
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
      patient: { select: { id: true, firstName: true, lastName: true, phone: true, dob: true, nextOfKinName: true } },
      doctor:  { include: { user: { select: { firstName: true } } } },
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

    // ── Build message ─────────────────────────────────────────────────────────
    const channel      = 'WHATSAPP'
    const doctor       = `Dr ${appt.doctor.user.firstName}`
    const minor        = isMinor(patient.dob)
    const guardianName = patient.nextOfKinName
    const greetName    = getGreetingName(patient)
    const addr         = minor && guardianName ? guardianName : minor ? 'there' : greetName
    const message      = minor
      ? `Hello ${addr}, this is Sarah from Code Clinic. We are following up on ${greetName}'s visit yesterday with ${doctor}. How is ${greetName} doing? 😊 Feel free to reply if you have any questions, we are always here for you.`
      : `Hello ${greetName}, hope you are feeling well after your visit yesterday with ${doctor} 😊 How are you doing? Are you following the instructions given? Feel free to reply if you have any questions, we are always here for you.`

    // ── Send ──────────────────────────────────────────────────────────────────
    try {
      await sendWhatsAppMessage(patient.phone, message)
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
      patient: { select: { id: true, firstName: true, lastName: true, phone: true, dob: true, nextOfKinName: true } },
    },
    take: 50,
  })

  if (entries.length === 0) return
  console.log(`[AfterHoursQueue] Processing ${entries.length} morning follow-up(s)`)

  for (const entry of entries) {
    const minor        = isMinor(entry.patient?.dob)
    const guardianName = entry.patient?.nextOfKinName
    const patientName  = getGreetingName(entry.patient) || 'there'
    const name         = minor && guardianName ? guardianName : minor ? 'there' : patientName

    let templateName: string | undefined
    let message: string

    if (entry.agentMode === 'MISSED_CALL_FOLLOWUP') {
      templateName = process.env.WA_TEMPLATE_MISSED_CALL_NAME || 'cc_missed_call_followup'
      message = `Hello ${name} 😊 We are now open at Code Clinic. We noticed your message last night, how can we help you today?`
    } else {
      templateName = process.env.WA_TEMPLATE_AFTER_HOURS_NAME
      message = `Hello ${name}, good morning 😊 Code Clinic is now open. You messaged us last night, how can we help you today?`
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
// Runs every hour between 8–9 AM EAT. Handles:
// 1. Missed appointments (CANCELLED/NO_SHOW from yesterday) — single caring message
// 2. Completed appointments — 3-stage follow-up (immediate, 30min, 90min)
//    Stages 2 and 3 are skipped if the patient replies between stages.

export async function checkAndSendPostAppointmentFollowups(forceRun = false): Promise<{sent: number; skipped: number}> {
  const counts = { sent: 0, skipped: 0 }
  const nowUTC  = new Date()
  const eatHourNow = parseInt(
    nowUTC.toLocaleTimeString('en-US', { hour: 'numeric', hour12: false, timeZone: 'Africa/Nairobi' })
  )
  if (!forceRun && (eatHourNow < 8 || eatHourNow >= 9)) return counts

  const startOfToday     = new Date(nowUTC.toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' }) + 'T00:00:00+03:00')
  const yesterday        = new Date(nowUTC)
  yesterday.setDate(yesterday.getDate() - 1)
  const startOfYesterday = new Date(yesterday.toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' }) + 'T00:00:00+03:00')
  const endOfYesterday   = new Date(yesterday.toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' }) + 'T23:59:59+03:00')

  // ── MISSED APPOINTMENTS ────────────────────────────────────────────────────
  let missedAppts: any[] = []
  try {
    missedAppts = await prisma.appointment.findMany({
      where: { startAt: { gte: startOfYesterday, lte: endOfYesterday }, status: { in: ['CANCELLED', 'NO_SHOW'] } },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, phone: true, dob: true, nextOfKinName: true } },
        doctor:  { include: { user: { select: { firstName: true } } } },
      },
    })
  } catch (err: any) {
    console.error('[PostApptFollowup] Missed appts query failed:', err.message)
  }

  for (const appt of missedAppts) {
    const patient = appt.patient
    if (!patient?.phone) continue

    const latestNote = await prisma.treatmentNote.findFirst({
      where: { patientId: patient.id },
      orderBy: { createdAt: 'desc' },
    })
    if (!latestNote || latestNote.followUpStatus !== 'CONTACT') {
      console.log('[PostApptFollowup] Skipping', patient.firstName, '— status is', latestNote?.followUpStatus || 'none')
      continue
    }

    const sentToday = await prisma.aiScheduledMessage.findFirst({
      where: { patientId: patient.id, templateType: 'MISSED_APPOINTMENT', sent: true, createdAt: { gte: startOfToday } },
    })
    if (sentToday) {
      const patientReplied = await prisma.aiMessage.findFirst({
        where: { conversation: { phoneNumber: patient.phone }, role: 'USER', createdAt: { gte: sentToday.createdAt } },
      })
      if (patientReplied) { counts.skipped++; console.log(`[PostApptFollowup] Missed: skipping ${patient.firstName}, already replied`); continue }
      // Not replied — send again (fall through to re-send)
    }

    const minor        = isMinor(patient.dob)
    const guardianName = patient.nextOfKinName
    const doctorFirst  = appt.doctor.user.firstName
    const greetName    = getGreetingName(patient)
    const addr         = minor && guardianName ? guardianName : minor ? 'there' : greetName
    const msg          = `Hello ${addr}, we noticed you missed your appointment yesterday with Dr ${doctorFirst}. We hope everything is okay 😊 Would you like to reschedule? We would love to see you.`

    try {
      await sendWhatsAppMessage(patient.phone, msg)
    } catch (err: any) {
      console.error(`[PostApptFollowup] Missed appt send failed for ${patient.phone}:`, err.message)
      await notifyReceptionistUnreachable(`${patient.firstName} ${patient.lastName}`, patient.phone)
      continue
    }
    let conv = await prisma.aiConversation.findFirst({ where: { phoneNumber: patient.phone, channel: 'WHATSAPP', status: 'ACTIVE' }, orderBy: { createdAt: 'desc' } })
    if (!conv) conv = await prisma.aiConversation.create({ data: { patientId: patient.id, channel: 'WHATSAPP', phoneNumber: patient.phone, status: 'ACTIVE', agentEnabled: true } })
    await prisma.aiMessage.create({ data: { conversationId: conv.id, role: 'AGENT', content: msg } })
    await prisma.aiScheduledMessage.create({ data: { patientId: patient.id, channel: 'WHATSAPP', templateType: 'MISSED_APPOINTMENT', scheduledFor: appt.startAt, sent: true, content: msg } })
    counts.sent++
    console.log(`[PostApptFollowup] Missed appt message sent to ${patient.firstName} ${patient.lastName}`)
  }

  // ── COMPLETED APPOINTMENTS — 3-STAGE FOLLOW-UP ────────────────────────────
  let appointments: any[] = []
  try {
    appointments = await prisma.appointment.findMany({
      where: { startAt: { gte: startOfYesterday, lte: endOfYesterday }, status: { in: ['COMPLETED', 'CONFIRMED'] }, ...(forceRun ? {} : { followUpSent: false }) },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, phone: true, dob: true, nextOfKinName: true } },
        doctor:  { include: { user: { select: { firstName: true } } } },
        service: { select: { name: true } },
      },
    })
  } catch (err: any) {
    console.error('[PostApptFollowup] Query failed:', err.message)
    return counts
  }

  if (appointments.length === 0) return counts
  console.log(`[PostApptFollowup] Processing ${appointments.length} completed appointment follow-up(s)`)

  for (const appt of appointments) {
    const patient      = appt.patient
    const doctorFirst  = appt.doctor.user.firstName
    const minor        = isMinor(patient.dob)
    const guardianName = patient.nextOfKinName

    const latestNoteC = await prisma.treatmentNote.findFirst({
      where: { patientId: patient.id },
      orderBy: { createdAt: 'desc' },
    })
    if (!latestNoteC || latestNoteC.followUpStatus === 'CONTACTED' || latestNoteC.followUpStatus === 'DO_NOT_CONTACT') {
      counts.skipped++
      console.log('[PostApptFollowup] Skipping', patient.firstName, '— status is', latestNoteC?.followUpStatus || 'none')
      continue
    }
    if (!latestNoteC || latestNoteC.followUpStatus !== 'CONTACT') {
      counts.skipped++
      continue
    }

    // For forceRun: skip if processed on a previous day (followUpSent: true but not sent today)
    const sentToday = await prisma.aiScheduledMessage.findFirst({
      where: { patientId: patient.id, templateType: 'POST_APPOINTMENT', sent: true, createdAt: { gte: startOfToday } },
    })
    if (appt.followUpSent && !sentToday) { counts.skipped++; continue }

    // Re-send check: if already sent today, check reply status
    if (sentToday) {
      const patientReplied = await prisma.aiMessage.findFirst({
        where: { conversation: { phoneNumber: patient.phone }, role: 'USER', createdAt: { gte: sentToday.createdAt } },
      })
      if (patientReplied) { counts.skipped++; console.log(`[PostApptFollowup] Skipping ${patient.firstName} — already replied`); continue }
      // Not replied — send gentle nudge
      const greetName2 = getGreetingName(patient)
      const addr2 = minor && guardianName ? guardianName : minor ? 'there' : greetName2
      const nudge = minor
        ? `Hello ${addr2}, just checking in on ${greetName2} 😊 Feel free to reply if you have any questions, we are here for you!`
        : `Hello ${greetName2}, just checking in 😊 How are you doing? Feel free to reply anytime!`
      try {
        await sendWhatsAppMessage(patient.phone, nudge)
        const c = await prisma.aiConversation.findFirst({ where: { phoneNumber: patient.phone, channel: 'WHATSAPP', status: 'ACTIVE' }, orderBy: { createdAt: 'desc' } })
        if (c) await prisma.aiMessage.create({ data: { conversationId: c.id, role: 'AGENT', content: nudge } })
        counts.sent++
        console.log(`[PostApptFollowup] Nudge sent to ${patient.firstName} ${patient.lastName}`)
      } catch (err: any) {
        console.error(`[PostApptFollowup] Nudge failed for ${patient.phone}:`, err.message)
      }
      continue
    }

    // First-contact detection
    const agentMsgCount  = await prisma.aiMessage.count({ where: { conversation: { phoneNumber: patient.phone }, role: 'AGENT' } })
    const isFirstContact = agentMsgCount === 0

    // Stage 1 greeting
    const greetName = getGreetingName(patient)
    let stage1: string
    if (minor) {
      const addr = guardianName ? `Hello ${guardianName},` : `Hello,`
      stage1 = isFirstContact
        ? `${addr} Good morning. This is Sarah from Code Clinic 😊 I am reaching out regarding your child ${greetName}.`
        : `${addr} Good morning 😊 I am checking in on ${greetName}.`
    } else {
      stage1 = isFirstContact
        ? `Hello ${greetName}, good morning. This is Sarah from Code Clinic 😊`
        : `Hello ${greetName}, good morning 😊`
    }

    // Get or create conversation
    let conv = await prisma.aiConversation.findFirst({ where: { phoneNumber: patient.phone, channel: 'WHATSAPP', status: 'ACTIVE' }, orderBy: { createdAt: 'desc' } })
    if (!conv) conv = await prisma.aiConversation.create({ data: { patientId: patient.id, channel: 'WHATSAPP', phoneNumber: patient.phone, status: 'ACTIVE', agentEnabled: true } })
    const convId = conv.id

    // Inject doctor notes as internal context for Sarah (never sent to patient)
    if (appt.notes) {
      await prisma.aiMessage.create({
        data: { conversationId: convId, role: 'SYSTEM',
          content: `[POST-APPOINTMENT CONTEXT] Patient had ${(appt.service?.name || 'appointment').toLowerCase()} with Dr ${doctorFirst} yesterday. Doctor notes: ${appt.notes}. Use this context naturally. Never show this tag or doctor notes to the patient.` },
      })
    }

    // Stage 1 — send immediately
    const stage1SentAt = new Date()
    try {
      await sendWhatsAppMessage(patient.phone, stage1)
      await prisma.aiMessage.create({ data: { conversationId: convId, role: 'AGENT', content: stage1 } })
      await prisma.appointment.update({ where: { id: appt.id }, data: { followUpSent: true } })
      await prisma.aiScheduledMessage.create({
        data: { patientId: patient.id, channel: 'WHATSAPP', templateType: 'POST_APPOINTMENT', scheduledFor: appt.startAt, sent: true, content: stage1 },
      })
      counts.sent++
      console.log(`[PostApptFollowup] Stage 1 sent to ${patient.firstName} ${patient.lastName}`)
    } catch (err: any) {
      console.error(`[PostApptFollowup] Stage 1 failed for ${patient.phone}:`, err.message)
      await notifyReceptionistUnreachable(`${patient.firstName} ${patient.lastName}`, patient.phone)
      continue
    }

    const patientPhone    = patient.phone
    const patientFullName = `${patient.firstName} ${patient.lastName}`
    const stage2 = `How are you doing? Hope you are feeling well after your visit yesterday with Dr ${doctorFirst} 😊`
    const stage3 = `Are you following the instructions given? Feel free to reply if you have any questions, we are always here for you 🌟`

    // Stage 2 — 30 minutes later if no reply
    setTimeout(async () => {
      try {
        const hasReplied = await prisma.aiMessage.findFirst({ where: { conversation: { phoneNumber: patientPhone }, role: 'USER', createdAt: { gte: stage1SentAt } } })
        if (hasReplied) { console.log(`[PostApptFollowup] Stage 2 skipped, patient replied`); return }
        await sendWhatsAppMessage(patientPhone, stage2)
        const c = await prisma.aiConversation.findFirst({ where: { phoneNumber: patientPhone, channel: 'WHATSAPP', status: 'ACTIVE' }, orderBy: { createdAt: 'desc' } })
        if (c) await prisma.aiMessage.create({ data: { conversationId: c.id, role: 'AGENT', content: stage2 } })
        console.log(`[PostApptFollowup] Stage 2 sent to ${patientPhone}`)
      } catch (err: any) {
        console.error(`[PostApptFollowup] Stage 2 failed for ${patientPhone}:`, err.message)
        await notifyReceptionistUnreachable(patientFullName, patientPhone).catch(() => {})
      }
    }, 30 * 60 * 1000)

    // Stage 3 — 90 minutes after Stage 1 if still no reply
    setTimeout(async () => {
      try {
        const hasReplied = await prisma.aiMessage.findFirst({ where: { conversation: { phoneNumber: patientPhone }, role: 'USER', createdAt: { gte: stage1SentAt } } })
        if (hasReplied) { console.log(`[PostApptFollowup] Stage 3 skipped, patient replied`); return }
        await sendWhatsAppMessage(patientPhone, stage3)
        const c = await prisma.aiConversation.findFirst({ where: { phoneNumber: patientPhone, channel: 'WHATSAPP', status: 'ACTIVE' }, orderBy: { createdAt: 'desc' } })
        if (c) await prisma.aiMessage.create({ data: { conversationId: c.id, role: 'AGENT', content: stage3 } })
        console.log(`[PostApptFollowup] Stage 3 sent to ${patientPhone}`)
      } catch (err: any) {
        console.error(`[PostApptFollowup] Stage 3 failed for ${patientPhone}:`, err.message)
        await notifyReceptionistUnreachable(patientFullName, patientPhone).catch(() => {})
      }
    }, 90 * 60 * 1000)
  }
  return counts
}

// ── checkAndSendAppointmentConfirmations ──────────────────────────────────────
// Runs every hour between 9–10 AM EAT. Finds appointments scheduled for
// TOMORROW with status SCHEDULED or CONFIRMED that haven't been sent a
// confirmation request, and asks each patient to confirm via WhatsApp.

export async function checkAndSendAppointmentConfirmations(forceRun = false): Promise<void> {
  const nowUTC     = new Date()
  const eatHourNow = parseInt(
    nowUTC.toLocaleTimeString('en-US', { hour: 'numeric', hour12: false, timeZone: 'Africa/Nairobi' })
  )
  if (!forceRun && (eatHourNow < 9 || eatHourNow >= 10)) return

  const tomorrow        = new Date(nowUTC)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const startOfTomorrow = new Date(tomorrow.toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' }) + 'T00:00:00+03:00')
  const endOfTomorrow   = new Date(tomorrow.toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' }) + 'T23:59:59+03:00')

  let appointments: any[] = []
  try {
    appointments = await prisma.appointment.findMany({
      where: {
        startAt: { gte: startOfTomorrow, lte: endOfTomorrow },
        status:  { in: ['PENDING', 'CONFIRMED'] },
      },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, phone: true, dob: true, nextOfKinName: true } },
        doctor:  { include: { user: { select: { firstName: true } } } },
        service: { select: { name: true } },
      },
    })
  } catch (err: any) {
    console.error('[ApptConfirmation] Query failed:', err.message)
    return
  }

  if (appointments.length === 0) return
  console.log(`[ApptConfirmation] Processing ${appointments.length} appointment(s) for tomorrow`)

  for (const appt of appointments) {
    const patient = appt.patient
    if (!patient?.phone) continue

    const alreadySent = await prisma.aiScheduledMessage.findFirst({
      where: {
        patientId:    patient.id,
        templateType: 'APPOINTMENT_CONFIRMATION',
        sent:         true,
        scheduledFor: { gte: startOfTomorrow, lte: endOfTomorrow },
      },
    })
    if (alreadySent) continue

    const minor        = isMinor(patient.dob)
    const guardianName = patient.nextOfKinName
    const doctorFirst  = appt.doctor.user.firstName
    const greetName    = getGreetingName(patient)
    const addr         = minor && guardianName ? guardianName : minor ? 'there' : greetName
    const start        = new Date(appt.startAt)
    const timeStr      = start.toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' })
    const msg          = minor
      ? `Hello ${addr}, this is Sarah from Code Clinic. ${greetName} has an appointment tomorrow with Dr ${doctorFirst} at ${timeStr}. Please reply YES to confirm or NO to cancel. 😊`
      : `Hello ${greetName}, this is Sarah from Code Clinic. You have an appointment tomorrow with Dr ${doctorFirst} at ${timeStr}. Please reply YES to confirm or NO to cancel. 😊`

    try {
      await sendWhatsAppMessage(patient.phone, msg)
    } catch (err: any) {
      console.error(`[ApptConfirmation] Send failed for ${patient.phone}:`, err.message)
      continue
    }

    let conv = await prisma.aiConversation.findFirst({ where: { phoneNumber: patient.phone, channel: 'WHATSAPP', status: 'ACTIVE' }, orderBy: { createdAt: 'desc' } })
    if (!conv) conv = await prisma.aiConversation.create({ data: { patientId: patient.id, channel: 'WHATSAPP', phoneNumber: patient.phone, status: 'ACTIVE', agentEnabled: true } })
    await prisma.aiMessage.create({ data: { conversationId: conv.id, role: 'AGENT', content: msg } })
    await prisma.aiScheduledMessage.create({ data: { patientId: patient.id, channel: 'WHATSAPP', templateType: 'APPOINTMENT_CONFIRMATION', scheduledFor: appt.startAt, sent: true, content: msg } })
    console.log(`[ApptConfirmation] Sent to ${patient.firstName} ${patient.lastName} for ${timeStr} appt`)
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
        patient: { select: { id: true, firstName: true, lastName: true, phone: true, dob: true, nextOfKinName: true } },
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
    const minor        = isMinor(patient.dob)
    const guardianName = patient.nextOfKinName
    const firstName    = getGreetingName(patient) || 'there'
    const addr         = minor && guardianName ? guardianName : minor ? 'there' : firstName
    try {
      try {
        await sendWhatsAppTemplate(patient.phone, templateName, [addr])
      } catch {
        await sendWhatsAppMessage(
          patient.phone,
          `Hello ${addr} 😊 We noticed you tried reaching us at Code Clinic earlier. Sorry we missed you! How can we help? Just reply here or call us on +256 394 836 298.`
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
    select: { id: true, firstName: true, lastName: true, phone: true, dob: true, nextOfKinName: true },
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
    const minor        = isMinor(patient.dob)
    const guardianName = patient.nextOfKinName
    const firstName    = getGreetingName(patient) || 'there'
    const addr         = minor && guardianName ? guardianName : minor ? 'there' : firstName
    try {
      try {
        await sendWhatsAppTemplate(patient.phone, templateName, [addr])
      } catch {
        await sendWhatsAppMessage(
          patient.phone,
          minor
            ? `Hello ${addr} 😊 It has been a while since ${firstName} visited Code Clinic. We hope everything is well! When ready, just reply or call us on +256 394 836 298.`
            : `Hello ${addr} 😊 It has been a while since we have seen you at Code Clinic. We hope you are doing well! When you are ready for your next visit, we are here for you. Just reply or call us on +256 394 836 298.`
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
