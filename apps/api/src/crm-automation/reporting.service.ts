// ─────────────────────────────────────────────────────────────────────────
// CRM Automation — reporting (Part R). Read-only aggregation over the models
// built for this workstream plus existing Patient/Invoice/CallEvent data.
// ─────────────────────────────────────────────────────────────────────────
import { prisma } from '../lib/prisma'

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// ── (1) Response-time leaderboard — avg/median first reply time per owner ──
export async function responseTimeLeaderboard() {
  const leads = await prisma.lead.findMany({
    where:  { assignedTo: { not: null }, firstHumanReplyAt: { not: null } },
    select: { assignedTo: true, createdAt: true, firstHumanReplyAt: true },
  })

  const byOwner = new Map<string, number[]>()
  for (const lead of leads) {
    const minutes = (lead.firstHumanReplyAt!.getTime() - lead.createdAt.getTime()) / 60_000
    const arr = byOwner.get(lead.assignedTo!) ?? []
    arr.push(minutes)
    byOwner.set(lead.assignedTo!, arr)
  }

  const owners = await prisma.user.findMany({ where: { id: { in: [...byOwner.keys()] } }, select: { id: true, firstName: true, lastName: true } })
  const ownerName = new Map(owners.map(o => [o.id, `${o.firstName} ${o.lastName}`]))

  return [...byOwner.entries()].map(([ownerId, minutesList]) => ({
    ownerId,
    ownerName: ownerName.get(ownerId) ?? ownerId,
    leadCount: minutesList.length,
    avgMinutes: minutesList.reduce((a, b) => a + b, 0) / minutesList.length,
    medianMinutes: median(minutesList),
  })).sort((a, b) => a.avgMinutes - b.avgMinutes)
}

// ── (2) Stage conversion rates ───────────────────────────────────────────
export async function stageConversionRates() {
  // Count leads, not history rows: reopening a lead and reaching a stage
  // again must not inflate conversion. Each conditional rate uses only leads
  // with evidence of both milestones; direct conversions don't manufacture
  // an earlier contact or qualification.
  const reached = (toStage: string) => ({ stageHistory: { some: { toStage } } })
  const [totalNew, contactedCount, qualifiedCount, convertedCount, qualifiedFromContactedCount, convertedFromQualifiedCount, leadsWithoutStageHistory] = await Promise.all([
    prisma.lead.count(),
    prisma.lead.count({ where: reached('CONTACTED') }),
    prisma.lead.count({ where: reached('QUALIFIED') }),
    prisma.lead.count({ where: reached('CONVERTED') }),
    prisma.lead.count({ where: { AND: [reached('CONTACTED'), reached('QUALIFIED')] } }),
    prisma.lead.count({ where: { AND: [reached('QUALIFIED'), reached('CONVERTED')] } }),
    prisma.lead.count({ where: { stageHistory: { none: {} } } }),
  ])

  return {
    newToContactedRate:      totalNew > 0 ? contactedCount / totalNew : null,
    contactedToQualifiedRate: contactedCount > 0 ? qualifiedFromContactedCount / contactedCount : null,
    qualifiedToConvertedRate: qualifiedCount > 0 ? convertedFromQualifiedCount / qualifiedCount : null,
    totals: { totalNew, contactedCount, qualifiedCount, convertedCount },
    cohorts: { qualifiedFromContactedCount, convertedFromQualifiedCount },
    leadsWithoutStageHistory,
    note: 'Lifetime rates count distinct leads with recorded stage history. Each later-stage rate counts leads with both recorded milestones. Missing history is not inferred. Converted can mean patient conversion, appointment booking, or treatment start; it does not prove attendance, treatment acceptance, or payment.',
  }
}

// ── (3) Stale leads — untouched >24h, grouped by owner ──────────────────
export async function staleLeadsByOwner() {
  const stale = await prisma.lead.findMany({
    where: {
      firstHumanReplyAt: null,
      status: { notIn: ['CONVERTED', 'LOST'] },
      createdAt: { lte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
    select: { id: true, name: true, phone: true, assignedTo: true, createdAt: true },
  })

  const grouped = new Map<string, typeof stale>()
  for (const lead of stale) {
    const key = lead.assignedTo ?? 'unassigned'
    grouped.set(key, [...(grouped.get(key) ?? []), lead])
  }
  return [...grouped.entries()].map(([ownerId, leads]) => ({ ownerId, count: leads.length, leads }))
}

// ── (4) Weekly cold-leads digest — moved to Lost in the past 7 days ──────
export async function weeklyColdLeadsDigest() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000)
  const lost = await prisma.leadStageHistory.findMany({
    where:  { toStage: 'LOST', changedAt: { gte: sevenDaysAgo } },
    include: { lead: { select: { id: true, name: true, phone: true, source: true, lossReason: true } } },
    orderBy: { changedAt: 'desc' },
  })
  return lost
}

// ── (5) Case acceptance — proposed/accepted plans, acceptance rate ──────
export async function caseAcceptanceReport() {
  const grouped = await prisma.patient.groupBy({
    by: ['treatmentPlanStatus'],
    _count: { _all: true },
  })
  const counts = Object.fromEntries(grouped.map(g => [g.treatmentPlanStatus, g._count._all]))
  const proposed = counts['PROPOSED'] ?? 0
  const accepted = counts['ACCEPTED'] ?? 0
  const declined = counts['DECLINED'] ?? 0
  const incomplete = counts['INCOMPLETE'] ?? 0
  const consideredTotal = proposed + accepted + declined + incomplete
  return {
    counts,
    acceptanceRate: consideredTotal > 0 ? accepted / consideredTotal : 0,
  }
}

// ── (6) Sequence performance — response/booking rate, by segment ────────
export async function sequencePerformanceReport() {
  const sequences = await prisma.sequenceDefinition.findMany()
  const results = []
  for (const seq of sequences) {
    const [total, replied, booked] = await Promise.all([
      prisma.sequenceEnrollment.count({ where: { sequenceId: seq.id } }),
      prisma.sequenceEnrollment.count({ where: { sequenceId: seq.id, status: 'EXITED_REPLY' } }),
      prisma.sequenceEnrollment.count({ where: { sequenceId: seq.id, status: 'EXITED_BOOKED' } }),
    ])
    results.push({
      sequenceId: seq.id,
      key: seq.key,
      name: seq.name,
      entityType: seq.entityType,
      totalEnrollments: total,
      responseRate: total > 0 ? replied / total : 0,
      bookingRate: total > 0 ? booked / total : 0,
    })
  }
  return results
}

// ── (7) Aging Accounts Receivable ────────────────────────────────────────
export async function agingReceivablesReport() {
  const owing = await prisma.patient.findMany({
    where:  { balanceStatus: 'OWING' },
    select: { balanceAgingBucket: true, accountBalance: true },
  })
  const buckets: Record<string, { count: number; totalOwedUGX: number }> = {}
  for (const p of owing) {
    const key = p.balanceAgingBucket ?? 'UNKNOWN'
    if (!buckets[key]) buckets[key] = { count: 0, totalOwedUGX: 0 }
    buckets[key].count++
    buckets[key].totalOwedUGX += p.accountBalance
  }
  return buckets
}

// ── (8) Call performance — answer rate, abandoned count ──────────────────
// Limited by what's actually logged today: CallEvent only records calls this
// workstream's missed-call intake sees (status MISSED). Answered-call volume
// isn't logged anywhere generic — see UNRESOLVED_ITEMS in the final report.
export async function callPerformanceReport() {
  const [missed, answered, total] = await Promise.all([
    prisma.callEvent.count({ where: { status: 'MISSED' } }),
    prisma.callEvent.count({ where: { status: 'ANSWERED' } }),
    prisma.callEvent.count(),
  ])
  return {
    missedCount: missed,
    answeredCount: answered,
    totalLogged: total,
    answerRate: total > 0 ? answered / total : 0,
    abandonedCount: missed,
    note: 'Only calls seen by the missed-call intake are logged here — no generic answered-call telephony integration exists yet.',
  }
}
