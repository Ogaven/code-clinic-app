import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import type { Server } from 'node:http'
import { logAudit } from '../services/audit.service'

process.env.OPENAI_API_KEY ??= 'test-key-not-real'

const { prismaMock, authenticatedDoctorId } = vi.hoisted(() => ({
  prismaMock: {
    treatmentPlan: { findFirst: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
    user: { findFirst: vi.fn() },
    treatmentFollowUpEvent: { create: vi.fn() },
    $transaction: vi.fn(),
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
  prismaMock.$transaction.mockImplementation(async (callback: any) => callback(prismaMock))
  currentUser = { id: 'staff-1', role: 'RECEPTIONIST', firstName: 'Front', lastName: 'Desk' }
})
function resolve(body: any) {
  return fetch(`${origin}/treatment/plan-1/follow-up/resolve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}
describe('treatment coordination HTTP access and clinical holds', () => {
  function coordinate(body: any) {
    return fetch(`${origin}/treatment/plan-1/coordination`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
  }
  it('rejects patient role without touching treatment records', async () => {
    currentUser.role = 'PATIENT'
    expect((await coordinate({ nextAction: 'Call patient' })).status).toBe(403)
    expect(prismaMock.treatmentPlan.findFirst).not.toHaveBeenCalled()
  })
  it('does not let reception clear a doctor clinical hold', async () => {
    expect((await coordinate({ clinicalReviewRequired: false })).status).toBe(403)
    expect(prismaMock.treatmentPlan.findFirst).not.toHaveBeenCalled()
  })
  it('rejects an inactive or unauthorized follow-up coordinator', async () => {
    prismaMock.user.findFirst.mockResolvedValue(null)
    expect((await coordinate({ coordinatorId: 'inactive-user' })).status).toBe(400)
    expect(prismaMock.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'inactive-user', isActive: true }),
    }))
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })
  it('does not create a coordination event if another staff member changed the plan', async () => {
    prismaMock.treatmentPlan.findFirst.mockResolvedValue({
      id: 'plan-1', doctorId: 'doctor-a', status: 'Planned',
      patientDecision: 'Accepted', decisionReason: null, coordinatorId: null,
      nextAction: null, clinicalReviewRequired: false, followUpAt: null,
    })
    prismaMock.treatmentPlan.updateMany.mockResolvedValue({ count: 0 })
    const response = await coordinate({ nextAction: 'Call tomorrow' })
    expect(response.status).toBe(409)
    expect(prismaMock.treatmentFollowUpEvent.create).not.toHaveBeenCalled()
  })
  it('saves coordination changes and a durable event together', async () => {
    prismaMock.treatmentPlan.findFirst.mockResolvedValue({
      id: 'plan-1', doctorId: 'doctor-a', status: 'Planned',
      patientDecision: 'Accepted', decisionReason: null, coordinatorId: null,
      nextAction: null, clinicalReviewRequired: false, followUpAt: null,
    })
    prismaMock.treatmentPlan.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.treatmentPlan.findUniqueOrThrow.mockResolvedValue({
      id: 'plan-1', patientDecision: 'Accepted', decisionReason: null,
      coordinatorId: null, nextAction: 'Call tomorrow',
      clinicalReviewRequired: false, followUpAt: null,
    })
    const response = await coordinate({ nextAction: 'Call tomorrow' })
    expect(response.status).toBe(200)
    expect(prismaMock.treatmentPlan.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ doctorId: 'doctor-a', patientDecision: 'Accepted' }),
      data: { nextAction: 'Call tomorrow' },
    }))
    expect(prismaMock.treatmentFollowUpEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eventType: 'COORDINATION_UPDATED', actorId: 'staff-1',
        newValues: expect.objectContaining({ nextAction: 'Call tomorrow' }),
      }),
    }))
  })
  it('blocks routine scheduling while a clinical hold remains active', async () => {
    prismaMock.treatmentPlan.findFirst.mockResolvedValue({
      id: 'plan-1', doctorId: 'doctor-a', status: 'Planned',
      patientDecision: 'Accepted', decisionReason: null, coordinatorId: null,
      nextAction: null, clinicalReviewRequired: true, followUpAt: null,
    })
    const response = await coordinate({ followUpAt: '2030-12-01' })
    expect(response.status).toBe(409)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })
  it('requires doctor identity for doctor coordination edits', async () => {
    currentUser.role = 'DOCTOR'
    authenticatedDoctorId.mockResolvedValue(null)
    const response = await coordinate({ nextAction: 'Review treatment' })
    expect(response.status).toBe(404)
    expect(prismaMock.treatmentPlan.findFirst).not.toHaveBeenCalled()
  })
  it('allows a doctor to clear a clinical hold and records the change', async () => {
    currentUser.role = 'DOCTOR'
    authenticatedDoctorId.mockResolvedValue('doctor-a')
    prismaMock.treatmentPlan.findFirst.mockResolvedValue({
      id: 'plan-1', doctorId: 'doctor-a', status: 'Planned',
      patientDecision: 'Accepted', decisionReason: null, coordinatorId: null,
      nextAction: null, clinicalReviewRequired: true, followUpAt: null,
    })
    prismaMock.treatmentPlan.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.treatmentPlan.findUniqueOrThrow.mockResolvedValue({
      id: 'plan-1', patientDecision: 'Accepted', decisionReason: null,
      coordinatorId: null, nextAction: null, clinicalReviewRequired: false,
      followUpAt: null,
    })
    const response = await coordinate({ clinicalReviewRequired: false })
    expect(response.status).toBe(200)
    expect(prismaMock.treatmentPlan.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ doctorId: 'doctor-a', clinicalReviewRequired: true }),
      data: { clinicalReviewRequired: false },
    }))
    expect(prismaMock.treatmentFollowUpEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eventType: 'COORDINATION_UPDATED', actorId: 'staff-1',
        newValues: expect.objectContaining({ clinicalReviewRequired: false }),
      }),
    }))
  })
  it('does not let a doctor edit another doctor\'s treatment coordination', async () => {
    currentUser.role = 'DOCTOR'
    authenticatedDoctorId.mockResolvedValue('doctor-a')
    prismaMock.treatmentPlan.findFirst.mockResolvedValue(null)
    const response = await coordinate({ nextAction: 'Call patient' })
    expect(response.status).toBe(404)
    expect(prismaMock.treatmentPlan.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'plan-1', doctorId: 'doctor-a' },
    }))
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })
  it('rejects malformed coordination requests before writing patient records', async () => {
    const malformed = await coordinate({ nextAction: { unsafe: true } })
    expect(malformed.status).toBe(400)
    const empty = await coordinate({})
    expect(empty.status).toBe(400)
    expect(prismaMock.treatmentPlan.updateMany).not.toHaveBeenCalled()
    expect(prismaMock.treatmentFollowUpEvent.create).not.toHaveBeenCalled()
  })
  it('rejects a non-doctor clearing a clinical hold even with another change', async () => {
    const response = await coordinate({
      clinicalReviewRequired: false, nextAction: 'Resume outreach',
    })
    expect(response.status).toBe(403)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })
  it('rejects a deferred decision while a routine follow-up remains scheduled', async () => {
    prismaMock.treatmentPlan.findFirst.mockResolvedValue({
      id: 'plan-1', doctorId: 'doctor-a', status: 'Planned',
      patientDecision: 'Accepted', decisionReason: null, coordinatorId: null,
      nextAction: null, clinicalReviewRequired: false,
      followUpAt: new Date('2030-12-01T00:00:00.000Z'),
    })
    const response = await coordinate({ patientDecision: 'Deferred' })
    expect(response.status).toBe(409)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })
  it('allows a declined decision when the routine follow-up is cleared in the same change', async () => {
    prismaMock.treatmentPlan.findFirst.mockResolvedValue({
      id: 'plan-1', doctorId: 'doctor-a', status: 'Planned',
      patientDecision: 'Accepted', decisionReason: null, coordinatorId: null,
      nextAction: null, clinicalReviewRequired: false,
      followUpAt: new Date('2030-12-01T00:00:00.000Z'),
    })
    prismaMock.treatmentPlan.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.treatmentPlan.findUniqueOrThrow.mockResolvedValue({
      id: 'plan-1', patientDecision: 'Declined', decisionReason: null,
      coordinatorId: null, nextAction: null, clinicalReviewRequired: false,
      followUpAt: null,
    })
    const response = await coordinate({ patientDecision: 'Declined', followUpAt: null })
    expect(response.status).toBe(200)
    expect(prismaMock.treatmentFollowUpEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eventType: 'COORDINATION_UPDATED',
        newValues: expect.objectContaining({ patientDecision: 'Declined', followUpAt: null }),
      }),
    }))
  })
  it('blocks a declined decision while a routine follow-up remains scheduled', async () => {
    prismaMock.treatmentPlan.findFirst.mockResolvedValue({
      id: 'plan-1', doctorId: 'doctor-a', status: 'Planned',
      patientDecision: 'Accepted', decisionReason: null, coordinatorId: null,
      nextAction: null, clinicalReviewRequired: false,
      followUpAt: new Date('2030-12-01T00:00:00.000Z'),
    })
    expect((await coordinate({ patientDecision: 'Declined' })).status).toBe(409)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })
})
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
  it('commits a completed outcome and its history in the same transaction', async () => {
    const scheduled = new Date('2026-10-29T08:00:00.000Z')
    prismaMock.treatmentPlan.findFirst.mockResolvedValue({
      id: 'plan-1', doctorId: 'doctor-a', patientId: 'patient-1',
      toothNumber: '24', followUpAt: scheduled, followUpNote: 'Earlier note',
      status: 'Planned', patientDecision: 'Accepted', clinicalReviewRequired: false,
    })
    prismaMock.treatmentPlan.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.treatmentFollowUpEvent.create.mockResolvedValue({ id: 'event-1' })
    const response = await resolve({ resolution: 'COMPLETED', note: '  Patient reached  ' })
    expect(response.status).toBe(200)
    expect(prismaMock.treatmentPlan.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ doctorId: 'doctor-a', followUpAt: scheduled }),
      data: expect.objectContaining({ followUpAt: null }),
    }))
    expect(prismaMock.treatmentFollowUpEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eventType: 'FOLLOW_UP_COMPLETED', outcome: 'Patient reached',
        previousValues: expect.objectContaining({ followUpNote: 'Earlier note' }),
      }),
    }))
  })
  it('returns conflict and does not append history when another staff member changes the plan', async () => {
    prismaMock.treatmentPlan.findFirst.mockResolvedValue({
      id: 'plan-1', doctorId: 'doctor-a', patientId: 'patient-1',
      followUpAt: new Date('2026-10-29T08:00:00.000Z'), followUpNote: null,
      status: 'Planned', patientDecision: 'Accepted', clinicalReviewRequired: false,
    })
    prismaMock.treatmentPlan.updateMany.mockResolvedValue({ count: 0 })
    const response = await resolve({ resolution: 'DISMISSED', note: 'No further outreach' })
    expect(response.status).toBe(409)
    expect(prismaMock.treatmentFollowUpEvent.create).not.toHaveBeenCalled()
  })
  it('blocks routine rescheduling while a doctor clinical hold is active', async () => {
    prismaMock.treatmentPlan.findFirst.mockResolvedValue({
      id: 'plan-1', doctorId: 'doctor-a', patientId: 'patient-1',
      followUpAt: new Date('2026-10-29T08:00:00.000Z'), followUpNote: null,
      status: 'Planned', patientDecision: 'Accepted', clinicalReviewRequired: true,
    })
    const response = await resolve({
      resolution: 'RESCHEDULED', note: 'Patient asked for later contact', rescheduleTo: '2030-12-01',
    })
    expect(response.status).toBe(409)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })
  it('blocks routine rescheduling after a patient declines treatment', async () => {
    prismaMock.treatmentPlan.findFirst.mockResolvedValue({
      id: 'plan-1', doctorId: 'doctor-a', patientId: 'patient-1',
      followUpAt: new Date('2026-10-29T08:00:00.000Z'), followUpNote: null,
      status: 'Planned', patientDecision: 'Declined', clinicalReviewRequired: false,
    })
    const response = await resolve({
      resolution: 'RESCHEDULED', note: 'Retry outreach', rescheduleTo: '2030-12-01',
    })
    expect(response.status).toBe(409)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })
  it('rejects past rescheduling without changing the plan or history', async () => {
    prismaMock.treatmentPlan.findFirst.mockResolvedValue({
      id: 'plan-1', doctorId: 'doctor-a', patientId: 'patient-1',
      followUpAt: new Date('2026-10-29T08:00:00.000Z'), followUpNote: null,
      status: 'Planned', patientDecision: 'Accepted', clinicalReviewRequired: false,
    })
    const response = await resolve({
      resolution: 'RESCHEDULED', note: 'Backdated follow-up', rescheduleTo: '2020-01-01',
    })
    expect(response.status).toBe(400)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })
  it('allows a valid future reschedule and records the new date in history', async () => {
    prismaMock.treatmentPlan.findFirst.mockResolvedValue({
      id: 'plan-1', doctorId: 'doctor-a', patientId: 'patient-1',
      toothNumber: '24', followUpAt: new Date('2026-10-29T08:00:00.000Z'),
      followUpNote: null, status: 'Planned',
      patientDecision: 'Accepted', clinicalReviewRequired: false,
    })
    prismaMock.treatmentPlan.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.treatmentFollowUpEvent.create.mockResolvedValue({ id: 'event-2' })
    const response = await resolve({
      resolution: 'RESCHEDULED', note: 'Patient requested December', rescheduleTo: '2030-12-01',
    })
    expect(response.status).toBe(200)
    const expectedDate = new Date('2030-12-01T00:00:00.000Z')
    expect(prismaMock.treatmentPlan.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ followUpAt: expectedDate }),
    }))
    expect(prismaMock.treatmentFollowUpEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eventType: 'FOLLOW_UP_RESCHEDULED',
        outcome: 'Patient requested December',
        newValues: expect.objectContaining({ followUpAt: expectedDate.toISOString() }),
      }),
    }))
  })
  it('rejects doctor accounts without an associated doctor record', async () => {
    currentUser.role = 'DOCTOR'
    authenticatedDoctorId.mockResolvedValue(null)
    const response = await resolve({ resolution: 'COMPLETED', note: 'Patient reached' })
    expect(response.status).toBe(404)
    expect(prismaMock.treatmentPlan.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })
  it('does not report success if durable follow-up history cannot be written', async () => {
    prismaMock.treatmentPlan.findFirst.mockResolvedValue({
      id: 'plan-1', doctorId: 'doctor-a', patientId: 'patient-1',
      toothNumber: '24', followUpAt: new Date('2026-10-29T08:00:00.000Z'),
      followUpNote: null, status: 'Planned',
      patientDecision: 'Accepted', clinicalReviewRequired: false,
    })
    prismaMock.treatmentPlan.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.treatmentFollowUpEvent.create.mockRejectedValue(new Error('Event insert failed'))
    const response = await resolve({ resolution: 'COMPLETED', note: 'Patient reached' })
    expect(response.status).toBe(500)
    expect(prismaMock.treatmentFollowUpEvent.create).toHaveBeenCalledOnce()
  })
  it('keeps a committed follow-up successful when secondary audit logging fails', async () => {
    prismaMock.treatmentPlan.findFirst.mockResolvedValue({
      id: 'plan-1', doctorId: 'doctor-a', patientId: 'patient-1',
      toothNumber: '24', followUpAt: new Date('2026-10-29T08:00:00.000Z'),
      followUpNote: null, status: 'Planned',
      patientDecision: 'Accepted', clinicalReviewRequired: false,
    })
    prismaMock.treatmentPlan.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.treatmentFollowUpEvent.create.mockResolvedValue({ id: 'event-3' })
    vi.mocked(logAudit).mockRejectedValueOnce(new Error('Secondary audit unavailable'))
    const response = await resolve({ resolution: 'COMPLETED', note: 'Patient reached' })
    expect(response.status).toBe(200)
    expect(prismaMock.treatmentFollowUpEvent.create).toHaveBeenCalledOnce()
    expect(logAudit).toHaveBeenCalledOnce()
  })
  it('does not resolve a treatment with no scheduled follow-up', async () => {
    prismaMock.treatmentPlan.findFirst.mockResolvedValue({ id: 'plan-1', followUpAt: null })
    const response = await resolve({ resolution: 'COMPLETED', note: 'Patient contacted' })
    expect(response.status).toBe(409)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })
})
