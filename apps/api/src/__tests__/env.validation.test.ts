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
    expect(env.JWT_EXPIRES_IN).toBe('15m') // default
  })
})
