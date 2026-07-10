import { prisma } from '../../lib/prisma'
import { sendWhatsAppMessage } from '../whatsapp/whatsapp.service'

function greet(firstName: string): string {
  const n = firstName?.trim()
  if (!n) return 'there'
  return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase()
}

const CANCEL_MSG = (name: string) =>
  `Hi ${name}! 😊 We noticed your appointment at Code Clinic was cancelled. We'd love to see you — would you like to rebook? Just reply and I'll find you a convenient slot 🙏`

const NO_SHOW_MSG = (name: string) =>
  `Hi ${name}! 😊 We missed you at Code Clinic today. Hope everything is okay! Would you like to reschedule your appointment? Just reply and I'll sort you out 😊`

// Runs every hour. Sends a single WhatsApp follow-up to patients whose
// CANCELLED or NO_SHOW appointment was >= 24 hours ago and who:
//  - have not already received a follow-up (followUpSent = false)
//  - have not rebooked any future appointment
//  - have not opted out (agentEnabled = false on their conversation)
export async function checkAndSendCancelledFollowups(): Promise<void> {
  const now        = new Date()
  const cutoff     = new Date(now.getTime() - 24 * 60 * 60 * 1000)       // 24h ago
  const lookback   = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)  // 30-day window max

  let appts: any[]
  try {
    appts = await prisma.appointment.findMany({
      where: {
        status:       { in: ['CANCELLED', 'NO_SHOW'] },
        followUpSent: false,
        startAt:      { gte: lookback, lte: cutoff },  // 24h–30d ago only
      },
      include: {
        patient: { select: { id: true, firstName: true, phone: true } },
      },
    })
  } catch (err: any) {
    console.error('[CancelledFollowup] Query failed:', err.message)
    return
  }

  if (!appts.length) return
  console.log(`[CancelledFollowup] ${appts.length} candidate(s) to check`)

  for (const appt of appts) {
    const patient = appt.patient
    if (!patient?.phone) {
      // No phone — mark so we skip it next time
      await prisma.appointment.update({ where: { id: appt.id }, data: { followUpSent: true } }).catch(() => {})
      continue
    }

    // Opted out?
    const optedOut = await prisma.aiConversation.findFirst({
      where: { phoneNumber: patient.phone, channel: 'WHATSAPP', agentEnabled: false },
      select: { id: true },
    })
    if (optedOut) {
      console.log(`[CancelledFollowup] Skipping ${patient.firstName} — opted out`)
      continue
    }

    // Patient already has a future appointment?
    const futureAppt = await prisma.appointment.findFirst({
      where: {
        patientId: patient.id,
        startAt:   { gt: now },
        status:    { notIn: ['CANCELLED', 'CANCELLED_RESCHEDULED', 'NO_SHOW'] },
      },
      select: { id: true },
    })
    if (futureAppt) {
      // Rebooked — mark as sent so we don't keep visiting this record
      await prisma.appointment.update({
        where: { id: appt.id },
        data:  { followUpSent: true, followUpSentAt: now },
      }).catch(() => {})
      console.log(`[CancelledFollowup] Skipping ${patient.firstName} — already rebooked`)
      continue
    }

    // Duplicate guard: any CANCELLED_FOLLOWUP or MISSED_APPOINTMENT message sent in last 48h?
    const recentMsg = await prisma.aiScheduledMessage.findFirst({
      where: {
        patientId:    patient.id,
        templateType: { in: ['CANCELLED_FOLLOWUP', 'MISSED_APPOINTMENT'] },
        sent:         true,
        createdAt:    { gte: new Date(now.getTime() - 48 * 60 * 60 * 1000) },
      },
      select: { id: true },
    })
    if (recentMsg) {
      console.log(`[CancelledFollowup] Skipping ${patient.firstName} — follow-up already sent recently`)
      // Mark followUpSent to avoid re-checking on every hour
      await prisma.appointment.update({
        where: { id: appt.id },
        data:  { followUpSent: true, followUpSentAt: now },
      }).catch(() => {})
      continue
    }

    const name = greet(patient.firstName)
    const msg  = appt.status === 'NO_SHOW' ? NO_SHOW_MSG(name) : CANCEL_MSG(name)

    try {
      await sendWhatsAppMessage(patient.phone, msg)
    } catch (err: any) {
      console.error(`[CancelledFollowup] WhatsApp send failed for ${patient.phone}:`, err.message)
      continue
    }

    // Mark appointment as followed-up
    await prisma.appointment.update({
      where: { id: appt.id },
      data:  { followUpSent: true, followUpSentAt: now },
    })

    // Log to AiScheduledMessage for dedup + inbox visibility
    await prisma.aiScheduledMessage.create({
      data: {
        patientId:    patient.id,
        channel:      'WHATSAPP',
        templateType: 'CANCELLED_FOLLOWUP',
        scheduledFor: appt.startAt,
        sent:         true,
        content:      msg,
      },
    })

    // Save message into the patient's WhatsApp conversation thread
    try {
      let conv = await prisma.aiConversation.findFirst({
        where:   { phoneNumber: patient.phone, channel: 'WHATSAPP' },
        orderBy: { updatedAt: 'desc' },
      })
      if (!conv) {
        conv = await prisma.aiConversation.create({
          data: { patientId: patient.id, channel: 'WHATSAPP', phoneNumber: patient.phone, status: 'ACTIVE', agentEnabled: true },
        })
      }
      await prisma.aiMessage.create({ data: { conversationId: conv.id, role: 'AGENT', content: msg } })
    } catch (err: any) {
      console.error('[CancelledFollowup] Conversation log failed:', err.message)
    }

    console.log(`[CancelledFollowup] Sent to ${patient.firstName} (${appt.status}, appt ${appt.id})`)
  }
}
