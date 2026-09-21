// ─────────────────────────────────────────────────────────────────────────
// CRM Automation — Lead automated stage transitions + stage history
// (Parts N and P). Stages stay exactly NEW/CONTACTED/QUALIFIED/CONVERTED/
// LOST — Lead.status/stage (both existing String columns) are still what's
// written; nothing here introduces a new stage.
// ─────────────────────────────────────────────────────────────────────────
import { prisma } from '../lib/prisma'
import type { Lead } from '@prisma/client'
import { emitAutomationEvent, exitActiveEnrollments } from './automation-events.service'
import { cancelSlaOnHumanReply } from './lead-sla.service'
import { phoneVariants } from '../utils/phone'

const FORTY_EIGHT_HR_MS = 48 * 60 * 60 * 1000

export type StageTrigger = 'AUTOMATION' | 'MANUAL'

export interface TransitionOptions {
  changedBy: string | null // User.id; null = automation with no human actor
  trigger: StageTrigger
  reason?: string
}

// Single write path for Lead.status/stage — every transition, automated or
// manual, goes through here so LeadStageHistory can never miss a row.
export async function transitionLeadStage(leadId: string, toStage: string, opts: TransitionOptions): Promise<Lead> {
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })
  if (lead.status === toStage) return lead // no-op — don't write duplicate history for a non-change

  if (toStage === 'LOST' && !opts.reason) {
    throw new Error('A loss reason is required whenever a lead moves to LOST')
  }

  const updated = await prisma.lead.update({
    where: { id: leadId },
    data: {
      status: toStage,
      stage:  toStage,
      lossReason: toStage === 'LOST' ? opts.reason! : lead.lossReason,
    },
  })

  await prisma.leadStageHistory.create({
    data: {
      leadId,
      fromStage: lead.status,
      toStage,
      changedBy: opts.changedBy,
      trigger:   opts.trigger,
      reason:    opts.reason ?? null,
    },
  })

  await emitAutomationEvent({
    entityType: 'LEAD',
    entityId:   leadId,
    eventType:  'lead_stage_changed',
    fromValue:  lead.status,
    toValue:    toStage,
    metadata:   { trigger: opts.trigger, reason: opts.reason },
  })

  return updated
}

// ── NEW -> CONTACTED: first HUMAN reply logged by the ASSIGNED owner ───────
// AI-generated replies must never call this — only a real "staff replied"
// action (human-takeover send, or an explicit "log reply" action) should.
//
// IMPORTANT: this is a STAFF OUTBOUND reply (staff -> lead), not a message
// FROM the lead. It must never touch lastInboundReplyAt — that field is
// reserved exclusively for recordInboundLeadMessage() below. firstReplyAt/
// firstHumanReplyAt measure how fast STAFF first responded (the response-
// time SLA metric in reporting.service.ts); lastOutboundAt tracks every
// subsequent staff message and drives the 48h CONTACTED->LOST no-response
// check in sweepStaleContactedLeads().
export async function logHumanReply(leadId: string, byUserId: string): Promise<Lead> {
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })
  const now = new Date()

  const updated = await prisma.lead.update({
    where: { id: leadId },
    data: {
      firstReplyAt:      lead.firstReplyAt ?? now,
      firstHumanReplyAt: lead.firstHumanReplyAt ?? now,
      lastOutboundAt:    now,
    },
  })

  await cancelSlaOnHumanReply(leadId)
  await exitActiveEnrollments('LEAD', leadId, 'EXITED_REPLY', 'human_reply_logged')

  const isAssignedOwner = !!lead.assignedTo && lead.assignedTo === byUserId
  if (lead.status === 'NEW' && isAssignedOwner) {
    return transitionLeadStage(leadId, 'CONTACTED', {
      changedBy: byUserId,
      trigger:   'AUTOMATION',
      reason:    'first_human_reply_by_assigned_owner',
    })
  }

  return updated
}

// ── Automatic wiring: NEW -> CONTACTED from a REAL staff reply ─────────────
// The root cause of "345 leads stuck in New": logHumanReply() above was only
// ever called from a separate, easy-to-miss "Log Reply" button on the Leads
// pipeline page — never from the actual place staff reply to a lead (the
// human-takeover message-send route). This is the missing connection.
//
// AiConversation has no leadId column, so the match is by phone — the same
// phoneVariants() utility already used everywhere else for phone matching
// (crm.ts search, lead-patient-link.service.ts). Deliberately excludes
// CONVERTED/LOST leads: a phone number matching a long-closed lead should
// never resurrect it or stamp fresh reply data on it. Never throws — a
// lookup/match failure here must never block the underlying message send
// (callers should treat this as fire-and-forget).
export async function advanceLeadOnHumanReply(phoneNumber: string, byUserId: string): Promise<void> {
  try {
    const variants = phoneVariants(phoneNumber)
    if (variants.length === 0) return
    const lead = await prisma.lead.findFirst({
      where:   { phone: { in: variants }, status: { notIn: ['CONVERTED', 'LOST'] } },
      orderBy: { updatedAt: 'desc' },
    })
    if (!lead) return
    await logHumanReply(lead.id, byUserId)
  } catch (err) {
    console.error('[LeadStage] advanceLeadOnHumanReply failed (non-fatal):', err)
  }
}

// Records an inbound message from the lead without necessarily being "the"
// qualifying human-reply event (e.g. the lead replies again while CONTACTED)
// — used by the 48h QUALIFIED window and by CONTACTED->LOST's "no response" check.
export async function recordInboundLeadMessage(leadId: string): Promise<void> {
  await prisma.lead.update({ where: { id: leadId }, data: { lastInboundReplyAt: new Date() } })
}

export async function recordOutboundLeadMessage(leadId: string): Promise<void> {
  await prisma.lead.update({ where: { id: leadId }, data: { lastOutboundAt: new Date() } })
}

// ── CONTACTED -> QUALIFIED: lead responds again within 48h AND owner marks
// a qualifying intent signal (pricing ask, wants an appointment, etc). Both
// conditions are required — an owner cannot qualify a lead that hasn't
// actually responded recently, and a reply alone is never enough.
export async function applyQualifyingIntent(leadId: string, byUserId: string, intent: string): Promise<Lead> {
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })
  if (lead.status !== 'CONTACTED') {
    throw new Error(`Cannot apply qualifying intent — lead is in stage ${lead.status}, not CONTACTED`)
  }
  const repliedRecently = !!lead.lastInboundReplyAt && Date.now() - lead.lastInboundReplyAt.getTime() <= FORTY_EIGHT_HR_MS
  if (!repliedRecently) {
    throw new Error('Lead has not responded within the last 48 hours — cannot qualify yet')
  }

  await prisma.lead.update({ where: { id: leadId }, data: { qualifyingIntent: intent } })
  return transitionLeadStage(leadId, 'QUALIFIED', { changedBy: byUserId, trigger: 'MANUAL', reason: `qualifying_intent:${intent}` })
}

// ── CONTACTED -> LOST: no lead response within 48h of the last outbound
// message. Swept periodically alongside the SLA engine (see main.ts wiring).
export async function sweepStaleContactedLeads(): Promise<number> {
  const cutoff = new Date(Date.now() - FORTY_EIGHT_HR_MS)
  // Prisma can't compare two columns of the same row in a portable `where`,
  // so this fetches a coarse candidate set (status + outbound age) and the
  // loop below does the precise "replied after the last outbound?" check.
  const candidates = await prisma.lead.findMany({
    where: {
      status: 'CONTACTED',
      lastOutboundAt: { not: null, lte: cutoff },
    },
  })

  let count = 0
  for (const lead of candidates) {
    // Re-check precisely in JS (Prisma can't compare two columns portably in
    // a single `where` across all providers) — a reply after the last
    // outbound message means this lead is NOT actually stale.
    if (lead.lastInboundReplyAt && lead.lastOutboundAt && lead.lastInboundReplyAt >= lead.lastOutboundAt) continue
    await transitionLeadStage(lead.id, 'LOST', { changedBy: null, trigger: 'AUTOMATION', reason: 'no_response' })
    count++
  }
  return count
}

// ── QUALIFIED -> CONVERTED: appointment booked OR treatment started ────────
export async function convertLeadOnBooking(leadId: string): Promise<Lead> {
  await exitActiveEnrollments('LEAD', leadId, 'EXITED_BOOKED', 'appointment_booked')
  return transitionLeadStage(leadId, 'CONVERTED', { changedBy: null, trigger: 'AUTOMATION', reason: 'appointment_or_treatment_started' })
}

// ── ANY -> LOST: manual owner override, loss reason required ───────────────
export async function markLeadLostManually(leadId: string, byUserId: string, reason: string): Promise<Lead> {
  await exitActiveEnrollments('LEAD', leadId, 'STOPPED', 'manual_lost_override')
  return transitionLeadStage(leadId, 'LOST', { changedBy: byUserId, trigger: 'MANUAL', reason })
}