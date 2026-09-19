// Shared date-of-birth formatting/age helpers.
//
// Patient.dob is stored as a UTC-midnight DateTime (see
// packages/database/prisma/schema.prisma) — the intended calendar date is
// encoded as e.g. 1990-05-14T00:00:00.000Z. Any code that reads it back with
// LOCAL-timezone getters (new Date(dob).getDate(), .getFullYear(), or
// .toLocaleDateString() with no explicit timeZone) rolls it back onto the
// previous calendar day for any browser west of UTC (which is most of them —
// Kampala itself is UTC+3, so even clinic staff on-site are affected for any
// dob stored with a non-zero time component, and any US/EU browser is
// affected unconditionally). This exact bug has recurred multiple times
// because DOB formatting was copy-pasted ad hoc into 5+ files instead of
// using one shared helper — always import from here instead of hand-rolling
// `new Date(dob).getDate()`.
const KAMPALA_TZ = 'Africa/Kampala'

function utcDateParts(dob: string | Date): { year: number; month: number; day: number } {
  const d = new Date(dob)
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() }
}

// "Today" in the clinic's own timezone, not the visiting browser's — matters
// for age math at the Dec 31/Jan 1 boundary, not just for reading dob itself.
export function kampalaToday(): { year: number; month: number; day: number } {
  const iso = new Date().toLocaleDateString('en-CA', { timeZone: KAMPALA_TZ }) // 'YYYY-MM-DD'
  const [year, month, day] = iso.split('-').map(Number)
  return { year, month: month - 1, day }
}

export function formatDob(dob: string | Date | null | undefined, locale = 'en-GB'): string {
  if (!dob) return 'N/A'
  const { year, month, day } = utcDateParts(dob)
  return new Date(Date.UTC(year, month, day)).toLocaleDateString(locale, { timeZone: 'UTC' })
}

export function ageFromDob(dob: string | Date | null | undefined): number | null {
  if (!dob) return null
  const b = utcDateParts(dob)
  const t = kampalaToday()
  let age = t.year - b.year
  if (t.month < b.month || (t.month === b.month && t.day < b.day)) age--
  return age
}
