import { describe, expect, it } from 'vitest'
import { reserveAiBudget, settleAiBudget, type BudgetLedgerState } from './ai-budget-ledger'

const empty = (): BudgetLedgerState => ({
  spent: { openaiSpentUsd: 0, deepseekSpentUsd: 0 },
  reservations: [],
})

describe('AI budget reservation transitions', () => {
  it('reserves, settles, and releases a request', () => {
    const first = reserveAiBudget(empty(), { id: 'req-1', provider: 'deepseek', reservedUsd: 1 })
    expect(first.allowed).toBe(true)
    if (!first.allowed) return
    const settled = settleAiBudget(first.state, 'req-1', 0.4)
    expect(settled.overrun).toBe(false)
    expect(settled.state.spent.deepseekSpentUsd).toBe(0.4)
    expect(settled.state.reservations).toEqual([])
  })
  it('counts outstanding reservations against provider limit', () => {
    const first = reserveAiBudget(empty(), { id: 'one', provider: 'deepseek', reservedUsd: 4.5 })
    expect(first.allowed).toBe(true)
    if (!first.allowed) return
    const second = reserveAiBudget(first.state, { id: 'two', provider: 'deepseek', reservedUsd: 1 })
    expect(second.allowed).toBe(false)
    if (!second.allowed) expect(second.reason).toBe('provider_limit')
  })
  it('rejects duplicate request IDs', () => {
    const first = reserveAiBudget(empty(), { id: 'one', provider: 'openai', reservedUsd: 1 })
    expect(first.allowed).toBe(true)
    if (!first.allowed) return
    expect(reserveAiBudget(first.state, { id: 'one', provider: 'openai', reservedUsd: 1 }).allowed).toBe(false)
  })
  it('fails closed on invalid costs', () => {
    expect(reserveAiBudget(empty(), { id: 'one', provider: 'openai', reservedUsd: NaN }).allowed).toBe(false)
    expect(() => settleAiBudget(empty(), 'unknown', 0.1)).toThrow('Unknown')
  })
  it('reports when a request costs more than its reservation', () => {
    const first = reserveAiBudget(empty(), { id: 'one', provider: 'openai', reservedUsd: 0.2 })
    expect(first.allowed).toBe(true)
    if (!first.allowed) return
    expect(settleAiBudget(first.state, 'one', 0.3).overrun).toBe(true)
  })
})
