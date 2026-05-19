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
          title:  '🚨 Agent Escalation — Needs Attention',
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
    return "I'm connecting you with our reception team right away. One moment please! 🙏\n\nYou can also reach us directly at 0205477000."
  }
  return "Let me connect you with our receptionist right away. Please hold for just a moment."
}
