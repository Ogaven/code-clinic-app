import { prisma } from '../../../lib/prisma'
import { phoneVariants } from '../../../utils/phone'
import { sendPushToUser } from '../../push.service'
import { sendStaffSMS } from '../../../ai-suite/sms/sms.service'

// ── Emergency keyword detection ────────────────────────────────

const EMERGENCY_KEYWORDS = [
  'pain', 'painful', 'emergency', 'urgent', 'bleeding', 'blood',
  'swollen', 'swelling', 'infection', 'abscess', 'broken tooth',
  'knocked out', 'cannot open', 'jaw', 'severe', 'unbearable',
  'fainted', 'unconscious', 'allergic', 'reaction',
]

const DISTRESS_KEYWORDS = [
  'angry', 'angry', 'furious', 'disgusted', 'terrible',
  'awful', 'complaint', 'sue', 'lawyer', 'refund',
  'this is wrong', 'unacceptable', 'never coming back',
]

export function shouldEscalate(message: string): boolean {
  const lower = message.toLowerCase()
  return (
    EMERGENCY_KEYWORDS.some(k => lower.includes(k)) ||
    DISTRESS_KEYWORDS.some(k => lower.includes(k))
  )
}

export function getEscalationUrgency(message: string): 'LOW' | 'MEDIUM' | 'HIGH' {
  const lower = message.toLowerCase()
  if (EMERGENCY_KEYWORDS.some(k => lower.includes(k))) return 'HIGH'
  if (DISTRESS_KEYWORDS.some(k => lower.includes(k))) return 'MEDIUM'
  return 'LOW'
}

// ── Shared in-app + push notification fan-out to RECEPTIONIST/ADMIN staff ──
// Used by every escalation-shaped alert in this module so a single place
// controls role targeting and the push-vs-in-app body split. `pushBody` stays
// generic/privacy-conscious (may surface on a locked screen); `body` carries
// full context but is only ever rendered inside the authenticated app.
export async function notifyStaffInApp(params: {
  title: string
  body: string
  pushBody: string
  // Receptionist and Admin have separate route prefixes for the same screens
  // (/receptionist/ai-suite/... vs /ai-suite/...) -- a flat href would send
  // one of the two roles to a 404 or the wrong app shell. Pass a function
  // when the destination differs by role; a plain string when it doesn't.
  href: string | ((role: 'RECEPTIONIST' | 'ADMIN') => string)
}): Promise<void> {
  const staff = await prisma.user.findMany({
    where: { role: { in: ['RECEPTIONIST', 'ADMIN'] }, isActive: true },
    select: { id: true, role: true },
  })
  await Promise.all(staff.map(async u => {
    const href = typeof params.href === 'function' ? params.href(u.role as 'RECEPTIONIST' | 'ADMIN') : params.href
    try {
      await prisma.notification.create({ data: { userId: u.id, type: 'ESCALATION', title: params.title, body: params.body, href } })
    } catch (e: any) {
      console.error('[Escalation] In-app notification create failed:', e?.message)
      return
    }
    sendPushToUser(u.id, { title: params.title, body: params.pushBody, url: href }).catch(() => {})
  }))
}

// ── Create escalation + notify staff ──────────────────────────

export async function createEscalation(params: {
  patientId?: string
  phoneNumber: string
  channel: 'VOICE' | 'WHATSAPP'
  reason: string
  transcript?: string
  whatsappThread?: any[]
}): Promise<void> {
  await prisma.escalation.create({
    data: {
      patientId:      params.patientId,
      phoneNumber:    params.phoneNumber,
      channel:        params.channel,
      reason:         params.reason,
      transcript:     params.transcript,
      whatsappThread: params.whatsappThread ? JSON.stringify(params.whatsappThread) : undefined,
      status:         'PENDING',
    },
  })

  // Push can surface on a locked device screen -- keep the escalation reason
  // (which may contain clinical/complaint detail straight from the patient's
  // own message) out of it. Full context stays in the in-app notification,
  // visible only after authenticating. Admin and Receptionist share one
  // escalations screen at different base paths; the query param is the same.
  await notifyStaffInApp({
    title:    '🚨 Patient Needs Team Follow-up — Please Action',
    body:     `${params.reason.slice(0, 160)} | ${params.channel} | ${params.phoneNumber}`,
    pushBody: `A patient on ${params.channel} needs team follow-up — tap to view.`,
    href:     role => role === 'RECEPTIONIST'
      ? `/receptionist/ai-suite/escalations?phone=${encodeURIComponent(params.phoneNumber)}`
      : `/ai-suite/escalations?phone=${encodeURIComponent(params.phoneNumber)}`,
  })
}

// ── Safe fallback responses ────────────────────────────────────

export function getSafeEscalationResponse(channel: 'VOICE' | 'WHATSAPP'): string {
  if (channel === 'WHATSAPP') {
    return "I'm connecting you with our reception team right away. One moment please! 🙏\n\nYou can also reach us directly at +256 394 836 298."
  }
  return "Let me connect you with our receptionist right away. Please hold for just a moment."
}

// ── Notify staff via WhatsApp + SMS ─────────────────────────────
//
// WhatsApp's send API can report success (HTTP 200, message accepted) while
// the message never actually reaches the recipient — Meta confirms real
// delivery only later, asynchronously, via a webhook status callback. That
// gap let staff alerts go undelivered for weeks in 2026-09 (Meta WhatsApp
// Business account had unsettled billing — every send was accepted then
// silently failed delivery, error 131042). SMS is a second, independently-
// billed channel: if WhatsApp is down for any reason (billing, 24h window,
// outage), SMS is not affected by the same failure and vice versa. Always
// fire both for a real clinical/emergency alert — never rely on WhatsApp
// alone for anything a real patient's safety depends on.

// A free-text WhatsApp send only reliably delivers within Meta's 24h
// customer-service window (the destination number messaged the business in
// the last 24h). Staff alerts used to attempt a freeform send unconditionally
// whenever no approved template was configured -- exactly the shape of send
// Meta rejects with #131047 "re-engagement message" outside that window, one
// of the two failure codes seen repeatedly against the real clinic escalation
// number in production. Mirrors the same fail-closed window+template check
// followup.service.ts's checkAndSendAppointmentConfirmations already uses for
// patient-facing confirmations.
export async function isWithinStaffSessionWindow(staffPhone: string): Promise<boolean> {
  const lastInbound = await prisma.aiMessage.findFirst({
    where: { conversation: { phoneNumber: { in: phoneVariants(staffPhone) } }, role: 'USER' },
    orderBy: { createdAt: 'desc' },
  })
  return !!lastInbound && (Date.now() - lastInbound.createdAt.getTime()) < 24 * 60 * 60 * 1000
}

export async function notifyJulian(patientPhone: string, patientMessage: string): Promise<void> {
  const staffPhone = process.env.STAFF_WHATSAPP_NUMBER || '+256394836298'
  const freeformBody =
    `🚨 Code Clinic Alert — Patient needs your attention.\n\n` +
    `📞 Phone: ${patientPhone}\n` +
    `💬 Message: "${patientMessage.slice(0, 200)}"\n\n` +
    `Please check the AI Suite inbox and follow up.`

  let waSucceeded = false
  try {
    // Dynamic import avoids circular dependency (whatsapp.service → escalation → whatsapp.service)
    const { sendWhatsAppMessage, sendWhatsAppTemplate } = await import('../../../ai-suite/whatsapp/whatsapp.service')
    const templateName = process.env.WA_TEMPLATE_STAFF_ALERT_NAME
    const withinWindow = await isWithinStaffSessionWindow(staffPhone)

    if (templateName) {
      const patient = await prisma.patient.findFirst({
        where: { phone: { in: phoneVariants(patientPhone) } },
        select: { firstName: true, lastName: true },
      })
      const patientName = patient ? `${patient.firstName} ${patient.lastName}` : patientPhone
      try {
        await sendWhatsAppTemplate(staffPhone, templateName, [patientName, patientPhone, patientMessage.slice(0, 200)])
        waSucceeded = true
      } catch (tmplErr: any) {
        console.warn('[Escalation] Template failed:', tmplErr.message)
        // Only a freeform retry inside the window is legitimate -- outside it
        // would just be the same #131047-shaped rejection the template was
        // meant to avoid.
        if (withinWindow) {
          try {
            await sendWhatsAppMessage(staffPhone, freeformBody)
            waSucceeded = true
          } catch (waErr: any) {
            console.error('[Escalation] WhatsApp freeform fallback failed:', waErr.message)
          }
        }
      }
    } else if (withinWindow) {
      try {
        await sendWhatsAppMessage(staffPhone, freeformBody)
        waSucceeded = true
      } catch (waErr: any) {
        console.error('[Escalation] WhatsApp send failed:', waErr.message)
      }
    } else {
      console.warn(`[Escalation] BLOCKED_TEMPLATE_REQUIRED — outside the 24h WhatsApp session window and no WA_TEMPLATE_STAFF_ALERT_NAME configured. No freeform send attempted (would only produce a #131047 rejection).`)
    }
    if (waSucceeded) console.log(`[Escalation] Staff notified via WhatsApp about ${patientPhone}`)
  } catch (err: any) {
    console.error('[Escalation] WhatsApp notify path threw:', err.message)
  }

  // Always attempt SMS too — independent channel, doesn't share WhatsApp's failure modes.
  let smsSucceeded = false
  try {
    await sendStaffSMS(staffPhone, freeformBody)
    smsSucceeded = true
    console.log(`[Escalation] Staff notified via SMS about ${patientPhone}`)
  } catch (smsErr: any) {
    console.error('[Escalation] SMS fallback failed:', smsErr.message)
  }

  // Last resort: if BOTH WhatsApp and SMS failed (Meta billing/window issues,
  // Africa's Talking not configured, etc.), the alert must still reach staff
  // somehow -- fall back to the in-app notification centre + push, the one
  // channel that doesn't depend on an external provider's account health.
  // Never skipped merely because a template/window check blocked WhatsApp;
  // only when staff would otherwise receive nothing at all.
  if (!waSucceeded && !smsSucceeded) {
    await notifyStaffInApp({
      title:    '🚨 Staff Alert Delivery Failed — Action Needed',
      body:     `WhatsApp and SMS both failed for an alert about ${patientPhone}: "${patientMessage.slice(0, 160)}"`,
      pushBody: 'A staff alert could not be delivered via WhatsApp/SMS — tap to view.',
      href:     role => role === 'RECEPTIONIST'
        ? `/receptionist/ai-suite/inbox?phone=${encodeURIComponent(patientPhone)}`
        : `/ai-suite/inbox?phone=${encodeURIComponent(patientPhone)}`,
    })
  }
}
