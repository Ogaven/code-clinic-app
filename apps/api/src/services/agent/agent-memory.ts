import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// ── Load full patient context by phone number ──────────────────

export async function loadPatientContext(phoneNumber: string) {
  const patient = await prisma.patient.findFirst({
    where: { phone: phoneNumber },
    include: {
      appointments: {
        orderBy: { startAt: 'desc' },
        take: 5,
        include: {
          doctor: { include: { user: { select: { firstName: true, lastName: true } } } },
          service: { select: { name: true, priceUGX: true } },
        },
      },
      invoices: {
        where: { status: { in: ['UNPAID', 'PARTIAL', 'OVERDUE'] } },
        select: { totalUGX: true, paidUGX: true, status: true },
      },
      agentMemory: {
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
    },
  })
  return patient
}

// ── Format memory history for prompt injection ─────────────────

export function formatMemoryForPrompt(
  memory: Array<{
    createdAt: Date
    channel: string
    interactionType: string
    summary: string
    outcome: string
  }>
): string {
  if (memory.length === 0) return 'No previous interactions on record.'

  return memory.map(m => {
    const daysAgo = Math.floor((Date.now() - m.createdAt.getTime()) / 86400000)
    const timeLabel = daysAgo === 0 ? 'Today' : daysAgo === 1 ? 'Yesterday' : `${daysAgo} days ago`
    return `• ${timeLabel} via ${m.channel}: ${m.summary} [${m.outcome}]`
  }).join('\n')
}

// ── Detect if we recently tried to call this patient ──────────

export function findRecentMissedOutbound(
  memory: Array<{ outcome: string; createdAt: Date; interactionType: string; summary: string }>
) {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000) // 24 hours ago
  return memory.find(m =>
    m.outcome === 'NO_ANSWER' &&
    m.createdAt > cutoff &&
    ['REMINDER', 'FOLLOWUP', 'DEBT'].includes(m.interactionType)
  ) || null
}
