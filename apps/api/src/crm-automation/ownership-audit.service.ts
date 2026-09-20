// ─────────────────────────────────────────────────────────────────────────
// CRM Automation — lead ownership audit (read-only).
//
// Lead.assignedTo is a nullable String with no Prisma foreign key (see the
// validation comment in routes/crm.ts's PATCH /leads/:id). This surfaces
// exactly what that leaves possible today — unassigned leads, leads pointing
// at a user id that no longer exists or is inactive, and the real
// distribution across current owners — plus a PREVIEW of what the active
// routing rule would assign to each unassigned lead.
//
// This module NEVER writes to the database. It is explicitly preview-only —
// per the production-completion brief, historical ownership must never be
// backfilled automatically. If a real backfill endpoint is ever built, it
// must be a separate, explicit, audited action — not a side effect of
// viewing this audit.
//
// Critically, the round-robin preview below does NOT call
// lead-routing.service.ts's pickOwnerForNewLead() — that function has a real
// side effect (it advances RoutingState.lastAssignedUserId on every call, by
// design, for actual new-lead assignment). Calling it here to "preview" a
// backfill would silently corrupt the live round-robin cursor and skew real
// future assignments. The simulation below reads the same RoutingState row
// but only ever advances a local, in-memory copy of the index.
// ─────────────────────────────────────────────────────────────────────────
import { prisma } from '../lib/prisma'

function safeParse<T = unknown>(json: string | null): T | null {
  if (!json) return null
  try { return JSON.parse(json) as T } catch { return null }
}

const OPEN_LEAD_STATUSES = ['CONVERTED', 'LOST']

export interface BackfillPreviewLead {
  id: string
  name: string | null
  phone: string | null
  source: string
  createdAt: Date
  wouldAssignTo: string | null // null = no active rule, no match, or no eligible active owner
}

export interface OwnerDistributionEntry {
  ownerId: string
  ownerName: string
  isActive: boolean
  count: number
}

export interface OwnershipAuditResult {
  generatedAt: string
  totals: {
    totalLeads: number
    unassignedOpenLeads: number
    assignedToInactiveOrDeletedUser: number
  }
  distributionByOwner: OwnerDistributionEntry[]
  activeRoutingRule: { id: string; name: string; mode: string } | null
  // PREVIEW ONLY — nothing below this point is ever written to the database.
  backfillPreview: BackfillPreviewLead[]
}

export async function buildOwnershipAudit(): Promise<OwnershipAuditResult> {
  const [allLeads, users, rule] = await Promise.all([
    prisma.lead.findMany({
      select: { id: true, name: true, phone: true, source: true, assignedTo: true, status: true, createdAt: true },
    }),
    prisma.user.findMany({ select: { id: true, firstName: true, lastName: true, isActive: true } }),
    prisma.routingRule.findFirst({ where: { entityType: 'LEAD', isActive: true }, orderBy: { updatedAt: 'desc' } }),
  ])

  const userById = new Map(users.map(u => [u.id, u]))
  const unassignedOpen = allLeads
    .filter(l => !l.assignedTo && !OPEN_LEAD_STATUSES.includes(l.status))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  const assignedToInvalid = allLeads.filter(l => l.assignedTo && !userById.has(l.assignedTo))

  const distribution = new Map<string, number>()
  for (const lead of allLeads) {
    if (!lead.assignedTo) continue
    distribution.set(lead.assignedTo, (distribution.get(lead.assignedTo) ?? 0) + 1)
  }
  const distributionByOwner: OwnerDistributionEntry[] = [...distribution.entries()]
    .map(([ownerId, count]) => {
      const u = userById.get(ownerId)
      return { ownerId, ownerName: u ? `${u.firstName} ${u.lastName}`.trim() : '(deleted or unknown user)', isActive: u?.isActive ?? false, count }
    })
    .sort((a, b) => b.count - a.count)

  let activeRoutingRule: OwnershipAuditResult['activeRoutingRule'] = null
  let backfillPreview: BackfillPreviewLead[] = unassignedOpen.map(lead => ({
    id: lead.id, name: lead.name, phone: lead.phone, source: lead.source, createdAt: lead.createdAt, wouldAssignTo: null,
  }))

  if (rule) {
    activeRoutingRule = { id: rule.id, name: rule.name, mode: rule.mode }

    if (rule.mode === 'SOURCE_BASED') {
      const map = safeParse<Record<string, string>>(rule.sourceMap) || {}
      backfillPreview = unassignedOpen.map(lead => {
        const candidate = map[lead.source] ? userById.get(map[lead.source]) : undefined
        return {
          id: lead.id, name: lead.name, phone: lead.phone, source: lead.source, createdAt: lead.createdAt,
          wouldAssignTo: candidate?.isActive ? candidate.id : null,
        }
      })
    } else if (rule.mode === 'ROUND_ROBIN') {
      const eligibleIds = new Set(safeParse<string[]>(rule.eligibleUserIds) || [])
      const activeUsers = users.filter(u => eligibleIds.has(u.id) && u.isActive)
      const state = await prisma.routingState.findUnique({ where: { routingRuleId: rule.id } })
      // Local-only cursor — mirrors pickOwnerForNewLead's advance-then-assign
      // order but is never persisted back to RoutingState.
      let idx = activeUsers.findIndex(u => u.id === state?.lastAssignedUserId)
      backfillPreview = unassignedOpen.map(lead => {
        if (activeUsers.length === 0) {
          return { id: lead.id, name: lead.name, phone: lead.phone, source: lead.source, createdAt: lead.createdAt, wouldAssignTo: null }
        }
        idx = (idx + 1) % activeUsers.length
        return { id: lead.id, name: lead.name, phone: lead.phone, source: lead.source, createdAt: lead.createdAt, wouldAssignTo: activeUsers[idx].id }
      })
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      totalLeads: allLeads.length,
      unassignedOpenLeads: unassignedOpen.length,
      assignedToInactiveOrDeletedUser: assignedToInvalid.length,
    },
    distributionByOwner,
    activeRoutingRule,
    backfillPreview,
  }
}
