import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

vi.setConfig({ testTimeout: 20000 })

const { prismaMock, sendWhatsAppMessage } = vi.hoisted(() => ({
  prismaMock: {
    reviewRequestConfig: { findFirst: vi.fn() },
    reviewRequestLog: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
    consentLog: { findFirst: vi.fn().mockResolvedValue(null) },
    patientConsent: { findFirst: vi.fn().mockResolvedValue(null) },
    patient: { findFirst: vi.fn() },
    patientFeedback: { findUnique: vi.fn(), create: vi.fn() },
  },
  sendWhatsAppMessage: vi.fn().mockResolvedValue('wamid-1'),
}))

vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../../ai-suite/whatsapp/whatsapp.service', () => ({ sendWhatsAppMessage }))

import { scheduleReviewRequest, processDueReviewRequests, buildGoogleReviewLink, captureReviewRatingReply } from '../../crm-automation/review-request.service'

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

describe('processDueReviewRequests — CRM_REVIEW_REQUEST_AUTOMATION_LIVE feature flag (release-blocker fix — per-feature gating)', () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV
  beforeEach(() => { process.env.NODE_ENV = 'production' })
  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV
    delete process.env.CRM_AUTOMATION_LIVE
    delete process.env.CRM_REVIEW_REQUEST_AUTOMATION_LIVE
  })

  it('master ON but REVIEW_REQUEST feature flag OFF -> scheduled but no real provider call', async () => {
    process.env.CRM_AUTOMATION_LIVE = 'true' // REVIEW_REQUEST flag deliberately not set
    prismaMock.reviewRequestLog.findMany.mockResolvedValueOnce([
      { id: 'log-1', patientId: 'p-1', patient: { negativeExperience: false, firstName: 'Jo', phone: '+256700000001' } },
    ])
    prismaMock.reviewRequestConfig.findFirst.mockResolvedValue({ gbpPlaceId: 'place-1', reviewLinkOverride: null })

    const result = await processDueReviewRequests()

    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
    expect(prismaMock.reviewRequestLog.update).toHaveBeenCalledWith({ where: { id: 'log-1' }, data: { status: 'DRY_RUN_SENT', sentAt: expect.any(Date) } })
    expect(result.sent).toBe(1)
  })

  it('master+feature ON -> a real send is attempted', async () => {
    process.env.CRM_AUTOMATION_LIVE = 'true'
    process.env.CRM_REVIEW_REQUEST_AUTOMATION_LIVE = 'true'
    prismaMock.reviewRequestLog.findMany.mockResolvedValueOnce([
      { id: 'log-1', patientId: 'p-1', patient: { negativeExperience: false, firstName: 'Jo', phone: '+256700000001' } },
    ])
    prismaMock.reviewRequestConfig.findFirst.mockResolvedValue({ gbpPlaceId: 'place-1', reviewLinkOverride: null })

    await processDueReviewRequests()

    expect(sendWhatsAppMessage).toHaveBeenCalledTimes(1)
    expect(prismaMock.reviewRequestLog.update).toHaveBeenCalledWith({ where: { id: 'log-1' }, data: { status: 'SENT', sentAt: expect.any(Date) } })
  })
})
describe('captureReviewRatingReply', () => {
  it('ignores a bare rating when there is no recent sent review request', async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 'p-1' })
    prismaMock.reviewRequestLog.findFirst.mockResolvedValue(null)
    expect(await captureReviewRatingReply('+256700000001', '5')).toBeNull()
    expect(prismaMock.patientFeedback.create).not.toHaveBeenCalled()
  })

  it('stores a recent WhatsApp rating and gives positive patients the configured Google CTA', async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 'p-1' })
    prismaMock.reviewRequestLog.findFirst.mockResolvedValue({ appointmentId: 'appt-1' })
    prismaMock.patientFeedback.findUnique.mockResolvedValue(null)
    prismaMock.reviewRequestConfig.findFirst.mockResolvedValue({ gbpPlaceId: 'place-1', reviewLinkOverride: null })
    const reply = await captureReviewRatingReply('+256700000001', '5/5')
    expect(prismaMock.patientFeedback.create).toHaveBeenCalledWith({ data: { patientId: 'p-1', appointmentId: 'appt-1', rating: 5, channel: 'WHATSAPP' } })
    expect(reply).toContain('Google review')
    expect(reply).toContain('placeid=place-1')
  })

  it('stores low ratings without sending the patient to Google', async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 'p-1' })
    prismaMock.reviewRequestLog.findFirst.mockResolvedValue({ appointmentId: 'appt-2' })
    prismaMock.patientFeedback.findUnique.mockResolvedValue(null)
    const reply = await captureReviewRatingReply('+256700000001', '2 stars')
    expect(prismaMock.patientFeedback.create).toHaveBeenCalledWith({ data: { patientId: 'p-1', appointmentId: 'appt-2', rating: 2, channel: 'WHATSAPP' } })
    expect(reply).not.toContain('Google')
  })
})
