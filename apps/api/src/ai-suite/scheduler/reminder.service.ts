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

// ── checkAndSendSameDayReminders ──────────────────────────────────────────────
// Phase 2 replacement for the retired 24h/1h reminders above. Ticks every 30
// minutes (see main.ts) but only actually sends during the 7:00-7:59 AM
// Africa/Kampala hour, Monday-Saturday. Purely informational — does not ask
// the patient to reply YES/NO or confirm/cancel (that framing is retired
// along with the 24h/1h reminders it replaces).

// All "now" reads below go through Africa/Kampala explicitly rather than the
// server's local/process TZ, per the Phase 2 spec.
function kampalaClock(): { hour: number; weekday: number; dateStr: string } {
  const now = new Date()
  const hour = parseInt(
    now.toLocaleTimeString('en-US', { hour: 'numeric', hour12: false, timeZone: 'Africa/Kampala' })
  )
  const weekdayStr = now.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'Africa/Kampala' })
  const WEEKDAY_MAP: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  // YYYY-MM-DD in Kampala — used to build the local day's start/end below
  const dateStr = now.toLocaleDateString('en-CA', { timeZone: 'Africa/Kampala' })
  return { hour, weekday: WEEKDAY_MAP[weekdayStr] ?? -1, dateStr }
}

// Only PENDING and CONFIRMED are treated as "still valid for a same-day
// reminder" — an explicit allow-list rather than an exclude-list, so any
// clinical-flow-in-progress status (ARRIVED, WITH_PROVIDER, DEPARTED, etc.)
// or terminal status (CANCELLED, CANCELLED_RESCHEDULED, NO_SHOW, RESCHEDULED,
// COMPLETED, IMPORTED) is safely excluded by construction, not by having to
// enumerate every one of them correctly.
const SAME_DAY_ELIGIBLE_STATUSES = ['PENDING', 'CONFIRMED'] as const

export async function checkAndSendSameDayReminders(): Promise<void> {
  const { hour, weekday, dateStr } = kampalaClock()
  if (weekday === 0) return   // Sunday — staff/Sarah split excludes Sunday entirely
  if (hour !== 7) return      // only the 7 AM Africa/Kampala hour

  // ── Template-only gate ────────────────────────────────────────────────
  // A proactive 7 AM reminder must never rely on the WhatsApp 24h
  // customer-service window, so this scheduler is template-only — no
  // freeform fallback anywhere below. Two separate approved templates are
  // required because the patient and guardian wording are grammatically
  // different sentences (see the per-recipient selection further down), not
  // interchangeable via a single template's variables. If BOTH are missing,
  // there is nothing this scheduler could possibly send — exit here, before
  // any patient querying, before any AiScheduledMessage row is created. A
  // missing template is not a send attempt, so it must not consume/create
  // dedup state. If only one is configured, that is handled per-appointment
  // below (a patient recipient still needs the patient template even if the
  // guardian one happens to be missing, and vice versa).
  const patientTemplateName  = process.env.WA_TEMPLATE_SAME_DAY_REMINDER_NAME
  const guardianTemplateName = process.env.WA_TEMPLATE_SAME_DAY_REMINDER_GUARDIAN_NAME
  if (!patientTemplateName && !guardianTemplateName) {
    console.warn('[SameDayReminder] Disabled — no WhatsApp template configured (WA_TEMPLATE_SAME_DAY_REMINDER_NAME / WA_TEMPLATE_SAME_DAY_REMINDER_GUARDIAN_NAME)')
    return
  }

  const dayStart = new Date(`${dateStr}T00:00:00+03:00`)
  const dayEnd   = new Date(`${dateStr}T23:59:59+03:00`)
  const now      = new Date()

  const appointments = await prisma.appointment.findMany({
    where: {
      startAt: { gte: dayStart, lte: dayEnd, gt: now }, // today in Kampala AND not already passed
      status:  { in: [...SAME_DAY_ELIGIBLE_STATUSES] },
      patient: { isActive: true },
    },
    include: {
      patient: { select: { id: true, firstName: true, lastName: true, phone: true, dob: true, nextOfKinName: true, nextOfKinRelation: true, guardianId: true, familyAccountId: true, guardian: { select: { phone: true } } } },
      doctor:  { include: { user: { select: { firstName: true } } } },
    },
  })

  if (appointments.length === 0) return
  console.log(`[SameDayReminder] Checking ${appointments.length} appointment(s) for today (${dateStr}, Africa/Kampala)`)

  for (const appt of appointments) {
    const patient = appt.patient

    // ── Dedup: persisted, checked BEFORE send, matched regardless of sent
    // true/false — see PRE-SEND MARKER note below for why this also covers
    // the crash-window case, not just genuine duplicates. ─────────────────
    const alreadyAttempted = await prisma.aiScheduledMessage.findFirst({
      where: {
        patientId:    patient.id,
        templateType: 'SAME_DAY_REMINDER',
        scheduledFor: {
          gte: new Date(appt.startAt.getTime() - 2 * 60 * 60 * 1000),
          lte: new Date(appt.startAt.getTime() + 2 * 60 * 60 * 1000),
        },
      },
    })
    if (alreadyAttempted) continue

    // resolveOutboundRecipient() does not itself validate phone presence for
    // non-minor patients (it returns ok:true with whatever's on file) — guard
    // explicitly here, same pattern already used in cancelled-followup.service.ts.
    if (!patient.phone) {
      console.log(`[SameDayReminder] Skipping ${patient.firstName} — no phone number on file`)
      continue
    }

    if (!(await hasOutboundConsent(patient.id))) {
      console.log(`[SameDayReminder] Skipping ${patient.firstName} — opted out of bot communications`)
      continue
    }

    const greetName = getGreetingName(patient)
    const routing   = await resolveOutboundRecipient(patient, greetName)
    if (!routing.ok) {
      console.warn(`[SameDayReminder] Skipping ${patient.firstName} — minor with no active guardian`)
      await alertStaffMinorNoGuardian(`${patient.firstName} ${patient.lastName}`, 'same-day reminder')
      continue
    }
    const { phone: recipientPhone, name: recipientName, isGuardian } = routing.recipient

    // ── Per-recipient template selection ──────────────────────────────────
    // Reuses isGuardian from resolveOutboundRecipient() above — never
    // re-derives recipient type from age/dob independently. The patient and
    // guardian templates are separate approved Meta templates with different
    // wording (second-person "you have" vs third-person "{{child}} has" —
    // a structurally different sentence, not just a swapped name), so there
    // is no fallback between them, and neither ever falls back to freeform.
    const activeTemplateName = isGuardian ? guardianTemplateName : patientTemplateName
    if (!activeTemplateName) {
      console.log(`[SameDayReminder] Skipping ${patient.firstName} — ${isGuardian ? 'guardian' : 'patient'} template not configured`)
      continue
    }

    const time   = appt.startAt.toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Kampala',
    }).toLowerCase()
    const doctor = `Dr ${appt.doctor.user.firstName}`

    // Purely informational — no "reply YES/NO", no confirm/cancel ask.
    // templateParams order must match the corresponding approved Meta
    // template's variables exactly (see implementation report).
    let message: string
    let templateParams: string[]
    if (isGuardian) {
      const title = guardianTitle(routing.recipient.relation, recipientName)
      message        = `Good morning ${title} 😊 This is Sarah from Code Clinic. Just a kind reminder that ${greetName} has an appointment with ${doctor} today at ${time}. We look forward to seeing you.`
      templateParams = [title, greetName, doctor, time]
    } else {
      message        = `Good morning ${greetName} 😊 This is Sarah from Code Clinic. Just a kind reminder that you have an appointment with ${doctor} today at ${time}. We look forward to seeing you.`
      templateParams = [greetName, doctor, time]
    }

    // ── PRE-SEND MARKER ──────────────────────────────────────────────────
    // Written before the network call, not after. WhatsApp Cloud API has no
    // idempotency-key / dedup mechanism for outbound sends, so a crash between
    // a successful send and marking `sent: true` cannot be made exact-once.
    // This design accepts that trade-off in the safe direction: if the process
    // crashes in that window, the row exists but sent stays false, and the
    // dedup check above (which does not filter on `sent`) will treat it as
    // already-attempted on the next run and skip it — the patient will not be
    // double-messaged, but in that specific crash window they may not receive
    // the reminder at all that day. A genuine send failure (caught below,
    // before ever reaching Meta) behaves the same way: no retry later that
    // day. This mirrors the instruction to prioritise "never twice" over
    // "always exactly once" and documents the residual limitation rather than
    // claiming exact-once delivery.
    const pending = await prisma.aiScheduledMessage.create({
      data: {
        patientId:    patient.id,
        channel:      'WHATSAPP',
        templateType: 'SAME_DAY_REMINDER',
        scheduledFor: appt.startAt,
        sent:         false,
        content:      message,
      },
    })

    try {
      // Template-only — no freeform fallback. A proactive 7 AM reminder must
      // never rely on the WhatsApp 24h customer-service window, which
      // sendWhatsAppMessage()/freeform sends require. sendWhatsAppTemplate()
      // itself already has no fallback baked in (it throws on failure by
      // design — see its own comment in whatsapp.service.ts); this call
      // simply does not catch-and-degrade to freeform the way the 24h/1h
      // reminders and notification.service.ts do for other message types.
      await sendWhatsAppTemplate(recipientPhone, activeTemplateName, templateParams, false)
    } catch (err: any) {
      console.error(`[SameDayReminder] Template send failed for ${recipientPhone}:`, err.message ?? err)
      continue // leave sent:false — dedup check above prevents a same-day retry
    }

    await prisma.aiScheduledMessage.update({ where: { id: pending.id }, data: { sent: true } })

    // ── Link to conversation so staff can see it in the inbox ────────────
    let conv = await prisma.aiConversation.findFirst({
      where:   { phoneNumber: patient.phone, channel: 'WHATSAPP', status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    })
    if (!conv) {
      conv = await prisma.aiConversation.create({
        data: {
          patientId:    patient.id,
          channel:      'WHATSAPP',
          phoneNumber:  patient.phone,
          status:       'ACTIVE',
          agentEnabled: true,
        },
      })
    }
    await prisma.aiMessage.create({
      data: { conversationId: conv.id, role: 'AGENT', content: message },
    })

    console.log(`[SameDayReminder] Sent to ${patient.firstName} ${patient.lastName} (${patient.phone}) via WHATSAPP`)
  }
}
