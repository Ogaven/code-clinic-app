import { describe, expect, it, vi } from 'vitest'
import type { Request, Response, NextFunction } from 'express'
import { adminOnly } from '../middleware/rbac'

function authorize(role?: string) {
  const req = { user: role ? { id: 'staff-test', role } : undefined } as Request
  const status = vi.fn().mockReturnThis()
  const json = vi.fn()
  const res = { status, json } as unknown as Response
  const next = vi.fn() as NextFunction
  adminOnly(req, res, next)
  return { status, json, next }
}

describe('AI Practice Intelligence review admin-only guard', () => {
  it('allows administrators', () => {
    const result = authorize('ADMIN')
    expect(result.next).toHaveBeenCalledOnce()
    expect(result.status).not.toHaveBeenCalled()
  })

  it.each(['DOCTOR', 'RECEPTIONIST', 'ACCOUNTS', 'DEVELOPER'])(
    'denies %s access to review and assignment endpoints',
    role => {
      const result = authorize(role)
      expect(result.next).not.toHaveBeenCalled()
      expect(result.status).toHaveBeenCalledWith(403)
      expect(result.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Access denied' }))
    },
  )

  it('denies unauthenticated requests', () => {
    const result = authorize()
    expect(result.next).not.toHaveBeenCalled()
    expect(result.status).toHaveBeenCalledWith(401)
  })
})
