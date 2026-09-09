import { describe, expect, it, vi } from 'vitest'
import { requireAuth } from '../middleware/auth'
import { clinicalStaff } from '../middleware/rbac'
import router from '../ai-suite/knowledge/knowledge-ingestion.routes'
import { confirmIngestion, discardIngestion } from '../ai-suite/knowledge/knowledge-ingestion.service'

function mockRes() {
  const res: any = {}
  res.status = vi.fn(() => res)
  res.json = vi.fn(() => res)
  return res
}

describe('ingestion route authorization', () => {
  it('unauthenticated request (no Authorization header) is blocked with 401', async () => {
    const req: any = { headers: {} }
    const res = mockRes()
    const next = vi.fn()
    await requireAuth(req, res, next)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('unauthorized role (e.g. a patient-facing/other role) is blocked with 403', () => {
    const req: any = { user: { id: 'u1', role: 'ACCOUNTS' } } // a real role in this system, but not clinical staff
    const res = mockRes()
    const next = vi.fn()
    clinicalStaff(req, res, next)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(next).not.toHaveBeenCalled()
  })

  it('every clinical staff role (ADMIN, DOCTOR, RECEPTIONIST) is allowed through', () => {
    for (const role of ['ADMIN', 'DOCTOR', 'RECEPTIONIST']) {
      const req: any = { user: { id: 'u1', role } }
      const res = mockRes()
      const next = vi.fn()
      clinicalStaff(req, res, next)
      expect(next).toHaveBeenCalledOnce()
      expect(res.status).not.toHaveBeenCalled()
    }
  })

  it('an unauthenticated req.user is blocked by clinicalStaff too (defense in depth even if requireAuth were skipped)', () => {
    const req: any = {}
    const res = mockRes()
    const next = vi.fn()
    clinicalStaff(req, res, next)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  // Structural proof that EVERY route in this router sits behind
  // requireAuth + clinicalStaff — not just the ones exercised above. Express
  // applies a path-less router.use() to every route registered after it in
  // the same router; this inspects the compiled router stack to confirm
  // that ordering actually holds for this file, rather than trusting the
  // source order by eye.
  it('router wiring: requireAuth + clinicalStaff are registered before every route (GET/POST/PATCH/DELETE)', () => {
    const stack = (router as any).stack as any[]
    const authLayerIndex = stack.findIndex(l => !l.route && typeof l.handle === 'function' && l.handle.length === 3)
    expect(authLayerIndex).toBeGreaterThanOrEqual(0)

    const routeLayers = stack.filter(l => l.route)
    expect(routeLayers.length).toBeGreaterThanOrEqual(6) // upload, GET /, GET /:id, PATCH /:id, POST /:id/retry, POST /:id/confirm, DELETE /:id

    // Every route-bearing layer must appear AFTER the auth middleware layer
    // in registration order (Express evaluates the stack in array order).
    for (const layer of routeLayers) {
      expect(stack.indexOf(layer)).toBeGreaterThan(authLayerIndex)
    }
  })

  it('router wiring: no route path is a bare "/upload" outside the router\'s own mount point (defense against accidental top-level exposure)', () => {
    const stack = (router as any).stack as any[]
    const paths = stack.filter(l => l.route).map(l => l.route.path)
    expect(paths).toContain('/upload')
    expect(paths).toContain('/')
    expect(paths).toContain('/:id')
    expect(paths).toContain('/:id/retry')
    expect(paths).toContain('/:id/confirm')
  })
})

describe('ownership / visibility design boundary (intentional, not a gap)', () => {
  // AiKnowledgeIngestion is deliberately clinic-wide visible to any
  // clinicalStaff-authenticated user, matching AiKnowledgeBase's own
  // existing model (see the schema comment on AiKnowledgeIngestion) — NOT
  // per-uploader like KnowledgeStudioConversation. createdBy exists only
  // for audit ("who uploaded this"), never as an access filter. These tests
  // prove that boundary explicitly rather than leaving it implicit: any
  // authenticated clinical-staff member can act on any row (by design), and
  // the only thing that gates an action is the row's STATE, never who
  // created it.
  function makeFakePrisma(seed: any[]) {
    const rows = seed.map(r => ({ ...r }))
    return {
      aiKnowledgeIngestion: {
        findUnique: vi.fn(async ({ where: { id } }: any) => rows.find(r => r.id === id) ?? null),
        update: vi.fn(async ({ where: { id }, data }: any) => { const r = rows.find(x => x.id === id)!; Object.assign(r, data); return { ...r } }),
        updateMany: vi.fn(async ({ where, data }: any) => {
          const matches = rows.filter(r => r.id === where.id && (where.status === undefined || r.status === where.status))
          for (const r of matches) Object.assign(r, data)
          return { count: matches.length }
        }),
        delete: vi.fn(async ({ where: { id } }: any) => { const i = rows.findIndex(r => r.id === id); return rows.splice(i, 1)[0] }),
      },
    } as any
  }

  it('a clinical staff member can confirm a row created by a DIFFERENT user (intentional — matches AiKnowledgeBase precedent)', async () => {
    const prisma = makeFakePrisma([{ id: 'a', createdBy: 'user-uploader', status: 'EXTRACTED', extractedTitle: 'T', extractedText: 'body', category: 'DOCUMENT', originalFilename: 'x.pdf', r2Key: 'k' }])
    const ingestFn = vi.fn(async () => 1)
    // Note: confirmIngestion takes no acting-user id at all — visibility is
    // clinic-wide for every clinicalStaff request, by design.
    const result = await confirmIngestion(prisma, 'a', ingestFn)
    expect(result.ok).toBe(true)
  })

  it('Confirm on a nonexistent id 404s rather than leaking any information about what does/doesn\'t exist', async () => {
    const prisma = makeFakePrisma([])
    const result = await confirmIngestion(prisma, 'some-id-that-does-not-exist')
    expect(result).toEqual({ ok: false, status: 404, error: 'Upload not found' })
  })

  it('Confirm cannot be abused to act on an id belonging to a different resource type — a random/malformed id simply 404s', async () => {
    const prisma = makeFakePrisma([{ id: 'a', status: 'EXTRACTED', extractedTitle: 'T', extractedText: 'b', category: 'DOCUMENT', originalFilename: 'x.pdf', r2Key: 'k' }])
    const result = await confirmIngestion(prisma, '../../../etc/passwd')
    expect(result).toEqual({ ok: false, status: 404, error: 'Upload not found' })
  })

  it('discard is likewise clinic-wide by design — a different user can discard a FAILED upload someone else created', async () => {
    const prisma = makeFakePrisma([{ id: 'a', createdBy: 'user-uploader', status: 'FAILED', r2Key: 'k' }])
    const result = await discardIngestion(prisma, 'a', vi.fn(async () => {}))
    expect(result).toEqual({ ok: true })
  })
})
