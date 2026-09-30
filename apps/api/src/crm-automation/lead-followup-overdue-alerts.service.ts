// ─────────────────────────────────────────────────────────────────────────
// CRM Automation — staff push/notification sweep over lead-followups.
// service.ts's existing "overdue" bucket (a Task with entityType 'LEAD' past
// its dueAt, still OPEN). No new follow-up/task state machine — this module
// only reads buildLeadFollowUpSummary().overdue, the same list the CRM
// dashboard's "Overdue" tab already shows, and turns each still-open overdue
// task into a staff notification when it doesn't already have one live.
//
// Recipient: Task.assignedToId (the follow-up's own owner) when present;
// ADMIN staff otherwise (an overdue follow-up nobody owns is still someone's
// job to catch). One notification per overdue Task, not per lead — a lead
// with two separate overdue follow-up tasks genuinely has two distinct
// pieces of work outstanding.
//
// Dedup/idempotency: identical pattern to lead-needs-help-alerts.service.ts
// — an UNREAD Notification already sitting at this exact href for this
// recipient means the alert is still live, so the sweep skips it rather than
// piling on a duplicate.
// ─────────────────────────────────────────────────────────────────────────
import { prisma } from '../lib/prisma'
import { buildLeadFollowUpSummary } from './lead-followups.service'
import { isCrmFeatureLive } from './dry-run'
import { sendPushToUser } from '../services/push.service'

const TITLE = 'Lead follow-up overdue'
// Generic on purpose — no lead name/phone in the OS push popup.
const BODY = 'A scheduled lead follow-up needs attention. Tap to review.'

function hrefForRole(role: string, leadId: string): string {
  return role === 'RECEPTIONIST' ? `/receptionist/leads?open=${leadId}` : `/leads?open=${leadId}`
}

async function notifyFollowUpOverdue(userId: string, role: string, leadId: string): Promise<boolean> {
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

export async function checkLeadFollowUpOverdueAlerts(): Promise<{ overdueConsidered: number; notified: number }> {
  const summary = await buildLeadFollowUpSummary()
  if (summary.overdue.length === 0) return { overdueConsidered: 0, notified: 0 }

  const admins = await prisma.user.findMany({ where: { role: 'ADMIN', isActive: true }, select: { id: true, role: true } })

  let notified = 0
  for (const item of summary.overdue) {
    let recipients: Array<{ id: string; role: string }> = []
    if (item.assignedToId) {
      const owner = await prisma.user.findUnique({ where: { id: item.assignedToId }, select: { id: true, role: true, isActive: true } })
      if (owner?.isActive) recipients = [{ id: owner.id, role: owner.role }]
    }
    if (recipients.length === 0) recipients = admins

    for (const recipient of recipients) {
      const created = await notifyFollowUpOverdue(recipient.id, recipient.role, item.leadId)
      if (created) notified++
    }
  }

  return { overdueConsidered: summary.overdue.length, notified }
}
