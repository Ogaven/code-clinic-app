import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  reserveBudgetAtomic: vi.fn(),
  settleBudgetAtomic: vi.fn(),
  markBudgetOutcomeUnknown: vi.fn(),
}))
vi.mock('./ai-budget-postgres', () => mocks)
import { runMeteredOpenAiRequest } from './openai-metered-request'

const db = {} as PrismaClient
const usage = { inputTokens: 120, outputTokens: 25, cachedInputTokens: 20 }

describe('OpenAI metered request gateway', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.reserveBudgetAtomic.mockResolvedValue({ month: '2026-10', warnings: [] })
    mocks.settleBudgetAtomic.mockResolvedValue({ overrun: false })
    mocks.markBudgetOutcomeUnknown.mockResolvedValue(undefined)
  })

  it('rejects invalid reservations before any provider call', async () => {
    const execute = vi.fn()
    await expect(runMeteredOpenAiRequest(db, {
      reserveUsd: 0, actualCostUsd: () => 0.001, execute,
    })).rejects.toThrow('Invalid verified OpenAI cost reservation')
    expect(execute).not.toHaveBeenCalled()
  })

  it('does not invoke OpenAI if budget reservation fails', async () => {
    mocks.reserveBudgetAtomic.mockRejectedValue(new Error('budget exhausted'))
    const execute = vi.fn()
    await expect(runMeteredOpenAiRequest(db, {
      reserveUsd: 0.02, actualCostUsd: () => 0.001, execute,
    })).rejects.toThrow('budget exhausted')
    expect(execute).not.toHaveBeenCalled()
  })

  it('settles only after verified usage and cost', async () => {
    const execute = vi.fn().mockResolvedValue({ usage, output: 'ok' })
    const result = await runMeteredOpenAiRequest(db, {
      reserveUsd: 0.02, actualCostUsd: () => 0.004, execute,
    })
    expect(result.actualUsd).toBe(0.004)
    expect(result.result.usage.inputTokens).toBe(120)
    expect(mocks.reserveBudgetAtomic).toHaveBeenCalledWith(db, expect.objectContaining({ provider: 'openai' }))
    expect(mocks.settleBudgetAtomic).toHaveBeenCalledWith(db, expect.objectContaining({ actualUsd: 0.004 }))
    expect(mocks.markBudgetOutcomeUnknown).not.toHaveBeenCalled()
  })

  it('retains funds when upstream call fails', async () => {
    await expect(runMeteredOpenAiRequest(db, {
      reserveUsd: 0.02, actualCostUsd: () => 0.004,
      execute: async () => { throw new Error('provider timeout') },
    })).rejects.toThrow('provider timeout')
    expect(mocks.markBudgetOutcomeUnknown).toHaveBeenCalledOnce()
    expect(mocks.settleBudgetAtomic).not.toHaveBeenCalled()
  })

  it('retains funds when provider usage is missing', async () => {
    await expect(runMeteredOpenAiRequest(db, {
      reserveUsd: 0.02, actualCostUsd: () => 0.004,
      execute: async () => ({ usage: { inputTokens: 0, outputTokens: 0 } }),
    })).rejects.toThrow('Missing or invalid OpenAI billable usage')
    expect(mocks.markBudgetOutcomeUnknown).toHaveBeenCalledOnce()
  })

  it('retains funds when verified cost is invalid', async () => {
    await expect(runMeteredOpenAiRequest(db, {
      reserveUsd: 0.02, actualCostUsd: () => Number.NaN,
      execute: async () => ({ usage }),
    })).rejects.toThrow('Unverifiable OpenAI provider cost')
    expect(mocks.markBudgetOutcomeUnknown).toHaveBeenCalledOnce()
  })
})
