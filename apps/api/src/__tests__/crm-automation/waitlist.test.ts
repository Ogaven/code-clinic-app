import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

vi.setConfig({ testTimeout: 20000 })

const { prismaMock, sendWhatsAppMessage } = vi.hoisted(() => ({
  prismaMock: {
    appointment: { findUnique: vi.fn() },
    waitlistEntry: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    waitlistNotification: { create: vi.fn() },
    consentLog: { findFirst: vi.fn().mockResolvedValue(null) },
    patientConsent: { findFirst: vi.fn().mockResolvedValue(null) },
  },
  sendWhatsAppMessage: vi.fn().mockResolvedValue('wamid-1'),
}))

vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../../ai-suite/whatsapp/whatsapp.service', () => ({ sendWhatsAppMessage }))
vi.mock('../../ai-suite/sms/sms.service', () => ({ sendSMS: vi.fn().mockResolvedValue(undefined) }))

import { notifyWaitlistForOpenSlot, createWaitlistEntry, markWaitlistEntryFulfilled } from '../../crm-automation/waitlist.service'

function entry(overrides: Record<string, any> = {}) {
  return {
    id: 'we-1',
    serviceId: 'svc-1',
    preferredDoctorId: null,
    preferredDateFrom: null,
    preferredDateTo: null,
    requestedAt: new Date('2026-01-01'),
    patient: { id: 'p-1', firstName: 'Jo', phone: '+256700000001', commsChannelPref: null },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NODE_ENV = 'test'
  delete process.env.CRM_AUTOMATION_LIVE
})

describe('notifyWaitlistForOpenSlot — explicit WaitlistEntry matching (release-blocker fix)', () => {
  it('is disabled when the cancelled appointment has no service context', async () => {
    prismaMock.appointment.findUnique.mockResolvedValue({ serviceId: null, doctorId: null, startAt: new Date() })
    const result = await notifyWaitlistForOpenSlot('appt-1')
    expect(result.targetingMode).toBe('DISABLED_NO_SERVICE_CONTEXT')
    expect(prismaMock.waitlistEntry.findMany).not.toHaveBeenCalled()
  })

  it('exact service match — queries only ACTIVE, unfulfilled, uncancelled entries for that service', async () => {
    prismaMock.appointment.findUnique.mockResolvedValue({ serviceId: 'svc-1', doctorId: null, startAt: new Date('2026-02-01') })
    prismaMock.waitlistEntry.findMany.mockResolvedValue([entry()])
    await notifyWaitlistForOpenSlot('appt-1')
    expect(prismaMock.waitlistEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { serviceId: 'svc-1', isActive: true, fulfilledAt: null, cancelledAt: null },
    }))
  })

  it('never broad-blasts — zero matching WaitlistEntry rows means zero notifications', async () => {
    prismaMock.appointment.findUnique.mockResolvedValue({ serviceId: 'svc-1', doctorId: null, startAt: new Date() })
    prismaMock.waitlistEntry.findMany.mockResolvedValue([])
    const result = await notifyWaitlistForOpenSlot('appt-1')
    expect(result.targetingMode).toBe('DISABLED_NO_MATCH')
    expect(result.notified).toHaveLength(0)
  })

  it('prefers an exact preferred-doctor match when one exists', async () => {
    prismaMock.appointment.findUnique.mockResolvedValue({ serviceId: 'svc-1', doctorId: 'doc-1', startAt: new Date('2026-02-01') })
    prismaMock.waitlistEntry.findMany.mockResolvedValue([
      entry({ id: 'we-1', preferredDoctorId: null, patient: { id: 'p-1', firstName: 'NoPref', phone: '+256700000001', commsChannelPref: null } }),
      entry({ id: 'we-2', preferredDoctorId: 'doc-1', patient: { id: 'p-2', firstName: 'Match', phone: '+256700000002', commsChannelPref: null } }),
    ])
    const result = await notifyWaitlistForOpenSlot('appt-1')
    expect(result.notified.map(n => n.waitlistEntryId)).toEqual(['we-2'])
  })

  it('an explicit preference for a DIFFERENT provider is a hard exclusion — never falls back to a doctor-mismatched entry (release-blocker fix)', async () => {
    prismaMock.appointment.findUnique.mockResolvedValue({ serviceId: 'svc-1', doctorId: 'doc-A', startAt: new Date('2026-02-01') })
    prismaMock.waitlistEntry.findMany.mockResolvedValue([
      entry({ id: 'we-prefers-doc-b', preferredDoctorId: 'doc-B', patient: { id: 'p-1', firstName: 'PrefersB', phone: '+256700000001', commsChannelPref: null } }),
    ])
    const result = await notifyWaitlistForOpenSlot('appt-1')
    expect(result.targetingMode).toBe('DISABLED_NO_MATCH')
    expect(result.notified).toHaveLength(0)
  })

  it('falls back to no-preference entries only when no same-doctor entry exists', async () => {
    prismaMock.appointment.findUnique.mockResolvedValue({ serviceId: 'svc-1', doctorId: 'doc-A', startAt: new Date('2026-02-01') })
    prismaMock.waitlistEntry.findMany.mockResolvedValue([
      entry({ id: 'we-prefers-doc-b', preferredDoctorId: 'doc-B', patient: { id: 'p-1', firstName: 'PrefersB', phone: '+256700000001', commsChannelPref: null } }),
      entry({ id: 'we-no-pref', preferredDoctorId: null, patient: { id: 'p-2', firstName: 'NoPref', phone: '+256700000002', commsChannelPref: null } }),
    ])
    const result = await notifyWaitlistForOpenSlot('appt-1')
    expect(result.notified.map(n => n.waitlistEntryId)).toEqual(['we-no-pref'])
  })

  it('date compatibility is a hard filter — never contacts someone outside their stated window', async () => {
    prismaMock.appointment.findUnique.mockResolvedValue({ serviceId: 'svc-1', doctorId: null, startAt: new Date('2026-03-15') })
    prismaMock.waitlistEntry.findMany.mockResolvedValue([
      entry({ preferredDateFrom: new Date('2026-01-01'), preferredDateTo: new Date('2026-01-31') }), // window doesn't include March
    ])
    const result = await notifyWaitlistForOpenSlot('appt-1')
    expect(result.targetingMode).toBe('DISABLED_NO_MATCH')
    expect(result.notified).toHaveLength(0)
  })

  it('oldest requestedAt is served first when multiple entries match', async () => {
    prismaMock.appointment.findUnique.mockResolvedValue({ serviceId: 'svc-1', doctorId: null, startAt: new Date('2026-02-01') })
    prismaMock.waitlistEntry.findMany.mockResolvedValue([
      entry({ id: 'we-newer', requestedAt: new Date('2026-01-10'), patient: { id: 'p-1', firstName: 'Newer', phone: '+256700000001', commsChannelPref: null } }),
      entry({ id: 'we-older', requestedAt: new Date('2026-01-01'), patient: { id: 'p-2', firstName: 'Older', phone: '+256700000002', commsChannelPref: null } }),
    ])
    const result = await notifyWaitlistForOpenSlot('appt-1', 1) // limit 1 — only the oldest should be picked
    expect(result.notified.map(n => n.waitlistEntryId)).toEqual(['we-older'])
  })

  it('skips (does not send to) a patient who has opted out of the channel', async () => {
    prismaMock.appointment.findUnique.mockResolvedValue({ serviceId: 'svc-1', doctorId: null, startAt: new Date() })
    prismaMock.waitlistEntry.findMany.mockResolvedValue([entry()])
    prismaMock.consentLog.findFirst.mockResolvedValue({ status: 'OPT_OUT' })
    const result = await notifyWaitlistForOpenSlot('appt-1')
    expect(result.notified).toHaveLength(0)
    expect(result.skipped[0].reason).toBe('consent_declined')
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('never sends a real message during tests — dry-run only', async () => {
    prismaMock.appointment.findUnique.mockResolvedValue({ serviceId: 'svc-1', doctorId: null, startAt: new Date() })
    prismaMock.waitlistEntry.findMany.mockResolvedValue([entry()])
    await notifyWaitlistForOpenSlot('appt-1')
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })
})

describe('notifyWaitlistForOpenSlot — CRM_WAITLIST_AUTOMATION_LIVE feature flag (release-blocker fix — per-feature gating)', () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV
  beforeEach(() => { process.env.NODE_ENV = 'production' })
  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV
    delete process.env.CRM_AUTOMATION_LIVE
    delete process.env.CRM_WAITLIST_AUTOMATION_LIVE
  })

  it('matching is computed even while OFF, but no real provider call is made', async () => {
    prismaMock.appointment.findUnique.mockResolvedValue({ serviceId: 'svc-1', doctorId: null, startAt: new Date() })
    prismaMock.waitlistEntry.findMany.mockResolvedValue([entry()])
    const result = await notifyWaitlistForOpenSlot('appt-1')
    expect(result.targetingMode).toBe('MATCHED')
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('master+feature ON with a valid match and consent -> a real send is attempted', async () => {
    process.env.CRM_AUTOMATION_LIVE = 'true'
    process.env.CRM_WAITLIST_AUTOMATION_LIVE = 'true'
    prismaMock.appointment.findUnique.mockResolvedValue({ serviceId: 'svc-1', doctorId: null, startAt: new Date() })
    prismaMock.waitlistEntry.findMany.mockResolvedValue([entry()])
    prismaMock.consentLog.findFirst.mockResolvedValue({ status: 'OPT_IN' })

    const result = await notifyWaitlistForOpenSlot('appt-1')

    expect(sendWhatsAppMessage).toHaveBeenCalledTimes(1)
    expect(result.notified[0].dryRun).toBe(false)
  })

  it('master ON but WAITLIST feature flag OFF -> still dry-run even with a valid match and consent', async () => {
    process.env.CRM_AUTOMATION_LIVE = 'true' // WAITLIST flag deliberately not set
    prismaMock.appointment.findUnique.mockResolvedValue({ serviceId: 'svc-1', doctorId: null, startAt: new Date() })
    prismaMock.waitlistEntry.findMany.mockResolvedValue([entry()])
    prismaMock.consentLog.findFirst.mockResolvedValue({ status: 'OPT_IN' })

    const result = await notifyWaitlistForOpenSlot('appt-1')

    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
    expect(result.notified[0].dryRun).toBe(true)
  })
})

describe('WaitlistEntry CRUD — fulfillment idempotency', () => {
  it('createWaitlistEntry persists the request fields', async () => {
    prismaMock.waitlistEntry.create.mockResolvedValue({ id: 'we-1' })
    await createWaitlistEntry({ patientId: 'p-1', serviceId: 'svc-1', preferredDoctorId: 'doc-1' })
    expect(prismaMock.waitlistEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ patientId: 'p-1', serviceId: 'svc-1', preferredDoctorId: 'doc-1' }),
    })
  })

  it('marking fulfilled deactivates the entry so it can never match again', async () => {
    await markWaitlistEntryFulfilled('we-1')
    expect(prismaMock.waitlistEntry.update).toHaveBeenCalledWith({
      where: { id: 'we-1' },
      data: { isActive: false, fulfilledAt: expect.any(Date) },
    })
  })
})
