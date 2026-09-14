// Focused regression coverage for the Admin Dashboard "Patients Overview"
// card's backend (apps/api/src/routes/clinical.ts):
//
//  1. GET /clinical/analytics/dashboard must report newPatientsThisMonth +
//     returningPatientsThisMonth === patientsSeenThisMonth for the Kampala
//     month-to-date window — the frontend card renders "Patients Seen" as
//     exactly that sum (see apps/web/app/(admin)/dashboard/page.tsx), so a
//     mismatch there would silently desync the headline number from the two
//     figures shown right next to it.
//  2. GET /clinical/analytics/dashboard/trend must never surface
//     Infinity/NaN when a metric's previous-period value is 0 — safePercentChange
//     (kampala-time.ts) is supposed to return null for "no meaningful
//     baseline" instead, and the frontend renders that as a "New" badge.
//
// Drives the real Express route handlers directly (no HTTP server), with an
// in-memory fake in place of Prisma — same pattern as
// push-subscription-ownership.test.ts. The system clock is pinned so the
// Kampala month-to-date / previous-month-to-date windows (kampala-time.ts)
// are deterministic.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Cold first import of routes/clinical.ts pulls in openai, @aws-sdk/client-s3,
// sharp, multer, etc. — comfortably past the 5s default under system load
// (same rationale as push-subscription-ownership.test.ts).
vi.setConfig({ testTimeout: 20000 })

// apps/api/src/lib/env.ts calls process.exit(1) at import time if these are
// missing — harmless placeholders so the module loads; nothing in this test
// ever performs a real DB connection or JWT operation (prisma is mocked
// below and requireAuth is bypassed entirely by calling the route handler
// directly, exactly as push-subscription-ownership.test.ts does).
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test'
process.env.JWT_SECRET ??= 'test-secret-at-least-32-characters-long'
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-at-least-32-chars'
process.env.OPENAI_API_KEY ??= 'test-key-not-real'

// ─── Minimal Prisma `where` matcher — just enough to support the shapes
//     clinical.ts and patient-analytics.service.ts actually use (gte/lte/
//     gt/lt, in/notIn, not:null, and plain equality). ───────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function matchesWhere(row: any, where: any): boolean {
  if (!where) return true
  return Object.entries(where).every(([key, cond]: [string, any]) => {
    const val = row[key]
    if (cond === null) return val === null
    if (typeof cond !== 'object' || cond instanceof Date) return val === cond
    if ('in' in cond) return cond.in.includes(val)
    if ('notIn' in cond) return !cond.notIn.includes(val)
    let ok = true
    if ('gte' in cond) ok = ok && val >= cond.gte
    if ('lte' in cond) ok = ok && val <= cond.lte
    if ('gt' in cond) ok = ok && val > cond.gt
    if ('lt' in cond) ok = ok && val < cond.lt
    if ('not' in cond) ok = ok && (cond.not === null ? val !== null : val !== cond.not)
    return ok
  })
}

const db = vi.hoisted(() => ({
  patients: [] as any[],
  appointments: [] as any[],
}))

vi.mock('../lib/prisma', () => ({
  prisma: {
    appointment: {
      findMany: vi.fn(async ({ where, select, distinct }: any = {}) => {
        let rows = db.appointments.filter((a: any) => matchesWhere(a, where))
        if (distinct?.includes('patientId')) {
          const seen = new Set<string>()
          rows = rows.filter((a: any) => {
            if (seen.has(a.patientId)) return false
            seen.add(a.patientId)
            return true
          })
        }
        if (select?.patientId && Object.keys(select).length === 1) {
          return rows.map((a: any) => ({ patientId: a.patientId }))
        }
        return rows
      }),
      count: vi.fn(async ({ where }: any = {}) => db.appointments.filter((a: any) => matchesWhere(a, where)).length),
    },
    patient: {
      count: vi.fn(async (args: any = {}) => db.patients.filter((p: any) => matchesWhere(p, args.where)).length),
      findMany: vi.fn(async ({ where, select }: any = {}) => {
        const rows = db.patients.filter((p: any) => matchesWhere(p, where))
        if (!select) return rows
        return rows.map((p: any) => {
          const projected: any = {}
          for (const k of Object.keys(select)) projected[k] = p[k]
          return projected
        })
      }),
      groupBy: vi.fn(async () => []),
    },
    payment: { aggregate: vi.fn(async () => ({ _sum: { amountUGX: 0 } })) },
    invoice: { aggregate: vi.fn(async () => ({ _sum: { totalUGX: 0 } })) },
    treatmentPlan: { findMany: vi.fn(async () => []) },
    agentLog: { count: vi.fn(async () => 0) },
    nurtureLog: { count: vi.fn(async () => 0) },
    $queryRaw: vi.fn(async () => []),
  },
}))

// These routes register requireAuth as an explicit middleware ahead of the
// real handler (router.get('/analytics/dashboard', requireAuth, async (...) =>
// ...)), on TOP of the router-level `router.use(requireAuth)` — so a route's
// method-matching layers include the real handler as the LAST match. Take
// that one, bypassing requireAuth entirely (same technique as
// push-subscription-ownership.test.ts).
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

function fakeReq() {
  return { headers: {} } as any
}

function fakeRes() {
  const res: any = {}
  res.status = vi.fn(() => res)
  res.json = vi.fn(() => res)
  return res
}

// 2026-09-14T10:00 UTC = 13:00 Kampala (UTC+3, no DST) — so the Kampala
// month-to-date window is 1–14 Sep, and kampalaPreviousMonthToDateRange's
// "same number of days" window is 1–15 Aug. Deliberately mid-month, not a
// boundary edge case.
const FIXED_NOW = new Date('2026-09-14T10:00:00.000Z')

describe('Patients Overview — dashboard + trend endpoints', () => {
  beforeAll(() => {
    vi.useFakeTimers()
    vi.setSystemTime(FIXED_NOW)
  })

  afterAll(() => {
    vi.useRealTimers()
  })

  beforeEach(() => {
    db.patients.length = 0
    db.appointments.length = 0

    // pA: attended this month (Sept), no attended visit before the MTD
    // window, not imported -> counts as "new".
    db.patients.push({ id: 'pA', createdAt: new Date('2026-09-05T08:00:00.000Z'), referralSource: 'Instagram', importSource: null, status: 'ACTIVE' })
    db.appointments.push({ id: 'apA1', patientId: 'pA', startAt: new Date('2026-09-05T09:00:00.000Z'), status: 'COMPLETED' })

    // pB: attended this month (Sept) AND has a prior attended visit in July
    // (before the MTD window start) -> counts as "returning".
    db.patients.push({ id: 'pB', createdAt: new Date('2026-06-01T08:00:00.000Z'), referralSource: 'Walk-in', importSource: null, status: 'ACTIVE' })
    db.appointments.push({ id: 'apB1', patientId: 'pB', startAt: new Date('2026-07-10T09:00:00.000Z'), status: 'COMPLETED' })
    db.appointments.push({ id: 'apB2', patientId: 'pB', startAt: new Date('2026-09-10T09:00:00.000Z'), status: 'COMPLETED' })

    // pC: only ever attended back in July — never seen this month, and (just
    // as importantly) never seen in the previous-month comparison window
    // (1–15 Aug) either. Exists to prove the MTD window is exclusive and the
    // trend endpoint's "previous" period is genuinely empty.
    db.patients.push({ id: 'pC', createdAt: new Date('2026-05-01T08:00:00.000Z'), referralSource: null, importSource: null, status: 'ACTIVE' })
    db.appointments.push({ id: 'apC1', patientId: 'pC', startAt: new Date('2026-07-02T09:00:00.000Z'), status: 'COMPLETED' })
  })

  it('dashboard endpoint: newPatientsThisMonth + returningPatientsThisMonth === patientsSeenThisMonth for the Kampala MTD window', async () => {
    const { default: clinicalRouter } = await import('../routes/clinical')
    const handler = findHandler(clinicalRouter, 'get', '/analytics/dashboard')

    const res = fakeRes()
    await handler(fakeReq(), res)

    expect(res.status).not.toHaveBeenCalled() // no 500 — route completed normally
    const body = res.json.mock.calls[0][0]
    const m = body.metrics

    expect(m.newPatientsThisMonth).toBe(1) // pA
    expect(m.returningPatientsThisMonth).toBe(1) // pB
    expect(m.patientsSeenThisMonth).toBe(m.newPatientsThisMonth + m.returningPatientsThisMonth)
    expect(m.patientsSeenThisMonth).toBe(2)
  })

  it('trend endpoint: percentChange is null (never Infinity/NaN) when the previous period has zero patients seen', async () => {
    const { default: clinicalRouter } = await import('../routes/clinical')
    const handler = findHandler(clinicalRouter, 'get', '/analytics/dashboard/trend')

    const res = fakeRes()
    await handler(fakeReq(), res)

    expect(res.status).not.toHaveBeenCalled() // no 500 — route completed normally
    const body = res.json.mock.calls[0][0]

    expect(body.trends.patientsSeen.previous).toBe(0)
    expect(body.trends.patientsSeen.current).toBe(2)
    expect(body.trends.patientsSeen.percentChange).toBeNull()

    expect(body.trends.newPatients.previous).toBe(0)
    expect(body.trends.newPatients.percentChange).toBeNull()

    expect(body.trends.returningPatients.previous).toBe(0)
    expect(body.trends.returningPatients.percentChange).toBeNull()

    // Blanket check: under this zero-baseline scenario, no metric's
    // percentChange is ever Infinity or NaN — it's either a finite number or
    // explicitly null.
    for (const key of ['totalPatients', 'patientsSeen', 'newPatients', 'returningPatients'] as const) {
      const pct = body.trends[key].percentChange
      if (pct !== null) expect(Number.isFinite(pct)).toBe(true)
    }
  })
})