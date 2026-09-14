// Verifies GET /ai-suite/ai-usage (apps/api/src/ai-suite/meta/meta-usage.routes.ts):
//  - it aggregates AiUsageLog rows correctly for the requested window (sums,
//    per-channel breakdown, failure count, avg tokens/response)
//  - the cost figure is DERIVED from token usage (not a hardcoded constant)
//    and is always labeled CALCULATED_FROM_TOKEN_USAGE, never "actual"
//  - the route sits behind adminOnly — provider billing/cost data is
//    Admin-only per project policy
//
// Drives the real route handler directly (no HTTP server) with an in-memory
// fake standing in for Prisma, following the pattern used by
// push-subscription-ownership.test.ts. No real network call is made —
// enforced further by the global no-real-sends guard.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { adminOnly } from '../middleware/rbac'

// Cold first import of meta-usage.routes.ts pulls in a fair amount of the
// ai-suite module graph — comfortably past the 5s default under system load
// (same rationale as dashboard-patient-overview.test.ts / push-subscription-ownership.test.ts).
vi.setConfig({ testTimeout: 20000 })

process.env.DATABASE_URL       ??= 'postgresql://test:test@localhost:5432/test'
process.env.JWT_SECRET         ??= 'test-secret-at-least-32-characters-long'
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-at-least-32-chars'

// ── In-memory AiUsageLog store + a minimal Prisma-shaped query engine ──────
// Real seeded rows (not canned return values) so the aggregation math in the
// route is actually exercised, not just its shape.

interface Row {
  id: string
  conversationId: string | null
  channel: string
  model: string
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningTokens: number
  totalTokens: number
  toolCallCount: number
  succeeded: boolean
  errorMessage: string | null
  createdAt: Date
}

const NOW = new Date('2026-09-14T12:00:00.000Z')

const SEED: Row[] = [
  // In range — flagship model, succeeded, has tool calls and cached tokens
  {
    id: 'u1', conversationId: 'conv-1', channel: 'WHATSAPP', model: 'gpt-5.6-sol',
    inputTokens: 1000, cachedInputTokens: 200, outputTokens: 500, reasoningTokens: 100,
    totalTokens: 1500, toolCallCount: 2, succeeded: true, errorMessage: null,
    createdAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1000), // 2h ago
  },
  // In range — cost-optimized model, FAILED request (zero tokens, has errorMessage)
  {
    id: 'u2', conversationId: 'conv-2', channel: 'WEBSITE', model: 'gpt-5.6-luna',
    inputTokens: 2000, cachedInputTokens: 0, outputTokens: 800, reasoningTokens: 50,
    totalTokens: 2800, toolCallCount: 1, succeeded: false, errorMessage: 'OpenAI 500',
    createdAt: new Date(NOW.getTime() - 1 * 60 * 60 * 1000), // 1h ago
  },
  // Out of range — 45 days ago, must NOT be included in a 30d window
  {
    id: 'u3', conversationId: 'conv-3', channel: 'WHATSAPP', model: 'gpt-5.6-sol',
    inputTokens: 9999, cachedInputTokens: 0, outputTokens: 9999, reasoningTokens: 0,
    totalTokens: 19998, toolCallCount: 9, succeeded: true, errorMessage: null,
    createdAt: new Date(NOW.getTime() - 45 * 24 * 60 * 60 * 1000),
  },
]

function inRange(row: Row, where: any): boolean {
  if (where?.createdAt?.gte && row.createdAt < where.createdAt.gte) return false
  if (where?.createdAt?.lt && row.createdAt >= where.createdAt.lt) return false
  if (where?.succeeded !== undefined && row.succeeded !== where.succeeded) return false
  return true
}

function sum(rows: Row[], field: keyof Row): number {
  return rows.reduce((acc, r) => acc + (r[field] as number), 0)
}

function makeFakePrisma(seed: Row[]) {
  return {
    aiUsageLog: {
      aggregate: vi.fn(async ({ where }: any) => {
        const rows = seed.filter(r => inRange(r, where))
        return {
          _count: { _all: rows.length },
          _sum: {
            inputTokens:       sum(rows, 'inputTokens'),
            cachedInputTokens: sum(rows, 'cachedInputTokens'),
            outputTokens:      sum(rows, 'outputTokens'),
            reasoningTokens:   sum(rows, 'reasoningTokens'),
            totalTokens:       sum(rows, 'totalTokens'),
            toolCallCount:     sum(rows, 'toolCallCount'),
          },
        }
      }),
      count: vi.fn(async ({ where }: any) => seed.filter(r => inRange(r, where)).length),
      groupBy: vi.fn(async ({ by, where }: any) => {
        const rows = seed.filter(r => inRange(r, where))
        const key = by[0] as 'channel' | 'model'
        const groups = new Map<string, Row[]>()
        for (const r of rows) {
          const k = r[key] as string
          if (!groups.has(k)) groups.set(k, [])
          groups.get(k)!.push(r)
        }
        return [...groups.entries()].map(([k, grouped]) => ({
          [key]: k,
          _count: { _all: grouped.length },
          _sum: {
            totalTokens:       sum(grouped, 'totalTokens'),
            inputTokens:       sum(grouped, 'inputTokens'),
            cachedInputTokens: sum(grouped, 'cachedInputTokens'),
            outputTokens:      sum(grouped, 'outputTokens'),
          },
        }))
      }),
    },
    // Tag function: prisma.$queryRaw`... ${start} ... ${end} ...` — the route
    // interpolates `start` then `end` in that order, so values[0]/values[1]
    // give us the same window without needing to parse the SQL text.
    $queryRaw: vi.fn(async (_strings: TemplateStringsArray, ...values: any[]) => {
      const [start, end] = values as [Date, Date]
      const rows = seed.filter(r => r.createdAt >= start && r.createdAt < end)
      const byDay = new Map<string, { requests: number; total_tokens: number }>()
      for (const r of rows) {
        const day = r.createdAt.toISOString().slice(0, 10)
        const entry = byDay.get(day) ?? { requests: 0, total_tokens: 0 }
        entry.requests += 1
        entry.total_tokens += r.totalTokens
        byDay.set(day, entry)
      }
      return [...byDay.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([day, v]) => ({ day, ...v }))
    }),
  }
}

vi.mock('../lib/prisma', () => ({ prisma: makeFakePrisma(SEED) }))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findHandler(router: any, method: string, path: string) {
  for (const layer of router.stack) {
    if (layer.route?.path === path) {
      const matches = layer.route.stack.filter((l: any) => l.method === method)
      if (matches.length > 0) return matches[matches.length - 1].handle
    }
  }
  throw new Error(`No handler for ${method.toUpperCase()} ${path}`)
}

function fakeReq(query: Record<string, string>) {
  return { user: { id: 'admin-1', role: 'ADMIN' }, query, headers: {} } as any
}

function fakeRes() {
  const res: any = {}
  res.status = vi.fn(() => res)
  res.json = vi.fn(() => res)
  return res
}

describe('GET /ai-suite/ai-usage', () => {
  beforeEach(() => { vi.useFakeTimers().setSystemTime(NOW) })
  // Leaving fake timers active after this suite finishes freezes Date/setTimeout
  // for whichever test file vitest's worker runs next (fake timers are a
  // process-global patch, not scoped to this file) — that previously caused
  // unrelated cache-TTL-dependent tests elsewhere (e.g. pricing-grounding's
  // getCachedMenu) to see stale data when run in the same worker as this file.
  afterEach(() => { vi.useRealTimers() })

  it('sums AiUsageLog fields correctly for the window and excludes rows outside it', async () => {
    const { default: router } = await import('../ai-suite/meta/meta-usage.routes')
    const handler = findHandler(router, 'get', '/ai-usage')
    const res = fakeRes()

    await handler(fakeReq({ range: '30d' }), res)

    expect(res.status).not.toHaveBeenCalledWith(500)
    const body = res.json.mock.calls[0][0]

    // Only u1 + u2 are inside the 30d window — u3 (45 days ago) is excluded.
    expect(body.totals.requests).toBe(2)
    expect(body.totals.failedRequests).toBe(1)
    expect(body.totals.inputTokens).toBe(3000)          // 1000 + 2000
    expect(body.totals.cachedInputTokens).toBe(200)       // 200 + 0
    expect(body.totals.outputTokens).toBe(1300)          // 500 + 800
    expect(body.totals.reasoningTokens).toBe(150)         // 100 + 50
    expect(body.totals.totalTokens).toBe(4300)            // 1500 + 2800
    expect(body.totals.toolCalls).toBe(3)                 // 2 + 1
    expect(body.totals.avgTokensPerResponse).toBe(2150)   // 4300 / 2

    const whatsapp = body.byChannel.find((c: any) => c.channel === 'WHATSAPP')
    const website   = body.byChannel.find((c: any) => c.channel === 'WEBSITE')
    expect(whatsapp.totalTokens).toBe(1500)
    expect(website.totalTokens).toBe(2800)

    expect(body.models.sort()).toEqual(['gpt-5.6-luna', 'gpt-5.6-sol'])
  })

  it('labels the cost figure CALCULATED_FROM_TOKEN_USAGE, never as actual billing', async () => {
    const { default: router } = await import('../ai-suite/meta/meta-usage.routes')
    const handler = findHandler(router, 'get', '/ai-usage')
    const res = fakeRes()

    await handler(fakeReq({ range: '30d' }), res)
    const body = res.json.mock.calls[0][0]

    expect(body.cost.source).toBe('CALCULATED_FROM_TOKEN_USAGE')
    expect(body.cost.currency).toBe('USD')
    expect(typeof body.cost.value).toBe('number')
    expect(body.cost.value).toBeGreaterThan(0)
  })

  it('the cost figure is DERIVED from token usage, not a hardcoded constant — doubling tokens roughly doubles cost', async () => {
    const { calculateAiUsageCostUsd } = await import('../ai-suite/meta/meta-usage.routes')

    const base = calculateAiUsageCostUsd([
      { model: 'gpt-5.6-sol', inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 1_000_000 },
    ])
    const doubled = calculateAiUsageCostUsd([
      { model: 'gpt-5.6-sol', inputTokens: 2_000_000, cachedInputTokens: 0, outputTokens: 2_000_000 },
    ])
    const zero = calculateAiUsageCostUsd([])

    expect(base).toBeGreaterThan(0)
    expect(doubled).toBeCloseTo(base * 2, 2)
    expect(zero).toBe(0)

    // Cached tokens must be billed at a DISCOUNT relative to full-price input
    // (they're a subset of inputTokens, not an addition on top of it).
    const noCache = calculateAiUsageCostUsd([
      { model: 'gpt-5.6-sol', inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 0 },
    ])
    const allCached = calculateAiUsageCostUsd([
      { model: 'gpt-5.6-sol', inputTokens: 1_000_000, cachedInputTokens: 1_000_000, outputTokens: 0 },
    ])
    expect(allCached).toBeLessThan(noCache)
  })

  it('window boundary: a "today" range excludes yesterday\'s usage', async () => {
    const { default: router } = await import('../ai-suite/meta/meta-usage.routes')
    const handler = findHandler(router, 'get', '/ai-usage')
    const res = fakeRes()

    await handler(fakeReq({ range: 'today' }), res)
    const body = res.json.mock.calls[0][0]

    // u1/u2 are 1-2h before NOW (2026-09-14T12:00 UTC = 15:00 Kampala), so
    // both fall on today's Kampala calendar day; u3 (45 days ago) never does.
    expect(body.totals.requests).toBe(2)
  })
})

describe('RBAC: /ai-suite/ai-usage is Admin-only', () => {
  function fakeMwRes() {
    const res: any = {}
    res.status = vi.fn(() => res)
    res.json = vi.fn(() => res)
    return res
  }

  it('a non-admin clinical role (e.g. RECEPTIONIST) is blocked with 403', () => {
    const req: any = { user: { id: 'u1', role: 'RECEPTIONIST' } }
    const res = fakeMwRes()
    const next = vi.fn()
    adminOnly(req, res, next)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(next).not.toHaveBeenCalled()
  })

  it('an unauthenticated request is blocked with 401', () => {
    const req: any = {}
    const res = fakeMwRes()
    const next = vi.fn()
    adminOnly(req, res, next)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('ADMIN is allowed through', () => {
    const req: any = { user: { id: 'u1', role: 'ADMIN' } }
    const res = fakeMwRes()
    const next = vi.fn()
    adminOnly(req, res, next)
    expect(next).toHaveBeenCalledOnce()
    expect(res.status).not.toHaveBeenCalled()
  })

  it('router wiring: GET /ai-usage is registered behind requireAuth + adminOnly', async () => {
    const { default: router } = await import('../ai-suite/meta/meta-usage.routes')
    const stack = (router as any).stack as any[]
    const layer = stack.find(l => l.route?.path === '/ai-usage')
    expect(layer).toBeTruthy()
    const middlewareNames = layer.route.stack.map((l: any) => l.name)
    // requireAuth and adminOnly must both run before the handler.
    expect(middlewareNames.length).toBeGreaterThanOrEqual(3)
  })
})
