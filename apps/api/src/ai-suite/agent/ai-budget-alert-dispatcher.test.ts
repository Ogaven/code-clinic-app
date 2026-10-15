import { describe, expect, it, vi } from 'vitest'
import { dispatchPendingAiBudgetAlerts } from './ai-budget-alert-dispatcher'

const row = (id: string) => ({ id, monthKey: '2026-10', level: 'warning', createdAt: new Date() })

describe('AI budget alert dispatcher', () => {
  it('acknowledges only successfully delivered alerts', async () => {
    const findMany = vi.fn().mockResolvedValue([row('ok'), row('fail')])
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    const db = { aiBudgetAlert: { findMany, updateMany } } as any
    const deliver = vi.fn(async (alert: { id: string }) => {
      if (alert.id === 'fail') throw new Error('delivery failed')
    })
    expect(await dispatchPendingAiBudgetAlerts(db, deliver)).toEqual({ delivered: 1, failed: 1 })
    expect(updateMany).toHaveBeenCalledTimes(1)
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'ok', status: 'PENDING' },
    }))
  })
  it('does not acknowledge an uncertain delivery', async () => {
    const updateMany = vi.fn()
    const db = { aiBudgetAlert: { findMany: vi.fn().mockResolvedValue([row('unknown')]), updateMany } } as any
    const result = await dispatchPendingAiBudgetAlerts(db, async () => { throw new Error('timeout') })
    expect(result).toEqual({ delivered: 0, failed: 1 })
    expect(updateMany).not.toHaveBeenCalled()
  })
  it('does nothing when no pending alerts exist', async () => {
    const db = { aiBudgetAlert: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn() } } as any
    const deliver = vi.fn()
    expect(await dispatchPendingAiBudgetAlerts(db, deliver)).toEqual({ delivered: 0, failed: 0 })
    expect(deliver).not.toHaveBeenCalled()
  })
})
