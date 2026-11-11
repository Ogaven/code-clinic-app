import { describe, expect, it } from 'vitest'
import { withinLeadAlertHours } from './lead-alert-hours'

describe('routine staff lead push window in Africa/Kampala', () => {
  it('blocks notifications before 07:00 EAT', () => {
    expect(withinLeadAlertHours(new Date('2026-11-11T03:59:59Z'))).toBe(false)
  })
  it('allows notifications at 07:00 EAT', () => {
    expect(withinLeadAlertHours(new Date('2026-11-11T04:00:00Z'))).toBe(true)
  })
  it('allows notifications through 17:59 EAT', () => {
    expect(withinLeadAlertHours(new Date('2026-11-11T14:59:59Z'))).toBe(true)
  })
  it('blocks notifications at 18:00 EAT and overnight', () => {
    expect(withinLeadAlertHours(new Date('2026-11-11T15:00:00Z'))).toBe(false)
    expect(withinLeadAlertHours(new Date('2026-11-11T21:00:00Z'))).toBe(false)
  })
})
