// ─────────────────────────────────────────────────────────────────────────
// CRM Automation — single lead-creation orchestration entry point (Part K),
// now consent-gated (release-blocker fix).
//
// findOrCreateLeadForChannel() is the ONLY place a Lead row is ever created
// from a real channel (WhatsApp, Website chat, Facebook, Instagram, Quiz
// funnel, manual/walk-in). Each caller supplies its own dedup `where` clause
// (channels differ slightly in what "the same lead" means) so existing dedup
// semantics are preserved exactly. What's centralized:
//   - existing lead found -> update lastMessage/name, log a genuine inbound
//     reply (recordInboundLeadMessage), record OPERATIONAL contact-origin
//     evidence when the caller identifies this as a real inbound channel
//     message, never re-run new-lead intake
//   - no lead found -> create it, record the SAME contact-origin evidence
//     (if provided), then run handleNewLeadCreated() once
//
// Manual/walk-in entry passes NO contactEvidence — per the consent rules,
// that means no operational evidence exists, so the acknowledgement below
// is correctly blocked by decideLeadSend() rather than sent blindly.
//
// handleNewLeadCreated() performs: (1) source attribution, (2) same-channel
// acknowledgement — dry-run gated AND consent-gated: skipped entirely when a
// real-time AI reply already covers the same inbound message (duplicate-ack
// avoidance), and blocked outright when decideLeadSend() finds no
// operational contact-origin evidence; (3) owner assignment via the
// configured RoutingRule (Part L); (4) in-app task creation; (5) owner push
// notification (in-app row always written, real push dry-run gated);
// (6) starts the 15-minute SLA clock (Lead.slaState defaults to 'PENDING').
// ─────────────────────────────────────────────────────────────────────────
import { prisma } from '../lib/prisma'
import type { Lead, Prisma, CommsChannel } from '@prisma/client'
import { emitAutomationEvent } from './automation-events.service'
import { pickOwnerForNewLead } from './lead-routing.service'
import { recordInboundLeadMessage } from './lead-stage.service'
import { sendOrSimulate, isCrmAutomationLive } from './dry-run'
import { sendPushToUser } from '../services/push.service'
import { recordLeadConsent, decideLeadSend, isAllowed, type LeadConsentSource } from './lead-consent.service'

// Dynamic import (not a static top-level one) deliberately, matching the
// same technique already used by ai-suite/sms/sms.service.ts: several real
// channel handlers (whatsapp.service.ts, facebook.routes.ts) now import
// THIS file to create leads, so a static top-level import of
// whatsapp.service.ts here would be a circular require.
async function sendWhatsAppMessage(to: string, body: string): Promise<string> {
  const mod = await import('../ai-suite/whatsapp/whatsapp.service')
  return mod.sendWhatsAppMessage(to, body)
}

const FIFTEEN_MIN_MS = 15 * 60 * 1000

export interface HandleNewLeadOptions {
  // Set true for channels where an AI agent (or other real-time reply path)
  // already sends the lead a response to this same inbound message —
  // WhatsApp/Facebook/Instagram/website chat all have one; Quiz funnel
  // submission and manual/walk-in entry do not, so they keep the ack.
  skipAcknowledgement?: boolean
  ackChannel?: CommsChannel
}

export async function handleNewLeadCreated(
  lead: Lead,
  opts: HandleNewLeadOptions = {}
): Promise<{ ownerId: string | null; acknowledgement: { dryRun: boolean } | { blocked: string } | null }> {
  // (1) Source/tag attribution
  await emitAutomationEvent({
    entityType: 'LEAD',
    entityId:   lead.id,
    eventType:  'lead_created',
    toValue:    lead.source,
  })

  // (3) Owner assignment — only if not already assigned at creation time
  let ownerId = lead.assignedTo
  if (!ownerId) {
    ownerId = await pickOwnerForNewLead(lead.source)
    if (ownerId) {
      await prisma.lead.update({ where: { id: lead.id }, data: { assignedTo: ownerId } })
    }
  }

  // (4) In-app task, due at the same 15-minute SLA boundary
  await prisma.task.create({
    data: {
      entityType:   'LEAD',
      entityId:     lead.id,
      assignedToId: ownerId,
      title:        `Follow up with new lead: ${lead.name || lead.phone || lead.email || 'Unknown'}`,
      description:  `Source: ${lead.source}`,
      dueAt:        new Date(Date.now() + FIFTEEN_MIN_MS),
    },
  })

  // (5) Owner push notification — in-app row always written; real browser
  // push is dry-run gated (Part W explicitly lists staff push as prohibited
  // during development/testing).
  if (ownerId) {
    const title = 'New lead assigned'
    const body  = `${lead.name || lead.phone || 'A new lead'} via ${lead.source}`
    await prisma.notification.create({ data: { userId: ownerId, type: 'MESSAGE', title, body, href: '/leads' } })
    if (isCrmAutomationLive()) {
      await sendPushToUser(ownerId, { title, body, url: '/leads' })
    }
  }

  // (2) Same-channel acknowledgement — dry-run gated AND consent-gated.
  // Manual/walk-in leads (no contact-origin evidence recorded) are correctly
  // blocked here rather than messaged blindly (release-blocker fix).
  let acknowledgement: { dryRun: boolean } | { blocked: string } | null = null
  if (lead.phone && !opts.skipAcknowledgement) {
    const ackChannel = opts.ackChannel ?? 'WHATSAPP'
    const consent = await decideLeadSend(lead.id, ackChannel, 'OPERATIONAL')
    if (!isAllowed(consent)) {
      acknowledgement = { blocked: consent.reason }
    } else {
      const firstName = (lead.name || '').trim().split(/\s+/)[0] || 'there'
      const ackMessage = `Hi ${firstName}! Thanks for reaching out to Code Clinic 😊 One of our team will be in touch shortly.`
      const result = await sendOrSimulate('WHATSAPP', lead.phone, ackMessage, () => sendWhatsAppMessage(lead.phone!, ackMessage))
      acknowledgement = { dryRun: result.dryRun }
    }
  }

  // (6) 15-minute SLA timer — Lead.slaState defaults to 'PENDING' and
  // Lead.createdAt is already set by Prisma's @default(now()); checkLeadSlas()
  // (lead-sla.service.ts) is the sweep that acts on it.

  return { ownerId, acknowledgement }
}

export interface LeadContactEvidence {
  channel: CommsChannel
  source: LeadConsentSource
}

export interface FindOrCreateLeadParams {
  // Caller-provided dedup filter — preserves each channel's existing
  // "is this the same lead" semantics exactly (some scope by source, some
  // don't); centralizing this away would risk silently changing which
  // messages get merged into the same Lead row on live channels.
  where: Prisma.LeadWhereInput
  createData: Prisma.LeadCreateInput
  // When an existing lead is found, these update it and are treated as a
  // genuine inbound reply from the lead (recordInboundLeadMessage).
  onExistingMessage?: string | null
  onExistingNameIfMissing?: string | null
  intakeOptions?: HandleNewLeadOptions
  // Present ONLY for channels where the lead itself genuinely initiated
  // contact (WhatsApp/Facebook/Instagram/website inbound message, quiz
  // submission). Omitted for manual/walk-in entry — no implied consent.
  contactEvidence?: LeadContactEvidence
}

export interface FindOrCreateLeadResult {
  lead: Lead
  isNew: boolean
}

// The single creation path for every real channel. Never creates a second
// Lead row for what the caller's `where` identifies as the same contact, and
// never re-runs new-lead intake (owner assignment/task/ack/push) for a
// message on an already-existing lead.
export async function findOrCreateLeadForChannel(params: FindOrCreateLeadParams): Promise<FindOrCreateLeadResult> {
  const existing = await prisma.lead.findFirst({ where: params.where, orderBy: { createdAt: 'desc' } })

  if (existing) {
    const updateData: Prisma.LeadUpdateInput = {}
    if (params.onExistingMessage !== undefined) updateData.lastMessage = params.onExistingMessage
    if (params.onExistingNameIfMissing && !existing.name) updateData.name = params.onExistingNameIfMissing

    const lead = Object.keys(updateData).length > 0
      ? await prisma.lead.update({ where: { id: existing.id }, data: updateData })
      : existing

    // A message landing on an existing, non-converted/lost lead is a real
    // inbound reply FROM the lead — this is the fix that makes the 48h
    // CONTACTED->QUALIFIED window and the CONTACTED->LOST no-response sweep
    // actually observe real channel traffic instead of only manual actions.
    await recordInboundLeadMessage(lead.id)

    if (params.contactEvidence) {
      await recordLeadConsent({
        leadId:  lead.id,
        channel: params.contactEvidence.channel,
        status:  'OPT_IN',
        purpose: 'OPERATIONAL',
        source:  params.contactEvidence.source,
      })
    }

    return { lead, isNew: false }
  }

  const lead = await prisma.lead.create({ data: params.createData })

  if (params.contactEvidence) {
    await recordLeadConsent({
      leadId:  lead.id,
      channel: params.contactEvidence.channel,
      status:  'OPT_IN',
      purpose: 'OPERATIONAL',
      source:  params.contactEvidence.source,
    })
  }

  await handleNewLeadCreated(lead, params.intakeOptions)
  return { lead, isNew: true }
}
