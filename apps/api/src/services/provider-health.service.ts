// ─────────────────────────────────────────────────────────────────────────
// Real WhatsApp delivery health + CRM configuration readiness for Analytics
// & Costs. Delivery numbers come from AiMessage.status (already written by
// the webhook handler on every real status update) — never estimated.
// Health classification and the 131042 outage this exists because of are
// documented in whatsapp.routes.ts and meta-billing.service.ts.
// ─────────────────────────────────────────────────────────────────────────
import { prisma } from '../lib/prisma'
import { staleLeadsByOwner } from '../crm-automation/reporting.service'
import { startOfKampalaDay, startOfKampalaMonth } from '../utils/kampala-time'

export type WhatsAppHealthStatus = 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'UNKNOWN'

export interface DeliveryWindow {
  attempted: number
  delivered: number
  read: number
  failed: number
  pending: number
  deliveryRate: number
  failureRate: number
}

export interface WhatsAppDeliveryHealth {
  today: DeliveryWindow
  thisMonth: DeliveryWindow
  last30Days: DeliveryWindow
  lastSuccessfulDeliveryAt: string | null
  lastFailedDeliveryAt: string | null
  latestError: { code: number; title: string; message: string | null; details: string | null; occurredAt: string } | null
  failureCountByCode: Record<string, number>
  status: WhatsAppHealthStatus
}

function emptyWindow(): DeliveryWindow {
  return { attempted: 0, delivered: 0, read: 0, failed: 0, pending: 0, deliveryRate: 0, failureRate: 0 }
}

async function computeWindow(since: Date, until?: Date): Promise<DeliveryWindow> {
  const where = {
    role: 'AGENT' as const,
    wamid: { not: null },
    createdAt: until ? { gte: since, lt: until } : { gte: since },
  }
  const grouped = await prisma.aiMessage.groupBy({ by: ['status'], where, _count: { _all: true } })

  const w = emptyWindow()
  for (const row of grouped) {
    const n = row._count._all
    w.attempted += n
    if (row.status === 'delivered') w.delivered += n
    else if (row.status === 'read') w.read += n
    else if (row.status === 'failed') w.failed += n
    else w.pending += n // 'sent' (accepted, no final status yet) or null
  }
  if (w.attempted > 0) {
    w.deliveryRate = Math.round(((w.delivered + w.read) / w.attempted) * 1000) / 10
    w.failureRate  = Math.round((w.failed / w.attempted) * 1000) / 10
  }
  return w
}

// DOWN if near-total failure over a meaningful sample in the last 24h; DEGRADED
// if meaningfully elevated; HEALTHY only when a meaningful sample shows real
// positive evidence of working delivery. Thresholds are deliberately simple
// and documented rather than tuned — this is a status indicator, not an SLA.
// Below the minimum sample size there isn't enough real delivery evidence
// either way — UNKNOWN, never HEALTHY. Silence must never be reported as
// health: a quiet overnight window during an active outage (few or zero send
// attempts) previously classified as HEALTHY purely because the sample was
// too small to judge, which is indistinguishable in the UI from "genuinely
// delivering fine" — exactly the false-positive this exists to prevent.
function classify(last24h: DeliveryWindow): WhatsAppHealthStatus {
  if (last24h.attempted < 3) return 'UNKNOWN'
  if (last24h.failureRate >= 90) return 'DOWN'
  if (last24h.failureRate >= 20) return 'DEGRADED'
  return 'HEALTHY'
}

export async function getWhatsAppDeliveryHealth(): Promise<WhatsAppDeliveryHealth> {
  const now = new Date()
  const dayStart   = startOfKampalaDay(now)
  const monthStart = startOfKampalaMonth(now)
  const last30      = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const last24h      = new Date(now.getTime() - 24 * 60 * 60 * 1000)

  const [today, thisMonth, last30Days, last24hWindow, lastSuccess, lastFailed, latestFailure, failuresByCode] = await Promise.all([
    computeWindow(dayStart),
    computeWindow(monthStart),
    computeWindow(last30),
    computeWindow(last24h),
    prisma.aiMessage.findFirst({ where: { status: { in: ['delivered', 'read'] } }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    prisma.aiMessage.findFirst({ where: { status: 'failed' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    prisma.metaDeliveryFailure.findFirst({ orderBy: { occurredAt: 'desc' } }),
    prisma.metaDeliveryFailure.groupBy({ by: ['code'], _count: { _all: true } }),
  ])

  const failureCountByCode: Record<string, number> = {}
  for (const row of failuresByCode) failureCountByCode[String(row.code)] = row._count._all

  return {
    today,
    thisMonth,
    last30Days,
    lastSuccessfulDeliveryAt: lastSuccess?.createdAt.toISOString() ?? null,
    lastFailedDeliveryAt:     lastFailed?.createdAt.toISOString() ?? null,
    latestError: latestFailure ? {
      code:       latestFailure.code,
      title:      latestFailure.title,
      message:    latestFailure.message,
      details:    latestFailure.details,
      occurredAt: latestFailure.occurredAt.toISOString(),
    } : null,
    failureCountByCode,
    status: classify(last24hWindow),
  }
}

export interface CrmReadinessSummary {
  routingRuleCount: number
  activeRoutingRuleCount: number
  sequenceDefinitionCount: number
  activeSequenceDefinitionCount: number
  staleUnassignedLeadCount: number
  reviewRequestConfigured: boolean
}

export async function getCrmReadinessSummary(): Promise<CrmReadinessSummary> {
  const [routingRuleCount, activeRoutingRuleCount, sequenceDefinitionCount, activeSequenceDefinitionCount, staleGroups, reviewConfig] = await Promise.all([
    prisma.routingRule.count(),
    prisma.routingRule.count({ where: { isActive: true } }),
    prisma.sequenceDefinition.count(),
    prisma.sequenceDefinition.count({ where: { status: 'ACTIVE' } }),
    staleLeadsByOwner(),
    prisma.reviewRequestConfig.findFirst(),
  ])

  return {
    routingRuleCount,
    activeRoutingRuleCount,
    sequenceDefinitionCount,
    activeSequenceDefinitionCount,
    staleUnassignedLeadCount: staleGroups.reduce((sum, g) => sum + g.count, 0),
    reviewRequestConfigured: reviewConfig != null,
  }
}
