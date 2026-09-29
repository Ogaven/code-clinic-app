import { describe, expect, it } from 'vitest'
import { middleware } from '../../middleware'

// Regression guard: OneSignal's SDK registers/verifies its service worker
// with its own fetch semantics, which cannot be relied on to carry the
// cc_token cookie — so /onesignal/* must bypass the auth gate entirely, or
// the worker script 307s to /login and the browser gets HTML instead of JS,
// silently breaking Web Push registration for every visitor regardless of
// sign-in state. See middleware.ts, lib/onesignal.ts.
function makeRequest(pathname: string, cookie?: string) {
  return {
    nextUrl: { pathname },
    url: `https://codeclinicemr.com${pathname}`,
    cookies: {
      get: (name: string) => (name === 'cc_token' && cookie ? { value: cookie } : undefined),
    },
  } as any
}

describe('middleware', () => {
  it('lets the OneSignal service worker through with no auth cookie present', () => {
    const res = middleware(makeRequest('/onesignal/OneSignalSDKWorker.js'))
    expect(res.headers.get('location')).toBeNull()
  })

  it('lets any /onesignal/ path through regardless of auth state', () => {
    const res = middleware(makeRequest('/onesignal/OneSignalSDKUpdaterWorker.js', 'some.jwt.token'))
    expect(res.headers.get('location')).toBeNull()
  })

  it('still redirects an actual protected route with no auth cookie', () => {
    const res = middleware(makeRequest('/admin/dashboard'))
    expect(res.headers.get('location')).toContain('/login')
  })
})
