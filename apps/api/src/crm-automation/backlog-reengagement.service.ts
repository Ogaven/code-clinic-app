// ─────────────────────────────────────────────────────────────────────────
// CRM Automation — one-time backlog re-engagement (Part Q).
//
// Three explicit, separately-triggered steps — nothing here runs on its own
// timer, and none of it may touch production data until an admin calls each
// step deliberately (tagBacklogLeads -> executeBacklogCampaign requires an
// approvedBy user id -> sweepBacklogNoResponse). This is intentional: the
// spec is explicit that the real backlog must NOT be messaged automatically
// during/after this workstream without separate approval.
// ─────────────────────────────────────────────────────────────────────────
import { prisma } from '../lib/prisma'
import { sendOrSimulate } from './dry-run'
import { sendWhatsAppMessage } from '../ai-suite/whatsapp/whatsapp.service'
import { transitionLeadStage } from './lead-stage.service'
import { decideLeadSend, isAllowed } from './lead-consent.service'

const BACKLOG_AGE_CUTOFF_DAYS = 30

// Step 2 (preview) — how many currently-tagged backlog leads would actually
// receive a message right now, without sending anything. Since no UI/flow in
// this codebase yet captures an explicit MARKETING opt-in from a lead, this
// will honestly report zero until that exists — which is the correct,
// consent-safe default, not a bug.
export async function previewBacklogEligibility(runId: string): Promise<{ totalTagged: number; eligibleToSend: number; blockedReasons: Record<string, number> }> {
  const leads = await prisma.lead.findMany({
    where: { backlogTag: true, backlogCampaignAt: null, status: 'NEW' },
  })
  let eligibleToSend = 0
  const blockedReasons: Record<string, number> = {}
  for (const lead of leads) {
    if (!lead.phone) { blockedReasons.no_phone = (blockedReasons.no_phone ?? 0) + 1; continue }
    const consent = await decideLeadSend(lead.id, 'WHATSAPP', 'MARKETING')
    if (isAllowed(consent)) eligibleToSend++
    else blockedReasons[consent.reason] = (blockedReasons[consent.reason] ?? 0) + 1
  }
  void runId // reserved for future per-run scoping; all TAGGED leads today belong to a single active run
  return { totalTagged: leads.length, eligibleToSend, blockedReasons }
}

// Step 1 — identify legacy New leads and bulk-tag them. Read/tag only, never sends anything.
export async function tagBacklogLeads(): Promise<{ leadCount: number; runId: string }> {
  const inProgress = await prisma.backlogCampaignRun.findFirst({ where: { status: { not: 'COMPLETED' } } })
  if (inProgress) throw new Error(`A backlog re-engagement run (${inProgress.id}) is already in progress — status ${inProgress.status}`)

  const cutoff = new Date(Date.now() - BACKLOG_AGE_CUTOFF_DAYS * 86_400_000)
  const legacy = await prisma.lead.findMany({
    where: { status: 'NEW', backlogTag: false, createdAt: { lte: cutoff } },
  })

  const run = await prisma.backlogCampaignRun.create({ data: { status: 'TAGGED', leadCount: legacy.length } })
  await prisma.lead.updateMany({
    where: { id: { in: legacy.map(l => l.id) } },
    data:  { backlogTag: true },
  })

  return { leadCount: legacy.length, runId: run.id }
}

// Step 2 — the actual re-engagement send. Requires an explicit approving
// admin user id; refuses to run twice for the same run. Every lead is
// individually consent-gated through decideLeadSend(purpose:'MARKETING') —
// re-engagement is marketing, not a continuation of an active inquiry, so it
// requires an explicit logged MARKETING opt-in per lead per channel. A lead
// with no such opt-in (the overwhelming majority, today, since nothing yet
// captures one) is skipped, not messaged.
export async function executeBacklogCampaign(runId: string, approvedByUserId: string): Promise<{ sent: number; skippedNoConsent: number; anyDryRun: boolean }> {
  const run = await prisma.backlogCampaignRun.findUniqueOrThrow({ where: { id: runId } })
  if (run.status !== 'TAGGED') {
    throw new Error(`Backlog run ${runId} is in status ${run.status}, expected TAGGED`)
  }

  await prisma.backlogCampaignRun.update({
    where: { id: runId },
    data:  { approvedBy: approvedByUserId, approvedAt: new Date() },
  })

  const leads = await prisma.lead.findMany({
    where: { backlogTag: true, backlogCampaignAt: null, status: 'NEW' },
  })

  let sent = 0
  let skippedNoConsent = 0
  let anyDryRun = false

  for (const lead of leads) {
    if (!lead.phone) continue
    const consent = await decideLeadSend(lead.id, 'WHATSAPP', 'MARKETING')
    if (!isAllowed(consent)) { skippedNoConsent++; continue }
    const firstName = (lead.name || '').trim().split(/\s+/)[0]
    const body = `Hi${firstName ? ' ' + firstName : ''}! It's been a while since we heard from you — Code Clinic would love to help with your dental care whenever you're ready. Reply here if you'd like to book.`
    const result = await sendOrSimulate('BACKLOG', 'WHATSAPP', lead.phone, body, () => sendWhatsAppMessage(lead.phone!, body))
    if (result.dryRun) anyDryRun = true
    await prisma.lead.update({ where: { id: lead.id }, data: { backlogCampaignAt: new Date() } })
    sent++
  }

  await prisma.backlogCampaignRun.update({ where: { id: runId }, data: { status: 'CAMPAIGN_SENT' } })
  return { sent, skippedNoConsent, anyDryRun }
}

// Step 3 — responses return to the normal New->Contacted flow automatically
// (lead-stage.service.ts's logHumanReply/recordInboundLeadMessage apply to
// every lead regardless of backlogTag — no special-casing needed there).
// This only handles the "still no response after the campaign window" arm.
export async function sweepBacklogNoResponse(windowDays = 14): Promise<number> {
  const cutoff = new Date(Date.now() - windowDays * 86_400_000)
  const stale = await prisma.lead.findMany({
    where: {
      backlogTag: true,
      backlogNoResponse: false,
      backlogCampaignAt: { not: null, lte: cutoff },
      status: 'NEW',
    },
  })

  for (const lead of stale) {
    await transitionLeadStage(lead.id, 'LOST', { changedBy: null, trigger: 'AUTOMATION', reason: 'backlog_no_response' })
    await prisma.lead.update({ where: { id: lead.id }, data: { backlogNoResponse: true } })
  }

  const remaining = await prisma.lead.count({
    where: { backlogTag: true, backlogNoResponse: false, status: 'NEW' },
  })
  if (remaining === 0 && stale.length > 0) {
    await prisma.backlogCampaignRun.updateMany({
      where: { status: 'CAMPAIGN_SENT' },
      data:  { status: 'COMPLETED' },
    })
  }

  return stale.length
}