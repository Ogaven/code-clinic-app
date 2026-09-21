import { describe, expect, it } from 'vitest'
import { startOfKampalaDay, kampalaMonthDay, kampalaYear } from '../utils/kampala-time'

// Milestone: URGENT HOTFIX — Birthdays. Regression coverage for the "today"
// computation the birthday routes now share via this single helper, instead
// of each reimplementing toLocaleDateString(..., { timeZone: 'Africa/Kampala' })
// inline. These assertions don't depend on the test machine's own timezone —
// Africa/Kampala is a fixed UTC+3 offset with no DST, so the instant math
// below is reproducible on any CI runner.

describe('kampalaMonthDay — UTC boundary', () => {
  it('reads the Kampala calendar day, not the UTC one, in the 00:00-02:59 Kampala window', () => {
    // 2026-05-13T22:30:00Z is 2026-05-14T01:30 in Kampala (UTC+3) — UTC still
    // says the 13th, Kampala has already rolled to the 14th.
    const date = new Date('2026-05-13T22:30:00.000Z')
    expect(kampalaMonthDay(date)).toEqual({ month: 5, day: 14 })
  })

  it('agrees with UTC well away from the boundary', () => {
    const date = new Date('2026-05-14T12:00:00.000Z')
    expect(kampalaMonthDay(date)).toEqual({ month: 5, day: 14 })
  })

  it('"yesterday" and "tomorrow" relative to a fixed Kampala today are one day off in each direction', () => {
    const today     = new Date('2026-05-14T12:00:00.000Z')
    const yesterday = new Date('2026-05-13T12:00:00.000Z')
    const tomorrow  = new Date('2026-05-15T12:00:00.000Z')
    expect(kampalaMonthDay(yesterday)).toEqual({ month: 5, day: 13 })
    expect(kampalaMonthDay(today)).toEqual({ month: 5, day: 14 })
    expect(kampalaMonthDay(tomorrow)).toEqual({ month: 5, day: 15 })
  })

  it('rolls over a month/year boundary correctly (Dec 31 -> Jan 1 in Kampala)', () => {
    // 2025-12-31T21:30:00Z is 2026-01-01T00:30 in Kampala.
    const date = new Date('2025-12-31T21:30:00.000Z')
    expect(kampalaMonthDay(date)).toEqual({ month: 1, day: 1 })
  })
})

describe('kampalaYear', () => {
  it('reports the Kampala calendar year across the UTC year boundary', () => {
    expect(kampalaYear(new Date('2025-12-31T21:30:00.000Z'))).toBe(2026)
    expect(kampalaYear(new Date('2025-12-31T20:30:00.000Z'))).toBe(2025)
  })
})

describe('startOfKampalaDay', () => {
  it('returns Kampala midnight as a UTC instant (21:00 UTC the previous day)', () => {
    const date = new Date('2026-05-14T12:00:00.000Z')
    expect(startOfKampalaDay(date).toISOString()).toBe('2026-05-13T21:00:00.000Z')
  })

  it('stays on the same Kampala day for an instant already past Kampala midnight', () => {
    const date = new Date('2026-05-13T22:30:00.000Z') // 01:30 on the 14th in Kampala
    expect(startOfKampalaDay(date).toISOString()).toBe('2026-05-13T21:00:00.000Z')
  })
})
