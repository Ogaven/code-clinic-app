// Regression coverage for a production incident: a real Meta-delivered
// Instagram DM webhook (POST /ai-suite/instagram/webhook) was returning 401
// "Authentication required" on every delivery, without ever reaching
// facebook.routes.ts's handler. Root cause, confirmed via production nginx
// + API logs: main.ts mounted facebookRouter AFTER takeoverRouter, and
// takeover.routes.ts installs `router.use(requireAuth)` with no path
// restriction — Express hands any unmatched /ai-suite/* request to
// takeoverRouter's dispatcher (after connectionsRouter/aiSuiteRouter don't
// match), whose blanket requireAuth 401s it before Express ever tries
// facebookRouter's own /instagram/webhook route.
//
// The fix is a pure mount-order change in main.ts (facebookRouter now
// mounted before takeoverRouter, mirroring the identical pre-existing fix
// for connectionsRouter's OAuth routes). This test mounts the two REAL
// routers, in the REAL relative order main.ts now uses, on a throwaway
// Express app and makes real HTTP requests — proving both halves of the
// fix: the public webhook is reachable, AND takeoverRouter's real
// auth-gated routes remain protected (this isn't an auth bypass).

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import express from 'express'
import type { Server } from 'node:http'

vi.mock('../lib/prisma', () => ({ prisma: {} }))

beforeAll(() => {
  process.env.DATABASE_URL       ??= 'postgresql://user:pass@localhost:5432/test'
  process.env.JWT_SECRET         ??= 'x'.repeat(32)
  process.env.JWT_REFRESH_SECRET ??= 'y'.repeat(32)
})

let server: Server
let origin: string

beforeAll(async () => {
  // Mirrors main.ts's real mount order for the two routers directly
  // involved in the bug: connectionsRouter and facebookRouter are mounted
  // BEFORE takeoverRouter, which is where its blanket requireAuth lives.
  const { default: connectionsRouter } = await import('../ai-suite/connections/connections.routes')
  const { default: facebookRouter }    = await import('../ai-suite/facebook/facebook.routes')
  const { default: takeoverRouter }    = await import('../ai-suite/takeover/takeover.routes')

  const app = express()
  app.use(express.json({ verify: (req: any, _res, buf) => { req.rawBody = buf } }))
  app.use('/ai-suite', connectionsRouter)
  app.use('/ai-suite', facebookRouter)
  app.use('/ai-suite', takeoverRouter)

  await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', resolve) })
  origin = `http://127.0.0.1:${(server.address() as any).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()))
})

describe('AI Suite router mount order — Instagram/Facebook webhooks vs takeover auth', () => {
  it('an unauthenticated POST to /ai-suite/instagram/webhook reaches the webhook handler, not a 401 from takeoverRouter', async () => {
    const res = await fetch(`${origin}/ai-suite/instagram/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Deliberately minimal/non-Instagram body — this test is scoped to
      // routing only, not Instagram payload handling (covered elsewhere).
      // The handler sends 200 before touching the body at all, so this
      // never needs a DB.
      body: JSON.stringify({}),
    })
    expect(res.status).not.toBe(401)
    expect(res.status).toBe(200)
  })

  it('an unauthenticated POST to /ai-suite/facebook/webhook also reaches the webhook handler, not a 401', async () => {
    const res = await fetch(`${origin}/ai-suite/facebook/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).not.toBe(401)
    expect(res.status).toBe(200)
  })

  it('takeoverRouter real routes remain protected — this is a mount-order fix, not an auth bypass', async () => {
    const res = await fetch(`${origin}/ai-suite/conversations`, { method: 'GET' })
    expect(res.status).toBe(401)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Authentication required')
  })

  it('GET /ai-suite/instagram/webhook (Meta verification handshake) is also reachable unauthenticated', async () => {
    const res = await fetch(`${origin}/ai-suite/instagram/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=x`)
    // Wrong token -> 403 from the handler itself, which still proves the
    // request reached facebook.routes.ts rather than being 401'd upstream.
    expect(res.status).toBe(403)
  })
})
