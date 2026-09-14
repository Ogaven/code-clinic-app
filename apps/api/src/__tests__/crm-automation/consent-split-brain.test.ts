import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.setConfig({ testTimeout: 20000 })

// Regression coverage for a real bug found during the Dr. Steven CRM final
// release: the WhatsApp STOP/START keyword handler used to write only to
// the legacy PatientConsent model, while every CRM-automation send path
// (missed-call text-back, waitlist, review requests, sequences) reads
// ConsentLog first and only falls back to PatientConsent when ConsentLog
// has zero rows for that channel. A patient with any prior ConsentLog row
// who then texted STOP was invisible to CRM automation. Fixed by (a)
// whatsapp.service.ts also writing a ConsentLog row on STOP/START, and
// (b) hasOutboundConsent (guardian-routing.service.ts) consulting
// ConsentLog first, same as getChannelConsentStatus already did.

const { prismaMock, recordConsent } = vi.hoisted(() => ({
  prismaMock: {
    patient:        { findFirst: vi.fn() },
    patientConsent: { create: vi.fn(), findFirst: vi.fn().mockResolvedValue(null) },
    consentLog:     { findFirst: vi.fn().mockResolvedValue(null) },
  },
  recordConsent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../../crm-automation/consent-log.service', () => ({ recordConsent }))

import { processInbound } from '../../ai-suite/whatsapp/whatsapp.service'
import { hasOutboundConsent } from '../../ai-suite/scheduler/guardian-routing.service'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NODE_ENV = 'test'
  prismaMock.consentLog.findFirst.mockResolvedValue(null)
  prismaMock.patientConsent.findFirst.mockResolvedValue(null)
})

describe('WhatsApp STOP/START also logs to ConsentLog (not just legacy PatientConsent)', () => {
  it('STOP writes PatientConsent(granted:false) AND ConsentLog(WHATSAPP, OPT_OUT, INBOUND_KEYWORD)', async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 'p-1' })
    await processInbound('256700000001', 'STOP', 'wamid-1')

    expect(prismaMock.patientConsent.create).toHaveBeenCalledWith({
      data: { patientId: 'p-1', consentType: 'BOT_COMMUNICATION', granted: false },
    })
    expect(recordConsent).toHaveBeenCalledWith({
      patientId: 'p-1', channel: 'WHATSAPP', status: 'OPT_OUT', source: 'INBOUND_KEYWORD',
    })
  })

  it('START writes PatientConsent(granted:true) AND ConsentLog(WHATSAPP, OPT_IN, INBOUND_KEYWORD)', async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 'p-2' })
    await processInbound('256700000002', 'start', 'wamid-2')

    expect(prismaMock.patientConsent.create).toHaveBeenCalledWith({
      data: { patientId: 'p-2', consentType: 'BOT_COMMUNICATION', granted: true },
    })
    expect(recordConsent).toHaveBeenCalledWith({
      patientId: 'p-2', channel: 'WHATSAPP', status: 'OPT_IN', source: 'INBOUND_KEYWORD',
    })
  })

  it('writes nothing when no patient record matches the phone number', async () => {
    prismaMock.patient.findFirst.mockResolvedValue(null)
    await processInbound('256700000003', 'STOP', 'wamid-3')

    expect(prismaMock.patientConsent.create).not.toHaveBeenCalled()
    expect(recordConsent).not.toHaveBeenCalled()
  })
})

describe('hasOutboundConsent — ConsentLog wins over legacy PatientConsent when both exist', () => {
  it('a ConsentLog OPT_OUT row is respected even if PatientConsent would say opted-in', async () => {
    prismaMock.consentLog.findFirst.mockResolvedValue({ status: 'OPT_OUT' })
    prismaMock.patientConsent.findFirst.mockResolvedValue({ granted: true })

    await expect(hasOutboundConsent('p-1')).resolves.toBe(false)
  })

  it('a ConsentLog OPT_IN row is respected even if PatientConsent would say opted-out', async () => {
    prismaMock.consentLog.findFirst.mockResolvedValue({ status: 'OPT_IN' })
    prismaMock.patientConsent.findFirst.mockResolvedValue({ granted: false })

    await expect(hasOutboundConsent('p-1')).resolves.toBe(true)
  })

  it('falls back to legacy PatientConsent when ConsentLog has no rows for this patient', async () => {
    prismaMock.consentLog.findFirst.mockResolvedValue(null)
    prismaMock.patientConsent.findFirst.mockResolvedValue({ granted: false })

    await expect(hasOutboundConsent('p-1')).resolves.toBe(false)
  })

  it('defaults to opted-in when neither model has a record', async () => {
    prismaMock.consentLog.findFirst.mockResolvedValue(null)
    prismaMock.patientConsent.findFirst.mockResolvedValue(null)

    await expect(hasOutboundConsent('p-1')).resolves.toBe(true)
  })
})
