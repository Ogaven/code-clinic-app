import { describe, expect, it, vi, beforeEach } from 'vitest'

// Milestone: patient CRM sequence content/activation pass, section 6 —
// "failed delivery does not create duplicate message storms". The real
// dry-run gate (dry-run.ts) forces every send in NODE_ENV=test, so it can
// never actually throw in the other sequence-dispatcher tests. Here
// sendOrSimulate itself is mocked so a real send failure can be injected and
// the no-retry-loop guarantee verified directly.

const { prismaMock, sendOrSimulate } = vi.hoisted(() => ({
  prismaMock: {
    scheduledTouch: { findMany: vi.fn(), update: vi.fn(), count: vi.fn().mockResolvedValue(0) },
    sequenceEnrollment: { update: vi.fn() },
    lead: { findUnique: vi.fn() },
    nurtureLog: { create: vi.fn() },
    automationEvent: { findMany: vi.fn().mockResolvedValue([]) },
    leadConsentLog: { findFirst: vi.fn().mockResolvedValue(null) },
    aiMessage: { findFirst: vi.fn().mockResolvedValue(null) },
  },
  sendOrSimulate: vi.fn(),
}))

vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../../crm-automation/dry-run', () => ({ sendOrSimulate }))
vi.mock('../../ai-suite/whatsapp/whatsapp.service', () => ({
  sendWhatsAppMessage: vi.fn().mockResolvedValue('wamid'),
  sendWhatsAppTemplate: vi.fn().mockResolvedValue('wamid-template'),
}))
vi.mock('../../ai-suite/sms/sms.service', () => ({ sendSMS: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../crm-automation/consent-log.service', () => ({
  getChannelConsentStatus: vi.fn().mockResolvedValue(true),
  hasExplicitOptIn: vi.fn().mockResolvedValue(false),
}))

import { processDueScheduledTouches } from '../../crm-automation/sequence-dispatcher'

function failingTouch() {
  return {
    id: 't-fail-1',
    enrollmentId: 'enr-fail-1',
    patientId: 'p-1',
    enrollment: { id: 'enr-fail-1', status: 'ACTIVE', leadId: null },
    touchTemplate: {
      // Deliberately NOT one of the 3 Meta-template-mapped sequence keys —
      // this test is about the generic failed-send/no-retry guarantee, not
      // the template gate, so it must not be intercepted by that gate first.
      channel: 'WHATSAPP',
      order: 0,
      messageTemplate: 'Hi {firstName}, this is a reminder.',
      sequence: { key: 'some_other_operational_sequence', isMarketing: false },
    },
    patient: { phone: '+256700000001', firstName: 'Jo', lastName: 'Doe' },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.scheduledTouch.count.mockResolvedValue(0)
  prismaMock.leadConsentLog.findFirst.mockResolvedValue(null)
  prismaMock.aiMessage.findFirst.mockResolvedValue(null)
})

describe('processDueScheduledTouches — failed delivery does not create duplicate message storms', () => {
  it('marks a failed send FAILED (not PENDING/re-queued) and never retries it within the same dispatcher run', async () => {
    sendOrSimulate.mockRejectedValueOnce(new Error('#131047 Meta rejected the send'))
    prismaMock.scheduledTouch.findMany.mockResolvedValueOnce([failingTouch()])

    const result = await processDueScheduledTouches()

    expect(sendOrSimulate).toHaveBeenCalledTimes(1)
    expect(prismaMock.scheduledTouch.update).toHaveBeenCalledWith({
      where: { id: 't-fail-1' },
      data: { status: 'FAILED', resultDetail: '#131047 Meta rejected the send' },
    })
    // No SENT/DRY_RUN write, no enrollment-completion write, no second attempt this run.
    expect(prismaMock.scheduledTouch.update).toHaveBeenCalledTimes(1)
    expect(prismaMock.sequenceEnrollment.update).not.toHaveBeenCalled()
    expect(result).toEqual({ processed: 1, sent: 0, dryRun: 0, skipped: 0 })
  })

  it('a FAILED touch is never picked up by a subsequent dispatcher run (findMany only ever queries status: PENDING)', async () => {
    sendOrSimulate.mockRejectedValueOnce(new Error('send_failed'))
    prismaMock.scheduledTouch.findMany.mockResolvedValueOnce([failingTouch()])
    await processDueScheduledTouches()

    // Second run: a real DB would no longer return this row because its
    // status is now FAILED, not PENDING — simulated here by returning an
    // empty result, exactly what the unchanged { status: 'PENDING' } filter
    // in scheduledTouch.findMany's where clause guarantees in production.
    prismaMock.scheduledTouch.findMany.mockResolvedValueOnce([])
    const secondResult = await processDueScheduledTouches()

    expect(sendOrSimulate).toHaveBeenCalledTimes(1) // not called again on the second run
    expect(secondResult).toEqual({ processed: 0, sent: 0, dryRun: 0, skipped: 0 })
    expect(prismaMock.scheduledTouch.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({ status: 'PENDING' }),
    }))
  })
})
