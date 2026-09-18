import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import type { Server } from 'node:http'

// Regression coverage for the 2026-09-16 lead-engine audit finding: PATCH
// /crm/leads/:id and POST /crm/leads/:id/convert used to write Lead.status
// directly via prisma.lead.update, silently bypassing transitionLeadStage()
// — which is why production leads reached CONTACTED with zero
// LeadStageHistory rows. Both routes must now go through the stage service.

const { prismaMock, transitionLeadStage, convertLeadOnBooking } = vi.hoisted(() => ({
  prismaMock: {
    lead: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    user: { findUnique: vi.fn() },
    patient: { findFirst: vi.fn(), create: vi.fn() },
  },
  transitionLeadStage: vi.fn(),
  convertLeadOnBooking: vi.fn(),
}))
vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = { id: 'staff-1', role: 'RECEPTIONIST' }; next() },
}))
vi.mock('../../crm-automation/lead-stage.service', () => ({ transitionLeadStage, convertLeadOnBooking }))
vi.mock('../../crm-automation/lead-intake.service', () => ({
  findOrCreateLeadForChannel: vi.fn(), handleNewLeadCreated: vi.fn(),
}))

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

describe('PATCH /crm/leads/:id — status changes route through transitionLeadStage', () => {
  it('calls transitionLeadStage instead of writing status directly', async () => {
    transitionLeadStage.mockResolvedValue({ id: 'lead-1', status: 'CONTACTED' })
    prismaMock.lead.findUniqueOrThrow.mockResolvedValue({ id: 'lead-1', status: 'CONTACTED' })

    const res = await patch('lead-1', { status: 'CONTACTED' })

    expect(res.status).toBe(200)
    expect(transitionLeadStage).toHaveBeenCalledWith('lead-1', 'CONTACTED', { changedBy: 'staff-1', trigger: 'MANUAL', reason: undefined })
    // No direct prisma.lead.update carrying a status/stage field — the only
    // legitimate write path for status is the mocked service above.
    for (const call of prismaMock.lead.update.mock.calls) {
      expect(call[0].data).not.toHaveProperty('status')
      expect(call[0].data).not.toHaveProperty('stage')
    }
  })

  it('propagates the loss-reason validation error as 400, not a generic 500', async () => {
    transitionLeadStage.mockRejectedValue(new Error('A loss reason is required whenever a lead moves to LOST'))

    const res = await patch('lead-1', { status: 'LOST' })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'A loss reason is required whenever a lead moves to LOST' })
  })

  it('still allows updating non-stage fields (e.g. assignedTo) without touching transitionLeadStage', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-2' })
    prismaMock.lead.update.mockResolvedValue({ id: 'lead-1', assignedTo: 'user-2' })

    const res = await patch('lead-1', { assignedTo: 'user-2' })

    expect(res.status).toBe(200)
    expect(transitionLeadStage).not.toHaveBeenCalled()
    expect(prismaMock.lead.update).toHaveBeenCalledWith({ where: { id: 'lead-1' }, data: { assignedTo: 'user-2' } })
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
