import { beforeEach, describe, expect, it, vi } from 'vitest'

const { findMany, count } = vi.hoisted(() => ({ findMany: vi.fn(), count: vi.fn() }))
vi.mock('../../lib/prisma', () => ({ prisma: { lead: { findMany, count } } }))
import { sourcePerformance, lostReasonsBreakdown } from '../../crm-automation/reporting.service'

interface FakeLead { source: string; status: string; history: string[] }
let leads: FakeLead[] = []

function matchesCount(lead: FakeLead, where: any): boolean {
  if (!where) return true
  if (where.source !== undefined && lead.source !== where.source) return false
  if (where.status !== undefined && lead.status !== where.status) return false
  if (where.stageHistory?.some?.toStage && !lead.history.includes(where.stageHistory.some.toStage)) return false
  return true
}

beforeEach(() => {
  leads = []
  findMany.mockImplementation(async (query?: any) => {
    if (query?.distinct) {
      return [...new Set(leads.map(l => l.source))].map(source => ({ source }))
    }
    return leads.filter(l => matchesCount(l, query?.where)).map(l => ({ lossReason: (l as any).lossReason ?? null }))
  })
  count.mockImplementation(async (query?: any) => leads.filter(l => matchesCount(l, query?.where)).length)
})

describe('sourcePerformance — per-source Lead/Qualified/Converted/Lost counts', () => {
  it('groups distinct sources with independent stage-history-backed counts', async () => {
    leads = [
      { source: 'WHATSAPP', status: 'QUALIFIED', history: ['CONTACTED', 'QUALIFIED'] },
      { source: 'WHATSAPP', status: 'LOST', history: ['CONTACTED'] },
      { source: 'WEBSITE', status: 'CONVERTED', history: ['CONTACTED', 'QUALIFIED', 'CONVERTED'] },
    ]
    const report = await sourcePerformance()
    expect(report.sources).toEqual(expect.arrayContaining([
      { source: 'WHATSAPP', leadCount: 2, qualifiedCount: 1, convertedCount: 0, lostCount: 1 },
      { source: 'WEBSITE', leadCount: 1, qualifiedCount: 1, convertedCount: 1, lostCount: 0 },
    ]))
    // Sorted by leadCount descending
    expect(report.sources[0].source).toBe('WHATSAPP')
  })

  it('returns an empty list rather than fabricating a source with zero leads', async () => {
    leads = []
    const report = await sourcePerformance()
    expect(report.sources).toEqual([])
  })
})

describe('lostReasonsBreakdown — verbatim reason grouping, no invented taxonomy', () => {
  it('groups current LOST leads by their exact recorded reason', async () => {
    leads = [
      { source: 'WHATSAPP', status: 'LOST', history: [], lossReason: 'Price' } as any,
      { source: 'WEBSITE', status: 'LOST', history: [], lossReason: 'Price' } as any,
      { source: 'WHATSAPP', status: 'LOST', history: [], lossReason: null } as any,
      { source: 'WHATSAPP', status: 'QUALIFIED', history: [], lossReason: null } as any,
    ]
    const report = await lostReasonsBreakdown()
    expect(report.totalLost).toBe(3)
    expect(report.reasons).toEqual([
      { reason: 'Price', count: 2 },
      { reason: 'Not specified', count: 1 },
    ])
  })
})
