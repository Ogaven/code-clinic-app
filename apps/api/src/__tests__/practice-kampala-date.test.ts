import { describe, expect, it } from 'vitest'
import { isValidKampalaCalendarDate } from '../utils/practice-kampala-date'

describe('practice reporting Kampala calendar dates', () => {
  it.each(['2026-10-19', '2026-01-01', '2026-12-31', '2026-02-28', '2028-02-29', '2026-04-30'])('accepts valid Kampala date %s', date => {
    expect(isValidKampalaCalendarDate(date)).toBe(true)
  })
  it.each(['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-01-00', '2026-01-32', '2026-1-1', 'not-a-date', ''])('rejects invalid Kampala date %s', date => {
    expect(isValidKampalaCalendarDate(date)).toBe(false)
  })
  it('keeps Kampala midnight on its requested calendar day despite UTC being the previous date', () => {
    const midnight = new Date('2026-10-19T00:00:00+03:00')
    expect(midnight.toISOString()).toBe('2026-10-18T21:00:00.000Z')
    expect(isValidKampalaCalendarDate('2026-10-19')).toBe(true)
  })
})
