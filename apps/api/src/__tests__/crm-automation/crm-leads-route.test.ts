import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import type { Server } from 'node:http'

// Regression coverage for the 2026-09-16 lead-engine audit finding: PATCH
// /crm/leads/:id and POST /crm/leads/:id/convert used to write Lead.status
// directly via prisma.lead.update, silently bypassing transitionLeadStage()
// — which is why production leads reached CONTACTED with zero
// LeadStageHistory rows. Both routes must now go through the stage service.
//
// Regression coverage for the 2026-09-19 follow-up finding: PATCH
// /crm/leads/:id then called transitionLeadStage() directly for ANY status
// value, which bypassed the canonical business-rule wrappers (logHumanReply,
// applyQualifyingIntent, markLeadLostManually, convertLeadOnBooking) that
// every dedicated stage-change endpoint uses — letting a generic PATCH to
// LOST/CONVERTED skip exitActiveEnrollments() and a PATCH to QUALIFIED skip
// the 48h-reply/CONTACTED precondition. PATCH must now dispatch to the same
// wrappers, not call transitionLeadStage() directly, for any of the four
// stages that have one.

const {
  prismaMock, transitionLeadStage, convertLeadOnBooking, logHumanReply, applyQualifyingIntent, markLeadLostManually,
  findOrCreateLeadForChannel, handleNewLeadCreated,
} = vi.hoisted(() => ({
  prismaMock: {
    lead: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    user: { findUnique: vi.fn() },
    patient: { findFirst: vi.fn(), create: vi.fn() },
  },
  transitionLeadStage: vi.fn(),
  convertLeadOnBooking: vi.fn(),
  logHumanReply: vi.fn(),
  applyQualifyingIntent: vi.fn(),
  markLeadLostManually: vi.fn(),
  findOrCreateLeadForChannel: vi.fn(),
  handleNewLeadCreated: vi.fn(),
}))
vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = { id: 'staff-1', role: 'RECEPTIONIST' }; next() },
}))
vi.mock('../../crm-automation/lead-stage.service', () => ({
  transitionLeadStage, convertLeadOnBooking, logHumanReply, applyQualifyingIntent, markLeadLostManually,
}))
vi.mock('../../crm-automation/lead-intake.service', () => ({ findOrCreateLeadForChannel, handleNewLeadCreated }))

import router from '../../routes/crm'

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

async function patch(id: string, body: object) {
  return fetch(`${origin}/leads/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

describe('PATCH /crm/leads/:id — stage changes dispatch to the canonical wrapper for that stage, never raw transitionLeadStage', () => {
  it('CONTACTED calls logHumanReply, not transitionLeadStage directly', async () => {
    logHumanReply.mockResolvedValue({ id: 'lead-1', status: 'CONTACTED' })

    const res = await patch('lead-1', { status: 'CONTACTED' })

    expect(res.status).toBe(200)
    expect(logHumanReply).toHaveBeenCalledWith('lead-1', 'staff-1')
    expect(transitionLeadStage).not.toHaveBeenCalled()
    // No direct prisma.lead.update carrying a status/stage field — the only
    // legitimate write path for status is inside the mocked service above.
    for (const call of prismaMock.lead.update.mock.calls) {
      expect(call[0].data).not.toHaveProperty('status')
      expect(call[0].data).not.toHaveProperty('stage')
    }
  })

  it('QUALIFIED without an intent is rejected with 400 before calling anything', async () => {
    const res = await patch('lead-1', { status: 'QUALIFIED' })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: expect.stringContaining('intent is required') })
    expect(applyQualifyingIntent).not.toHaveBeenCalled()
    expect(transitionLeadStage).not.toHaveBeenCalled()
  })

  it('QUALIFIED with an intent calls applyQualifyingIntent (enforces the 48h-reply/CONTACTED business rule), not transitionLeadStage directly', async () => {
    applyQualifyingIntent.mockResolvedValue({ id: 'lead-1', status: 'QUALIFIED' })

    const res = await patch('lead-1', { status: 'QUALIFIED', intent: 'asked_pricing' })

    expect(res.status).toBe(200)
    expect(applyQualifyingIntent).toHaveBeenCalledWith('lead-1', 'staff-1', 'asked_pricing')
    expect(transitionLeadStage).not.toHaveBeenCalled()
  })

  it('QUALIFIED cannot bypass the qualification business rule — a rejection from applyQualifyingIntent surfaces as 400, not 500', async () => {
    applyQualifyingIntent.mockRejectedValue(new Error('Lead has not responded within the last 48 hours — cannot qualify yet'))

    const res = await patch('lead-1', { status: 'QUALIFIED', intent: 'asked_pricing' })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Lead has not responded within the last 48 hours — cannot qualify yet' })
  })

  it('LOST without a reason is rejected with 400 before calling anything', async () => {
    const res = await patch('lead-1', { status: 'LOST' })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'A loss reason is required whenever a lead moves to LOST' })
    expect(markLeadLostManually).not.toHaveBeenCalled()
    expect(transitionLeadStage).not.toHaveBeenCalled()
  })

  it('LOST with a reason calls markLeadLostManually (exits active enrollments), not transitionLeadStage directly', async () => {
    markLeadLostManually.mockResolvedValue({ id: 'lead-1', status: 'LOST' })

    const res = await patch('lead-1', { status: 'LOST', reason: 'went with a competitor' })

    expect(res.status).toBe(200)
    expect(markLeadLostManually).toHaveBeenCalledWith('lead-1', 'staff-1', 'went with a competitor')
    expect(transitionLeadStage).not.toHaveBeenCalled()
  })

  it('CONVERTED calls convertLeadOnBooking (exits active enrollments), not transitionLeadStage directly', async () => {
    convertLeadOnBooking.mockResolvedValue({ id: 'lead-1', status: 'CONVERTED' })

    const res = await patch('lead-1', { status: 'CONVERTED' })

    expect(res.status).toBe(200)
    expect(convertLeadOnBooking).toHaveBeenCalledWith('lead-1')
    expect(transitionLeadStage).not.toHaveBeenCalled()
  })

  it('a stage without a canonical wrapper (e.g. NEW, for a reset/reopen) still falls through to transitionLeadStage — still the single write path, still LeadStageHistory-backed', async () => {
    transitionLeadStage.mockResolvedValue({ id: 'lead-1', status: 'NEW' })
    prismaMock.lead.findUniqueOrThrow.mockResolvedValue({ id: 'lead-1', status: 'NEW' })

    const res = await patch('lead-1', { status: 'NEW' })

    expect(res.status).toBe(200)
    expect(transitionLeadStage).toHaveBeenCalledWith('lead-1', 'NEW', { changedBy: 'staff-1', trigger: 'MANUAL', reason: undefined })
  })

  it('still allows updating non-stage fields (e.g. assignedTo) without touching any stage-transition function', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-2' })
    prismaMock.lead.update.mockResolvedValue({ id: 'lead-1', assignedTo: 'user-2' })

    const res = await patch('lead-1', { assignedTo: 'user-2' })

    expect(res.status).toBe(200)
    expect(transitionLeadStage).not.toHaveBeenCalled()
    expect(logHumanReply).not.toHaveBeenCalled()
    expect(applyQualifyingIntent).not.toHaveBeenCalled()
    expect(markLeadLostManually).not.toHaveBeenCalled()
    expect(convertLeadOnBooking).not.toHaveBeenCalled()
    expect(prismaMock.lead.update).toHaveBeenCalledWith({ where: { id: 'lead-1' }, data: { assignedTo: 'user-2' } })
  })
})

describe('POST /crm/leads — every new lead is born NEW regardless of client input', () => {
  it('ignores a client-supplied status when creating a lead without a phone', async () => {
    prismaMock.lead.create.mockResolvedValue({ id: 'lead-2', status: 'NEW', stage: 'NEW' })
    handleNewLeadCreated.mockResolvedValue(undefined)

    const res = await fetch(`${origin}/leads`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'WALKIN', name: 'Jane Doe', status: 'CONVERTED' }),
    })

    expect(res.status).toBe(201)
    expect(prismaMock.lead.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'NEW', stage: 'NEW' }),
    })
  })

  it('ignores a client-supplied status when creating/finding a lead by phone', async () => {
    findOrCreateLeadForChannel.mockResolvedValue({ lead: { id: 'lead-3', status: 'NEW' } })

    const res = await fetch(`${origin}/leads`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'WALKIN', phone: '+256700000000', status: 'QUALIFIED' }),
    })

    expect(res.status).toBe(201)
    const call = findOrCreateLeadForChannel.mock.calls[0][0]
    expect(call.createData).toEqual(expect.objectContaining({ status: 'NEW', stage: 'NEW' }))
  })
})

describe('POST /crm/leads/:id/convert — routes CONVERTED through convertLeadOnBooking', () => {
  it('links the patient then calls convertLeadOnBooking instead of writing status directly', async () => {
    prismaMock.lead.findUnique.mockResolvedValue({ id: 'lead-1', status: 'QUALIFIED', name: 'Jane Doe', phone: '+256700000000', email: null })
    prismaMock.patient.findFirst.mockResolvedValue(null)
    prismaMock.patient.create.mockResolvedValue({ id: 'patient-1' })
    convertLeadOnBooking.mockResolvedValue({ id: 'lead-1', status: 'CONVERTED' })

    const res = await fetch(`${origin}/leads/lead-1/convert`, { method: 'POST' })

    expect(res.status).toBe(200)
    expect(prismaMock.lead.update).toHaveBeenCalledWith({ where: { id: 'lead-1' }, data: { convertedToPatientId: 'patient-1' } })
    expect(convertLeadOnBooking).toHaveBeenCalledWith('lead-1')
    const body = await res.json() as any
    expect(body.lead.status).toBe('CONVERTED')
  })
})
