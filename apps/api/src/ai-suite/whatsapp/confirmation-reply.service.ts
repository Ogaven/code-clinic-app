// Strict, non-LLM reply classifier for tomorrow's-appointment confirmation
// requests (AiScheduledMessage.templateType === 'APPOINTMENT_CONFIRMATION').
//
// Why this exists: the general conversational agent (agent.service.ts /
// agent-tools.ts) can call cancel_appointment based on free-text LLM
// judgement, which is the right tool for open-ended conversation but is not
// an appropriate gate for a patient replying to a plain "reply YES to
// confirm or NO to cancel" prompt. This module is deliberately dumb and
// narrow: it only recognises a short, fixed list of exact tokens and NEVER
// calls the LLM or the cancel_appointment tool. Anything that doesn't match
// exactly returns null so the caller (whatsapp.service.ts) falls through to
// the existing, unmodified general-agent flow.
//
// Hard safety rule: a strict "cancel" match NEVER sets Appointment.status to
// CANCELLED here. It only tags the reply for staff review (a Notification +
// a metadata-tagged AiMessage) — a human always makes the actual
// cancellation decision. Only "confirm" is applied directly, because
// CONFIRMED is a normal, non-destructive status.

import { prisma } from '../../lib/prisma'

export type ConfirmationReplyClassification = 'CONFIRM' | 'CANCEL_REQUESTED' | 'RESCHEDULE_REQUESTED'

const CONFIRM_WORDS    = new Set(['yes', 'y', 'confirm', 'confirmed', '1'])
const CANCEL_WORDS     = new Set(['no', 'n', 'cancel', '2'])
const RESCHEDULE_WORDS = new Set(['reschedule', 'change', '3'])

/**
 * Exact-match only (after trim + lowercase) — deliberately not a substring or
 * fuzzy match. Ambiguous text like "maybe next week I think" must return
 * null, not a guess.
 */
export function classifyConfirmationReply(text: string): ConfirmationReplyClassification | null {
  const t = text.trim().toLowerCase()
  if (CONFIRM_WORDS.has(t)) return 'CONFIRM'
  if (CANCEL_WORDS.has(t)) return 'CANCEL_REQUESTED'
  if (RESCHEDULE_WORDS.has(t)) return 'RESCHEDULE_REQUESTED'
  return null
}

export interface PendingConfirmation {
  scheduledMessageId: string
  appointmentId: string | null
  scheduledFor: Date // == the appointment's startAt
}

/**
 * A patient has an "open" confirmation window when we actually sent them an
 * APPOINTMENT_CONFIRMATION message and the appointment it refers to has not
 * happened yet. We correlate back to the specific appointment by exact
 * startAt match, since checkAndSendAppointmentConfirmations always sets
 * scheduledFor = appt.startAt.
 */
export async function findPendingConfirmation(patientId: string): Promise<PendingConfirmation | null> {
  const scheduledMsg = await prisma.aiScheduledMessage.findFirst({
    where: {
      patientId,
      templateType: 'APPOINTMENT_CONFIRMATION',
      sent:         true,
      scheduledFor: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  })
  if (!scheduledMsg) return null

  const appt = await prisma.appointment.findFirst({
    where: { patientId, startAt: scheduledMsg.scheduledFor, status: { in: ['PENDING', 'CONFIRMED'] } },
  })

  return {
    scheduledMessageId: scheduledMsg.id,
    appointmentId:      appt?.id ?? null,
    scheduledFor:        scheduledMsg.scheduledFor,
  }
}

/**
 * Applies a strictly-classified confirmation reply. Returns the WhatsApp
 * reply text for the caller to actually send (this module never calls out to
 * WhatsApp itself, to avoid a static circular import with whatsapp.service.ts —
 * see notifyJulian in guards/escalation.ts for the same constraint solved via
 * dynamic import; here the caller already owns the send path so a return
 * value is simpler).
 */
export async function applyConfirmationReply(params: {
  classification: ConfirmationReplyClassification
  conversationId: string
  appointmentId: string | null
  patientName: string
  phone: string
}): Promise<{ replyText: string }> {
  const { classification, conversationId, appointmentId, patientName, phone } = params

  if (classification === 'CONFIRM') {
    if (appointmentId) {
      await prisma.appointment.update({ where: { id: appointmentId }, data: { status: 'CONFIRMED' } })
    }
    const replyText = `Perfect, thank you for confirming! See you then 😊`
    await prisma.aiMessage.create({
      data: {
        conversationId,
        role:     'AGENT',
        content:  replyText,
        metadata: JSON.stringify({ type: 'confirmation_reply', classification, appointmentId }),
      },
    })
    return { replyText }
  }

  // CANCEL_REQUESTED / RESCHEDULE_REQUESTED — staff-review only. Deliberately
  // does NOT touch Appointment.status. The appointment stays PENDING/CONFIRMED
  // and visible on the confirmation dashboard as "Cancel Requested" /
  // "Reschedule Requested" until a staff member acts on it.
  const replyText = classification === 'CANCEL_REQUESTED'
    ? `Thanks for letting us know 😊 We won't cancel this automatically — our team will reach out shortly to confirm and help with rebooking if needed.`
    : `No problem! Our team will reach out shortly to help you find a new time 😊`

  await prisma.aiMessage.create({
    data: {
      conversationId,
      role:     'AGENT',
      content:  replyText,
      metadata: JSON.stringify({ type: 'confirmation_reply', classification, appointmentId }),
    },
  })

  await notifyStaffOfConfirmationReply(classification, patientName, phone)

  return { replyText }
}

async function notifyStaffOfConfirmationReply(
  classification: 'CANCEL_REQUESTED' | 'RESCHEDULE_REQUESTED',
  patientName: string,
  phone: string,
): Promise<void> {
  try {
    const staff = await prisma.user.findMany({
      where: { role: { in: ['RECEPTIONIST', 'ADMIN'] }, isActive: true },
    })
    const title = classification === 'CANCEL_REQUESTED' ? 'Cancellation Requested' : 'Reschedule Requested'
    const action = classification === 'CANCEL_REQUESTED' ? 'cancel' : 'reschedule'
    const body = `${patientName} (${phone}) replied to their appointment confirmation asking to ${action}. Please follow up — no change has been made automatically.`

    await Promise.all(
      staff.map(u => {
        const href = u.role === 'RECEPTIONIST'
          ? '/receptionist/ai-suite/confirmation-dashboard'
          : '/ai-suite/confirmation-dashboard'
        return prisma.notification.create({ data: { userId: u.id, type: 'CONFIRMATION', title, body, href } })
      })
    )
  } catch (e: any) {
    console.error('[ConfirmationReply] Staff notify failed:', e?.message || e)
  }
}