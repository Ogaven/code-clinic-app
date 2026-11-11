import { describe, expect, it } from 'vitest'
import { withinLeadAlertHours, withinTreatmentFollowupAlertHours } from './lead-alert-hours'

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

describe('routine treatment follow-up staff alert window in Africa/Kampala', () => {
  it('blocks staff alerts before 09:00 EAT', () => {
    expect(withinTreatmentFollowupAlertHours(new Date('2026-11-11T05:59:59Z'))).toBe(false)
  })
  it('allows staff alerts at 09:00 EAT', () => {
    expect(withinTreatmentFollowupAlertHours(new Date('2026-11-11T06:00:00Z'))).toBe(true)
  })
  it('allows staff alerts through 17:59 EAT', () => {
    expect(withinTreatmentFollowupAlertHours(new Date('2026-11-11T14:59:59Z'))).toBe(true)
  })
  it('blocks staff alerts at 18:00 EAT', () => {
    expect(withinTreatmentFollowupAlertHours(new Date('2026-11-11T15:00:00Z'))).toBe(false)
  })
})
