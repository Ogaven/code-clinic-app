import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatDob, ageFromDob, kampalaToday } from '../dob'

// Regression coverage for the recurring "birthday is a day early" bug: dob is
// stored as a UTC-midnight DateTime, so any local-timezone getter can shift
// it back a calendar day. These helpers must always read dob via UTC
// accessors, regardless of the machine's own timezone (which is exactly why
// these assertions don't need to fake a specific TZ — getUTC* is TZ-agnostic
// by definition, so a bug here would fail identically on every CI machine).

describe('formatDob', () => {
  it('formats a UTC-midnight dob without shifting to the previous day', () => {
    expect(formatDob('1990-05-14T00:00:00.000Z')).toBe('14/05/1990')
  })

  it('formats a dob with a late UTC time component without shifting forward or back', () => {
    // The exact class of value that broke before c5029f1: a non-midnight UTC
    // timestamp late enough in the day that a local-timezone getter run in a
    // timezone west of UTC would land on the previous calendar day.
    expect(formatDob('1990-05-14T23:30:00.000Z')).toBe('14/05/1990')
  })

  it('returns N/A for a missing dob', () => {
    expect(formatDob(null)).toBe('N/A')
    expect(formatDob(undefined)).toBe('N/A')
  })
})

describe('ageFromDob', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('computes age using Kampala "today", not the birthday not yet reached this year', () => {
    vi.setSystemTime(new Date('2026-05-13T12:00:00.000Z')) // one day before the birthday, Kampala time
    expect(ageFromDob('2000-05-14T00:00:00.000Z')).toBe(25)
  })

  it('increments age on the birthday itself', () => {
    vi.setSystemTime(new Date('2026-05-14T12:00:00.000Z'))
    expect(ageFromDob('2000-05-14T00:00:00.000Z')).toBe(26)
  })

  it('returns null for a missing dob', () => {
    expect(ageFromDob(null)).toBeNull()
  })
})

describe('kampalaToday', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reads the clinic-local calendar date, not the UTC one, near the UTC day boundary', () => {
    // 22:30 UTC on the 13th is already 01:30 on the 14th in Africa/Kampala (UTC+3).
    vi.setSystemTime(new Date('2026-05-13T22:30:00.000Z'))
    expect(kampalaToday()).toEqual({ year: 2026, month: 4, day: 14 })
  })
})
