// ─────────────────────────────────────────────────────────────────────────
// CRM Automation — lead follow-up summary (Today / Overdue / Upcoming /
// Completed), read from the existing generic Task model.
//
// Task.entityId links to Lead.id only by convention (entityType === 'LEAD')
// — there is no Prisma relation between the two models (see schema.prisma).
// This module is the single read path for that convention: it fetches lead
// Tasks, then joins the corresponding Lead rows itself, so every caller sees
// the same lead context (name/phone/assignedTo) rather than re-deriving it.
//
// Tasks are already created for leads elsewhere (lead-intake.service.ts on
// intake); this module only reads and completes them — it does not create
// any new follow-up task type.
// ─────────────────────────────────────────────────────────────────────────
import { prisma } from '../lib/prisma'

const LEAD_TASK = { entityType: 'LEAD' } as const

function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function startOfTomorrow(): Date {
  const d = startOfToday()
  d.setDate(d.getDate() + 1)
  return d
}

export interface LeadFollowUpItem {
  id: string
  title: string
  description: string | null
  dueAt: string | null
  status: string
  assignedToId: string | null
  leadId: string
  leadName: string | null
  leadPhone: string | null
}

export interface LeadFollowUpSummary {
  generatedAt: string
  counts: { dueToday: number; overdue: number; upcoming: number; completed: number }
  dueToday: LeadFollowUpItem[]
  overdue: LeadFollowUpItem[]
  upcoming: LeadFollowUpItem[]
  completed: LeadFollowUpItem[]
}

async function withLeadContext(tasks: Array<{ id: string; title: string; description: string | null; dueAt: Date | null; status: string; assignedToId: string | null; entityId: string }>): Promise<LeadFollowUpItem[]> {
  const leadIds = [...new Set(tasks.map(t => t.entityId))]
  const leads = leadIds.length
    ? await prisma.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, name: true, phone: true } })
    : []
  const leadById = new Map(leads.map(l => [l.id, l]))

  return tasks.map(t => ({
    id: t.id,
    title: t.title,
    description: t.description,
    dueAt: t.dueAt ? t.dueAt.toISOString() : null,
    status: t.status,
    assignedToId: t.assignedToId,
    leadId: t.entityId,
    leadName: leadById.get(t.entityId)?.name ?? null,
    leadPhone: leadById.get(t.entityId)?.phone ?? null,
  }))
}

export interface LeadFollowUpOptions {
  ownerId?: string
}

export async function buildLeadFollowUpSummary(options: LeadFollowUpOptions = {}): Promise<LeadFollowUpSummary> {
  const ownerFilter = options.ownerId ? { assignedToId: options.ownerId } : {}
  const today = startOfToday()
  const tomorrow = startOfTomorrow()

  const [dueTodayRaw, overdueRaw, upcomingRaw, completedRaw] = await Promise.all([
    prisma.task.findMany({
      where:  { ...LEAD_TASK, ...ownerFilter, status: 'OPEN', dueAt: { gte: today, lt: tomorrow } },
      orderBy: { dueAt: 'asc' },
    }),
    prisma.task.findMany({
      where:  { ...LEAD_TASK, ...ownerFilter, status: 'OPEN', dueAt: { lt: today } },
      orderBy: { dueAt: 'asc' },
    }),
    prisma.task.findMany({
      where:  { ...LEAD_TASK, ...ownerFilter, status: 'OPEN', dueAt: { gte: tomorrow } },
      orderBy: { dueAt: 'asc' },
      take: 100,
    }),
    prisma.task.findMany({
      where:  { ...LEAD_TASK, ...ownerFilter, status: 'DONE' },
      orderBy: { completedAt: 'desc' },
      take: 50,
    }),
  ])

  const [dueToday, overdue, upcoming, completed] = await Promise.all([
    withLeadContext(dueTodayRaw), withLeadContext(overdueRaw), withLeadContext(upcomingRaw), withLeadContext(completedRaw),
  ])

  return {
    generatedAt: new Date().toISOString(),
    counts: { dueToday: dueToday.length, overdue: overdue.length, upcoming: upcoming.length, completed: completed.length },
    dueToday, overdue, upcoming, completed,
  }
}

export async function completeLeadFollowUp(taskId: string): Promise<{ id: string; status: string }> {
  const task = await prisma.task.findUnique({ where: { id: taskId } })
  if (!task || task.entityType !== 'LEAD') throw new Error('Follow-up task not found')
  return prisma.task.update({
    where: { id: taskId },
    data:  { status: 'DONE', completedAt: new Date() },
    select: { id: true, status: true },
  })
}
