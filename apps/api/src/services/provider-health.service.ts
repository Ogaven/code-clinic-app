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

// Internal staff escalation sends (clinical-concern alerts, guardian-routing
// warnings, new-lead notifications) are logged into AiConversation/AiMessage
// under the staff number's own "conversation" exactly like a real patient
// thread (see whatsapp.service.ts's logAgentMessageToConversation, called by
// sendWhatsAppMessage for ANY recipient). Without excluding that phone
// number here, a burst of failed staff alerts silently drags down the
// PATIENT-facing WhatsApp health status even when real patient delivery is
// completely fine -- this is the exact contamination bug that produced
// misleading "WhatsApp DOWN" readings while patient messages were sending
// normally. See getStaffEscalationHealth() below for the separate, correct
// staff-alert-only metric.
function staffPhoneNumbers(): string[] {
  const raw = process.env.STAFF_WHATSAPP_NUMBER || '+256394836298'
  const digits = raw.replace(/\D/g, '')
  return [raw, `+${digits}`, digits]
}

async function computeWindow(since: Date, until: Date | undefined, scope: 'PATIENT' | 'STAFF'): Promise<DeliveryWindow> {
  const where = {
    role: 'AGENT' as const,
    wamid: { not: null },
    createdAt: until ? { gte: since, lt: until } : { gte: since },
    conversation: { phoneNumber: scope === 'STAFF' ? { in: staffPhoneNumbers() } : { notIn: staffPhoneNumbers() } },
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
function classify(window: DeliveryWindow): WhatsAppHealthStatus {
  if (window.attempted < 3) return 'UNKNOWN'
  if (window.failureRate >= 90) return 'DOWN'
  if (window.failureRate >= 20) return 'DEGRADED'
  return 'HEALTHY'
}

export async function getWhatsAppDeliveryHealth(): Promise<WhatsAppDeliveryHealth> {
  const now = new Date()
  const dayStart   = startOfKampalaDay(now)
  const monthStart = startOfKampalaMonth(now)
  const last30      = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const last24h      = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const notStaff = { conversation: { phoneNumber: { notIn: staffPhoneNumbers() } } }

  const [today, thisMonth, last30Days, last24hWindow, lastSuccess, lastFailed, latestFailure, failuresByCode] = await Promise.all([
    computeWindow(dayStart, undefined, 'PATIENT'),
    computeWindow(monthStart, undefined, 'PATIENT'),
    computeWindow(last30, undefined, 'PATIENT'),
    computeWindow(last24h, undefined, 'PATIENT'),
    prisma.aiMessage.findFirst({ where: { status: { in: ['delivered', 'read'] }, ...notStaff }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    prisma.aiMessage.findFirst({ where: { status: 'failed', ...notStaff }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    prisma.metaDeliveryFailure.findFirst({ where: { recipientId: { notIn: staffPhoneNumbers() } }, orderBy: { occurredAt: 'desc' } }),
    prisma.metaDeliveryFailure.groupBy({ by: ['code'], where: { recipientId: { notIn: staffPhoneNumbers() } }, _count: { _all: true } }),
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

// ── Staff escalation delivery health (separate from patient health above) ─────
// Deliberately the mirror image of getWhatsAppDeliveryHealth: same AiMessage/
// MetaDeliveryFailure data, but scoped to ONLY the staff escalation number so
// a burst of failed staff alerts is visible as its own concrete status rather
// than silently blended into (or entirely absent from) patient health.

export interface StaffEscalationHealth {
  last30Days: DeliveryWindow
  lastAttemptAt:            string | null
  lastSuccessfulDeliveryAt: string | null
  lastFailedDeliveryAt:     string | null
  latestError: { code: number; title: string; message: string | null; details: string | null; occurredAt: string } | null
  status: WhatsAppHealthStatus
}

export async function getStaffEscalationHealth(): Promise<StaffEscalationHealth> {
  const now = new Date()
  const last30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const isStaff = { conversation: { phoneNumber: { in: staffPhoneNumbers() } } }

  const [last30Days, lastAttempt, lastSuccess, lastFailed, latestFailure] = await Promise.all([
    computeWindow(last30, undefined, 'STAFF'),
    prisma.aiMessage.findFirst({ where: { role: 'AGENT', wamid: { not: null }, ...isStaff }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    prisma.aiMessage.findFirst({ where: { status: { in: ['delivered', 'read'] }, ...isStaff }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    prisma.aiMessage.findFirst({ where: { status: 'failed', ...isStaff }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    prisma.metaDeliveryFailure.findFirst({ where: { recipientId: { in: staffPhoneNumbers() } }, orderBy: { occurredAt: 'desc' } }),
  ])

  return {
    last30Days,
    lastAttemptAt:            lastAttempt?.createdAt.toISOString() ?? null,
    lastSuccessfulDeliveryAt: lastSuccess?.createdAt.toISOString() ?? null,
    lastFailedDeliveryAt:     lastFailed?.createdAt.toISOString() ?? null,
    latestError: latestFailure ? {
      code:       latestFailure.code,
      title:      latestFailure.title,
      message:    latestFailure.message,
      details:    latestFailure.details,
      occurredAt: latestFailure.occurredAt.toISOString(),
    } : null,
    // Staff volume is naturally low (escalations, not routine traffic), so
    // classify() is applied to a 30-day window here rather than the 24h
    // window used for patient health -- a 24h window would sit at UNKNOWN
    // (sample too small) on most quiet days even when everything is fine.
    status: classify(last30Days),
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

// ── Per-channel ingestion evidence (Meta Integration Health) ──────────────
// Answers one narrow, factual question per channel: "when did we last
// actually persist a real inbound event for this channel?" — the DB-side
// half of distinguishing "Meta is receiving this but our webhook isn't" from
// "everything's fine." Deliberately says nothing about WHY a channel is
// quiet (that's meta-integration-diagnostics.service.ts, the live Graph API
// side) — this is ground truth from our own database only, so it can never
// be wrong about what we actually received, even if every live Graph API
// call below fails.
export type IngestionEvidence = 'RECENT' | 'STALE' | 'NONE'

export interface ChannelIngestionStatus {
  channel: string
  lastInboundEventAt: string | null
  evidence: IngestionEvidence
}

const INGESTION_RECENT_WINDOW_MS = 48 * 60 * 60 * 1000 // 48h — social channels are lower-volume than WhatsApp, so 24h is too tight a bar for "still working"

export async function getChannelIngestionHealth(channels: string[]): Promise<ChannelIngestionStatus[]> {
  return Promise.all(channels.map(async (channel): Promise<ChannelIngestionStatus> => {
    const last = await prisma.aiMessage.findFirst({
      where: { role: 'USER', conversation: { channel } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    })
    if (!last) return { channel, lastInboundEventAt: null, evidence: 'NONE' }
    const evidence: IngestionEvidence = Date.now() - last.createdAt.getTime() < INGESTION_RECENT_WINDOW_MS ? 'RECENT' : 'STALE'
    return { channel, lastInboundEventAt: last.createdAt.toISOString(), evidence }
  }))
}
