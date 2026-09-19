import { afterEach, describe, expect, it } from 'vitest'
import { setAuthCookie } from '../api'

// Regression guard for the repeated-logout root cause: middleware.ts only
// checks whether the cc_token cookie is PRESENT — it never verifies the JWT
// inside it — so the cookie disappearing is what actually forces staff back
// to /login, independent of whether a valid refresh token could have
// silently re-authenticated them. This cookie's max-age must track the
// refresh token's 30-day lifetime, not the much shorter access-token expiry
// (JWT_EXPIRES_IN, 12h) — otherwise the cookie vanishes from the browser at
// the exact moment the access token expires and no refresh ever gets a
// chance to run.

describe('setAuthCookie', () => {
  afterEach(() => {
    delete (globalThis as any).document
  })

  it('sets a max-age matching the 30-day refresh token lifetime, not the 12h access token expiry', () => {
    let written = ''
    ;(globalThis as any).document = {
      set cookie(value: string) { written = value },
      get cookie() { return written },
    }

    setAuthCookie('fake.jwt.token')

    const maxAgeMatch = written.match(/max-age=(\d+)/)
    expect(maxAgeMatch).not.toBeNull()
    const maxAgeSeconds = Number(maxAgeMatch![1])

    expect(maxAgeSeconds).toBe(30 * 24 * 60 * 60)
    expect(maxAgeSeconds).not.toBe(43200) // the old, JWT-expiry-matched value that caused the bug
    expect(written).toContain('cc_token=fake.jwt.token')
  })
})
