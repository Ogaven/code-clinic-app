// ─────────────────────────────────────────────────────────────────────────
// CRM Automation — Lead owner routing (Part L).
// Admin-configurable: source-based map OR round-robin across active
// eligible owners. No hardcoded source->owner mapping — that lives entirely
// in RoutingRule.sourceMap, set by an admin through the config endpoint.
// ─────────────────────────────────────────────────────────────────────────
import { prisma } from '../lib/prisma'

function safeParse<T = any>(json: string | null): T | null {
  if (!json) return null
  try { return JSON.parse(json) as T } catch { return null }
}

export async function pickOwnerForNewLead(source: string): Promise<string | null> {
  const rule = await prisma.routingRule.findFirst({
    where:   { entityType: 'LEAD', isActive: true },
    orderBy: { updatedAt: 'desc' },
  })
  if (!rule) return null

  if (rule.mode === 'SOURCE_BASED') {
    const map = safeParse<Record<string, string>>(rule.sourceMap) || {}
    const userId = map[source]
    if (!userId) return null
    const user = await prisma.user.findUnique({ where: { id: userId } })
    return user?.isActive ? user.id : null
  }

  if (rule.mode === 'ROUND_ROBIN') {
    const eligibleIds = safeParse<string[]>(rule.eligibleUserIds) || []
    if (eligibleIds.length === 0) return null
    const activeUsers = await prisma.user.findMany({
      where:   { id: { in: eligibleIds }, isActive: true },
      orderBy: { id: 'asc' },
    })
    if (activeUsers.length === 0) return null

    const state = await prisma.routingState.findUnique({ where: { routingRuleId: rule.id } })
    const lastIdx = state ? activeUsers.findIndex(u => u.id === state.lastAssignedUserId) : -1
    const next = activeUsers[(lastIdx + 1) % activeUsers.length]

    await prisma.routingState.upsert({
      where:  { routingRuleId: rule.id },
      update: { lastAssignedUserId: next.id },
      create: { routingRuleId: rule.id, lastAssignedUserId: next.id },
    })
    return next.id
  }

  return null
}