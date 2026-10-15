import { describe, expect, it, vi } from 'vitest'
import { listPendingAiBudgetAlerts } from './ai-budget-alert-outbox'

describe('pending AI budget alert reader', () => {
  it('reads only pending alerts in bounded batches without mutating them', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: 'alert-1', monthKey: '2026-10', level: 'warning', createdAt: new Date('2026-10-15T10:00:00Z') },
    ])
    const result = await listPendingAiBudgetAlerts({ aiBudgetAlert: { findMany } } as any, 10)
    expect(result).toHaveLength(1)
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'PENDING' },
      take: 10,
    }))
  })
  it('rejects unbounded batch sizes before database access', async () => {
    const findMany = vi.fn()
    await expect(listPendingAiBudgetAlerts({ aiBudgetAlert: { findMany } } as any, 101)).rejects.toThrow()
    expect(findMany).not.toHaveBeenCalled()
  })
  it('fails closed on unexpected alert levels', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: 'x', monthKey: '2026-10', level: 'unexpected', createdAt: new Date() },
    ])
    await expect(listPendingAiBudgetAlerts({ aiBudgetAlert: { findMany } } as any)).rejects.toThrow()
  })
})
