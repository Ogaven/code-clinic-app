import { Router } from 'express'
import fs from 'fs'
import { requireAuth } from '../../middleware/auth'
import { adminOnly } from '../../middleware/rbac'
import { prisma } from '../../lib/prisma'
import { startOfKampalaDay, endOfKampalaDay, startOfKampalaMonth, startOfPreviousKampalaMonth } from '../../utils/kampala-time'
import type { DateRange } from '../../utils/kampala-time'
import { getWhatsAppWabaId, getWhatsAppToken } from '../../config/meta-config'

const router = Router()

const CACHE_FILE = '/tmp/codeclinic-meta-usage.json'
const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6 hours

const GRAPH_VER = 'v25.0'

// 2026-09-20 correction: this used to fetch two SEPARATE WABAs —
// UG_WABA='1754698499275270' labeled "Code Clinic Uganda (routed via AT)"
// and KE_WABA='1035568108843333' labeled "Elyrac AI Kenya (test WABA,
// Meta Cloud API direct)". Both labels predate a completed migration: Code
// Clinic's real number now sends with zero Africa's Talking involvement
// (see whatsapp.service.ts), and live Graph API calls during the 2026-09-20
// investigation confirmed the real phone number, templates, and delivery
// failures all live on `1035568108843333` — the ID this file called
// "Kenya (test WABA)". `1754698499275270` is an unrelated WABA that does
// not own Code Clinic's number; the "Uganda" usage panel was silently
// pulling pricing data for the wrong account the entire time.
//
// There is exactly one real, configured, direct-Meta-Cloud-API WhatsApp
// account (WHATSAPP_WABA_ID, via config/meta-config.ts) with two phone
// numbers registered on it. pricing_analytics is a WABA-level metric —
// live-tested with Graph API's `phone_numbers` filter parameter, which
// returned an empty result set for both numbers individually — so Meta
// does not expose a way to split this account's cost by phone number.
// Rather than re-fabricate a fake per-number split, this now reports one
// honest, correctly-sourced account with every phone number registered on
// it listed underneath, instead of pretending two independent accounts.
const DATA_SINCE = new Date('2025-12-01T00:00:00Z') // Meta per-message pricing changed July 1 2025 — lookback only from Dec 1 2025

interface DataPoint { start: number; end: number; volume: number; cost?: number }
interface WabaPhoneNumber { id: string; displayPhoneNumber: string; verifiedName: string | null }
// Coverage of a specific requested window against what Meta's pricing_analytics
// API can actually supply (DATA_SINCE / 90-day lookback). `full` means the
// entire requested window was covered by real data; a requested window with
// ZERO overlap is reported as `unavailable` (never silently $0.00); partial
// overlap reports the real figures for the covered slice plus a reason so
// the UI can caveat it rather than presenting it as the full requested total.
interface RangeCoverage {
  requestedStart: string
  requestedEnd:   string
  coveredStart:   string | null
  coveredEnd:     string | null
  full:           boolean
  unavailable:    boolean
  reason:         string | null
}
interface WabaUsage {
  wabaId:       string
  phoneNumbers: WabaPhoneNumber[]
  daily:        DataPoint[]
  thisMonth:    { volume: number; cost: number }
  lastMonth:    { volume: number; cost: number }
  // Present only when the caller requested a specific range (query param) —
  // null volume/cost (with coverage.unavailable=true) rather than $0.00 when
  // Meta genuinely cannot supply data that far back.
  selected:     { volume: number; cost: number } | null
  coverage:     RangeCoverage | null
  fetchedAt:    string
}
interface UsageCache {
  account:   WabaUsage | null
  configured: boolean
  cachedAt:  string
}

function readCache(): UsageCache | null {
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf-8')
    const c   = JSON.parse(raw) as UsageCache
    if (Date.now() - new Date(c.cachedAt).getTime() < CACHE_TTL_MS) return c
    return null
  } catch {
    return null
  }
}

function writeCache(data: UsageCache): void {
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify(data), 'utf-8') } catch {}
}

// The earliest instant Meta's pricing_analytics can honestly be asked about —
// both the pricing-model-change cutover (DATA_SINCE) and Meta's own ~90-day
// analytics lookback window. Exported so callers can tell, BEFORE fetching,
// whether a requested historical range has any real overlap at all.
export function metaDataFloor(now: Date = new Date()): Date {
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
  return DATA_SINCE > ninetyDaysAgo ? DATA_SINCE : ninetyDaysAgo
}

async function fetchWabaAnalytics(wabaId: string, token: string, sinceMs: number, untilMs: number): Promise<DataPoint[]> {
  const since = Math.floor(sinceMs / 1000)
  const until = Math.floor(untilMs / 1000)

  const url = `https://graph.facebook.com/${GRAPH_VER}/${wabaId}/pricing_analytics`
    + `?start=${since}&end=${until}&granularity=DAILY&access_token=${token}`

  const res  = await fetch(url)
  const json = await res.json() as { data?: { data_points?: DataPoint[] }[]; error?: any }

  if (json.error) {
    console.warn(`[MetaUsage] API error for WABA ${wabaId}:`, json.error.message)
    return []
  }

  return json.data?.[0]?.data_points ?? []
}

async function fetchWabaPhoneNumbers(wabaId: string, token: string): Promise<WabaPhoneNumber[]> {
  try {
    const url = `https://graph.facebook.com/${GRAPH_VER}/${wabaId}/phone_numbers?fields=display_phone_number,verified_name&access_token=${token}`
    const res  = await fetch(url)
    const json = await res.json() as { data?: { id: string; display_phone_number?: string; verified_name?: string }[]; error?: any }
    if (json.error) {
      console.warn(`[MetaUsage] phone_numbers error for WABA ${wabaId}:`, json.error.message)
      return []
    }
    return (json.data ?? []).map(n => ({
      id: n.id,
      displayPhoneNumber: n.display_phone_number ?? 'unknown',
      verifiedName: n.verified_name ?? null,
    }))
  } catch (e: any) {
    console.warn(`[MetaUsage] phone_numbers fetch failed for WABA ${wabaId}:`, e.message)
    return []
  }
}

// Sums every daily data point whose start falls in [startMs, endMs) — plain
// millisecond Date boundaries (converted once here) so every caller works in
// the same Kampala-resolved Date objects instead of re-deriving year/month
// splits per call site.
function summariseWindow(points: DataPoint[], startMs: number, endMs: number) {
  const start = startMs / 1000
  const end   = endMs / 1000
  const inWindow = points.filter(p => p.start >= start && p.start < end)
  return {
    volume: inWindow.reduce((s, p) => s + p.volume, 0),
    cost:   inWindow.reduce((s, p) => s + (p.cost ?? 0), 0),
  }
}

function buildCoverage(requested: DateRange, floor: Date): RangeCoverage {
  const effectiveStart = requested.start > floor ? requested.start : floor
  const unavailable = effectiveStart >= requested.end
  const full = !unavailable && effectiveStart.getTime() === requested.start.getTime()
  return {
    requestedStart: requested.start.toISOString(),
    requestedEnd:   requested.end.toISOString(),
    coveredStart:   unavailable ? null : effectiveStart.toISOString(),
    coveredEnd:     unavailable ? null : requested.end.toISOString(),
    full,
    unavailable,
    reason: unavailable
      ? `Meta only retains pricing data from ${floor.toISOString().slice(0, 10)} onward — the requested range is entirely before that.`
      : !full
        ? `Meta only retains pricing data from ${floor.toISOString().slice(0, 10)} onward — figures reflect that partial overlap, not the full requested range.`
        : null,
  }
}

export async function buildUsage(token: string, requestedRange?: DateRange): Promise<UsageCache> {
  const now = new Date()
  const wabaId = getWhatsAppWabaId()
  if (!wabaId) {
    return { account: null, configured: false, cachedAt: now.toISOString() }
  }

  const floor = metaDataFloor(now)
  const thisMonthStart = startOfKampalaMonth(now)
  const lastMonthStart = startOfPreviousKampalaMonth(now)

  // One single Graph API call wide enough to cover this month, last month,
  // AND the caller's requested range (whichever reaches furthest back),
  // clamped to what Meta can actually supply — never fetch (or claim) data
  // older than `floor`.
  const earliestNeeded = [lastMonthStart, requestedRange?.start ?? now]
    .reduce((a, b) => (a < b ? a : b))
  const fetchStart = earliestNeeded > floor ? earliestNeeded : floor

  const [points, phoneNumbers] = await Promise.all([
    fetchWabaAnalytics(wabaId, token, fetchStart.getTime(), now.getTime()),
    fetchWabaPhoneNumbers(wabaId, token),
  ])

  // Keep only last 30 days of daily points for the existing chart card.
  const cutoff = Math.floor(Date.now() / 1000) - 30 * 86400
  const trim   = (pts: DataPoint[]) => pts.filter(p => p.start >= cutoff)

  let selected: { volume: number; cost: number } | null = null
  let coverage: RangeCoverage | null = null
  if (requestedRange) {
    coverage = buildCoverage(requestedRange, floor)
    selected = coverage.unavailable
      ? null
      : summariseWindow(points, new Date(coverage.coveredStart!).getTime(), new Date(coverage.coveredEnd!).getTime())
  }

  return {
    account: {
      wabaId,
      phoneNumbers,
      daily:     trim(points),
      thisMonth: summariseWindow(points, thisMonthStart.getTime(), now.getTime()),
      lastMonth: summariseWindow(points, lastMonthStart.getTime(), thisMonthStart.getTime()),
      selected,
      coverage,
      fetchedAt: now.toISOString(),
    },
    configured: true,
    cachedAt: now.toISOString(),
  }
}

// GET /ai-suite/meta-usage?range=today|7d|30d|90d|month|prev_month|custom&from=&to=
// `range` is optional — the existing thisMonth/lastMonth/daily chart payload
// is always included regardless. Only when a range is explicitly requested
// is the extra `selected`/`coverage` figure computed. The on-disk cache
// predates per-range querying and was only ever built for the no-range
// shape, so a specific range request always computes fresh rather than
// risking a stale/wrong `selected` value from a cached different range.
router.get('/meta-usage', requireAuth, async (req, res) => {
  try {
    const hasRangeRequest = typeof req.query.range === 'string'
    if (!hasRangeRequest) {
      const cached = readCache()
      if (cached) return res.json(cached)
    }

    const token = getWhatsAppToken()
    if (!token) return res.status(503).json({ error: 'WHATSAPP_TOKEN not configured' })

    let requestedRange: DateRange | undefined
    if (hasRangeRequest) {
      try {
        requestedRange = resolveAiUsageRange(req.query.range, req.query.from, req.query.to)
      } catch (err: any) {
        if (err instanceof InvalidRangeError) { res.status(400).json({ error: err.message }); return }
        throw err
      }
    }

    const data = await buildUsage(token, requestedRange)
    if (!hasRangeRequest) writeCache(data)
    res.json(data)
  } catch (err: any) {
    console.error('[MetaUsage] fetch error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /ai-suite/meta-usage/refresh — force-bust the cache
router.post('/meta-usage/refresh', requireAuth, async (req, res) => {
  try {
    try { fs.unlinkSync(CACHE_FILE) } catch {}
    const token = getWhatsAppToken()
    if (!token) return res.status(503).json({ error: 'WHATSAPP_TOKEN not configured' })
    const hasRangeRequest = typeof req.query.range === 'string'
    let requestedRange: DateRange | undefined
    if (hasRangeRequest) {
      try {
        requestedRange = resolveAiUsageRange(req.query.range, req.query.from, req.query.to)
      } catch (err: any) {
        if (err instanceof InvalidRangeError) { res.status(400).json({ error: err.message }); return }
        throw err
      }
    }
    const data = await buildUsage(token, requestedRange)
    if (!hasRangeRequest) writeCache(data)
    res.json(data)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── OpenAI token-usage / cost analytics (Admin-only) ────────────────────────
// Aggregates the AiUsageLog rows written by agent.service.ts (see
// logAiUsage) for the requested window. Provider billing/cost data is
// admin-only per project policy — see the adminOnly guard below and the
// matching role check on the Analytics & Costs page.

export type AiUsageRangeKey = 'today' | '7d' | '30d' | '90d' | 'month' | 'prev_month' | 'custom'

// Best-effort per-million-token USD pricing for the models this app
// actually calls (see OPENAI_WEBSITE_MODEL / OPENAI_COMMENT_MODEL in
// agent.service.ts). This is a server-side estimate only — never persisted
// or exposed as "actual" billing. Update these figures if OpenAI's pricing
// changes or the configured model changes.
const OPENAI_PRICING: Record<string, { inputPerMillion: number; cachedInputPerMillion: number; outputPerMillion: number }> = {
  'gpt-5.6-sol':  { inputPerMillion: 2.50, cachedInputPerMillion: 1.25,  outputPerMillion: 10.00 }, // flagship tier (website/WhatsApp)
  'gpt-5.6-luna': { inputPerMillion: 0.15, cachedInputPerMillion: 0.075, outputPerMillion: 0.60  }, // cost-optimized tier (comment replies)
}
// Fallback for any model that shows up in the log without a pricing entry above.
const DEFAULT_PRICING = OPENAI_PRICING['gpt-5.6-sol']

// Pure and exported (server-side only — never sent to the client) so it can
// be unit-tested directly: proves the cost figure is actually DERIVED from
// token counts rather than a hardcoded number. Cached input tokens are a
// discounted SUBSET of inputTokens, and reasoning tokens are already
// included inside outputTokens by the Responses API, so neither is added on
// top of its parent bucket.
export function calculateAiUsageCostUsd(
  byModel: { model: string; inputTokens: number; cachedInputTokens: number; outputTokens: number }[],
): number {
  const raw = byModel.reduce((acc, row) => {
    const pricing      = OPENAI_PRICING[row.model] ?? DEFAULT_PRICING
    const billableInput = Math.max(row.inputTokens - row.cachedInputTokens, 0)
    const modelCost =
      (billableInput          / 1_000_000) * pricing.inputPerMillion +
      (row.cachedInputTokens  / 1_000_000) * pricing.cachedInputPerMillion +
      (row.outputTokens       / 1_000_000) * pricing.outputPerMillion
    return acc + modelCost
  }, 0)
  return Math.round(raw * 10000) / 10000
}

// N calendar Kampala days ending today (inclusive) — e.g. "7 days" means
// today plus the 6 preceding full Kampala days, not a raw 7*24h UTC
// subtraction, which could straddle a Kampala day boundary and silently
// shift which day's data appears "in" vs "out" of the window.
function lastNKampalaDays(now: Date, n: number): DateRange {
  const todayStart = startOfKampalaDay(now)
  return { start: new Date(todayStart.getTime() - (n - 1) * 24 * 60 * 60 * 1000), end: now }
}

export class InvalidRangeError extends Error {}

// A bare 'YYYY-MM-DD' is interpreted as a Kampala calendar date, not UTC —
// parsing it as UTC midnight first is safe because UTC midnight always
// falls on the same Kampala calendar day (Kampala is UTC+3, so UTC
// midnight = 03:00 Kampala, never past midnight into the next Kampala day).
function parseKampalaCalendarDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new InvalidRangeError(`Invalid date "${value}" — expected YYYY-MM-DD`)
  const parsed = new Date(`${value}T00:00:00Z`)
  if (isNaN(parsed.getTime())) throw new InvalidRangeError(`Invalid date "${value}"`)
  return parsed
}

export function resolveAiUsageRange(
  rangeParam: unknown,
  customFrom?: unknown,
  customTo?: unknown,
): { start: Date; end: Date; range: AiUsageRangeKey } {
  const now = new Date()
  const key = (typeof rangeParam === 'string' ? rangeParam : '30d') as AiUsageRangeKey

  switch (key) {
    case 'today':
      return { start: startOfKampalaDay(now), end: endOfKampalaDay(now), range: 'today' }
    case '7d':
      return { ...lastNKampalaDays(now, 7), range: '7d' }
    case '90d':
      return { ...lastNKampalaDays(now, 90), range: '90d' }
    case 'month':
      return { start: startOfKampalaMonth(now), end: now, range: 'month' }
    case 'prev_month':
      return { start: startOfPreviousKampalaMonth(now), end: startOfKampalaMonth(now), range: 'prev_month' }
    case 'custom': {
      if (typeof customFrom !== 'string' || typeof customTo !== 'string') {
        throw new InvalidRangeError('custom range requires both from and to (YYYY-MM-DD)')
      }
      // parseKampalaCalendarDate returns UTC midnight of that calendar date,
      // which is 03:00 Kampala, not Kampala midnight — startOfKampalaDay
      // converts it to the actual Kampala-day boundary.
      const start = startOfKampalaDay(parseKampalaCalendarDate(customFrom))
      // Inclusive end day — "Sep 1 to Sep 30" must include all of Sep 30,
      // so the exclusive upper bound is the start of Oct 1.
      const end = endOfKampalaDay(parseKampalaCalendarDate(customTo))
      if (start >= end) throw new InvalidRangeError('custom range: from must be before to')
      return { start, end, range: 'custom' }
    }
    case '30d':
    default:
      return { ...lastNKampalaDays(now, 30), range: '30d' }
  }
}

// GET /ai-suite/ai-usage?range=today|7d|30d|90d|month|prev_month|custom&from=&to=
router.get('/ai-usage', requireAuth, adminOnly, async (req, res) => {
  try {
    const { start, end, range } = resolveAiUsageRange(req.query.range, req.query.from, req.query.to)
    const where = { createdAt: { gte: start, lt: end } }

    const [totals, failedRequests, byChannelRaw, byModelRaw, byDayRaw] = await Promise.all([
      prisma.aiUsageLog.aggregate({
        where,
        _count: { _all: true },
        _sum: {
          inputTokens:       true,
          cachedInputTokens: true,
          outputTokens:      true,
          reasoningTokens:   true,
          totalTokens:       true,
          toolCallCount:     true,
        },
      }),
      prisma.aiUsageLog.count({ where: { ...where, succeeded: false } }),
      prisma.aiUsageLog.groupBy({
        by:     ['channel'],
        where,
        _count: { _all: true },
        _sum:   { totalTokens: true },
      }),
      prisma.aiUsageLog.groupBy({
        by:     ['model'],
        where,
        _count: { _all: true },
        _sum:   { inputTokens: true, cachedInputTokens: true, outputTokens: true, totalTokens: true },
      }),
      prisma.$queryRaw<{ day: string; requests: number; total_tokens: number }[]>`
        SELECT
          DATE_TRUNC('day', "createdAt")::text AS day,
          COUNT(*)::int                        AS requests,
          COALESCE(SUM("totalTokens"), 0)::int  AS total_tokens
        FROM ai_usage_logs
        WHERE "createdAt" >= ${start} AND "createdAt" < ${end}
        GROUP BY DATE_TRUNC('day', "createdAt")
        ORDER BY day
      `,
    ])

    const requests = totals._count._all
    const sum       = totals._sum

    // Cost is computed per model (each model has its own price) and summed —
    // never a single blended rate — so mixing tiers doesn't skew the total.
    const costValue = calculateAiUsageCostUsd(byModelRaw.map(row => ({
      model:             row.model,
      inputTokens:       row._sum.inputTokens ?? 0,
      cachedInputTokens: row._sum.cachedInputTokens ?? 0,
      outputTokens:      row._sum.outputTokens ?? 0,
    })))

    res.json({
      range,
      since: start.toISOString(),
      until: end.toISOString(),
      totals: {
        requests,
        failedRequests,
        inputTokens:          sum.inputTokens ?? 0,
        cachedInputTokens:    sum.cachedInputTokens ?? 0,
        outputTokens:         sum.outputTokens ?? 0,
        reasoningTokens:      sum.reasoningTokens ?? 0,
        totalTokens:          sum.totalTokens ?? 0,
        toolCalls:            sum.toolCallCount ?? 0,
        avgTokensPerResponse: requests > 0 ? Math.round(((sum.totalTokens ?? 0) / requests) * 10) / 10 : 0,
      },
      byChannel: byChannelRaw.map(r => ({
        channel:     r.channel,
        requests:    r._count._all,
        totalTokens: r._sum.totalTokens ?? 0,
      })),
      byDay: byDayRaw.map(r => ({
        day:         r.day.slice(0, 10),
        requests:    r.requests,
        totalTokens: r.total_tokens,
      })),
      models: byModelRaw.map(r => r.model),
      cost: {
        value:    costValue,
        currency: 'USD',
        source:   'CALCULATED_FROM_TOKEN_USAGE',
      },
    })
  } catch (err: any) {
    if (err instanceof InvalidRangeError) { res.status(400).json({ error: err.message }); return }
    console.error('[AiUsage] fetch error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

export default router
