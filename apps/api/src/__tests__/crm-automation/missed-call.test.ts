import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.setConfig({ testTimeout: 20000 })

const { prismaMock, sendSMS } = vi.hoisted(() => ({
  prismaMock: {
    patient: { findFirst: vi.fn().mockResolvedValue(null) },
    callEvent: { create: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
    consentLog: { findFirst: vi.fn().mockResolvedValue(null) },
    patientConsent: { findFirst: vi.fn().mockResolvedValue(null) },
  },
  sendSMS: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../../ai-suite/sms/sms.service', () => ({ sendSMS }))

import { recordMissedCall } from '../../crm-automation/missed-call.service'

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.patient.findFirst.mockResolvedValue(null)
  process.env.NODE_ENV = 'test'
  delete process.env.CRM_AUTOMATION_LIVE
})

describe('recordMissedCall (Part F — provider-agnostic architecture)', () => {
  it('logs the call and processes the text-back in dry-run mode without ever calling a real send', async () => {
    prismaMock.callEvent.create.mockResolvedValue({ id: 'call-1', fromNumber: '+256700000001', textBackStatus: 'PENDING' })
    prismaMock.callEvent.findUniqueOrThrow.mockResolvedValue({ id: 'call-1', fromNumber: '+256700000001', patientId: null, textBackStatus: 'PENDING' })

    await recordMissedCall({ provider: 'MOCK', fromNumber: '+256700000001', toNumber: '+256700000099' })

    expect(sendSMS).not.toHaveBeenCalled()
    expect(prismaMock.callEvent.update).toHaveBeenCalledWith({
      where: { id: 'call-1' },
      data: { textBackStatus: 'DRY_RUN_SENT', textBackSentAt: expect.any(Date) },
    })
  })

  it('never sends a real text-back even if CRM_AUTOMATION_LIVE=true is set by mistake, because NODE_ENV=test forces dry-run regardless', async () => {
    process.env.CRM_AUTOMATION_LIVE = 'true'
    prismaMock.callEvent.create.mockResolvedValue({ id: 'call-1', fromNumber: '+256700000001', textBackStatus: 'PENDING' })
    prismaMock.callEvent.findUniqueOrThrow.mockResolvedValue({ id: 'call-1', fromNumber: '+256700000001', patientId: null, textBackStatus: 'PENDING' })

    await recordMissedCall({ provider: 'MOCK', fromNumber: '+256700000001', toNumber: '+256700000099' })

    expect(sendSMS).not.toHaveBeenCalled()
    expect(prismaMock.callEvent.update).toHaveBeenCalledWith({
      where: { id: 'call-1' },
      data: { textBackStatus: 'DRY_RUN_SENT', textBackSentAt: expect.any(Date) },
    })
  })

  it('skips the text-back when the patient has declined SMS consent', async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 'p-1' })
    prismaMock.callEvent.create.mockResolvedValue({ id: 'call-1', fromNumber: '+256700000001', patientId: 'p-1', textBackStatus: 'PENDING' })
    prismaMock.callEvent.findUniqueOrThrow.mockResolvedValue({ id: 'call-1', fromNumber: '+256700000001', patientId: 'p-1', textBackStatus: 'PENDING' })
    prismaMock.consentLog.findFirst.mockResolvedValue({ status: 'OPT_OUT' })

    await recordMissedCall({ provider: 'MOCK', fromNumber: '+256700000001', toNumber: '+256700000099' })

    expect(prismaMock.callEvent.update).toHaveBeenCalledWith({ where: { id: 'call-1' }, data: { textBackStatus: 'SKIPPED_CONSENT' } })
    expect(sendSMS).not.toHaveBeenCalled()
  })
})