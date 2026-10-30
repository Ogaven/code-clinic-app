import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import type { Server } from 'node:http'

process.env.OPENAI_API_KEY ??= 'test-key-not-real'

const { prismaMock, authenticatedDoctorId } = vi.hoisted(() => ({
  prismaMock: {
    treatmentPlan: { findFirst: vi.fn(), updateMany: vi.fn() },
    treatmentFollowUpEvent: { create: vi.fn() },
    $transaction: vi.fn(async (callback: any) => callback(prismaMock)),
  },
  authenticatedDoctorId: vi.fn(),
}))
vi.mock('../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../lib/doctor-access', () => ({ authenticatedDoctorId }))
vi.mock('../services/audit.service', () => ({ logAudit: vi.fn() }))
vi.mock('../services/notification.service', () => ({ notifyUsers: vi.fn() }))
vi.mock('../services/push.service', () => ({ sendPushToUser: vi.fn() }))
vi.mock('../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = currentUser; next() },
}))
let currentUser: any
import router from '../routes/pipeline'

let server: Server
let origin: string
beforeAll(async () => {
  const app = express()
  app.use(express.json(), router)
  await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', resolve) })
  origin = `http://127.0.0.1:${(server.address() as any).port}`
})
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())) })
beforeEach(() => {
  vi.clearAllMocks()
  currentUser = { id: 'staff-1', role: 'RECEPTIONIST', firstName: 'Front', lastName: 'Desk' }
})
function resolve(body: any) {
  return fetch(`${origin}/treatment/plan-1/follow-up/resolve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}
describe('follow-up resolution HTTP authorization and validation', () => {
  it('rejects unauthorized roles before reading a treatment plan', async () => {
    currentUser.role = 'PATIENT'
    const response = await resolve({ resolution: 'COMPLETED', note: 'Called' })
    expect(response.status).toBe(403)
    expect(prismaMock.treatmentPlan.findFirst).not.toHaveBeenCalled()
  })
  it('rejects malformed resolution and missing notes without database writes', async () => {
    for (const body of [
      { resolution: 'UNKNOWN', note: 'Called' },
      { resolution: 'COMPLETED', note: '   ' },
      { resolution: 'COMPLETED', note: 42 },
      { resolution: 'COMPLETED', note: 'x'.repeat(2001) },
    ]) {
      expect((await resolve(body)).status).toBe(400)
    }
    expect(prismaMock.treatmentPlan.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })
  it('scopes doctor access to their own treatment plans', async () => {
    currentUser.role = 'DOCTOR'
    authenticatedDoctorId.mockResolvedValue('doctor-a')
    prismaMock.treatmentPlan.findFirst.mockResolvedValue(null)
    const response = await resolve({ resolution: 'COMPLETED', note: 'Patient contacted' })
    expect(response.status).toBe(404)
    expect(prismaMock.treatmentPlan.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'plan-1', doctorId: 'doctor-a' },
    }))
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })
  it('does not resolve a treatment with no scheduled follow-up', async () => {
    prismaMock.treatmentPlan.findFirst.mockResolvedValue({ id: 'plan-1', followUpAt: null })
    const response = await resolve({ resolution: 'COMPLETED', note: 'Patient contacted' })
    expect(response.status).toBe(409)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })
})
