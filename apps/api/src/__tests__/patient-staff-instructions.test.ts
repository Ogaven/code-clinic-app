import { describe, expect, it, vi, beforeAll } from 'vitest'

// Synthetic records only: never reads or writes a production patient.
const instruction = { id: 'instruction-1', patientId: 'patient-1', userId: 'doctor-a', userName: 'Doctor A', action: 'STAFF_INTERNAL_INSTRUCTION', metadata: JSON.stringify({ message: 'Synthetic staff note', recipientId: 'reception-a' }), createdAt: new Date('2026-01-01') }
const prisma = {
  patient: { findUnique: vi.fn().mockResolvedValue({ id: 'patient-1' }) },
  patientActivity: { findMany: vi.fn().mockResolvedValue([instruction]), findFirst: vi.fn().mockResolvedValue(instruction), create: vi.fn().mockResolvedValue({ id: 'new-1', createdAt: new Date() }) },
  user: { findUnique: vi.fn().mockResolvedValue({ id: 'doctor-a', role: 'DOCTOR', isActive: true }), findMany: vi.fn().mockResolvedValue([]) },
  doctor: { findUnique: vi.fn().mockResolvedValue({ id: 'doctor-1' }) },
  appointment: { findFirst: vi.fn().mockResolvedValue({ id: 'appointment-1' }), findMany: vi.fn().mockResolvedValue([]) },
}
let router: any
beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/test'
  process.env.JWT_SECRET ??= 'x'.repeat(32)
  process.env.JWT_REFRESH_SECRET ??= 'y'.repeat(32)
  vi.doMock('openai', () => ({ default: class OpenAITestStub { constructor() {} } }))
  vi.doMock('../lib/prisma', () => ({ prisma }))
  vi.doMock('../services/storage/r2', () => ({ getPublicUrl: vi.fn(), uploadAvatar: vi.fn() }))
  vi.doMock('../services/notification.service', () => ({ notifyUsers: vi.fn().mockResolvedValue(undefined) }))
  router = (await import('../routes/clinical')).default
}, 30000)
function handler(method: string, path: string) {
  const route = router.stack.find((layer: any) => layer.route?.path === path && layer.route.methods[method])
  if (!route) throw new Error('Missing route: ' + path)
  return route.route.stack[route.route.stack.length - 1].handle
}
function req(role: string, id: string) {
  return { params: { id: 'patient-1', instructionId: id }, user: { id: 'reception-a', role, firstName: 'Test', lastName: 'Staff' }, body: {} }
}
function response() {
  const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() }
  return res
}
describe('private patient staff instruction security', () => {
  it('private instruction events are excluded from general activity', async () => {
    prisma.patientActivity.findMany.mockClear()
    const res = response()
    await handler('get', '/patients/:id/activity')(req('ADMIN', ''), res)
    expect(prisma.patientActivity.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ action: { notIn: ['STAFF_INTERNAL_INSTRUCTION', 'STAFF_INTERNAL_INSTRUCTION_HANDLED'] } }),
    }))
  })
  it('rejects forged private events via general activity write', async () => {
    const res = response()
    await handler('post', '/patients/:id/activity')({ ...req('ADMIN', ''), body: { action: 'STAFF_INTERNAL_INSTRUCTION' } }, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })
  it('non-recipient staff cannot mark another instruction handled', async () => {
    const res = response()
    await handler('post', '/patients/:id/staff-instructions/:instructionId/handled')({ ...req('RECEPTIONIST', 'instruction-1'), user: { id: 'other-staff', role: 'RECEPTIONIST' } }, res)
    expect(res.status).toHaveBeenCalledWith(403)
  })
  it('recipient can mark an instruction handled', async () => {
    prisma.patientActivity.findMany.mockResolvedValueOnce([])
    const res = response()
    await handler('post', '/patients/:id/staff-instructions/:instructionId/handled')(req('RECEPTIONIST', 'instruction-1'), res)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ handled: true }))
  })
  it('unrelated staff cannot reply to an instruction', async () => {
    const res = response()
    await handler('post', '/patients/:id/staff-instructions')({
      ...req('RECEPTIONIST', ''), user: { id: 'unrelated', role: 'RECEPTIONIST', firstName: 'Other', lastName: 'Staff' },
      body: { message: 'Synthetic reply', recipientId: 'doctor-a', replyToId: 'instruction-1' },
    }, res)
    expect(res.status).toHaveBeenCalledWith(403)
  })
})
