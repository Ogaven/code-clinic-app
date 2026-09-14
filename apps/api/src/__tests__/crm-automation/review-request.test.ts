import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.setConfig({ testTimeout: 20000 })

const { prismaMock, sendWhatsAppMessage } = vi.hoisted(() => ({
  prismaMock: {
    reviewRequestConfig: { findFirst: vi.fn() },
    reviewRequestLog: { findUnique: vi.fn(), create: vi.fn(), findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
    consentLog: { findFirst: vi.fn().mockResolvedValue(null) },
    patientConsent: { findFirst: vi.fn().mockResolvedValue(null) },
  },
  sendWhatsAppMessage: vi.fn().mockResolvedValue('wamid-1'),
}))

vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../../ai-suite/whatsapp/whatsapp.service', () => ({ sendWhatsAppMessage }))

import { scheduleReviewRequest, processDueReviewRequests, buildGoogleReviewLink } from '../../crm-automation/review-request.service'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NODE_ENV = 'test'
  delete process.env.CRM_AUTOMATION_LIVE
})

describe('buildGoogleReviewLink', () => {
  it('builds the standard Google direct-review URL from a place id', () => {
    expect(buildGoogleReviewLink('abc123')).toBe('https://search.google.com/local/writereview?placeid=abc123')
  })
})

describe('scheduleReviewRequest', () => {
  it('does nothing when review requests are not configured/active', async () => {
    prismaMock.reviewRequestConfig.findFirst.mockResolvedValue(null)
    await scheduleReviewRequest('appt-1', 'p-1')
    expect(prismaMock.reviewRequestLog.create).not.toHaveBeenCalled()
  })

  it('schedules using the configured delayHours and never double-schedules the same appointment', async () => {
    prismaMock.reviewRequestConfig.findFirst.mockResolvedValue({ isActive: true, delayHours: 24 })
    prismaMock.reviewRequestLog.findUnique.mockResolvedValueOnce(null)
    await scheduleReviewRequest('appt-1', 'p-1')
    expect(prismaMock.reviewRequestLog.create).toHaveBeenCalledWith({
      data: { patientId: 'p-1', appointmentId: 'appt-1', scheduledFor: expect.any(Date), status: 'PENDING' },
    })

    prismaMock.reviewRequestLog.findUnique.mockResolvedValueOnce({ id: 'existing' })
    await scheduleReviewRequest('appt-1', 'p-1')
    expect(prismaMock.reviewRequestLog.create).toHaveBeenCalledTimes(1)
  })
})

describe('processDueReviewRequests', () => {
  it('suppresses the request when Patient.negativeExperience is set (Part H)', async () => {
    prismaMock.reviewRequestLog.findMany.mockResolvedValueOnce([
      { id: 'log-1', patientId: 'p-1', patient: { negativeExperience: true, firstName: 'Jo', phone: '+256700000001' } },
    ])
    const result = await processDueReviewRequests()
    expect(result.suppressed).toBe(1)
    expect(prismaMock.reviewRequestLog.update).toHaveBeenCalledWith({ where: { id: 'log-1' }, data: { status: 'SUPPRESSED_NEGATIVE_EXPERIENCE' } })
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('sends in dry-run mode by default and never calls the real WhatsApp send', async () => {
    prismaMock.reviewRequestLog.findMany.mockResolvedValueOnce([
      { id: 'log-1', patientId: 'p-1', patient: { negativeExperience: false, firstName: 'Jo', phone: '+256700000001' } },
    ])
    prismaMock.reviewRequestConfig.findFirst.mockResolvedValue({ gbpPlaceId: 'place-1', reviewLinkOverride: null })

    const result = await processDueReviewRequests()

    expect(result.sent).toBe(1)
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
    expect(prismaMock.reviewRequestLog.update).toHaveBeenCalledWith({ where: { id: 'log-1' }, data: { status: 'DRY_RUN_SENT', sentAt: expect.any(Date) } })
  })
})