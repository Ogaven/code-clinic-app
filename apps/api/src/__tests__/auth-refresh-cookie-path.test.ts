// Regression coverage for the mobile/PWA "logged out overnight" bug.
//
// The browser never talks to this API directly -- every request goes
// through the web app's same-origin proxy at /api-proxy/* (apps/web/app/
// api-proxy/[...path]/route.ts), which forwards Set-Cookie headers to the
// browser verbatim. So the request the browser actually makes to refresh a
// session is POST /api-proxy/auth/refresh, not POST /auth/refresh.
//
// The refreshToken cookie used to be scoped to path '/auth/refresh'. Per
// cookie-matching rules a cookie is only attached to requests whose path is
// exactly its Path or a subpath of it -- '/api-proxy/auth/refresh' is
// neither, so the browser silently never sent the cookie back. Every
// silent-refresh attempt 401'd with "No refresh token", and the client
// (apps/web/lib/api.ts refreshToken()/fetchWithAuth()) treated that as a
// real expired session and force-logged the user out, even though a valid
// 30-day refresh token existed the whole time. Scoping the cookie to '/'
// fixes this since '/' is a prefix of every path the browser ever requests.
//
// This test locks in that every place the API sets or clears the
// refreshToken cookie uses a path the proxy's request path will always
// match.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import jwt from 'jsonwebtoken'

// routes/auth.ts pulls in the S3/R2 storage client and other heavy deps cold
// on the first test that imports it — comfortably past the 5s default under
// system load (same rationale as treatment-followup-alerts.test.ts and
// push-subscription-ownership.test.ts).
vi.setConfig({ testTimeout: 20000 })

process.env.DATABASE_URL       ??= 'postgresql://test:test@localhost:5432/test'
process.env.JWT_SECRET         ??= 'test-jwt-secret-not-real-'.padEnd(32, '0')
process.env.JWT_REFRESH_SECRET ??= 'test-jwt-refresh-not-real-'.padEnd(32, '0')

const store = vi.hoisted(() => ({
  users: new Map<string, any>(),
}))

vi.mock('../lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async ({ where }: any) => store.users.get(where.id ?? where.email) ?? null),
      update: vi.fn(async ({ where, data }: any) => {
        const u = store.users.get(where.id)
        if (u) Object.assign(u, data)
        return u
      }),
    },
  },
}))

vi.mock('../lib/tokenBlacklist', () => ({
  blacklistToken: vi.fn(async () => {}),
  isTokenBlacklisted: vi.fn(async () => false),
}))

vi.mock('../services/audit.service', () => ({
  logAudit: vi.fn(async () => {}),
}))

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

function fakeRes() {
  const res: any = { cookieCalls: [] as any[], clearCookieCalls: [] as any[] }
  res.status = vi.fn(() => res)
  res.json = vi.fn(() => res)
  res.cookie = vi.fn((name: string, value: string, opts: any) => { res.cookieCalls.push({ name, value, opts }); return res })
  res.clearCookie = vi.fn((name: string, opts: any) => { res.clearCookieCalls.push({ name, opts }); return res })
  return res
}

beforeEach(() => {
  store.users.clear()
  store.users.set('user_1', {
    id: 'user_1', email: 'staff@codeclinic.test', role: 'RECEPTIONIST',
    firstName: 'Jane', lastName: 'Doe', isActive: true, permissions: '{}', doctor: null,
  })
})

describe('refreshToken cookie is scoped to a path the web app\'s api-proxy will actually match', () => {
  it('POST /refresh sets a fresh refreshToken cookie with path "/", not "/auth/refresh"', async () => {
    const { default: authRouter } = await import('../routes/auth')
    const handler = findHandler(authRouter, 'post', '/refresh')

    const validRefreshToken = jwt.sign({ id: 'user_1' }, process.env.JWT_REFRESH_SECRET!, { expiresIn: '30d' })
    const req: any = { cookies: { refreshToken: validRefreshToken } }
    const res = fakeRes()

    await handler(req, res)

    expect(res.status).not.toHaveBeenCalledWith(401)
    expect(res.cookieCalls).toHaveLength(1)
    expect(res.cookieCalls[0].name).toBe('refreshToken')
    expect(res.cookieCalls[0].opts.path).toBe('/')
    expect(res.cookieCalls[0].opts.path).not.toBe('/auth/refresh')
  })

  it('POST /logout clears the refreshToken cookie with the same path it was set with', async () => {
    const { default: authRouter } = await import('../routes/auth')
    const handler = findHandler(authRouter, 'post', '/logout')

    const req: any = { user: { id: 'user_1', firstName: 'Jane', lastName: 'Doe' }, token: jwt.sign({ id: 'user_1' }, process.env.JWT_SECRET!, { expiresIn: '1h' }) }
    const res = fakeRes()

    await handler(req, res)

    expect(res.clearCookieCalls).toHaveLength(1)
    expect(res.clearCookieCalls[0].name).toBe('refreshToken')
    expect(res.clearCookieCalls[0].opts.path).toBe('/')
  })

  it('a cookie scoped to path "/" would actually be sent by a browser on a request to /api-proxy/auth/refresh (unlike "/auth/refresh")', () => {
    // Documents the actual browser cookie-path-matching rule this bug hinged
    // on: a cookie's Path must equal the request path, or be a prefix of it
    // ending in "/" (or the request path plus "/" equals Path). No test
    // double for browser behavior exists in this API-only test suite, so
    // this is asserted directly against the rule (RFC 6265 §5.1.4) rather
    // than exercised through a real browser.
    function cookiePathMatches(cookiePath: string, requestPath: string): boolean {
      if (requestPath === cookiePath) return true
      if (requestPath.startsWith(cookiePath) && cookiePath.endsWith('/')) return true
      if (requestPath.startsWith(cookiePath) && requestPath[cookiePath.length] === '/') return true
      return false
    }

    const proxyRequestPath = '/api-proxy/auth/refresh'
    expect(cookiePathMatches('/', proxyRequestPath)).toBe(true)
    expect(cookiePathMatches('/auth/refresh', proxyRequestPath)).toBe(false)
  })
})
