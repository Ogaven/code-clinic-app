// Covers the production defect found during the final operational closure:
// GET /health's storageOk previously checked `R2_BUCKET && R2_ACCOUNT_ID` —
// a pair that doesn't match any real gate in storage/r2.ts (which reads
// R2_BUCKET_NAME, falling back to R2_BUCKET, defaulting to 'codeclinic' —
// R2_BUCKET alone is never required) and ignores R2_ACCESS_KEY_ID entirely.
// isR2Configured() (now exported) is the ONE real condition uploadAvatar/
// uploadFile branch on; these tests pin down that it reflects reality
// regardless of whether R2_BUCKET happens to be set.

import { describe, expect, it, afterEach, vi } from 'vitest'

async function loadIsR2Configured(env: Record<string, string | undefined>) {
  vi.resetModules()
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  const mod = await import('../services/storage/r2')
  return mod.isR2Configured
}

const ORIGINAL = { ...process.env }

afterEach(() => {
  process.env = { ...ORIGINAL }
})

describe('isR2Configured', () => {
  it('is true when R2_ACCOUNT_ID and R2_ACCESS_KEY_ID are both real values, regardless of R2_BUCKET', async () => {
    const isR2Configured = await loadIsR2Configured({
      R2_ACCOUNT_ID: 'acct-123', R2_ACCESS_KEY_ID: 'key-456',
      R2_BUCKET: undefined, R2_BUCKET_NAME: 'codeclinic-avatars',
    })
    expect(isR2Configured()).toBe(true)
  })

  it('is false when R2_ACCOUNT_ID is the literal placeholder "..."', async () => {
    const isR2Configured = await loadIsR2Configured({
      R2_ACCOUNT_ID: '...', R2_ACCESS_KEY_ID: 'key-456',
    })
    expect(isR2Configured()).toBe(false)
  })

  it('is false when R2_ACCESS_KEY_ID is missing, even with a real account id', async () => {
    const isR2Configured = await loadIsR2Configured({
      R2_ACCOUNT_ID: 'acct-123', R2_ACCESS_KEY_ID: undefined,
    })
    expect(isR2Configured()).toBe(false)
  })

  it('is false when neither is set', async () => {
    const isR2Configured = await loadIsR2Configured({
      R2_ACCOUNT_ID: undefined, R2_ACCESS_KEY_ID: undefined,
    })
    expect(isR2Configured()).toBe(false)
  })

  // The exact production scenario this fix addresses: R2_BUCKET was never
  // set (only R2_BUCKET_NAME), which made the OLD main.ts check
  // (`R2_BUCKET && R2_ACCOUNT_ID`) false even though R2 was fully usable.
  it('reproduces the fixed production scenario: R2_BUCKET unset, R2_BUCKET_NAME set, real credentials present -> configured', async () => {
    const isR2Configured = await loadIsR2Configured({
      R2_ACCOUNT_ID: 'acct-123', R2_ACCESS_KEY_ID: 'key-456',
      R2_SECRET_ACCESS_KEY: 'secret-789', R2_ENDPOINT: 'https://acct-123.r2.cloudflarestorage.com',
      R2_BUCKET_NAME: 'codeclinic-avatars', R2_BUCKET: undefined,
    })
    expect(isR2Configured()).toBe(true)
  })
})
