import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('env validation', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('passes with all required vars set', async () => {
    process.env['DATABASE_URL']       = 'postgresql://localhost/test'
    process.env['JWT_SECRET']         = 'a'.repeat(32)
    process.env['JWT_REFRESH_SECRET'] = 'b'.repeat(32)
    process.env['NODE_ENV']           = 'test'

    // Should not throw
    const { env } = await import('../lib/env')
    expect(env.DATABASE_URL).toBe('postgresql://localhost/test')
    // 12h is the deliberate, current policy (commit b966ac8, "12h JWT
    // session" — extended from 15m specifically to prevent mid-shift expiry
    // for clinic staff; cookie max-age and apiFetch's 401 auto-refresh were
    // updated to match in the same change). Not a stale default — verify
    // against that decision, not the pre-b966ac8 15m value.
    expect(env.JWT_EXPIRES_IN).toBe('12h') // default
  })
})
