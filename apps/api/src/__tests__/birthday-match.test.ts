import { describe, expect, it } from 'vitest'
import { isKampalaBirthdayToday, kampalaAgeTurningToday } from '../utils/birthday-match'

// Milestone: URGENT HOTFIX — Birthdays. Covers the exact inclusion rule
// required: a patient appears in "Birthdays Today" ONLY if dob is real AND
// month matches AND day matches, in Kampala's calendar date — never inferred
// from any other field, never included for a null/malformed dob.

describe('isKampalaBirthdayToday', () => {
  it('matches when dob month+day equal today\'s Kampala month+day', () => {
    const today = new Date('2026-05-14T09:00:00.000Z')
    expect(isKampalaBirthdayToday('1990-05-14T00:00:00.000Z', today)).toBe(true)
  })

  it('does not match a dob one day before today (Kampala)', () => {
    const today = new Date('2026-05-14T09:00:00.000Z')
    expect(isKampalaBirthdayToday('1990-05-13T00:00:00.000Z', today)).toBe(false)
  })

  it('does not match a dob one day after today (Kampala)', () => {
    const today = new Date('2026-05-14T09:00:00.000Z')
    expect(isKampalaBirthdayToday('1990-05-15T00:00:00.000Z', today)).toBe(false)
  })

  it('matches at the UTC boundary where Kampala has already rolled to the next day', () => {
    // 22:30 UTC on the 13th is 01:30 on the 14th in Kampala.
    const today = new Date('2026-05-13T22:30:00.000Z')
    expect(isKampalaBirthdayToday('1990-05-14T00:00:00.000Z', today)).toBe(true)
    expect(isKampalaBirthdayToday('1990-05-13T00:00:00.000Z', today)).toBe(false)
  })

  it('does not shift a date-only YYYY-MM-DD dob to the previous day', () => {
    const today = new Date('2026-05-14T09:00:00.000Z')
    expect(isKampalaBirthdayToday('1990-05-14', today)).toBe(true)
  })

  it('excludes a missing dob (null/undefined/empty) — never inferred from any other field', () => {
    const today = new Date('2026-05-14T09:00:00.000Z')
    expect(isKampalaBirthdayToday(null, today)).toBe(false)
    expect(isKampalaBirthdayToday(undefined, today)).toBe(false)
    expect(isKampalaBirthdayToday('', today)).toBe(false)
  })

  it('excludes a malformed/unusable dob string instead of throwing or matching', () => {
    const today = new Date('2026-05-14T09:00:00.000Z')
    expect(isKampalaBirthdayToday('not-a-date', today)).toBe(false)
    expect(isKampalaBirthdayToday('0000-00-00', today)).toBe(false)
  })

  it('leap-day dob: matches only on an actual Feb 29 (leap year), never substitutes Feb 28 or Mar 1', () => {
    const leapDob = '2000-02-29T00:00:00.000Z'
    expect(isKampalaBirthdayToday(leapDob, new Date('2028-02-29T09:00:00.000Z'))).toBe(true) // 2028 is a leap year
    expect(isKampalaBirthdayToday(leapDob, new Date('2027-02-28T09:00:00.000Z'))).toBe(false) // 2027 is not
    expect(isKampalaBirthdayToday(leapDob, new Date('2027-03-01T09:00:00.000Z'))).toBe(false)
  })
})

describe('kampalaAgeTurningToday', () => {
  it('computes the age using Kampala\'s calendar year for "now" vs. the dob\'s UTC year', () => {
    expect(kampalaAgeTurningToday('2000-05-14T00:00:00.000Z', new Date('2026-05-14T09:00:00.000Z'))).toBe(26)
  })

  it('uses the already-rolled-over Kampala year at the UTC year boundary', () => {
    // 2025-12-31T21:30:00Z is already 2026-01-01 in Kampala.
    expect(kampalaAgeTurningToday('2000-01-01T00:00:00.000Z', new Date('2025-12-31T21:30:00.000Z'))).toBe(26)
  })
})
