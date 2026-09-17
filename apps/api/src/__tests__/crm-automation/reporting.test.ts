import { beforeEach, describe, expect, it, vi } from 'vitest'

const { count } = vi.hoisted(() => ({ count: vi.fn() }))
vi.mock('../../lib/prisma', () => ({ prisma: { lead: { count } } }))
import { stageConversionRates } from '../../crm-automation/reporting.service'

// Synthetic recorded milestones. Query evaluation deliberately keeps duplicate
// transitions so an implementation that counts events would overstate rates.
let leads: { history: string[] }[] = []
function matches(lead: typeof leads[number], where: any): boolean {
  if (!where) return true
  if (where.AND) return where.AND.every((condition: any) => matches(lead, condition))
  if (where.stageHistory?.none) return lead.history.length === 0
  return lead.history.includes(where.stageHistory.some.toStage)
}
beforeEach(() => {
  leads = []
  count.mockReset().mockImplementation(async (query?: any) => leads.filter(lead => matches(lead, query?.where)).length)
})

describe('stage conversion — unique leads and documented milestone cohorts', () => {
  it('does not count repeated stage entries twice', async () => {
    leads = [
      { history: ['CONTACTED', 'QUALIFIED', 'LOST', 'CONTACTED', 'QUALIFIED', 'CONVERTED'] },
      { history: ['CONTACTED'] },
      { history: [] },
    ]
    const report = await stageConversionRates()
    expect(report.totals).toEqual({ totalNew: 3, contactedCount: 2, qualifiedCount: 1, convertedCount: 1 })
    expect(report.newToContactedRate).toBeCloseTo(2 / 3)
    expect(report.contactedToQualifiedRate).toBe(0.5)
    expect(report.qualifiedToConvertedRate).toBe(1)
    expect(report.leadsWithoutStageHistory).toBe(1)
  })

  it('does not invent earlier stages for direct qualification or conversion', async () => {
    leads = [
      { history: ['CONTACTED'] },
      { history: ['QUALIFIED', 'CONVERTED'] },
      { history: ['CONVERTED'] },
      { history: ['CONVERTED'] },
    ]
    const report = await stageConversionRates()
    expect(report.contactedToQualifiedRate).toBe(0)
    expect(report.qualifiedToConvertedRate).toBe(1)
    expect(report.totals.convertedCount).toBe(3)
    expect(report.cohorts).toEqual({ qualifiedFromContactedCount: 0, convertedFromQualifiedCount: 1 })
    expect(report.note).toContain('does not prove attendance')
  })

  it('shows unavailable rates when no denominator exists', async () => {
    expect(await stageConversionRates()).toMatchObject({
      newToContactedRate: null, contactedToQualifiedRate: null, qualifiedToConvertedRate: null,
    })
    leads = [{ history: [] }]
    expect(await stageConversionRates()).toMatchObject({
      newToContactedRate: 0, contactedToQualifiedRate: null, qualifiedToConvertedRate: null,
      leadsWithoutStageHistory: 1,
    })
  })
})
