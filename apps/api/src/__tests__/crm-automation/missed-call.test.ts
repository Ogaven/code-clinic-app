import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

vi.setConfig({ testTimeout: 20000 })

const { prismaMock, sendSMS, isRealSmsProviderConfigured } = vi.hoisted(() => ({
  prismaMock: {
    patient: { findFirst: vi.fn().mockResolvedValue(null) },
    callEvent: { create: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
    consentLog: { findFirst: vi.fn().mockResolvedValue(null) },
    patientConsent: { findFirst: vi.fn().mockResolvedValue(null) },
  },
  sendSMS: vi.fn().mockResolvedValue(undefined),
  isRealSmsProviderConfigured: vi.fn().mockReturnValue(false),
}))

vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../../ai-suite/sms/sms.service', () => ({ sendSMS, isRealSmsProviderConfigured }))

import { recordMissedCall } from '../../crm-automation/missed-call.service'

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.patient.findFirst.mockResolvedValue(null)
  isRealSmsProviderConfigured.mockReturnValue(false)
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

describe('recordMissedCall — CRM_MISSED_CALL_TEXTBACK_LIVE (dedicated flag, real Africa\'s Talking wiring)', () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV
  beforeEach(() => { process.env.NODE_ENV = 'production' })
  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV
    delete process.env.CRM_AUTOMATION_LIVE
    delete process.env.CRM_MISSED_CALL_TEXTBACK_LIVE
  })

  it('master+feature ON but no real SMS provider configured -> SKIPPED_NO_PROVIDER, no send attempted', async () => {
    process.env.CRM_AUTOMATION_LIVE = 'true'
    process.env.CRM_MISSED_CALL_TEXTBACK_LIVE = 'true'
    isRealSmsProviderConfigured.mockReturnValue(false)
    prismaMock.callEvent.create.mockResolvedValue({ id: 'call-1', fromNumber: '+256700000001', textBackStatus: 'PENDING' })
    prismaMock.callEvent.findUniqueOrThrow.mockResolvedValue({ id: 'call-1', fromNumber: '+256700000001', patientId: null, textBackStatus: 'PENDING' })

    await recordMissedCall({ provider: 'SIP_DRACHTIO', fromNumber: '+256700000001', toNumber: '+256700000099' })

    expect(sendSMS).not.toHaveBeenCalled()
    expect(prismaMock.callEvent.update).toHaveBeenCalledWith({ where: { id: 'call-1' }, data: { textBackStatus: 'SKIPPED_NO_PROVIDER' } })
  })

  it('master+feature ON and a real SMS provider is configured -> a real send is attempted', async () => {
    process.env.CRM_AUTOMATION_LIVE = 'true'
    process.env.CRM_MISSED_CALL_TEXTBACK_LIVE = 'true'
    isRealSmsProviderConfigured.mockReturnValue(true)
    prismaMock.callEvent.create.mockResolvedValue({ id: 'call-1', fromNumber: '+256700000001', textBackStatus: 'PENDING' })
    prismaMock.callEvent.findUniqueOrThrow.mockResolvedValue({ id: 'call-1', fromNumber: '+256700000001', patientId: null, textBackStatus: 'PENDING' })

    await recordMissedCall({ provider: 'SIP_DRACHTIO', fromNumber: '+256700000001', toNumber: '+256700000099' })

    expect(sendSMS).toHaveBeenCalledTimes(1)
    expect(prismaMock.callEvent.update).toHaveBeenCalledWith({
      where: { id: 'call-1' },
      data: { textBackStatus: 'SENT', textBackSentAt: expect.any(Date) },
    })
  })

  it('master ON but MISSED_CALL_TEXTBACK flag OFF -> stays dry-run even with a provider configured', async () => {
    process.env.CRM_AUTOMATION_LIVE = 'true' // MISSED_CALL_TEXTBACK flag deliberately not set
    isRealSmsProviderConfigured.mockReturnValue(true)
    prismaMock.callEvent.create.mockResolvedValue({ id: 'call-1', fromNumber: '+256700000001', textBackStatus: 'PENDING' })
    prismaMock.callEvent.findUniqueOrThrow.mockResolvedValue({ id: 'call-1', fromNumber: '+256700000001', patientId: null, textBackStatus: 'PENDING' })

    await recordMissedCall({ provider: 'SIP_DRACHTIO', fromNumber: '+256700000001', toNumber: '+256700000099' })

    expect(sendSMS).not.toHaveBeenCalled()
    expect(prismaMock.callEvent.update).toHaveBeenCalledWith({
      where: { id: 'call-1' },
      data: { textBackStatus: 'DRY_RUN_SENT', textBackSentAt: expect.any(Date) },
    })
  })
})