// Covers the root-cause fix for incorrect "Unassigned" pipeline cards
// (apps/api/src/routes/clinical.ts, POST /patients/:id/treatment-plans):
// an Admin creating a treatment plan must now explicitly choose the
// treating doctor rather than silently create an ownerless plan; a Doctor
// creating their own plan is unaffected (still auto-assigned). Also covers
// that the optional patient-requested follow-up date is accepted and
// persisted on create.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import type { Server } from 'node:http'

process.env.OPENAI_API_KEY ??= 'test-key-not-real'

const { prismaMock, authenticatedDoctorId } = vi.hoisted(() => ({
  prismaMock: {
    treatmentPlan: { create: vi.fn(async ({ data }: any) => ({ id: 'plan-1', ...data })) },
    patientActivity: { create: vi.fn().mockResolvedValue(undefined) },
    doctor: { findUnique: vi.fn().mockResolvedValue(null) },
  },
  authenticatedDoctorId: vi.fn(),
}))

vi.mock('../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../middleware/rbac', () => ({
  doctorOrAdmin: (_req: any, _res: any, next: any) => next(),
  clinicalStaff: (_req: any, _res: any, next: any) => next(),
}))
vi.mock('../lib/doctor-access', () => ({
  authenticatedDoctorId,
  requireDoctorPatientAccess: () => (_req: any, _res: any, next: any) => next(),
}))
vi.mock('../services/storage/r2', () => ({ uploadAvatar: vi.fn(), getPublicUrl: vi.fn() }))
vi.mock('../services/audit.service', () => ({ logAudit: vi.fn() }))
vi.mock('../utils/kampala-time', () => ({
  kampalaMonthToDateRange: vi.fn(), kampalaPreviousMonthToDateRange: vi.fn(), safePercentChange: vi.fn(),
}))
vi.mock('../services/patient-analytics.service', () => ({
  getTotalPatients: vi.fn(), getPatientsSeen: vi.fn(), splitNewAndReturning: vi.fn(),
}))
vi.mock('../services/notification.service', () => ({ notifyUsers: vi.fn() }))
vi.mock('openai', () => ({ default: class { responses = { create: vi.fn() } } }))

let currentUser: any
vi.mock('../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = currentUser; next() },
}))

import router from '../routes/clinical'

let server: Server
let origin: string
beforeAll(async () => {
  const app = express()
  app.use(express.json(), router)
  await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', resolve) })
  origin = `http://127.0.0.1:${(server.address() as any).port}`
})
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())) })
beforeEach(() => { vi.clearAllMocks() })

function post(body: any) {
  return fetch(`${origin}/patients/patient-1/treatment-plans`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

describe('POST /clinical/patients/:id/treatment-plans — doctor ownership', () => {
  it('rejects an Admin-created plan with no doctorId, instead of silently creating an ownerless treatment', async () => {
    currentUser = { id: 'admin-1', role: 'ADMIN', firstName: 'Ava', lastName: 'Admin' }
    authenticatedDoctorId.mockResolvedValue(null)

    const res = await post({ toothNumber: '16', notes: 'crown' })

    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/treating doctor/i)
    expect(prismaMock.treatmentPlan.create).not.toHaveBeenCalled()
  })

  it('creates the plan when an Admin explicitly supplies doctorId', async () => {
    currentUser = { id: 'admin-1', role: 'ADMIN', firstName: 'Ava', lastName: 'Admin' }
    authenticatedDoctorId.mockResolvedValue(null)

    const res = await post({ toothNumber: '16', doctorId: 'doctor-7' })

    expect(res.status).toBe(201)
    expect(prismaMock.treatmentPlan.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ doctorId: 'doctor-7' }),
    }))
  })

  it('a Doctor creating their own plan is auto-assigned and never prompted to pick a doctor', async () => {
    currentUser = { id: 'doc-user-1', role: 'DOCTOR', firstName: 'Steven', lastName: 'K' }
    authenticatedDoctorId.mockResolvedValue('doctor-self')

    const res = await post({ toothNumber: '24' })

    expect(res.status).toBe(201)
    expect(prismaMock.treatmentPlan.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ doctorId: 'doctor-self' }),
    }))
  })

  it('accepts and persists an optional patient-requested follow-up date on create', async () => {
    currentUser = { id: 'doc-user-1', role: 'DOCTOR', firstName: 'Steven', lastName: 'K' }
    authenticatedDoctorId.mockResolvedValue('doctor-self')

    const res = await post({ toothNumber: '24', followUpAt: '2026-12-01', followUpReason: 'Patient asked to be contacted in 2 weeks' })

    expect(res.status).toBe(201)
    const [[arg]] = prismaMock.treatmentPlan.create.mock.calls
    expect(new Date(arg.data.followUpAt).toISOString().slice(0, 10)).toBe('2026-12-01')
    expect(arg.data.followUpReason).toBe('Patient asked to be contacted in 2 weeks')
  })

  it('rejects an invalid followUpAt rather than silently writing garbage', async () => {
    currentUser = { id: 'doc-user-1', role: 'DOCTOR', firstName: 'Steven', lastName: 'K' }
    authenticatedDoctorId.mockResolvedValue('doctor-self')

    const res = await post({ toothNumber: '24', followUpAt: 'not-a-date' })

    expect(res.status).toBe(400)
    expect(prismaMock.treatmentPlan.create).not.toHaveBeenCalled()
  })
})
