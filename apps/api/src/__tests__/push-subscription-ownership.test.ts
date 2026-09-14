// Verifies the existing push subscription endpoints (apps/api/src/routes/push.ts)
// always scope reads/writes to the AUTHENTICATED user — never a client-
// supplied id — so one user can never read, overwrite, or delete another
// user's push subscription. This code was not changed by the mobile/PWA
// workstream; this test documents and locks in behavior that was already
// correct. Drives the real Express route handlers directly (no HTTP server),
// with an in-memory fake in place of Prisma. No real push notification is
// ever sent — sendNotification/webpush is not exercised by these routes.

import { beforeEach, describe, expect, it, vi } from 'vitest'

// The dynamic import below pulls in routes/push.ts -> services/push.service.ts
// -> the web-push package cold on the first test that runs it — comfortably
// past the 5s default under system load. Bumped for this file only (same
// rationale as comment-thread-continuity.test.ts in the Meta workstream).
vi.setConfig({ testTimeout: 20000 })

// apps/api/src/lib/env.ts calls process.exit(1) at import time if these are
// missing — harmless placeholders so the module loads; nothing in this test
// ever performs a real DB connection or JWT operation (prisma is mocked
// below and no auth middleware runs — requireAuth is bypassed entirely by
// calling the route handler directly with req.user pre-set).
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test'
process.env.JWT_SECRET ??= 'test-secret-at-least-32-characters-long'
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-at-least-32-chars'

const store = vi.hoisted(() => ({ rows: new Map<string, any>() }))

vi.mock('../lib/prisma', () => ({
  prisma: {
    pushSubscription: {
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const existing = [...store.rows.values()].find(r => r.endpoint === where.endpoint)
        if (existing) { Object.assign(existing, update); return existing }
        const row = { id: `sub_${store.rows.size + 1}`, ...create }
        store.rows.set(row.id, row)
        return row
      }),
      deleteMany: vi.fn(async ({ where }: any) => {
        let count = 0
        for (const [id, row] of store.rows) {
          if (row.endpoint === where.endpoint && row.userId === where.userId) { store.rows.delete(id); count++ }
        }
        return { count }
      }),
      findMany: vi.fn(async ({ where }: any) => [...store.rows.values()].filter(r => r.userId === where.userId)),
    },
  },
}))

// These routes register requireAuth as a first middleware ahead of the real
// handler (router.post('/subscribe', requireAuth, async (req, res) => ...)),
// so a route's method-matching layers include BOTH — take the LAST one to
// get the actual route logic, bypassing requireAuth entirely (this test
// simulates an already-authenticated request via req.user, exactly as
// Express would have it after requireAuth ran for real).
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

function fakeReqAs(userId: string, body: unknown) {
  return { user: { id: userId }, body, headers: {} } as any
}

function fakeRes() {
  const res: any = {}
  res.status = vi.fn(() => res)
  res.json = vi.fn(() => res)
  return res
}

describe('Push subscription ownership (POST/DELETE /push/subscribe)', () => {
  beforeEach(() => { store.rows.clear() })

  it('a subscribe request always stores the AUTHENTICATED user id, ignoring any userId in the body', async () => {
    const { default: pushRouter } = await import('../routes/push')
    const handler = findHandler(pushRouter, 'post', '/subscribe')

    await handler(fakeReqAs('user-A', {
      endpoint: 'https://fcm.googleapis.com/end/1', keys: { p256dh: 'p1', auth: 'a1' },
      userId: 'user-B', // an attacker-supplied field the route must never read
    }), fakeRes())

    const rows = [...store.rows.values()]
    expect(rows).toHaveLength(1)
    expect(rows[0].userId).toBe('user-A')
  })

  it('re-subscribing an existing endpoint under a different session reassigns it to whoever is authenticated now (matches existing upsert semantics)', async () => {
    const { default: pushRouter } = await import('../routes/push')
    const handler = findHandler(pushRouter, 'post', '/subscribe')

    await handler(fakeReqAs('user-A', { endpoint: 'https://fcm.googleapis.com/end/shared', keys: { p256dh: 'p1', auth: 'a1' } }), fakeRes())
    await handler(fakeReqAs('user-B', { endpoint: 'https://fcm.googleapis.com/end/shared', keys: { p256dh: 'p2', auth: 'a2' } }), fakeRes())

    const rows = [...store.rows.values()]
    expect(rows).toHaveLength(1)
    expect(rows[0].userId).toBe('user-B')
  })

  it('deleting a subscription requires it to belong to the authenticated user — cannot delete another user\'s row', async () => {
    const { default: pushRouter } = await import('../routes/push')
    const subscribe = findHandler(pushRouter, 'post', '/subscribe')
    const unsubscribe = findHandler(pushRouter, 'delete', '/subscribe')

    await subscribe(fakeReqAs('user-B', { endpoint: 'https://fcm.googleapis.com/end/victim', keys: { p256dh: 'p1', auth: 'a1' } }), fakeRes())
    expect(store.rows.size).toBe(1)

    // user-A (not the owner) tries to delete user-B's subscription.
    await unsubscribe(fakeReqAs('user-A', { endpoint: 'https://fcm.googleapis.com/end/victim' }), fakeRes())

    expect(store.rows.size).toBe(1) // untouched
    expect([...store.rows.values()][0].userId).toBe('user-B')
  })

  it('a user can delete their own subscription', async () => {
    const { default: pushRouter } = await import('../routes/push')
    const subscribe = findHandler(pushRouter, 'post', '/subscribe')
    const unsubscribe = findHandler(pushRouter, 'delete', '/subscribe')

    await subscribe(fakeReqAs('user-A', { endpoint: 'https://fcm.googleapis.com/end/own', keys: { p256dh: 'p1', auth: 'a1' } }), fakeRes())
    await unsubscribe(fakeReqAs('user-A', { endpoint: 'https://fcm.googleapis.com/end/own' }), fakeRes())

    expect(store.rows.size).toBe(0)
  })
})