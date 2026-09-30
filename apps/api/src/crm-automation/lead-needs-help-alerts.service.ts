// ─────────────────────────────────────────────────────────────────────────
// CRM Automation — staff push/notification sweep over the existing "Needs
// Attention" lead queue (needs-attention.service.ts). This module invents no
// new lead state machine: it only reads the same LEAD_OWNER categories that
// already drive the CRM dashboard, and turns "this lead needs attention"
// into a staff notification when nobody has one open for it yet.
//
// Recipient: the lead's own owner (Lead.assignedTo) when it has one; ADMIN
// staff otherwise (covers UNASSIGNED leads, and an owner who has since gone
// inactive). A lead appearing in multiple categories at once (e.g. both
// UNANSWERED_NEW and STALE_UNTOUCHED) still produces exactly ONE alert —
// matching distinctLeadCount's own dedup rule in needs-attention.service.ts.
//
// Dedup/idempotency: reuses Notification.isRead as the "still open" signal
// (no migration, no separate incident table). Before creating a new
// notification for (recipient, lead), we check whether an UNREAD one with
// the same title+href already exists for that recipient — if so, the
// existing alert is still live and we skip. Once staff read it (or the lead
// leaves these categories entirely and a later sweep stops looking at it),
// a genuinely new occurrence can alert again.
// ─────────────────────────────────────────────────────────────────────────
import { prisma } from '../lib/prisma'
import { buildNeedsAttentionQueue } from './needs-attention.service'
import { isCrmFeatureLive } from './dry-run'
import { sendPushToUser } from '../services/push.service'

const LEAD_NEEDS_HELP_CATEGORIES = ['UNANSWERED_NEW', 'OVERDUE_FOLLOWUP', 'STALE_UNTOUCHED', 'QUALIFIED_UNBOOKED', 'UNASSIGNED']

const TITLE = 'Lead needs help'
// Generic on purpose — the OS push popup must say WHAT kind of action is
// needed, never which lead/person it's about (lock-screen privacy).
const BODY = 'A CRM lead needs staff assistance. Tap to review.'

function hrefForRole(role: string, leadId: string): string {
  return role === 'RECEPTIONIST' ? `/receptionist/leads?open=${leadId}` : `/leads?open=${leadId}`
}

async function notifyLeadNeedsHelp(userId: string, role: string, leadId: string): Promise<boolean> {
  const href = hrefForRole(role, leadId)

  const existing = await prisma.notification.findFirst({
    where: { userId, href, title: TITLE, isRead: false },
    select: { id: true },
  })
  if (existing) return false

  await prisma.notification.create({
    data: { userId, type: 'ESCALATION', title: TITLE, body: BODY, href, isRead: false },
  })

  if (isCrmFeatureLive('OPERATIONAL')) {
    sendPushToUser(userId, { title: TITLE, body: BODY, url: href }).catch(() => {})
  }
  return true
}

export async function checkLeadNeedsHelpAlerts(): Promise<{ leadsConsidered: number; notified: number }> {
  const queue = await buildNeedsAttentionQueue()
  const relevantCategories = queue.categories.filter(c => LEAD_NEEDS_HELP_CATEGORIES.includes(c.key))

  const leadById = new Map<string, { id: string; assignedTo: string | null }>()
  for (const category of relevantCategories) {
    for (const item of category.items) {
      const id = item.id as string
      if (!leadById.has(id)) {
        leadById.set(id, { id, assignedTo: (item.assignedTo as string | null | undefined) ?? null })
      }
    }
  }
  if (leadById.size === 0) return { leadsConsidered: 0, notified: 0 }

  const admins = await prisma.user.findMany({ where: { role: 'ADMIN', isActive: true }, select: { id: true, role: true } })

  let notified = 0
  for (const lead of leadById.values()) {
    let recipients: Array<{ id: string; role: string }> = []
    if (lead.assignedTo) {
      const owner = await prisma.user.findUnique({ where: { id: lead.assignedTo }, select: { id: true, role: true, isActive: true } })
      if (owner?.isActive) recipients = [{ id: owner.id, role: owner.role }]
    }
    if (recipients.length === 0) recipients = admins

    for (const recipient of recipients) {
      const created = await notifyLeadNeedsHelp(recipient.id, recipient.role, lead.id)
      if (created) notified++
    }
  }

  return { leadsConsidered: leadById.size, notified }
}
