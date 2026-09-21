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

// ── (9) Lead source performance — Leads/Qualified/Converted/Lost by source ──
// Deliberately does not include "Booked" or any revenue figure: this repo has
// no Lead-stage evidence of booking distinct from CONVERTED (see
// lead-stage.service.ts — QUALIFIED->CONVERTED already covers appointment
// booking and treatment-start triggers, so a separate "booked" lead-stage
// count would just restate convertedCount under a different label). Revenue
// by source is handled separately by acquisitionRevenueByDimension(), which
// applies the stricter single-lead attribution rule — mixing that into this
// lead-only view would blur two different levels of evidence together.
export async function sourcePerformance() {
  const reached = (toStage: string) => ({ stageHistory: { some: { toStage } } })
  const sources = await prisma.lead.findMany({ distinct: ['source'], select: { source: true } })

  const rows = await Promise.all(sources.map(async ({ source }) => {
    const [leadCount, qualifiedCount, convertedCount, lostCount] = await Promise.all([
      prisma.lead.count({ where: { source } }),
      prisma.lead.count({ where: { source, ...reached('QUALIFIED') } }),
      prisma.lead.count({ where: { source, ...reached('CONVERTED') } }),
      prisma.lead.count({ where: { source, status: 'LOST' } }),
    ])
    return { source, leadCount, qualifiedCount, convertedCount, lostCount }
  }))

  return {
    sources: rows.sort((a, b) => b.leadCount - a.leadCount),
    note: 'Counts are lifetime, distinct leads (qualified/converted use recorded stage history, not current status, so a lead that reached a stage and later moved on is still counted). No revenue or "booked" figure is included here — see the Revenue workspace for attributed revenue by source.',
  }
}

// ── (10) Lost reasons — current LOST leads grouped by their recorded reason ─
// Free-text grouping, not an invented taxonomy: Lead.lossReason has no enum
// (see schema.prisma), so this reports exactly what staff typed, verbatim.
export async function lostReasonsBreakdown() {
  const lost = await prisma.lead.findMany({
    where:  { status: 'LOST' },
    select: { lossReason: true },
  })
  const counts = new Map<string, number>()
  for (const { lossReason } of lost) {
    const key = (lossReason || '').trim() || 'Not specified'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return {
    totalLost: lost.length,
    reasons: [...counts.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
  }
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

// ── (11) Campaign performance — Leads/Qualified/Converted by campaign,
// plus attributed revenue reusing the existing single-clean-lead rule ──────
// Mirrors sourcePerformance()'s shape exactly, grouped by campaignId instead
// of source, and folds in acquisitionRevenueByDimension('campaignId') so
// this is one real report instead of two the UI would have to stitch
// together. Leads with no campaignId (the vast majority — most leads aren't
// tied to a paid campaign) are excluded, not lumped into a fake "none" row.
export async function campaignPerformance() {
  const { acquisitionRevenueByDimension } = await import('./revenue-attribution.service')
  const reached = (toStage: string) => ({ stageHistory: { some: { toStage } } })

  const campaigns = await prisma.lead.findMany({
    where: { campaignId: { not: null } },
    distinct: ['campaignId'],
    select: { campaignId: true, campaignName: true },
  })

  const [rows, revenue] = await Promise.all([
    Promise.all(campaigns.map(async ({ campaignId, campaignName }) => {
      const [leadCount, qualifiedCount, convertedCount, lostCount] = await Promise.all([
        prisma.lead.count({ where: { campaignId } }),
        prisma.lead.count({ where: { campaignId, ...reached('QUALIFIED') } }),
        prisma.lead.count({ where: { campaignId, ...reached('CONVERTED') } }),
        prisma.lead.count({ where: { campaignId, status: 'LOST' } }),
      ])
      return { campaignId, campaignName, leadCount, qualifiedCount, convertedCount, lostCount }
    })),
    acquisitionRevenueByDimension('campaignId'),
  ])

  const revenueByCampaign = new Map(revenue.buckets.map(b => [b.key, b.collectedUGX]))

  return {
    campaigns: rows
      .map(r => ({ ...r, collectedUGX: revenueByCampaign.get(r.campaignId!) ?? 0 }))
      .sort((a, b) => b.leadCount - a.leadCount),
    note: 'Only leads tagged with a campaignId are included. Revenue uses the same single-clean-lead attribution rule as the Revenue workspace — see its note for what is excluded and why.',
  }
}

// ── (12) Lead trend — leads received per day over a window ────────────────
// Bucketed in JS from raw createdAt timestamps (not a DB-specific date-trunc
// function) to stay portable across the SQLite dev / Postgres prod split
// already used elsewhere in this codebase's scheduler code.
function dayKey(d: Date): string { return d.toISOString().slice(0, 10) }

function buildDaySeries(days: number, timestamps: Date[]): Array<{ date: string; count: number }> {
  const counts = new Map<string, number>()
  for (const ts of timestamps) {
    const key = dayKey(ts)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const series: Array<{ date: string; count: number }> = []
  const now = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86_400_000)
    const key = dayKey(d)
    series.push({ date: key, count: counts.get(key) ?? 0 })
  }
  return series
}

export async function leadTrend(days = 30) {
  const since = new Date(Date.now() - days * 86_400_000)
  const leads = await prisma.lead.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } })
  return { days, series: buildDaySeries(days, leads.map(l => l.createdAt)) }
}

// ── (13) Conversion trend — CONVERTED transitions per day over a window ───
// Uses LeadStageHistory.changedAt (the actual moment a lead converted), not
// Lead.updatedAt, which could have moved for unrelated reasons since.
export async function conversionTrend(days = 30) {
  const since = new Date(Date.now() - days * 86_400_000)
  const conversions = await prisma.leadStageHistory.findMany({
    where:  { toStage: 'CONVERTED', changedAt: { gte: since } },
    select: { changedAt: true },
  })
  return { days, series: buildDaySeries(days, conversions.map(c => c.changedAt)) }
}

// ── (14) Revenue trend — total collected UGX per month ─────────────────────
// Deliberately NOT lead-attributed per month: the conservative single-clean-
// lead attribution rule (revenue-attribution.service.ts) has no natural
// monthly bucketing of its own, and approximating one would risk implying
// every payment came from a CRM lead, which this codebase explicitly never
// claims. This is real total collected revenue (Payment.amountUGX), labelled
// as such — the snapshot Attributed/Unattributed split lives separately on
// the Revenue workspace, unchanged.
export async function revenueTrend(months = 6) {
  const since = new Date()
  since.setMonth(since.getMonth() - (months - 1))
  since.setDate(1); since.setHours(0, 0, 0, 0)

  const payments = await prisma.payment.findMany({ where: { paidAt: { gte: since } }, select: { paidAt: true, amountUGX: true } })

  const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  const totals = new Map<string, number>()
  for (const p of payments) totals.set(monthKey(p.paidAt), (totals.get(monthKey(p.paidAt)) ?? 0) + p.amountUGX)

  const series: Array<{ month: string; collectedUGX: number }> = []
  const cursor = new Date(since)
  for (let i = 0; i < months; i++) {
    const key = monthKey(cursor)
    series.push({ month: key, collectedUGX: totals.get(key) ?? 0 })
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return { months, series, note: 'Total collected revenue (all patients), not scoped to CRM-attributed leads specifically — see the Revenue workspace for the attributed/unattributed split.' }
}

// ── (15) CRM Insights — deterministic, plain-language readouts of real
// metrics already computed elsewhere in this file/module. Never a
// prediction/forecast dressed up as one: every line here is a fact about
// data that already exists, computed the same way the underlying report
// computes it. If a genuine trend projection is ever added, it must be
// labelled "Projection"/"Estimate" explicitly — this function does not do
// that today because there isn't yet enough history to defend one.
export interface CrmInsight { text: string; tone: 'info' | 'warning' | 'positive' }

export async function crmInsights(): Promise<CrmInsight[]> {
  const [needsAttentionMod, sourcePerf, conversion, weeklyCold] = await Promise.all([
    import('./needs-attention.service'),
    sourcePerformance(),
    stageConversionRates(),
    weeklyColdLeadsDigest(),
  ])
  const attention = await needsAttentionMod.buildNeedsAttentionQueue()

  const insights: CrmInsight[] = []

  const unansweredCount = attention.categories.find(c => c.key === 'UNANSWERED_NEW')?.count ?? 0
  if (unansweredCount > 0) {
    insights.push({ text: `${unansweredCount} lead${unansweredCount === 1 ? ' is' : 's are'} waiting for a first response.`, tone: unansweredCount > 5 ? 'warning' : 'info' })
  }

  const overdueCount = attention.categories.find(c => c.key === 'OVERDUE_FOLLOWUP')?.count ?? 0
  if (overdueCount > 0) {
    insights.push({ text: `${overdueCount} follow-up${overdueCount === 1 ? ' is' : 's are'} overdue.`, tone: 'warning' })
  }

  if (sourcePerf.sources.length > 0) {
    const top = [...sourcePerf.sources].sort((a, b) => b.leadCount - a.leadCount)[0]
    if (top.leadCount > 0) {
      insights.push({ text: `${SOURCE_LABELS[top.source] ?? top.source} generated the most enquiries (${top.leadCount} leads).`, tone: 'info' })
      const noConversions = sourcePerf.sources.filter(s => s.leadCount >= 5 && s.convertedCount === 0)
      for (const s of noConversions) {
        insights.push({ text: `${SOURCE_LABELS[s.source] ?? s.source} generated ${s.leadCount} leads with no recorded conversions yet.`, tone: 'warning' })
      }
    }
  }

  if (conversion.totals.totalNew > 0 && conversion.newToContactedRate != null) {
    insights.push({ text: `Contact rate is ${(conversion.newToContactedRate * 100).toFixed(0)}% of all-time leads.`, tone: 'info' })
  }

  if (weeklyCold.length > 0) {
    insights.push({ text: `${weeklyCold.length} lead${weeklyCold.length === 1 ? ' was' : 's were'} moved to Lost in the past 7 days.`, tone: weeklyCold.length > 3 ? 'warning' : 'info' })
  }

  if (insights.length === 0) {
    insights.push({ text: 'No leads currently need attention — the pipeline is clear.', tone: 'positive' })
  }

  return insights
}

const SOURCE_LABELS: Record<string, string> = {
  WHATSAPP: 'WhatsApp', FACEBOOK: 'Facebook', INSTAGRAM: 'Instagram', WEBSITE: 'Website',
  WALKIN: 'Walk-in', QUIZ: 'Internal Quiz', SCOREAPP: 'ScoreApp', OTHER: 'Other',
}
