import { describe, expect, it, vi, beforeAll } from 'vitest'
import { adminOnly, adminAndReceptionist, accountsOrAdmin } from '../middleware/rbac'
import { requireAuth } from '../middleware/auth'

// Focused tests for WORKSTREAM A final closure pass (Voice Studio UI
// alignment, Stocks role guard, employee data minimization). These inspect
// the actual Express route wiring — not just the middleware functions in
// isolation (already covered by ai-suite-security.test.ts) — so a future
// change that re-orders or drops a guard on a specific route fails here
// even if the shared middleware functions themselves still work correctly.
// No DB, no HTTP server, no external calls.
//
// voice.routes.ts and employees.ts transitively import ../lib/env, which
// process.exit(1)s if DATABASE_URL/JWT_SECRET/JWT_REFRESH_SECRET are unset
// (this worktree has no .env — see env.validation.test.ts, a pre-existing
// unrelated failure for the same reason). Stubbing dummy values before the
// dynamic import lets the router modules load without ever touching a real
// database or signing a real token.
beforeAll(() => {
  process.env.DATABASE_URL         ??= 'postgresql://user:pass@localhost:5432/test'
  process.env.JWT_SECRET           ??= 'x'.repeat(32)
  process.env.JWT_REFRESH_SECRET   ??= 'y'.repeat(32)
})

function routeStack(router: any, method: string, path: string): Function[] {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route.methods[method])
  if (!layer) throw new Error(`No route registered for ${method.toUpperCase()} ${path}`)
  return layer.route.stack.map((s: any) => s.handle)
}

function routerLevelMiddlewares(router: any): Function[] {
  return router.stack.filter((l: any) => !l.route).map((l: any) => l.handle)
}

describe('voice.routes.ts — Voice Studio route wiring matches the UI split', () => {
  it('requires auth on every route, gates admin-only writes with adminOnly, and keeps Receptionist read/preview on adminAndReceptionist', async () => {
    const { default: voiceRouter } = await import('../ai-suite/voice/voice.routes')

    expect(routerLevelMiddlewares(voiceRouter)).toContain(requireAuth)

    // Admin-only writes: Save Settings, Train, Delete, Set as Default
    expect(routeStack(voiceRouter, 'post', '/settings')).toContain(adminOnly)
    expect(routeStack(voiceRouter, 'post', '/train')).toContain(adminOnly)
    expect(routeStack(voiceRouter, 'delete', '/voices/:id')).toContain(adminOnly)
    expect(routeStack(voiceRouter, 'put', '/voices/:id/assign')).toContain(adminOnly)

    // Receptionist-visible read/preview actions
    for (const [method, path] of [['get', '/settings'], ['get', '/voices'], ['post', '/preview'], ['get', '/calls']] as const) {
      const stack = routeStack(voiceRouter, method, path)
      expect(stack).toContain(adminAndReceptionist)
      expect(stack).not.toContain(adminOnly)
    }
  }, 30000)
})

describe('stocks.ts — role guard matches the existing product design (ADMIN + ACCOUNTS only)', () => {
  it('applies requireAuth and accountsOrAdmin at the router level', async () => {
    const { default: stocksRouter } = await import('../routes/stocks')
    const middlewares = routerLevelMiddlewares(stocksRouter)
    expect(middlewares).toContain(requireAuth)
    expect(middlewares).toContain(accountsOrAdmin)
  })

  it('accountsOrAdmin allows ADMIN and ACCOUNTS', () => {
    for (const role of ['ADMIN', 'ACCOUNTS']) {
      const req: any = { user: { role } }
      const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() }
      const next = vi.fn()
      accountsOrAdmin(req, res, next)
      expect(next).toHaveBeenCalledTimes(1)
    }
  })

  it('accountsOrAdmin rejects RECEPTIONIST and DOCTOR — no UI or nav entry ever exposed /stocks to them', () => {
    for (const role of ['RECEPTIONIST', 'DOCTOR']) {
      const req: any = { user: { role } }
      const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() }
      const next = vi.fn()
      accountsOrAdmin(req, res, next)
      expect(res.status).toHaveBeenCalledWith(403)
      expect(next).not.toHaveBeenCalled()
    }
  })
})

describe('employees.ts — GET /employees/summary cannot leak extra fields', () => {
  it('queries Prisma with exactly the minimal select set LeadsPipeline needs', async () => {
    vi.resetModules()
    const findManyMock = vi.fn().mockResolvedValue([])
    vi.doMock('../lib/prisma', () => ({ prisma: { user: { findMany: findManyMock } } }))

    const { default: employeesRouter } = await import('../routes/employees')
    const layer = (employeesRouter as any).stack.find((l: any) => l.route?.path === '/summary' && l.route.methods.get)
    const handler = layer.route.stack[layer.route.stack.length - 1].handle

    await handler({} as any, { json: vi.fn() } as any)

    expect(findManyMock).toHaveBeenCalledTimes(1)
    const { select } = findManyMock.mock.calls[0][0]
    expect(select).toEqual({ id: true, firstName: true, lastName: true, role: true, isActive: true })

    vi.doUnmock('../lib/prisma')
  })
})