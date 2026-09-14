import { Router } from 'express'
import fs from 'fs'
import { requireAuth } from '../../middleware/auth'
import { adminOnly } from '../../middleware/rbac'
import { prisma } from '../../lib/prisma'
import { startOfKampalaDay, endOfKampalaDay, startOfKampalaMonth, startOfPreviousKampalaMonth } from '../../utils/kampala-time'

const router = Router()

const CACHE_FILE = '/tmp/codeclinic-meta-usage.json'
const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6 hours

const UG_WABA   = '1754698499275270'   // Code Clinic Uganda (routed via AT)
const KE_WABA   = '1035568108843333'   // Elyrac AI Kenya (Meta Cloud API direct)
const GRAPH_VER = 'v25.0'

// Meta per-message pricing changed July 1 2025 — lookback only from Dec 1 2025
const DATA_SINCE = new Date('2025-12-01T00:00:00Z')

interface DataPoint { start: number; end: number; volume: number; cost?: number }
interface WabaUsage {
  wabaId:      string
  wabaName:    string
  phone:       string
  daily:       DataPoint[]
  thisMonth:   { volume: number; cost: number }
  lastMonth:   { volume: number; cost: number }
  fetchedAt:   string
}
interface UsageCache {
  uganda:    WabaUsage
  kenya:     WabaUsage
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

async function fetchWabaAnalytics(wabaId: string, token: string): Promise<DataPoint[]> {
  const now   = Math.floor(Date.now() / 1000)
  const since = Math.floor(Math.max(DATA_SINCE.getTime() / 1000, Date.now() / 1000 - 90 * 86400))

  const url = `https://graph.facebook.com/${GRAPH_VER}/${wabaId}/pricing_analytics`
    + `?start=${since}&end=${now}&granularity=DAILY&access_token=${token}`

  const res  = await fetch(url)
  const json = await res.json() as { data?: { data_points?: DataPoint[] }[]; error?: any }

  if (json.error) {
    console.warn(`[MetaUsage] API error for WABA ${wabaId}:`, json.error.message)
    return []
  }

  return json.data?.[0]?.data_points ?? []
}

function summariseMonth(points: DataPoint[], year: number, month: number) {
  const start = new Date(year, month - 1, 1).getTime() / 1000
  const end   = new Date(year, month, 1).getTime() / 1000
  const inMonth = points.filter(p => p.start >= start && p.start < end)
  return {
    volume: inMonth.reduce((s, p) => s + p.volume, 0),
    cost:   inMonth.reduce((s, p) => s + (p.cost ?? 0), 0),
  }
}

async function buildUsage(token: string): Promise<UsageCache> {
  const now  = new Date()
  const yr   = now.getUTCFullYear()
  const mo   = now.getUTCMonth() + 1
  const prev = mo === 1 ? { yr: yr - 1, mo: 12 } : { yr, mo: mo - 1 }

  const [ugPoints, kePoints] = await Promise.all([
    fetchWabaAnalytics(UG_WABA, token),
    fetchWabaAnalytics(KE_WABA, token),
  ])

  // Keep only last 30 days of daily points for the chart
  const cutoff = Math.floor(Date.now() / 1000) - 30 * 86400
  const trim   = (pts: DataPoint[]) => pts.filter(p => p.start >= cutoff)

  return {
    uganda: {
      wabaId:    UG_WABA,
      wabaName:  'Code Clinic (Uganda)',
      phone:     '+256 741 087667',
      daily:     trim(ugPoints),
      thisMonth: summariseMonth(ugPoints, yr, mo),
      lastMonth: summariseMonth(ugPoints, prev.yr, prev.mo),
      fetchedAt: now.toISOString(),
    },
    kenya: {
      wabaId:    KE_WABA,
      wabaName:  'Elyrac AI (Kenya)',
      phone:     '+254 701 944393',
      daily:     trim(kePoints),
      thisMonth: summariseMonth(kePoints, yr, mo),
      lastMonth: summariseMonth(kePoints, prev.yr, prev.mo),
      fetchedAt: now.toISOString(),
    },
    cachedAt: now.toISOString(),
  }
}

// GET /ai-suite/meta-usage
router.get('/meta-usage', requireAuth, async (_req, res) => {
  try {
    const cached = readCache()
    if (cached) return res.json(cached)

    const token = process.env.WHATSAPP_TOKEN
    if (!token) return res.status(503).json({ error: 'WHATSAPP_TOKEN not configured' })

    const data = await buildUsage(token)
    writeCache(data)
    res.json(data)
  } catch (err: any) {
    console.error('[MetaUsage] fetch error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /ai-suite/meta-usage/refresh — force-bust the cache
router.post('/meta-usage/refresh', requireAuth, async (_req, res) => {
  try {
    try { fs.unlinkSync(CACHE_FILE) } catch {}
    const token = process.env.WHATSAPP_TOKEN
    if (!token) return res.status(503).json({ error: 'WHATSAPP_TOKEN not configured' })
    const data = await buildUsage(token)
    writeCache(data)
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

type AiUsageRangeKey = 'today' | '7d' | '30d' | 'month' | 'prev_month'

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

export function resolveAiUsageRange(rangeParam: unknown): { start: Date; end: Date; range: AiUsageRangeKey } {
  const now = new Date()
  const key = (typeof rangeParam === 'string' ? rangeParam : '30d') as AiUsageRangeKey

  switch (key) {
    case 'today':
      return { start: startOfKampalaDay(now), end: endOfKampalaDay(now), range: 'today' }
    case '7d':
      return { start: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), end: now, range: '7d' }
    case 'month':
      return { start: startOfKampalaMonth(now), end: now, range: 'month' }
    case 'prev_month':
      return { start: startOfPreviousKampalaMonth(now), end: startOfKampalaMonth(now), range: 'prev_month' }
    case '30d':
    default:
      return { start: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), end: now, range: '30d' }
  }
}

// GET /ai-suite/ai-usage?range=today|7d|30d|month|prev_month
router.get('/ai-usage', requireAuth, adminOnly, async (req, res) => {
  try {
    const { start, end, range } = resolveAiUsageRange(req.query.range)
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
    console.error('[AiUsage] fetch error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

export default router
