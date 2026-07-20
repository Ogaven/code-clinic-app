import Anthropic from '@anthropic-ai/sdk'
import { sendWhatsAppMessage, sendWhatsAppTemplate, notifyReceptionistUnreachable } from '../whatsapp/whatsapp.service'
import { prisma } from '../../lib/prisma'
import { getGreetingName, isMinor, normalizeRelation } from '../../utils/nameHelper'
import { resolveOutboundRecipient } from './guardian-routing.service'

const ADMIN_WHATSAPP = '+256763430276'

// Dedup flag: reset each deploy/restart (acceptable for a weekly report)
let weekendReportSentOn: string | null = null

// EAT hour helper (UTC+3)
function eatHour(): number {
  return parseInt(
    new Date().toLocaleTimeString('en-US', { hour: 'numeric', hour12: false, timeZone: 'Africa/Nairobi' })
  )
}

function naturalServiceName(dbName: string | null | undefined): string {
  if (!dbName) return 'appointment'
  const lower = dbName.toLowerCase().trim()
  const map: Record<string, string> = {
    'stain removal':                             'cleaning',
    'teeth whitening (inoffice)':                'teeth whitening',
    'teeth whitening':                           'teeth whitening',
    'composite filling':                         'filling',
    'gi restoration':                            'filling',
    'extraction':                                'tooth extraction',
    'root canal therapy (incisors/premolars)':   'root canal treatment',
    'root canal therapy (molars)':               'root canal treatment',
    'root canal therapy':                        'root canal treatment',
    'braces consultation':                       'braces consultation',
    'implant':                                   'implant procedure',
    'implant sitting':                           'implant procedure',
    'implant placement':                         'implant procedure',
    'dental x-ray':                              'dental X-ray',
    'x-ray':                                     'dental X-ray',
    'complete dentures':                         'dentures',
    'review check up':                           'check-up',
    'consultation':                              'consultation',
    'crown':                                     'crown fitting',
    'veneer':                                    'veneer',
    'veneers':                                   'veneers',
    'periodontal therapy':                       'gum treatment',
    'periodontal treatment(quadrant scaling)':   'deep cleaning',
    'periodontal treatment (quadrant scaling)':  'deep cleaning',
    'scale and polish':                          'cleaning',
  }
  return map[lower] || dbName
}

async function generatePersonalizedFollowup(params: {
  patientName: string
  doctorName: string
  serviceName: string
  noteContent: string | null
  isGuardianMessage: boolean
  guardianAddress?: string
  childName?: string
}): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null

  const noteSection = params.noteContent && params.noteContent.trim().length >= 20
    ? `Clinical note:\n"""\n${params.noteContent.slice(0, 3000)}\n"""`
    : `(No clinical note available — write based on the treatment name only.)`

  const prompt = `You are Sarah, a warm WhatsApp assistant for Code Clinic dental clinic in Uganda. Write a SHORT follow-up message (2-3 sentences max) to a patient after yesterday's appointment.

The patient came in yesterday for: ${params.serviceName}.

Start the message by referencing THIS SPECIFIC TREATMENT in simple terms — for example "your cleaning", "your filling", "your implant procedure", "your root canal treatment", "your check-up". Do NOT use the generic word "visit".

Use the clinical note below ONLY to find any specific aftercare instructions to include (avoid hard foods, rinse with salt water, take medication, etc). If the note doesn't add anything useful beyond the treatment name, that is fine — just write a warm message about the ${params.serviceName} itself.

${noteSection}

Rules:
- Translate clinical/medical terms into simple, friendly language a patient would understand. NEVER use jargon like "RCT", "GI restoration", "periapical", tooth numbers, diagnoses, etc.
- Do NOT mention diagnoses, prognosis, or anything that could alarm the patient
- Warm, caring tone, 1-2 emojis max
- NEVER use em dashes (—)
- Always greet with "Hello" not "Hi"
- ${params.isGuardianMessage
    ? `This message is going to ${params.guardianAddress}, the guardian of ${params.childName}, a minor patient. Address them as "${params.guardianAddress}" and refer to the child as ${params.childName}.`
    : `Address the patient as ${params.patientName}.`}
- Doctor's name: Dr ${params.doctorName}
- End with an invitation to reply if they have questions
- Output ONLY the message text, nothing else`

  try {
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as any).text)
      .join('')
      .trim()
    return text || null
  } catch (err: any) {
    console.error('[PersonalizedFollowup] Failed:', err?.message || err)
    return null
  }
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
      patient: { isActive: true },
    },
    include: {
      patient: { select: { id: true, firstName: true, lastName: true, phone: true, dob: true, nextOfKinName: true, nextOfKinRelation: true, guardianId: true, familyAccountId: true, guardian: { select: { phone: true } } } },
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
    const channel           = 'WHATSAPP'
    const doctorFirst       = appt.doctor.user.firstName
    const doctor            = `Dr ${doctorFirst}`
    const minor             = isMinor(patient.dob)
    const guardianFirstName = minor && patient.nextOfKinName
      ? getGreetingName({ firstName: patient.nextOfKinName, lastName: '' })
      : null
    const relation  = normalizeRelation(patient.nextOfKinRelation)
    const greetName = getGreetingName(patient)
    const addr      = minor && guardianFirstName ? guardianFirstName : minor ? 'there' : greetName

    const note = await prisma.treatmentNote.findFirst({
      where: { patientId: patient.id },
      orderBy: { createdAt: 'desc' },
    })
    const personalized = await generatePersonalizedFollowup({
      patientName:       greetName,
      doctorName:        doctorFirst,
      serviceName:       naturalServiceName(appt.service?.name),
      noteContent:       note?.content ?? null,
      isGuardianMessage: minor && !!guardianFirstName,
      guardianAddress:   guardianFirstName ?? undefined,
      childName:         minor ? greetName : undefined,
    })

    const genericMessage = minor
      ? `Hello ${addr}, this is Sarah from Code Clinic 😊 As ${greetName}'s ${relation}, we wanted to follow up on ${greetName}'s visit yesterday with ${doctor}. How is ${greetName} doing? Feel free to reply if you have any questions, we are always here for you.`
      : `Hello ${greetName}, hope you are feeling well after your visit yesterday with ${doctor} 😊 How are you doing? Are you following the instructions given? Feel free to reply if you have any questions, we are always here for you.`
    const message = personalized ?? genericMessage

    // ── Send ──────────────────────────────────────────────────────────────────
    const routing = await resolveOutboundRecipient(patient, greetName)
    if (!routing.ok) {
      console.warn(`[Followup] Skipping ${patient.firstName} — minor with no active guardian`)
      continue
    }
    const recipientPhone = routing.recipient.phone
    try {
      await sendWhatsAppMessage(recipientPhone, message)
    } catch (err: any) {
      console.error(`[Followup] Send failed for ${recipientPhone}:`, err.message ?? err)
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
        metadata:       JSON.stringify({ type: 'followup', serviceName: naturalServiceName(appt.service?.name), doctorName: doctorFirst }),
      },
    })

    console.log(
      `[Followup] Sent to ${patient.firstName} ${patient.lastName} (${recipientPhone}) via ${channel}`
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
      patient: { select: { id: true, firstName: true, lastName: true, phone: true, dob: true, nextOfKinName: true, nextOfKinRelation: true } },
    },
    take: 50,
  })

  if (entries.length === 0) return
  console.log(`[AfterHoursQueue] Processing ${entries.length} morning follow-up(s)`)

  for (const entry of entries) {
    const minor             = isMinor(entry.patient?.dob)
    const guardianFirstName = minor && entry.patient?.nextOfKinName
      ? getGreetingName({ firstName: entry.patient.nextOfKinName, lastName: '' })
      : null
    const patientName = getGreetingName(entry.patient) || 'there'
    const name        = minor && guardianFirstName ? guardianFirstName : minor ? 'there' : patientName

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
        patient: { select: { id: true, firstName: true, lastName: true, phone: true, dob: true, nextOfKinName: true, nextOfKinRelation: true, guardianId: true, familyAccountId: true, guardian: { select: { phone: true } } } },
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

    const minor             = isMinor(patient.dob)
    const guardianFirstName = minor && patient.nextOfKinName
      ? getGreetingName({ firstName: patient.nextOfKinName, lastName: '' })
      : null
    const relation  = normalizeRelation(patient.nextOfKinRelation)
    const doctorFirst  = appt.doctor.user.firstName
    const greetName    = getGreetingName(patient)
    const addr         = minor && guardianFirstName ? guardianFirstName : minor ? 'there' : greetName
    const msg          = minor && guardianFirstName
      ? `Hello ${addr}, this is Sarah from Code Clinic 😊 As ${greetName}'s ${relation}, we noticed ${greetName} missed an appointment yesterday with Dr ${doctorFirst}. We hope everything is okay. Would you like to reschedule? We would love to see ${greetName}.`
      : `Hello ${addr}, we noticed you missed your appointment yesterday with Dr ${doctorFirst}. We hope everything is okay 😊 Would you like to reschedule? We would love to see you.`

    const missedRouting = await resolveOutboundRecipient(patient, greetName)
    if (!missedRouting.ok) {
      console.warn(`[PostApptFollowup] Skipping ${patient.firstName} (missed) — minor with no active guardian`)
      continue
    }
    const recipientPhone = missedRouting.recipient.phone
    try {
      await sendWhatsAppMessage(recipientPhone, msg)
    } catch (err: any) {
      console.error(`[PostApptFollowup] Missed appt send failed for ${recipientPhone}:`, err.message)
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
        patient: { select: { id: true, firstName: true, lastName: true, phone: true, dob: true, nextOfKinName: true, nextOfKinRelation: true, guardianId: true, familyAccountId: true, guardian: { select: { phone: true } } } },
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
    const patient           = appt.patient
    const doctorFirst       = appt.doctor.user.firstName
    const minor             = isMinor(patient.dob)
    const guardianFirstName = minor && patient.nextOfKinName
      ? getGreetingName({ firstName: patient.nextOfKinName, lastName: '' })
      : null
    const relation = normalizeRelation(patient.nextOfKinRelation)

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
      const addr2 = minor && guardianFirstName ? guardianFirstName : minor ? 'there' : greetName2
      const nudge = minor
        ? `Hello ${addr2}, just checking in on ${greetName2} 😊 Feel free to reply if you have any questions, we are here for you!`
        : `Hello ${greetName2}, just checking in 😊 How are you doing? Feel free to reply anytime!`
      const nudgeRouting = await resolveOutboundRecipient(patient, getGreetingName(patient))
      if (!nudgeRouting.ok) continue
      const recipientPhoneNudge = nudgeRouting.recipient.phone
      try {
        await sendWhatsAppMessage(recipientPhoneNudge, nudge)
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
      const addr = guardianFirstName ? `Hello ${guardianFirstName},` : `Hello,`
      stage1 = isFirstContact
        ? `${addr} Good morning. This is Sarah from Code Clinic 😊 As ${greetName}'s ${relation}, I am reaching out regarding ${greetName}'s recent visit.`
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
    const stage1Routing = await resolveOutboundRecipient(patient, greetName)
    if (!stage1Routing.ok) {
      console.warn(`[PostApptFollowup] Skipping ${patient.firstName} (stage 1) — minor with no active guardian`)
      continue
    }
    const recipientPhone = stage1Routing.recipient.phone
    const stage1SentAt = new Date()
    try {
      await sendWhatsAppMessage(recipientPhone, stage1)
      await prisma.aiMessage.create({ data: { conversationId: convId, role: 'AGENT', content: stage1 } })
      await prisma.appointment.update({ where: { id: appt.id }, data: { followUpSent: true } })
      await prisma.aiScheduledMessage.create({
        data: { patientId: patient.id, channel: 'WHATSAPP', templateType: 'POST_APPOINTMENT', scheduledFor: appt.startAt, sent: true, content: stage1 },
      })
      counts.sent++
      console.log(`[PostApptFollowup] Stage 1 sent to ${patient.firstName} ${patient.lastName}`)
    } catch (err: any) {
      console.error(`[PostApptFollowup] Stage 1 failed for ${recipientPhone}:`, err.message)
      await notifyReceptionistUnreachable(`${patient.firstName} ${patient.lastName}`, patient.phone)
      continue
    }

    const patientPhone    = recipientPhone
    const patientFullName = `${patient.firstName} ${patient.lastName}`
    const personalizedStage2 = await generatePersonalizedFollowup({
      patientName:       greetName,
      doctorName:        doctorFirst,
      serviceName:       naturalServiceName(appt.service?.name),
      noteContent:       latestNoteC?.content ?? null,
      isGuardianMessage: minor && !!guardianFirstName,
      guardianAddress:   guardianFirstName ?? undefined,
      childName:         minor ? greetName : undefined,
    })
    const stage2 = personalizedStage2 ?? `How are you doing? Hope you are feeling well after your visit yesterday with Dr ${doctorFirst} 😊`
    const stage3 = `Are you following the instructions given? Feel free to reply if you have any questions, we are always here for you 🌟`

    // Stage 2 — 30 minutes later if no reply
    setTimeout(async () => {
      try {
        const hasReplied = await prisma.aiMessage.findFirst({ where: { conversation: { phoneNumber: patientPhone }, role: 'USER', createdAt: { gte: stage1SentAt } } })
        if (hasReplied) { console.log(`[PostApptFollowup] Stage 2 skipped, patient replied`); return }
        await sendWhatsAppMessage(patientPhone, stage2)
        const c = await prisma.aiConversation.findFirst({ where: { phoneNumber: patientPhone, channel: 'WHATSAPP', status: 'ACTIVE' }, orderBy: { createdAt: 'desc' } })
        if (c) await prisma.aiMessage.create({ data: { conversationId: c.id, role: 'AGENT', content: stage2, metadata: JSON.stringify({ type: 'followup', serviceName: naturalServiceName(appt.service?.name), doctorName: doctorFirst }) } })
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
        if (c) await prisma.aiMessage.create({ data: { conversationId: c.id, role: 'AGENT', content: stage3, metadata: JSON.stringify({ type: 'followup', serviceName: naturalServiceName(appt.service?.name), doctorName: doctorFirst }) } })
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
        patient: { select: { id: true, firstName: true, lastName: true, phone: true, dob: true, nextOfKinName: true, nextOfKinRelation: true, guardianId: true, familyAccountId: true, guardian: { select: { phone: true } } } },
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

    const minor             = isMinor(patient.dob)
    const guardianFirstName = minor && patient.nextOfKinName
      ? getGreetingName({ firstName: patient.nextOfKinName, lastName: '' })
      : null
    const relation  = normalizeRelation(patient.nextOfKinRelation)
    const doctorFirst  = appt.doctor.user.firstName
    const greetName    = getGreetingName(patient)
    const addr         = minor && guardianFirstName ? guardianFirstName : minor ? 'there' : greetName
    const start        = new Date(appt.startAt)
    const timeStr      = start.toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' })
    const msg          = minor
      ? `Hello ${addr}, this is Sarah from Code Clinic 😊 As ${greetName}'s ${relation}, just a reminder that ${greetName} has an appointment tomorrow with Dr ${doctorFirst} at ${timeStr}. Please reply YES to confirm or NO to cancel.`
      : `Hello ${greetName}, this is Sarah from Code Clinic. You have an appointment tomorrow with Dr ${doctorFirst} at ${timeStr}. Please reply YES to confirm or NO to cancel. 😊`

    const confirmRouting = await resolveOutboundRecipient(patient, greetName)
    if (!confirmRouting.ok) {
      console.warn(`[ApptConfirmation] Skipping ${patient.firstName} — minor with no active guardian`)
      continue
    }
    const recipientPhone = confirmRouting.recipient.phone
    try {
      await sendWhatsAppMessage(recipientPhone, msg)
    } catch (err: any) {
      console.error(`[ApptConfirmation] Send failed for ${recipientPhone}:`, err.message)
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
        patient: { select: { id: true, firstName: true, lastName: true, phone: true, dob: true, nextOfKinName: true, nextOfKinRelation: true, guardianId: true, familyAccountId: true, guardian: { select: { phone: true } } } },
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

    const templateName      = process.env.WA_TEMPLATE_MISSED_CALL_NAME || 'cc_missed_call_followup'
    const minor             = isMinor(patient.dob)
    const guardianFirstName = minor && patient.nextOfKinName
      ? getGreetingName({ firstName: patient.nextOfKinName, lastName: '' })
      : null
    const firstName = getGreetingName(patient) || 'there'
    const missedCallRouting = await resolveOutboundRecipient(patient, firstName)
    if (!missedCallRouting.ok) {
      console.warn(`[MissedCallFollowup] Skipping ${patient.firstName} — minor with no active guardian`)
      continue
    }
    const addr           = missedCallRouting.recipient.isGuardian ? missedCallRouting.recipient.name : firstName
    const recipientPhone = missedCallRouting.recipient.phone
    try {
      try {
        await sendWhatsAppTemplate(recipientPhone, templateName, [addr])
      } catch {
        await sendWhatsAppMessage(
          recipientPhone,
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
    select: { id: true, firstName: true, lastName: true, phone: true, dob: true, nextOfKinName: true, nextOfKinRelation: true, guardianId: true, familyAccountId: true, guardian: { select: { phone: true } } },
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

    const templateName      = process.env.WA_TEMPLATE_REACTIVATION_NAME || 'cc_patient_reactivation'
    const minor             = isMinor(patient.dob)
    const guardianFirstName = minor && patient.nextOfKinName
      ? getGreetingName({ firstName: patient.nextOfKinName, lastName: '' })
      : null
    const firstName = getGreetingName(patient) || 'there'
    const reactivationRouting = await resolveOutboundRecipient(patient, firstName)
    if (!reactivationRouting.ok) {
      console.warn(`[Reactivation] Skipping ${patient.firstName} — minor with no active guardian`)
      continue
    }
    const addr           = reactivationRouting.recipient.isGuardian ? reactivationRouting.recipient.name : firstName
    const recipientPhone = reactivationRouting.recipient.phone
    try {
      try {
        await sendWhatsAppTemplate(recipientPhone, templateName, [addr])
      } catch {
        await sendWhatsAppMessage(
          recipientPhone,
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

// ── checkAndSendWeekendReport ─────────────────────────────────────────────────
// Runs every Monday at 8 AM EAT. Sends a WhatsApp weekend activity summary to
// the clinic admin summarising Sarah's conversations from Saturday and Sunday.

export async function checkAndSendWeekendReport(): Promise<void> {
  const now        = new Date()
  const dayOfWeek  = now.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Africa/Nairobi' })
  const hour       = eatHour()
  if (dayOfWeek !== 'Monday' || hour < 8 || hour >= 9) return

  const todayStr = now.toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' })
  if (weekendReportSentOn === todayStr) return
  weekendReportSentOn = todayStr

  // Weekend window: Saturday 00:00 to Sunday 23:59 EAT
  const satDate  = new Date(now); satDate.setDate(satDate.getDate() - 2)
  const sunDate  = new Date(now); sunDate.setDate(sunDate.getDate() - 1)
  const satStart = new Date(satDate.toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' }) + 'T00:00:00+03:00')
  const sunEnd   = new Date(sunDate.toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' }) + 'T23:59:59+03:00')

  const satLabel = satDate.toLocaleDateString('en-UG', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Nairobi' })
  const sunLabel = sunDate.toLocaleDateString('en-UG', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Nairobi' })

  console.log(`[WeekendReport] Generating report for ${satLabel} – ${sunLabel}`)

  // Total conversations started over the weekend
  const conversations = await prisma.aiConversation.findMany({
    where: { createdAt: { gte: satStart, lte: sunEnd } },
    select: { id: true, phoneNumber: true, agentEnabled: true, channel: true, createdAt: true },
  })
  const totalConversations = conversations.length

  // New contacts: phone numbers that had NO prior conversation before Saturday
  let newContacts = 0
  for (const conv of conversations) {
    const priorCount = await prisma.aiConversation.count({
      where: { phoneNumber: conv.phoneNumber, createdAt: { lt: satStart } },
    })
    if (priorCount === 0) newContacts++
  }

  // Appointments booked during the weekend
  const appointmentsBooked = await prisma.appointment.count({
    where: { createdAt: { gte: satStart, lte: sunEnd } },
  })

  // Conversations needing attention: human takeover still active (agentEnabled = false)
  const needAttentionConvs = conversations.filter(c => c.agentEnabled === false)
  const needAttentionCount = needAttentionConvs.length
  const attentionList = needAttentionCount > 0
    ? needAttentionConvs.slice(0, 5).map(c => `  • ${c.phoneNumber} (${c.channel})`).join('\n')
    : '  None — all conversations handled ✅'

  // Top topics: analyse USER messages for keyword frequency
  const userMessages = await prisma.aiMessage.findMany({
    where: { role: 'USER', createdAt: { gte: satStart, lte: sunEnd } },
    select: { content: true },
    take: 100,
  })
  const topicKeywords: [string, string][] = [
    ['appointment', 'Appointments'],
    ['price|cost|fee|how much', 'Pricing'],
    ['teeth|tooth|dental', 'Dental care'],
    ['pain|emergency|urgent', 'Pain / Emergency'],
    ['hours|open|available|time', 'Opening hours'],
    ['doctor|specialist', 'Doctor availability'],
    ['location|where|address|directions', 'Location'],
  ]
  const topicCounts: Record<string, number> = {}
  for (const msg of userMessages) {
    const lower = msg.content.toLowerCase()
    for (const [pattern, label] of topicKeywords) {
      if (new RegExp(pattern).test(lower)) {
        topicCounts[label] = (topicCounts[label] || 0) + 1
      }
    }
  }
  const topTopics = Object.entries(topicCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([label, count], i) => `  ${i + 1}. ${label} (${count} mention${count !== 1 ? 's' : ''})`)
    .join('\n')

  const message = `Good morning! 🌅 Here is your weekend summary from Code Clinic Sarah:

📊 Weekend Activity (${satLabel} – ${sunLabel}):
• ${totalConversations} new conversation${totalConversations !== 1 ? 's' : ''}
• ${newContacts} new contact${newContacts !== 1 ? 's' : ''}
• ${appointmentsBooked} appointment${appointmentsBooked !== 1 ? 's' : ''} booked
• ${needAttentionCount} conversation${needAttentionCount !== 1 ? 's' : ''} need${needAttentionCount === 1 ? 's' : ''} follow-up

Top topics asked about:
${topTopics || '  (not enough data)'}

Conversations needing attention:
${attentionList}

Have a great week! 😊`

  try {
    await sendWhatsAppMessage(ADMIN_WHATSAPP, message)
    console.log('[WeekendReport] Sent to admin WhatsApp')
  } catch (err: any) {
    console.error('[WeekendReport] Failed to send:', err.message)
  }
}
