import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import type { Server } from 'node:http'
import { AddressInfo } from 'node:net'

const mock = vi.hoisted(() => ({
  transaction: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  auditCreate: vi.fn(),
  groupBy: vi.fn(),
  pendingFindMany: vi.fn(),
}))

vi.mock('../middleware/auth', () => ({
  requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const id = req.headers['x-test-user']
    if (typeof id !== 'string') return res.status(401).json({ error: 'Authentication required' })
    req.user = { id, role: req.headers['x-test-role'] === 'DOCTOR' ? 'DOCTOR' : 'ADMIN', email: 'test@example.invalid', firstName: 'Test', lastName: 'User' }
    next()
  },
}))
vi.mock('../lib/prisma', () => ({
  prisma: {
    $transaction: mock.transaction,
    clinicalProductionEntry: { groupBy: mock.groupBy, findMany: mock.pendingFindMany },
  },
}))

import router from '../routes/clinical-production'

describe('clinical production HTTP route behavior (mocked transaction; not database integration)', () => {
  let server: Server
  let url: string
  beforeEach(async () => {
    vi.clearAllMocks()
    const app = express()
    app.use(express.json())
    app.use('/clinical-production', router)
    server = await new Promise<Server>(resolve => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance))
    })
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/clinical-production`
    mock.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn({
      $executeRaw: async () => 1,
      clinicalProductionEntry: { findUnique: mock.findUnique, updateMany: mock.updateMany },
      auditLog: { create: mock.auditCreate },
    }))
  })
  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()))
  })
  const decision = (url: string, user: string, role = 'ADMIN') => fetch(`${url}/entries/entry-1/decision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-user': user, 'x-test-role': role },
    body: JSON.stringify({ decision: 'APPROVED', note: 'Independently verified delivery' }),
  })

  it('requires authentication and an admin role', async () => {
    expect((await fetch(`${url}/entries/pending`)).status).toBe(401)
    expect((await decision(url, 'doctor-1', 'DOCTOR')).status).toBe(403)
    expect(mock.transaction).not.toHaveBeenCalled()
  })
  it('prevents the recorder from approving their own entry', async () => {
    mock.findUnique.mockResolvedValue({ id: 'entry-1', kind: 'DELIVERY', recordedById: 'admin-1', approvalStatus: 'PENDING' })
    const response = await decision(url, 'admin-1')
    expect(response.status).toBe(403)
    expect(mock.updateMany).not.toHaveBeenCalled()
    expect(mock.auditCreate).not.toHaveBeenCalled()
  })
  it('allows another admin to approve and writes the audit record', async () => {
    mock.findUnique.mockResolvedValue({ id: 'entry-1', kind: 'DELIVERY', recordedById: 'admin-1', approvalStatus: 'PENDING' })
    mock.updateMany.mockResolvedValue({ count: 1 })
    const response = await decision(url, 'admin-2')
    expect(response.status).toBe(200)
    expect(mock.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ approvalStatus: 'APPROVED', approvedById: 'admin-2' }),
    }))
    expect(mock.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'admin-2', resource: 'CLINICAL_PRODUCTION', resourceId: 'entry-1' }),
    }))
  })
  it('rejects a second review without writing an audit event', async () => {
    mock.findUnique.mockResolvedValue({ id: 'entry-1', recordedById: 'admin-1', approvalStatus: 'APPROVED' })
    expect((await decision(url, 'admin-2')).status).toBe(409)
    expect(mock.auditCreate).not.toHaveBeenCalled()
  })
  it('filters summaries to approved entries only', async () => {
    mock.groupBy.mockResolvedValue([{ kind: 'DELIVERY', _sum: { amountUGX: 50000 }, _count: { id: 1 } }])
    const response = await fetch(`${url}/summary?startDate=2026-10-01&endDate=2026-10-01`, { headers: { 'x-test-user': 'admin-1' } })
    expect(response.status).toBe(200)
    expect(mock.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ approvalStatus: 'APPROVED' }),
    }))
    expect((await response.json() as { netClinicalProductionUGX: number }).netClinicalProductionUGX).toBe(50000)
  })
})
