import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock, acquisitionRevenueByDimensionMock, buildNeedsAttentionQueueMock } = vi.hoisted(() => ({
  prismaMock: {
    lead: { findMany: vi.fn(), count: vi.fn() },
    leadStageHistory: { findMany: vi.fn() },
    payment: { findMany: vi.fn() },
  },
  acquisitionRevenueByDimensionMock: vi.fn(),
  buildNeedsAttentionQueueMock: vi.fn(),
}))

vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../../crm-automation/revenue-attribution.service', () => ({ acquisitionRevenueByDimension: acquisitionRevenueByDimensionMock }))
vi.mock('../../crm-automation/needs-attention.service', () => ({ buildNeedsAttentionQueue: buildNeedsAttentionQueueMock }))

import { leadTrend, conversionTrend, revenueTrend, campaignPerformance, crmInsights } from '../../crm-automation/reporting.service'

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.lead.findMany.mockResolvedValue([])
  prismaMock.lead.count.mockResolvedValue(0)
  prismaMock.leadStageHistory.findMany.mockResolvedValue([])
  prismaMock.payment.findMany.mockResolvedValue([])
  acquisitionRevenueByDimensionMock.mockResolvedValue({ buckets: [], ambiguousPatientCount: 0 })
  buildNeedsAttentionQueueMock.mockResolvedValue({ categories: [], distinctLeadCount: 0, totalItems: 0 })
})

describe('leadTrend', () => {
  it('buckets real lead createdAt timestamps into a full day series, including zero days', async () => {
    const today = new Date()
    prismaMock.lead.findMany.mockResolvedValue([{ createdAt: today }, { createdAt: today }])
    const result = await leadTrend(7)
    expect(result.series).toHaveLength(7)
    expect(result.series[result.series.length - 1].count).toBe(2)
    expect(result.series.slice(0, 6).every(p => p.count === 0)).toBe(true)
  })

  it('queries only leads created within the requested window', async () => {
    await leadTrend(14)
    expect(prismaMock.lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { createdAt: { gte: expect.any(Date) } } })
    )
  })

  // Milestone: CRM UX/IA/Dashboard refinement — the Dashboard's new "1 year"
  // trend range option (GET .../lead-trend?days=365) depends on this
  // function genuinely handling a full year, not just the old 30-day
  // default. The route-level clamp was raised from 180 to 366 alongside
  // this to stop silently truncating a requested year to ~6 months.
  it('builds a full 365-day series without truncating (the Dashboard "1 year" range)', async () => {
    const today = new Date()
    prismaMock.lead.findMany.mockResolvedValue([{ createdAt: today }])
    const result = await leadTrend(365)
    expect(result.days).toBe(365)
    expect(result.series).toHaveLength(365)
    expect(result.series[result.series.length - 1].count).toBe(1)
  })
})

describe('conversionTrend', () => {
  it('uses LeadStageHistory.changedAt for CONVERTED transitions, not Lead.updatedAt', async () => {
    const today = new Date()
    prismaMock.leadStageHistory.findMany.mockResolvedValue([{ changedAt: today }])
    const result = await conversionTrend(7)
    expect(prismaMock.leadStageHistory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ toStage: 'CONVERTED' }) })
    )
    expect(result.series[result.series.length - 1].count).toBe(1)
  })

  it('builds a full 365-day series without truncating (the Dashboard "1 year" range)', async () => {
    const today = new Date()
    prismaMock.leadStageHistory.findMany.mockResolvedValue([{ changedAt: today }])
    const result = await conversionTrend(365)
    expect(result.days).toBe(365)
    expect(result.series).toHaveLength(365)
    expect(result.series[result.series.length - 1].count).toBe(1)
  })
})

describe('revenueTrend', () => {
  it('sums real Payment.amountUGX per month, labelled as total collected not lead-attributed', async () => {
    const now = new Date()
    prismaMock.payment.findMany.mockResolvedValue([{ paidAt: now, amountUGX: 50000 }, { paidAt: now, amountUGX: 25000 }])
    const result = await revenueTrend(3)
    expect(result.series).toHaveLength(3)
    expect(result.series[result.series.length - 1].collectedUGX).toBe(75000)
    expect(result.note).toContain('not scoped to CRM-attributed leads')
  })

  it('never fabricates a value for a month with no real payments', async () => {
    const result = await revenueTrend(3)
    expect(result.series.every(p => p.collectedUGX === 0)).toBe(true)
  })
})

describe('campaignPerformance', () => {
  it('only includes leads that actually carry a campaignId, and folds in real attributed revenue', async () => {
    prismaMock.lead.findMany.mockResolvedValueOnce([{ campaignId: 'camp-1', campaignName: 'Summer Promo' }]) // distinct campaigns
    prismaMock.lead.count
      .mockResolvedValueOnce(2) // leadCount for camp-1
      .mockResolvedValueOnce(1) // qualified
      .mockResolvedValueOnce(1) // converted
      .mockResolvedValueOnce(0) // lost
    acquisitionRevenueByDimensionMock.mockResolvedValue({ buckets: [{ key: 'camp-1', collectedUGX: 120000 } as any], ambiguousPatientCount: 0 })

    const result = await campaignPerformance()
    expect(result.campaigns).toHaveLength(1)
    expect(result.campaigns[0]).toMatchObject({ campaignId: 'camp-1', campaignName: 'Summer Promo', leadCount: 2, qualifiedCount: 1, convertedCount: 1, collectedUGX: 120000 })
  })

  it('returns an empty list, not an error, when no lead has ever been tagged with a campaign', async () => {
    prismaMock.lead.findMany.mockResolvedValueOnce([])
    const result = await campaignPerformance()
    expect(result.campaigns).toEqual([])
  })
})

describe('crmInsights', () => {
  it('generates a deterministic, plain-language insight for unanswered leads — never a fabricated forecast', async () => {
    buildNeedsAttentionQueueMock.mockResolvedValue({
      categories: [{ key: 'UNANSWERED_NEW', label: '', count: 3, scope: 'LEAD_OWNER' }],
      distinctLeadCount: 3, totalItems: 3,
    })
    const insights = await crmInsights()
    expect(insights.some(i => i.text.includes('3 leads are waiting for a first response'))).toBe(true)
    // No insight text should ever claim to be a prediction/forecast here.
    expect(insights.every(i => !/predict|forecast/i.test(i.text))).toBe(true)
  })

  it('falls back to a clear positive message when nothing needs attention', async () => {
    const insights = await crmInsights()
    expect(insights).toEqual([{ text: 'No leads currently need attention — the pipeline is clear.', tone: 'positive' }])
  })
})
