import { afterEach, describe, expect, it } from 'vitest'
import { parseDob } from '../routes/patients'

// Milestone: URGENT HOTFIX — Birthdays. Root cause: parseDob()'s last-resort
// native-Date fallback (used for CSV/Sheet import rows whose date text
// doesn't match any of the explicit formats above it) silently rolled the
// stored dob back one calendar day whenever process.env.TZ was a positive
// UTC offset (main.ts pins it to Africa/Kampala, UTC+3) — because V8's
// legacy non-ISO parser reads a bare date string as LOCAL midnight, and the
// old code returned that Date object as-is instead of re-anchoring it to UTC
// midnight of the same calendar date like every other branch does.

const ORIGINAL_TZ = process.env.TZ

afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ
  else process.env.TZ = ORIGINAL_TZ
})

function isoDateOnly(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null
}

describe('parseDob — date-only YYYY-MM-DD never shifts a day', () => {
  it('parses to the exact calendar date regardless of process.env.TZ', () => {
    process.env.TZ = 'Africa/Kampala'
    expect(isoDateOnly(parseDob('1990-06-15'))).toBe('1990-06-15')
  })
})

describe('parseDob — last-resort native-parse fallback (the actual root cause)', () => {
  it('does not roll a "15 June 1990"-style date back a day under TZ=Africa/Kampala', () => {
    process.env.TZ = 'Africa/Kampala'
    expect(isoDateOnly(parseDob('15 June 1990'))).toBe('1990-06-15')
  })

  it('gives the identical result under TZ=UTC (parser is TZ-agnostic by construction)', () => {
    process.env.TZ = 'UTC'
    expect(isoDateOnly(parseDob('15 June 1990'))).toBe('1990-06-15')
  })

  it('gives the identical result under a negative-offset TZ too', () => {
    process.env.TZ = 'America/New_York'
    expect(isoDateOnly(parseDob('15 June 1990'))).toBe('1990-06-15')
  })
})

describe('parseDob — explicit formats already covered (regression guard, unaffected by the fix)', () => {
  it('DD-MM-YYYY', () => {
    expect(isoDateOnly(parseDob('15-06-1990'))).toBe('1990-06-15')
  })

  it('DD/MM/YYYY (day > 12, unambiguous)', () => {
    expect(isoDateOnly(parseDob('15/06/1990'))).toBe('1990-06-15')
  })

  it('"Month DD, YYYY"', () => {
    expect(isoDateOnly(parseDob('June 15, 1990'))).toBe('1990-06-15')
  })

  it('Excel serial date', () => {
    expect(isoDateOnly(parseDob('32831'))).toBe('1989-11-19')
  })
})

describe('parseDob — missing/malformed/unusable input', () => {
  it('returns null for an empty or whitespace-only string', () => {
    expect(parseDob('')).toBeNull()
    expect(parseDob('   ')).toBeNull()
  })

  it('returns null for text that is not a date in any recognized format', () => {
    expect(parseDob('not a date')).toBeNull()
  })

  it('returns null for an out-of-range year instead of returning a garbage date', () => {
    expect(parseDob('15 June 1850')).toBeNull()
  })
})
