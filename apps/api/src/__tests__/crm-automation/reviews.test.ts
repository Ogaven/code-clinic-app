import { describe, expect, it, vi, beforeEach } from 'vitest'

// Milestone: CRM Data/Role-Parity closure. The Reviews workspace previously
// only exposed the ReviewRequestConfig settings form — there was no list
// view at all, even though real PatientFeedback data exists in production
// (20 real ratings). reviewsOverview() surfaces it, kept separate from the
// (genuinely, correctly empty until activated) outbound review-request log.

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    patientFeedback: { findMany: vi.fn() },
    reviewRequestLog: { findMany: vi.fn() },
  },
}))
vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))

import { reviewsOverview } from '../../crm-automation/reviews.service'

beforeEach(() => { vi.clearAllMocks() })

describe('reviewsOverview', () => {
  it('returns real feedback entries with computed average rating and breakdown', async () => {
    prismaMock.patientFeedback.findMany.mockResolvedValue([
      { id: 'f1', rating: 5, comment: 'Great!', channel: 'WHATSAPP', submittedAt: new Date('2026-09-01'), patient: { id: 'p1', firstName: 'Jane', lastName: 'Doe' } },
      { id: 'f2', rating: 3, comment: null, channel: 'WHATSAPP', submittedAt: new Date('2026-09-02'), patient: { id: 'p2', firstName: 'John', lastName: 'Smith' } },
    ])
    prismaMock.reviewRequestLog.findMany.mockResolvedValue([])

    const result = await reviewsOverview()

    expect(result.feedback.totalCount).toBe(2)
    expect(result.feedback.averageRating).toBe(4)
    expect(result.feedback.ratingBreakdown).toEqual({ 5: 1, 3: 1 })
    expect(result.feedback.recent[0].patientName).toBe('Jane Doe')
  })

  it('averageRating is null, not NaN or a fabricated number, when there is no feedback', async () => {
    prismaMock.patientFeedback.findMany.mockResolvedValue([])
    prismaMock.reviewRequestLog.findMany.mockResolvedValue([])
    const result = await reviewsOverview()
    expect(result.feedback.averageRating).toBeNull()
    expect(result.feedback.totalCount).toBe(0)
  })

  it('reports review-request activity by status separately from patient feedback — never conflated', async () => {
    prismaMock.patientFeedback.findMany.mockResolvedValue([])
    prismaMock.reviewRequestLog.findMany.mockResolvedValue([
      { status: 'SENT' }, { status: 'SENT' }, { status: 'PENDING' },
    ])
    const result = await reviewsOverview()
    expect(result.reviewRequests.totalCount).toBe(3)
    expect(result.reviewRequests.byStatus).toEqual({ SENT: 2, PENDING: 1 })
  })

  it('genuinely empty review-request log (config never activated) reports zero honestly, not an error', async () => {
    prismaMock.patientFeedback.findMany.mockResolvedValue([])
    prismaMock.reviewRequestLog.findMany.mockResolvedValue([])
    const result = await reviewsOverview()
    expect(result.reviewRequests.totalCount).toBe(0)
    expect(result.reviewRequests.byStatus).toEqual({})
  })

  it('limits recent feedback to the 20 most recent entries', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      id: `f${i}`, rating: 5, comment: null, channel: 'WHATSAPP', submittedAt: new Date(),
      patient: { id: `p${i}`, firstName: 'A', lastName: 'B' },
    }))
    prismaMock.patientFeedback.findMany.mockResolvedValue(rows)
    prismaMock.reviewRequestLog.findMany.mockResolvedValue([])
    const result = await reviewsOverview()
    expect(result.feedback.recent).toHaveLength(20)
    expect(result.feedback.totalCount).toBe(30)
  })
})
