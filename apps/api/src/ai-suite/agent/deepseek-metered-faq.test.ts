import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'

const mock = vi.hoisted(() => ({
  selectSafeAiRoute: vi.fn(),
  reserveBudgetAtomic: vi.fn(),
  settleBudgetAtomic: vi.fn(),
  markBudgetOutcomeUnknown: vi.fn(),
  completeRoutineWithDeepSeek: vi.fn(),
}))
vi.mock('./safe-routing', () => ({ selectSafeAiRoute: mock.selectSafeAiRoute }))
vi.mock('./ai-budget-postgres', () => ({
  reserveBudgetAtomic: mock.reserveBudgetAtomic,
  settleBudgetAtomic: mock.settleBudgetAtomic,
  markBudgetOutcomeUnknown: mock.markBudgetOutcomeUnknown,
}))
vi.mock('./deepseek-client', () => ({ completeRoutineWithDeepSeek: mock.completeRoutineWithDeepSeek }))

import { runMeteredPublicDeepSeekFaq } from './deepseek-metered-faq'

const db = {} as PrismaClient
const pricing = { reserveUsd: 0.01, actualCostUsd: () => 0.002 }

describe('metered public FAQ isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mock.selectSafeAiRoute.mockReturnValue({ provider: 'deepseek', approvedPrompt: 'Where is Code Clinic located?' })
    mock.reserveBudgetAtomic.mockResolvedValue({ month: '2026-10', warnings: [] })
    mock.completeRoutineWithDeepSeek.mockResolvedValue({ text: 'Ask clinic staff for confirmed location.', inputTokens: 20, outputTokens: 10 })
    mock.settleBudgetAtomic.mockResolvedValue({ overrun: false })
    mock.markBudgetOutcomeUnknown.mockResolvedValue(undefined)
  })

  it('does not call DeepSeek when routing gate rejects it', async () => {
    mock.selectSafeAiRoute.mockReturnValue({ provider: 'openai', approvedPrompt: null })
    await expect(runMeteredPublicDeepSeekFaq(db, 'clinic_location', pricing)).rejects.toThrow('not enabled')
    expect(mock.reserveBudgetAtomic).not.toHaveBeenCalled()
    expect(mock.completeRoutineWithDeepSeek).not.toHaveBeenCalled()
  })

  it('does not send anything when reservation is denied', async () => {
    mock.reserveBudgetAtomic.mockRejectedValue(new Error('budget exhausted'))
    await expect(runMeteredPublicDeepSeekFaq(db, 'clinic_location', pricing)).rejects.toThrow('budget exhausted')
    expect(mock.completeRoutineWithDeepSeek).not.toHaveBeenCalled()
  })

  it('passes only fixed public prompt and settles provider usage', async () => {
    const result = await runMeteredPublicDeepSeekFaq(db, 'clinic_location', pricing)
    const messages = mock.completeRoutineWithDeepSeek.mock.calls[0][0]
    expect(messages[1]).toEqual({ role: 'user', content: 'Where is Code Clinic located?' })
    expect(mock.reserveBudgetAtomic).toHaveBeenCalledWith(db, expect.objectContaining({ provider: 'deepseek', estimatedUsd: 0.01 }))
    expect(mock.settleBudgetAtomic).toHaveBeenCalledWith(db, expect.objectContaining({ month: '2026-10', actualUsd: 0.002 }))
    expect(result.outputTokens).toBe(10)
    expect(mock.markBudgetOutcomeUnknown).not.toHaveBeenCalled()
  })

  it('retains reservation when upstream request fails', async () => {
    mock.completeRoutineWithDeepSeek.mockRejectedValue(new Error('timeout'))
    await expect(runMeteredPublicDeepSeekFaq(db, 'clinic_location', pricing)).rejects.toThrow('timeout')
    expect(mock.markBudgetOutcomeUnknown).toHaveBeenCalledWith(db, expect.objectContaining({ month: '2026-10' }))
    expect(mock.settleBudgetAtomic).not.toHaveBeenCalled()
  })

  it('rejects missing price reservation before provider calls', async () => {
    await expect(runMeteredPublicDeepSeekFaq(db, 'clinic_location', { ...pricing, reserveUsd: 0 })).rejects.toThrow('Invalid verified pricing')
    expect(mock.reserveBudgetAtomic).not.toHaveBeenCalled()
  })
})
