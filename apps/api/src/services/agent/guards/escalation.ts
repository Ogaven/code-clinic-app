import { prisma } from '../../../lib/prisma'

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

  // Notify all RECEPTIONIST + ADMIN users
  const staff = await prisma.user.findMany({
    where: { role: { in: ['RECEPTIONIST', 'ADMIN'] }, isActive: true },
    select: { id: true },
  })

  await Promise.all(
    staff.map(u =>
      prisma.notification.create({
        data: {
          userId: u.id,
          type:   'ESCALATION',
          title:  '🚨 Patient Needs Team Follow-up — Please Action',
          body:   `${params.reason.slice(0, 160)} | ${params.channel} | ${params.phoneNumber}`,
          href:   '/receptionist/dashboard',
        },
      })
    )
  )
}

// ── Safe fallback responses ────────────────────────────────────

export function getSafeEscalationResponse(channel: 'VOICE' | 'WHATSAPP'): string {
  if (channel === 'WHATSAPP') {
    return "I'm connecting you with our reception team right away. One moment please! 🙏\n\nYou can also reach us directly at +256 394 836 298."
  }
  return "Let me connect you with our receptionist right away. Please hold for just a moment."
}

// ── Notify staff via WhatsApp ──────────────────────────────────

export async function notifyJulian(patientPhone: string, patientMessage: string): Promise<void> {
  const staffPhone = process.env.STAFF_WHATSAPP_NUMBER || '+256394836298'
  try {
    // Dynamic import avoids circular dependency (whatsapp.service → escalation → whatsapp.service)
    const { sendWhatsAppMessage, sendWhatsAppTemplate } = await import('../../../ai-suite/whatsapp/whatsapp.service')
    const templateName = process.env.WA_TEMPLATE_STAFF_ALERT_NAME
    const freeformBody =
      `🚨 Code Clinic Alert — Patient needs your attention.\n\n` +
      `📞 Phone: ${patientPhone}\n` +
      `💬 Message: "${patientMessage.slice(0, 200)}"\n\n` +
      `Please check the AI Suite inbox and follow up.`

    if (templateName) {
      const localPhone = patientPhone.replace(/^\+256/, '0')
      const patient = await prisma.patient.findFirst({
        where: { OR: [{ phone: patientPhone }, { phone: localPhone }] },
        select: { firstName: true, lastName: true },
      })
      const patientName = patient ? `${patient.firstName} ${patient.lastName}` : patientPhone
      try {
        await sendWhatsAppTemplate(staffPhone, templateName, [patientName, patientPhone, patientMessage.slice(0, 200)])
        return
      } catch (tmplErr: any) {
        console.warn('[Escalation] Template failed, falling back to freeform:', tmplErr.message)
      }
    }
    await sendWhatsAppMessage(staffPhone, freeformBody)
    console.log(`[Escalation] Staff notified about ${patientPhone}`)
  } catch (err: any) {
    console.error('[Escalation] Failed to notify staff:', err.message)
  }
}
