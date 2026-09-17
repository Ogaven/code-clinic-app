import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import type { Server } from 'node:http'

const { prismaMock, applyTags, consentHistory, recordConsent } = vi.hoisted(() => ({
  prismaMock: {
    appointment: { findFirst: vi.fn() },
    doctor: { findUnique: vi.fn() },
    patient: { findUnique: vi.fn() },
  },
  applyTags: vi.fn(), consentHistory: vi.fn(), recordConsent: vi.fn(),
}))
vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const role = req.headers['x-test-role']
    if (!role) return res.status(401).json({ error: 'Authentication required' })
    req.user = { id: 'synthetic-staff', role, doctorId: 'synthetic-doctor' }
    next()
  },
}))
vi.mock('../../crm-automation/patient-tags.service', () => ({
  applyPatientTagUpdate: applyTags, runDailyPatientTagDerivation: vi.fn(),
}))
vi.mock('../../crm-automation/consent-log.service', () => ({
  getConsentHistory: consentHistory, recordConsent,
}))
import router from '../../routes/crm-automation'

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
  prismaMock.appointment.findFirst.mockResolvedValue(null)
  prismaMock.patient.findUnique.mockResolvedValue({ id: 'synthetic-patient', riskFlags: ['SYNTHETIC_FLAG'], accountBalance: 100 })
  applyTags.mockResolvedValue({ id: 'synthetic-patient', riskFlags: ['SYNTHETIC_FLAG'], accountBalance: 100 })
  consentHistory.mockResolvedValue([])
  recordConsent.mockResolvedValue({ id: 'synthetic-consent' })
})
async function request(method: string, path: string, role?: string, body?: object) {
  return fetch(`${origin}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(role ? { 'x-test-role': role } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}
const patientRoutes = [
  ['GET', '/patients/synthetic-patient/tags', undefined],
  ['PATCH', '/patients/synthetic-patient/tags', { recallInterval: '6_MONTHS' }],
  ['GET', '/patients/synthetic-patient/consent', undefined],
  ['POST', '/patients/synthetic-patient/consent', { channel: 'WHATSAPP', status: 'OPT_IN', source: 'PATIENT_REQUEST' }],
] as const

describe('patient CRM routes — real Express middleware chain with synthetic identity', () => {
  it.each(patientRoutes)('blocks unrelated doctor on %s %s before reading or changing patient data', async (method, path, body) => {
    const response = await request(method, path, 'DOCTOR', body)
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Patient not found' })
    expect(prismaMock.patient.findUnique).not.toHaveBeenCalled()
    expect(applyTags).not.toHaveBeenCalled()
    expect(consentHistory).not.toHaveBeenCalled()
    expect(recordConsent).not.toHaveBeenCalled()
  })
  it.each(patientRoutes)('allows related doctor on %s %s', async (method, path, body) => {
    prismaMock.appointment.findFirst.mockResolvedValue({ id: 'synthetic-appointment' })
    expect((await request(method, path, 'DOCTOR', body)).status).toBeLessThan(300)
    expect(prismaMock.appointment.findFirst).toHaveBeenCalledWith({
      where: { doctorId: 'synthetic-doctor', patientId: 'synthetic-patient' }, select: { id: true },
    })
  })
  it('authenticates before attempting patient scoping', async () => {
    expect((await request('GET', '/patients/synthetic-patient/tags')).status).toBe(401)
    expect(prismaMock.appointment.findFirst).not.toHaveBeenCalled()
  })
  it('denies Accounts access to clinical CRM tags', async () => {
    expect((await request('GET', '/patients/synthetic-patient/tags', 'ACCOUNTS')).status).toBe(403)
    expect(prismaMock.patient.findUnique).not.toHaveBeenCalled()
  })
  it('retains Admin access and risk flags without doctor scoping', async () => {
    const response = await request('GET', '/patients/synthetic-patient/tags', 'ADMIN')
    expect(response.status).toBe(200)
    expect(await response.json()).toHaveProperty('riskFlags')
    expect(prismaMock.appointment.findFirst).not.toHaveBeenCalled()
  })
  it.each(['GET', 'PATCH'])('redacts clinical risk and financial fields from Reception %s response', async method => {
    const response = await request(method, '/patients/synthetic-patient/tags', 'RECEPTIONIST', method === 'PATCH' ? {} : undefined)
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).not.toHaveProperty('riskFlags')
    expect(data).not.toHaveProperty('accountBalance')
  })
  it('prevents Reception from writing clinical risk flags', async () => {
    expect((await request('PATCH', '/patients/synthetic-patient/tags', 'RECEPTIONIST', { riskFlags: [] })).status).toBe(403)
    expect(applyTags).not.toHaveBeenCalled()
  })
})
