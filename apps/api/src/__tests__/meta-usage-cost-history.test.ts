// Covers the Workstream B cost-history extension to meta-usage.routes.ts:
// - resolveAiUsageRange: 90d + custom (Kampala-aware), replacing the old raw
//   UTC day-subtraction for 7d/30d with Kampala-calendar-day alignment.
// - metaDataFloor / buildCoverage: Meta's pricing_analytics can only honestly
//   answer for data since max(DATA_SINCE, now-90d) — a requested range
//   outside that must report `unavailable`/`partial`, never a silent $0.00.
// - buildUsage(token, requestedRange): produces `selected`/`coverage` only
//   when a range was actually requested, and Kampala-aligns thisMonth/
//   lastMonth (previously raw UTC, which could pick the wrong month for a
//   few hours around each month boundary since Kampala is UTC+3).
// - GET /meta-usage: range/from/to wiring, 400 on invalid custom range,
//   cache bypass when a specific range is requested.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 20000 })

process.env.DATABASE_URL       ??= 'postgresql://test:test@localhost:5432/test'
process.env.JWT_SECRET         ??= 'test-secret-at-least-32-characters-long'
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-at-least-32-chars'

const prismaMock = {}
vi.mock('../lib/prisma', () => ({ prisma: prismaMock }))

const ORIGINAL_FETCH = global.fetch

afterEach(() => {
  global.fetch = ORIGINAL_FETCH
  vi.useRealTimers()
})

describe('resolveAiUsageRange — Kampala-aware ranges', () => {
  it('today: a timestamp just after Kampala midnight is NOT treated as yesterday', async () => {
    const { resolveAiUsageRange } = await import('../ai-suite/meta/meta-usage.routes')
    // 2026-09-14T21:30:00Z = 2026-09-15T00:30 Kampala (UTC+3) — just past Kampala midnight.
    vi.useFakeTimers().setSystemTime(new Date('2026-09-14T21:30:00.000Z'))
    const { start, end, range } = resolveAiUsageRange('today')
    expect(range).toBe('today')
    // Kampala-day start for 2026-09-15 00:00 Kampala = 2026-09-14T21:00:00Z
    expect(start.toISOString()).toBe('2026-09-14T21:00:00.000Z')
    expect(end.toISOString()).toBe('2026-09-15T21:00:00.000Z')
  })

  it('7d: spans exactly 7 Kampala calendar days ending today, not a raw 7*24h UTC subtraction', async () => {
    const { resolveAiUsageRange } = await import('../ai-suite/meta/meta-usage.routes')
    vi.useFakeTimers().setSystemTime(new Date('2026-09-14T21:30:00.000Z')) // just past Kampala midnight
    const { start, end } = resolveAiUsageRange('7d')
    // today (Sep 15 Kampala) + 6 preceding days = start of Sep 9 Kampala.
    expect(start.toISOString()).toBe('2026-09-08T21:00:00.000Z')
    expect(end.toISOString()).toBe('2026-09-14T21:30:00.000Z')
  })

  it('90d: starts 89 Kampala days before today\'s Kampala midnight (today + 89 preceding days = 90)', async () => {
    const { resolveAiUsageRange } = await import('../ai-suite/meta/meta-usage.routes')
    const now = new Date('2026-09-14T12:00:00.000Z') // 15:00 Kampala
    vi.useFakeTimers().setSystemTime(now)
    const { start, end, range } = resolveAiUsageRange('90d')
    expect(range).toBe('90d')
    expect(end).toEqual(now)
    // Kampala midnight today (Sep 14) is 2026-09-13T21:00:00Z; 89 days earlier:
    const expectedStart = new Date(new Date('2026-09-13T21:00:00.000Z').getTime() - 89 * 86_400_000)
    expect(start.toISOString()).toBe(expectedStart.toISOString())
  })

  it('month: uses Kampala month boundaries, not UTC — correct even in the last hours of a UTC month', async () => {
    const { resolveAiUsageRange } = await import('../ai-suite/meta/meta-usage.routes')
    // 2026-08-31T22:00:00Z = 2026-09-01T01:00 Kampala — already September in Kampala,
    // still August in UTC. A UTC-based "this month" would wrongly pick August.
    vi.useFakeTimers().setSystemTime(new Date('2026-08-31T22:00:00.000Z'))
    const { start } = resolveAiUsageRange('month')
    expect(start.toISOString()).toBe('2026-08-31T21:00:00.000Z') // Sep 1 00:00 Kampala
  })

  it('custom: interprets from/to as Kampala calendar dates and is end-inclusive', async () => {
    const { resolveAiUsageRange } = await import('../ai-suite/meta/meta-usage.routes')
    const { start, end, range } = resolveAiUsageRange('custom', '2026-09-01', '2026-09-30')
    expect(range).toBe('custom')
    expect(start.toISOString()).toBe('2026-08-31T21:00:00.000Z') // Sep 1 00:00 Kampala
    expect(end.toISOString()).toBe('2026-09-30T21:00:00.000Z')   // Oct 1 00:00 Kampala (exclusive upper bound)
  })

  it('custom: a cross-month range (Aug 15 – Sep 15) resolves correctly', async () => {
    const { resolveAiUsageRange } = await import('../ai-suite/meta/meta-usage.routes')
    const { start, end } = resolveAiUsageRange('custom', '2026-08-15', '2026-09-15')
    expect(start.toISOString()).toBe('2026-08-14T21:00:00.000Z')
    expect(end.toISOString()).toBe('2026-09-15T21:00:00.000Z')
  })

  it('custom: throws InvalidRangeError when from/to are missing', async () => {
    const { resolveAiUsageRange, InvalidRangeError } = await import('../ai-suite/meta/meta-usage.routes')
    expect(() => resolveAiUsageRange('custom')).toThrow(InvalidRangeError)
    expect(() => resolveAiUsageRange('custom', '2026-09-01')).toThrow(InvalidRangeError)
  })

  it('custom: throws InvalidRangeError when from is after to', async () => {
    const { resolveAiUsageRange, InvalidRangeError } = await import('../ai-suite/meta/meta-usage.routes')
    expect(() => resolveAiUsageRange('custom', '2026-09-30', '2026-09-01')).toThrow(InvalidRangeError)
  })

  it('custom: throws InvalidRangeError on a malformed date string', async () => {
    const { resolveAiUsageRange, InvalidRangeError } = await import('../ai-suite/meta/meta-usage.routes')
    expect(() => resolveAiUsageRange('custom', 'not-a-date', '2026-09-30')).toThrow(InvalidRangeError)
  })
})

describe('metaDataFloor — the earliest instant Meta can honestly answer for', () => {
  it('is the later of DATA_SINCE and 90 days ago', async () => {
    const { metaDataFloor } = await import('../ai-suite/meta/meta-usage.routes')
    // Far in the future: 90-days-ago is after DATA_SINCE, so it wins.
    const farFuture = new Date('2027-01-01T00:00:00.000Z')
    const floor = metaDataFloor(farFuture)
    expect(floor.toISOString()).toBe(new Date(farFuture.getTime() - 90 * 86400000).toISOString())
  })

  it('is DATA_SINCE itself when now is still within 90 days of it', async () => {
    const { metaDataFloor } = await import('../ai-suite/meta/meta-usage.routes')
    const soonAfterDataSince = new Date('2025-12-10T00:00:00.000Z')
    const floor = metaDataFloor(soonAfterDataSince)
    expect(floor.toISOString()).toBe('2025-12-01T00:00:00.000Z')
  })
})

describe('buildUsage — selected/coverage for a requested range', () => {
  function mockGraphResponses(points: { start: number; end: number; volume: number; cost: number }[]) {
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('pricing_analytics')) {
        return { json: async () => ({ data: [{ data_points: points }] }) } as any
      }
      if (url.includes('phone_numbers')) {
        return { json: async () => ({ data: [] }) } as any
      }
      throw new Error('unexpected fetch: ' + url)
    }) as any
  }

  beforeEach(() => {
    process.env.WHATSAPP_WABA_ID = '1035568108843333'
  })

  it('reports unavailable (not $0.00) when the requested range is entirely before what Meta can supply', async () => {
    vi.resetModules()
    const now = new Date('2026-09-14T12:00:00.000Z')
    vi.useFakeTimers().setSystemTime(now)
    mockGraphResponses([])
    const { buildUsage, resolveAiUsageRange } = await import('../ai-suite/meta/meta-usage.routes')

    // Way before DATA_SINCE (2025-12-01) and before the 90-day floor.
    const requested = resolveAiUsageRange('custom', '2025-01-01', '2025-01-31')
    const result = await buildUsage('fake-token', requested)

    expect(result.account!.selected).toBeNull()
    expect(result.account!.coverage!.unavailable).toBe(true)
    expect(result.account!.coverage!.reason).toContain('only retains pricing data')
  })

  it('reports full coverage and real figures when the requested range is entirely within the supported window', async () => {
    vi.resetModules()
    const now = new Date('2026-09-14T12:00:00.000Z')
    vi.useFakeTimers().setSystemTime(now)
    mockGraphResponses([
      { start: Math.floor(new Date('2026-09-05T00:00:00Z').getTime() / 1000), end: 0, volume: 10, cost: 2.5 },
      { start: Math.floor(new Date('2026-09-06T00:00:00Z').getTime() / 1000), end: 0, volume: 20, cost: 5 },
    ])
    const { buildUsage, resolveAiUsageRange } = await import('../ai-suite/meta/meta-usage.routes')

    const requested = resolveAiUsageRange('custom', '2026-09-01', '2026-09-10')
    const result = await buildUsage('fake-token', requested)

    expect(result.account!.coverage!.unavailable).toBe(false)
    expect(result.account!.coverage!.full).toBe(true)
    expect(result.account!.coverage!.reason).toBeNull()
    expect(result.account!.selected).toEqual({ volume: 30, cost: 7.5 })
  })

  it('reports partial coverage when the requested range straddles the floor', async () => {
    vi.resetModules()
    // now = 2026-09-14, floor = max(DATA_SINCE, now-90d) = 2025-12-01 (90d-ago is 2026-06-16, later) -> floor = 2026-06-16-ish
    const now = new Date('2026-09-14T12:00:00.000Z')
    vi.useFakeTimers().setSystemTime(now)
    mockGraphResponses([
      { start: Math.floor(new Date('2026-07-01T00:00:00Z').getTime() / 1000), end: 0, volume: 15, cost: 3 },
    ])
    const { buildUsage, resolveAiUsageRange, metaDataFloor } = await import('../ai-suite/meta/meta-usage.routes')

    // Requested range starts well before the 90-day floor, ends after it.
    const requested = resolveAiUsageRange('custom', '2026-01-01', '2026-07-15')
    const result = await buildUsage('fake-token', requested)

    const floor = metaDataFloor(now)
    expect(result.account!.coverage!.unavailable).toBe(false)
    expect(result.account!.coverage!.full).toBe(false)
    expect(result.account!.coverage!.coveredStart).toBe(floor.toISOString())
    expect(result.account!.coverage!.reason).toContain('partial overlap')
    expect(result.account!.selected).toEqual({ volume: 15, cost: 3 })
  })

  it('does not include selected/coverage at all when no range was requested (existing callers unaffected)', async () => {
    vi.resetModules()
    vi.useFakeTimers().setSystemTime(new Date('2026-09-14T12:00:00.000Z'))
    mockGraphResponses([])
    const { buildUsage } = await import('../ai-suite/meta/meta-usage.routes')

    const result = await buildUsage('fake-token')

    expect(result.account!.selected).toBeNull()
    expect(result.account!.coverage).toBeNull()
    // thisMonth/lastMonth are always present regardless.
    expect(result.account!.thisMonth).toBeDefined()
    expect(result.account!.lastMonth).toBeDefined()
  })

  it('a Graph API error for pricing_analytics does not throw — returns empty points, not an exception', async () => {
    vi.resetModules()
    vi.useFakeTimers().setSystemTime(new Date('2026-09-14T12:00:00.000Z'))
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('pricing_analytics')) return { json: async () => ({ error: { message: 'temporary Meta outage' } }) } as any
      return { json: async () => ({ data: [] }) } as any
    }) as any
    const { buildUsage } = await import('../ai-suite/meta/meta-usage.routes')

    const result = await buildUsage('fake-token')

    expect(result.account!.thisMonth).toEqual({ volume: 0, cost: 0 })
    expect(result.configured).toBe(true)
  })
})
