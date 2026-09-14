// ─────────────────────────────────────────────────────────────────────────
// CRM Automation — Lead-level consent (release-blocker fix).
//
// Leads previously had NO consent model at all — every lead-directed send
// (acknowledgement, SLA warm message, backlog campaign) went out with zero
// gate. This is the single centralized decision point every lead-directed
// send must now pass through; no provider send may bypass it.
//
// Semantics (deliberately NOT "no record = opted in", unlike the existing
// patient-side default for operational healthcare comms):
//   OPERATIONAL — allowed only when the LEAD ITSELF has evidence of having
//     initiated contact on that exact channel (inbound WhatsApp/FB/IG/
//     website message, quiz submission). This licenses a direct reply to
//     their own inquiry — never indefinite marketing. No evidence -> BLOCK.
//   MARKETING — allowed ONLY with an explicit, separate MARKETING OPT_IN
//     event on that channel. Operational contact is never read as marketing
//     consent. No evidence -> BLOCK, same as MARKETING OPT_OUT -> BLOCK.
//   An OPT_OUT on a channel (regardless of purpose) blocks everything on
//     that channel until a later explicit OPT_IN is logged.
// ─────────────────────────────────────────────────────────────────────────
import { prisma } from '../lib/prisma'
import type { CommsChannel } from '@prisma/client'

export type LeadConsentPurpose = 'OPERATIONAL' | 'MARKETING'
export type LeadConsentStatus = 'OPT_IN' | 'OPT_OUT'
export type LeadConsentSource = 'INBOUND_MESSAGE' | 'WEB_FORM' | 'QUIZ' | 'WALK_IN' | 'STAFF_ENTRY' | 'IMPORT' | 'OTHER'

export type LeadConsentDecision =
  | 'ALLOW_OPERATIONAL'
  | 'ALLOW_MARKETING'
  | 'BLOCK_NO_CONSENT'
  | 'BLOCK_OPT_OUT'
  | 'BLOCK_WRONG_CHANNEL'

export interface LeadConsentDecisionResult {
  decision: LeadConsentDecision
  reason: string
}

export interface RecordLeadConsentParams {
  leadId: string
  channel: CommsChannel
  status: LeadConsentStatus
  purpose: LeadConsentPurpose
  source: LeadConsentSource
  recordedByUserId?: string | null
  metadata?: Record<string, unknown>
}

export async function recordLeadConsent(params: RecordLeadConsentParams) {
  return prisma.leadConsentLog.create({
    data: {
      leadId:           params.leadId,
      channel:          params.channel,
      status:           params.status,
      purpose:          params.purpose,
      source:           params.source,
      recordedByUserId: params.recordedByUserId ?? null,
      metadata:         params.metadata ? JSON.stringify(params.metadata) : null,
    },
  })
}

export interface DecideLeadSendOptions {
  // For OPERATIONAL sends tied to an "active follow-up window" (e.g. the
  // SLA 30-minute warm message) — the inbound-contact evidence must be
  // within this many ms, not just "ever happened".
  operationalWindowMs?: number
}

// THE single decision point — every lead-directed send must call this
// before touching a provider, and must not send when the result is BLOCK_*.
export async function decideLeadSend(
  leadId: string,
  channel: CommsChannel,
  purpose: LeadConsentPurpose,
  opts: DecideLeadSendOptions = {}
): Promise<LeadConsentDecisionResult> {
  const latestForChannel = await prisma.leadConsentLog.findFirst({
    where:   { leadId, channel },
    orderBy: { recordedAt: 'desc' },
  })
  if (latestForChannel?.status === 'OPT_OUT') {
    return { decision: 'BLOCK_OPT_OUT', reason: 'explicit_opt_out_this_channel' }
  }

  if (purpose === 'MARKETING') {
    const marketingOptIn = await prisma.leadConsentLog.findFirst({
      where:   { leadId, channel, purpose: 'MARKETING', status: 'OPT_IN' },
      orderBy: { recordedAt: 'desc' },
    })
    if (!marketingOptIn) return { decision: 'BLOCK_NO_CONSENT', reason: 'no_marketing_opt_in_this_channel' }
    return { decision: 'ALLOW_MARKETING', reason: 'explicit_marketing_opt_in' }
  }

  // OPERATIONAL
  const operationalEvidence = await prisma.leadConsentLog.findFirst({
    where:   { leadId, channel, purpose: 'OPERATIONAL' },
    orderBy: { recordedAt: 'desc' },
  })
  if (operationalEvidence) {
    if (opts.operationalWindowMs) {
      const withinWindow = Date.now() - operationalEvidence.recordedAt.getTime() <= opts.operationalWindowMs
      if (!withinWindow) return { decision: 'BLOCK_NO_CONSENT', reason: 'operational_evidence_outside_active_window' }
    }
    return { decision: 'ALLOW_OPERATIONAL', reason: 'inbound_contact_origin_present' }
  }

  // No evidence on the requested channel — check whether evidence exists on
  // a DIFFERENT channel, for a more precise audit reason than a bare "no consent".
  const otherChannelEvidence = await prisma.leadConsentLog.findFirst({
    where: { leadId, purpose: 'OPERATIONAL' },
  })
  if (otherChannelEvidence) {
    return { decision: 'BLOCK_WRONG_CHANNEL', reason: `contact_origin_recorded_for_${otherChannelEvidence.channel}_not_${channel}` }
  }

  return { decision: 'BLOCK_NO_CONSENT', reason: 'no_contact_origin_evidence' }
}

export function isAllowed(result: LeadConsentDecisionResult): boolean {
  return result.decision === 'ALLOW_OPERATIONAL' || result.decision === 'ALLOW_MARKETING'
}

export async function getLeadConsentHistory(leadId: string, channel?: CommsChannel) {
  return prisma.leadConsentLog.findMany({
    where:   { leadId, ...(channel ? { channel } : {}) },
    orderBy: { recordedAt: 'desc' },
  })
}
