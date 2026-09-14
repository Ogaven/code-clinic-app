// ─────────────────────────────────────────────────────────────────────────
// CRM Automation — Lead SLA engine (Part M).
//
// No durable per-lead timer exists in this codebase (no BullMQ/Agenda — see
// the audit in the final report). This mirrors the same [status,
// createdAt]-style polling idiom already used for OutboundQueue/
// AiScheduledMessage: a periodic sweep (checkLeadSlas, called from main.ts
// on a short interval) finds leads that have crossed a threshold and are
// still in slaState PENDING/ESCALATED_15/ESCALATED_30, escalates them, and
// advances slaState so the same lead is never escalated twice for the same
// threshold. cancelSlaOnHumanReply() writes slaState synchronously the
// moment a qualifying reply is logged — by the time any sweep next runs,
// the lead has already dropped out of every "needs escalation" query, so no
// false escalation can fire after a reply.
// ─────────────────────────────────────────────────────────────────────────
import { prisma } from '../lib/prisma'
import { isCrmAutomationLive, sendOrSimulate } from './dry-run'
import { sendPushToUser, type PushPayload } from '../services/push.service'
import { decideLeadSend, isAllowed } from './lead-consent.service'

// Dynamic import, matching the same technique used by lead-intake.service.ts
// and ai-suite/sms/sms.service.ts: whatsapp.service.ts creates leads via
// lead-intake.service.ts -> lead-stage.service.ts -> this file, so a static
// top-level import of whatsapp.service.ts here would be a circular require.
async function sendWhatsAppMessage(to: string, body: string): Promise<string> {
  const mod = await import('../ai-suite/whatsapp/whatsapp.service')
  return mod.sendWhatsAppMessage(to, body)
}

const FIFTEEN_MIN_MS = 15 * 60 * 1000
const THIRTY_MIN_MS  = 30 * 60 * 1000
const TWENTY_FOUR_HR_MS = 24 * 60 * 60 * 1000

const OPEN_LEAD_STATUSES = { notIn: ['CONVERTED', 'LOST'] }

async function notifyUser(userId: string, title: string, body: string, href: string | null): Promise<void> {
  // In-app notification row is always created — it's internal, not an
  // external "real send", and staff need to see SLA state while testing.
  await prisma.notification.create({ data: { userId, type: 'ESCALATION', title, body, href: href ?? undefined } })
  // Browser push IS an external, staff-facing send — gated per Part W
  // ("push notification to real staff" is explicitly listed as prohibited
  // during development/testing).
  if (isCrmAutomationLive()) {
    const payload: PushPayload = { title, body, url: href ?? undefined }
    await sendPushToUser(userId, payload)
  }
}

async function findTeamLeadIds(): Promise<string[]> {
  const admins = await prisma.user.findMany({ where: { role: 'ADMIN', isActive: true }, select: { id: true } })
  return admins.map(a => a.id)
}

export async function checkLeadSlas(): Promise<{ escalated15: number; warm30: number; stale24: number }> {
  const now = new Date()
  let escalated15 = 0, warm30 = 0, stale24 = 0

  // ── 15 minutes without a human reply: notify owner + team lead ──────────
  const needs15 = await prisma.lead.findMany({
    where: {
      firstHumanReplyAt: null,
      slaState: 'PENDING',
      createdAt: { lte: new Date(now.getTime() - FIFTEEN_MIN_MS) },
      status: OPEN_LEAD_STATUSES,
    },
  })
  for (const lead of needs15) {
    const teamLeads = await findTeamLeadIds()
    const recipients = new Set([lead.assignedTo, ...teamLeads].filter(Boolean) as string[])
    for (const userId of recipients) {
      await notifyUser(userId, 'Lead needs a reply', `${lead.name || lead.phone || 'A lead'} has had no reply in 15 minutes.`, '/leads')
    }
    await prisma.lead.update({ where: { id: lead.id }, data: { slaState: 'ESCALATED_15' } })
    await prisma.leadSlaEvent.create({ data: { leadId: lead.id, type: 'ESCALATION_15' } })
    escalated15++
  }

  // ── 30 minutes without a human reply: second warm message to the lead ───
  const needs30 = await prisma.lead.findMany({
    where: {
      firstHumanReplyAt: null,
      slaState: 'ESCALATED_15',
      createdAt: { lte: new Date(now.getTime() - THIRTY_MIN_MS) },
      status: OPEN_LEAD_STATUSES,
    },
  })
  for (const lead of needs30) {
    // Real second warm-message send, dry-run gated same as every other
    // outbound path in this workstream (crm-automation/dry-run.ts), AND
    // consent-gated: this is a continuation of the lead's OWN active
    // inquiry, not marketing — it may only fire when there is operational
    // contact-origin evidence within the active follow-up window (24h,
    // matching this same file's own staleness threshold), and never when
    // the lead has opted out.
    let dryRun = true
    let consentReason: string | null = null
    if (lead.phone) {
      const consent = await decideLeadSend(lead.id, 'WHATSAPP', 'OPERATIONAL', { operationalWindowMs: TWENTY_FOUR_HR_MS })
      if (isAllowed(consent)) {
        const firstName = (lead.name || '').trim().split(/\s+/)[0] || 'there'
        const body = `Hi ${firstName}! Just checking in — we haven't heard back yet. Still interested in booking with Code Clinic? Reply here whenever you're ready 😊`
        const result = await sendOrSimulate('WHATSAPP', lead.phone, body, () => sendWhatsAppMessage(lead.phone!, body))
        dryRun = result.dryRun
      } else {
        consentReason = consent.reason
      }
    }
    await prisma.lead.update({ where: { id: lead.id }, data: { slaState: 'ESCALATED_30' } })
    await prisma.leadSlaEvent.create({ data: { leadId: lead.id, type: 'WARM_MESSAGE_30', metadata: JSON.stringify({ dryRun, hadPhone: !!lead.phone, blockedReason: consentReason }) } })
    warm30++
  }

  // ── 24 hours without a human reply: mark stale, escalate to Admin ───────
  const needsStale = await prisma.lead.findMany({
    where: {
      firstHumanReplyAt: null,
      slaState: { in: ['PENDING', 'ESCALATED_15', 'ESCALATED_30'] },
      createdAt: { lte: new Date(now.getTime() - TWENTY_FOUR_HR_MS) },
      status: OPEN_LEAD_STATUSES,
    },
  })
  for (const lead of needsStale) {
    const admins = await findTeamLeadIds()
    for (const userId of admins) {
      await notifyUser(userId, 'Lead is stale (24h)', `${lead.name || lead.phone || 'A lead'} has gone 24 hours with no human reply.`, '/leads')
    }
    await prisma.lead.update({ where: { id: lead.id }, data: { slaState: 'STALE_24H' } })
    await prisma.leadSlaEvent.create({ data: { leadId: lead.id, type: 'STALE_24H' } })
    stale24++
  }

  return { escalated15, warm30, stale24 }
}

// Called the moment a qualifying human reply is logged (lead-stage.service.ts)
// — cancels the SLA clock immediately so the sweep above can never escalate
// this lead again.
export async function cancelSlaOnHumanReply(leadId: string): Promise<void> {
  await prisma.lead.update({ where: { id: leadId }, data: { slaState: 'REPLIED' } })
  await prisma.leadSlaEvent.create({ data: { leadId, type: 'SLA_CANCELLED' } })
}