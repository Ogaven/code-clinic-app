import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.setConfig({ testTimeout: 20000 })

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    consentLog: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    patientConsent: { findFirst: vi.fn().mockResolvedValue(null) },
    sequenceEnrollment: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
    scheduledTouch: { updateMany: vi.fn() },
  },
}))

vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))

import { recordConsent, getChannelConsentStatus, getConsentHistory } from '../../crm-automation/consent-log.service'

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.sequenceEnrollment.findMany.mockResolvedValue([])
})

describe('recordConsent (Part I — append-only)', () => {
  it('always creates a new row rather than updating an existing one', async () => {
    prismaMock.consentLog.create.mockResolvedValueOnce({ id: 'log-1' })
    await recordConsent({ patientId: 'p-1', channel: 'WHATSAPP', status: 'OPT_IN', source: 'PATIENT_REQUEST', changedBy: 'user-1' })
    expect(prismaMock.consentLog.create).toHaveBeenCalledWith({
      data: { patientId: 'p-1', channel: 'WHATSAPP', status: 'OPT_IN', source: 'PATIENT_REQUEST', changedBy: 'user-1', metadata: null },
    })
  })

  it('does not touch any sequence enrollment on OPT_IN', async () => {
    prismaMock.consentLog.create.mockResolvedValueOnce({ id: 'log-2' })
    await recordConsent({ patientId: 'p-1', channel: 'WHATSAPP', status: 'OPT_IN', source: 'PATIENT_REQUEST' })
    expect(prismaMock.sequenceEnrollment.findMany).not.toHaveBeenCalled()
  })

  it('exits active enrollments scoped to that channel on OPT_OUT (Milestone D — consent invalidates further messaging)', async () => {
    prismaMock.consentLog.create.mockResolvedValueOnce({ id: 'log-3' })
    prismaMock.sequenceEnrollment.findMany.mockResolvedValueOnce([{ id: 'enr-1' }])

    await recordConsent({ patientId: 'p-1', channel: 'WHATSAPP', status: 'OPT_OUT', source: 'INBOUND_KEYWORD' })

    expect(prismaMock.sequenceEnrollment.findMany).toHaveBeenCalledWith({
      where: { patientId: 'p-1', status: 'ACTIVE', sequence: { channel: 'WHATSAPP' } },
    })
    expect(prismaMock.sequenceEnrollment.update).toHaveBeenCalledWith({
      where: { id: 'enr-1' },
      data: expect.objectContaining({ status: 'STOPPED', exitReason: 'consent_opt_out' }),
    })
  })
})

describe('getChannelConsentStatus', () => {
  it('honors the most recent logged event for that channel', async () => {
    prismaMock.consentLog.findFirst.mockResolvedValue({ status: 'OPT_OUT' })
    expect(await getChannelConsentStatus('p-1', 'SMS')).toBe(false)
  })

  it('falls back to the existing BOT_COMMUNICATION consent record when no channel-specific event was ever logged', async () => {
    prismaMock.consentLog.findFirst.mockResolvedValue(null)
    prismaMock.patientConsent.findFirst.mockResolvedValue({ granted: true })
    expect(await getChannelConsentStatus('p-1', 'WHATSAPP')).toBe(true)
  })

  it('defaults to opted-in when nothing has ever been recorded anywhere, matching existing app behavior', async () => {
    prismaMock.consentLog.findFirst.mockResolvedValue(null)
    prismaMock.patientConsent.findFirst.mockResolvedValue(null)
    expect(await getChannelConsentStatus('p-1', 'EMAIL')).toBe(true)
  })
})

describe('getConsentHistory', () => {
  it('returns the full history, newest first, never mutating past rows', async () => {
    const rows = [{ id: '2' }, { id: '1' }]
    prismaMock.consentLog.findMany.mockResolvedValue(rows)
    const result = await getConsentHistory('p-1')
    expect(result).toBe(rows)
    expect(prismaMock.consentLog.findMany).toHaveBeenCalledWith({ where: { patientId: 'p-1' }, orderBy: { createdAt: 'desc' } })
  })
})