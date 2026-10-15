import { describe, expect, it } from 'vitest'
import { newlyCrossedAiBudgetAlerts } from './ai-budget-alerts'

describe('AI budget alert thresholds', () => {
  it('does not alert below $10 or repeatedly above thresholds', () => {
    expect(newlyCrossedAiBudgetAlerts(2, 9.99)).toEqual([])
    expect(newlyCrossedAiBudgetAlerts(10, 11)).toEqual([])
    expect(newlyCrossedAiBudgetAlerts(12, 14)).toEqual([])
  })
  it('alerts when reaching $10 and $12', () => {
    expect(newlyCrossedAiBudgetAlerts(9.99, 10)).toEqual(['warning'])
    expect(newlyCrossedAiBudgetAlerts(11.99, 12)).toEqual(['critical'])
  })
  it('emits both alerts for a jump across both thresholds', () => {
    expect(newlyCrossedAiBudgetAlerts(9, 12.5)).toEqual(['warning', 'critical'])
  })
  it('rejects invalid and reversed totals', () => {
    expect(() => newlyCrossedAiBudgetAlerts(NaN, 12)).toThrow()
    expect(() => newlyCrossedAiBudgetAlerts(12, 10)).toThrow()
    expect(() => newlyCrossedAiBudgetAlerts(-1, 2)).toThrow()
  })
})
