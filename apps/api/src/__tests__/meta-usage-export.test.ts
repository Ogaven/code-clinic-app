import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 20000 })

const prismaMock = {}
vi.mock('../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../../../lib/prisma', () => ({ prisma: prismaMock }))

// Regression coverage for a real production defect found during the
// 2026-09-23 Analytics & Costs verification: channel-analytics.routes.ts's
// buildAnalytics() loads the WhatsApp/Meta usage summary via
//   const { buildUsage } = await import('./meta-usage.routes') as any
// but buildUsage was declared WITHOUT `export` in meta-usage.routes.ts. The
// destructure silently resolved to `undefined`, calling `undefined(token)`
// threw a TypeError, and the surrounding try/catch swallowed it
// ("/* meta data optional */") -- so `meta` stayed null on every request
// once the 6h on-disk cache went stale, and the web UI's entire
// "WhatsApp / Meta Status" card (`{data.meta && (...)}`) silently vanished
// from the Analytics page with zero error surfaced anywhere. Confirmed live
// in production: the on-disk cache (/tmp/codeclinic-meta-usage.json) was
// dated 2026-07-28, and a fresh admin request came back with meta: null.
//
// This test exists specifically to catch a *dynamic* import/export mismatch
// like this one again -- a plain `import { buildUsage } from '...'` type
// error would have caught it at compile time, but the dynamic `await
// import(...)` pattern used here does not, so TypeScript alone can't.

const ORIGINAL_ENV = { ...process.env }
const ORIGINAL_FETCH = global.fetch

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV, WHATSAPP_WABA_ID: '1035568108843333' }
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  global.fetch = ORIGINAL_FETCH
  vi.resetModules()
})

describe('meta-usage.routes — buildUsage export', () => {
  it('is exported as a callable function (the exact shape channel-analytics.routes.ts dynamically imports)', async () => {
    const mod = await import('../ai-suite/meta/meta-usage.routes')
    expect(typeof (mod as any).buildUsage).toBe('function')
  })

  it('resolving it via the SAME dynamic-import pattern channel-analytics.routes.ts uses never yields undefined', async () => {
    // Mirrors buildAnalytics()'s exact call site: `const { buildUsage } = await import('./meta-usage.routes')`
    const { buildUsage } = await import('../ai-suite/meta/meta-usage.routes') as any
    expect(buildUsage).toBeDefined()
    expect(typeof buildUsage).toBe('function')
  })

  it('actually returns real usage data end-to-end when called this way (not silently caught as null)', async () => {
    global.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/pricing_analytics')) {
        return { json: async () => ({ data: [{ start: 1758000000, end: 1758086400, volume: 5, cost: 0 }] }) } as Response
      }
      if (url.includes('/phone_numbers')) {
        return { json: async () => ({ data: [{ display_phone_number: '+256741087667', verified_name: 'Code Clinic' }] }) } as Response
      }
      return { json: async () => ({}) } as Response
    })

    const { buildUsage } = await import('../ai-suite/meta/meta-usage.routes') as any
    const result = await buildUsage('fake-token')

    expect(result.configured).toBe(true)
    expect(result.account.wabaId).toBe('1035568108843333')
    expect(result.account.phoneNumbers).toHaveLength(1)
  })
})
