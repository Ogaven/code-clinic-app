import { describe, expect, it } from 'vitest'
import { antiHallucinationGuard, type ToolRecord } from '../services/agent/guards/anti-hallucination'

// [PRE-DEPLOY VERIFY] Fail-closed pricing guard — direct, unmocked tests of the
// real antiHallucinationGuard. This is the last line of defense: even if a
// model ignores every prompt instruction and states a price it should not,
// this guard must independently reject it so the caller falls back to a safe
// message instead of sending the patient a fabricated or zero price.

describe('antiHallucinationGuard — pricing must fail closed', () => {
  it('rejects "UGX 0" even when a price-lookup tool genuinely returned 0 for a real service', async () => {
    const tools: ToolRecord[] = [
      { tool: 'search_services', result: { found: true, serviceId: 's1', name: 'RECEMETING RETAINER', priceConfirmed: false, priceNote: 'not confirmed' } },
    ]
    const result = await antiHallucinationGuard('Retainer re-cementing is currently listed at UGX 0. 😊', tools)
    expect(result.safe).toBe(false)
    expect(result.reason).toMatch(/zero|non-positive/i)
  })

  it('rejects "0/-" style zero-price phrasing regardless of a genuinely zero tool-returned price', async () => {
    const tools: ToolRecord[] = [
      { tool: 'search_services', result: { found: true, serviceId: 's1', name: 'RECEMENTING CROWN', priceConfirmed: false, priceNote: 'not confirmed' } },
    ]
    const result = await antiHallucinationGuard('That one is 0/- 😊', tools)
    expect(result.safe).toBe(false)
  })

  it('accepts a price that matches a real, confirmed tool-returned price', async () => {
    const tools: ToolRecord[] = [
      { tool: 'search_services', result: { found: true, serviceId: 's1', name: 'Dental Cleaning', priceConfirmed: true, priceUGX: 80000 } },
    ]
    const result = await antiHallucinationGuard('Dental cleaning is UGX 80,000 😊', tools)
    expect(result.safe).toBe(true)
  })

  it('rejects a price that does not match any confirmed tool-returned price (fabricated/remembered number)', async () => {
    const tools: ToolRecord[] = [
      { tool: 'search_services', result: { found: true, serviceId: 's1', name: 'Dental Cleaning', priceConfirmed: true, priceUGX: 80000 } },
    ]
    const result = await antiHallucinationGuard('Dental cleaning is UGX 45,000 😊', tools)
    expect(result.safe).toBe(false)
    expect(result.reason).toMatch(/not found in database/i)
  })

  it('rejects any price mentioned with zero tool calls this turn', async () => {
    const result = await antiHallucinationGuard('That will be UGX 120,000 😊', [])
    expect(result.safe).toBe(false)
  })

  it('rejects a price mentioned without any price-lookup tool having been called this turn', async () => {
    const tools: ToolRecord[] = [
      { tool: 'get_doctors_available_today', result: { today: 'Monday', doctors: [] } },
    ]
    const result = await antiHallucinationGuard('That will be UGX 120,000 😊', tools)
    expect(result.safe).toBe(false)
    expect(result.reason).toMatch(/no price lookup tool/i)
  })

  it('rejects the reply outright when the price-lookup tool itself errored (simulated DB/timeout failure)', async () => {
    const tools: ToolRecord[] = [
      { tool: 'search_services', result: { error: 'search_services failed: connection timeout' } },
    ]
    const result = await antiHallucinationGuard('Dental cleaning is UGX 80,000 😊', tools)
    expect(result.safe).toBe(false)
    expect(result.reason).toMatch(/error/i)
  })

  it('does not fabricate a price rejection when no price is mentioned at all (no regression on normal replies)', async () => {
    const tools: ToolRecord[] = [
      { tool: 'search_services', result: { found: true, serviceId: 's1', name: 'Dental Cleaning', priceConfirmed: false, priceNote: 'not confirmed' } },
    ]
    const result = await antiHallucinationGuard(`I don't have a confirmed price for that one just yet — I'll have the team confirm it for you 😊`, tools)
    expect(result.safe).toBe(true)
  })
})
