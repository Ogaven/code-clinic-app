import { describe, expect, it, vi } from 'vitest'
import { requireAuth } from '../middleware/auth'
import { requireRole, adminOnly, adminAndReceptionist } from '../middleware/rbac'

// Focused unit tests for the exact middleware now guarding
// agent-control.routes.ts, takeover.routes.ts and voice.routes.ts (see
// WORKSTREAM A final security pass). These three files previously had
// little to no auth at all — these tests assert the specific boundary that
// was fixed: no token -> rejected, and each new role restriction actually
// excludes the roles it's meant to exclude. No DB, no HTTP server, no
// external API calls — requireAuth's no-token path returns before ever
// touching jwt.verify or the token blacklist store, and requireRole/
// adminOnly/adminAndReceptionist only ever read req.user.role.

function mockRes() {
  const res: any = {}
  res.status = vi.fn().mockReturnValue(res)
  res.json = vi.fn().mockReturnValue(res)
  return res
}

describe('requireAuth — unauthenticated access is rejected', () => {
  it('rejects a request with no Authorization header at all', async () => {
    const req: any = { headers: {} }
    const res = mockRes()
    const next = vi.fn()
    await requireAuth(req, res, next)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' })
    expect(next).not.toHaveBeenCalled()
  })

  it('rejects a non-Bearer Authorization header', async () => {
    const req: any = { headers: { authorization: 'Basic dXNlcjpwYXNz' } }
    const res = mockRes()
    const next = vi.fn()
    await requireAuth(req, res, next)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })
})

describe('requireRole / adminOnly / adminAndReceptionist — role boundaries', () => {
  it('rejects when no user is attached to the request', () => {
    const req: any = {}
    const res = mockRes()
    const next = vi.fn()
    adminOnly(req, res, next)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('adminOnly rejects RECEPTIONIST (agent-control.routes.ts global config, voice.routes.ts admin-only endpoints)', () => {
    const req: any = { user: { role: 'RECEPTIONIST' } }
    const res = mockRes()
    const next = vi.fn()
    adminOnly(req, res, next)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(next).not.toHaveBeenCalled()
  })

  it('adminOnly allows ADMIN', () => {
    const req: any = { user: { role: 'ADMIN' } }
    const res = mockRes()
    const next = vi.fn()
    adminOnly(req, res, next)
    expect(next).toHaveBeenCalledTimes(1)
    expect(res.status).not.toHaveBeenCalled()
  })

  it('adminAndReceptionist allows ADMIN and RECEPTIONIST (agent-control, takeover/conversations, voice read/operational endpoints)', () => {
    for (const role of ['ADMIN', 'RECEPTIONIST']) {
      const req: any = { user: { role } }
      const res = mockRes()
      const next = vi.fn()
      adminAndReceptionist(req, res, next)
      expect(next).toHaveBeenCalledTimes(1)
    }
  })

  it('adminAndReceptionist rejects DOCTOR and ACCOUNTS — unrelated roles must not gain conversation/agent-control access', () => {
    for (const role of ['DOCTOR', 'ACCOUNTS']) {
      const req: any = { user: { role } }
      const res = mockRes()
      const next = vi.fn()
      adminAndReceptionist(req, res, next)
      expect(res.status).toHaveBeenCalledWith(403)
      expect(next).not.toHaveBeenCalled()
    }
  })

  it('requireRole reports the required roles and the caller\'s actual role on rejection', () => {
    const req: any = { user: { role: 'ACCOUNTS' } }
    const res = mockRes()
    const next = vi.fn()
    requireRole('ADMIN', 'RECEPTIONIST')(req, res, next)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      required: ['ADMIN', 'RECEPTIONIST'],
      current: 'ACCOUNTS',
    }))
  })
})