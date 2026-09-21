import { kampalaMonthDay, kampalaYear } from './kampala-time'

// Patient.dob is stored as a UTC-midnight DateTime — the intended calendar
// date is encoded directly in its UTC Y/M/D (see apps/web/lib/dob.ts for the
// matching frontend convention). Reading it back via getUTCMonth()/getUTCDate()
// recovers that exact calendar date regardless of server/process timezone.

/**
 * True only when `dob` is a real, parseable date AND its stored calendar
 * month+day exactly match `date`'s Kampala calendar month+day. Never infers
 * a birthday from any other field (createdAt, appointments, age, etc.) — a
 * missing or malformed dob always returns false, never true.
 *
 * Leap-day rule: a Feb 29 dob matches ONLY on an actual Feb 29 (i.e. only in
 * leap years). In non-leap years this deliberately does not fire on Feb 28
 * or Mar 1 — inventing a substitute date would mean sending/showing a
 * "birthday today" on a day that isn't actually the patient's birthday of
 * record. The patient's age still advances (see kampalaAgeTurningToday /
 * apps/web/lib/dob.ts ageFromDob) even in years the alert doesn't fire.
 */
export function isKampalaBirthdayToday(dob: Date | string | null | undefined, date: Date = new Date()): boolean {
  if (!dob) return false
  const d = dob instanceof Date ? dob : new Date(dob)
  if (isNaN(d.getTime())) return false
  const today = kampalaMonthDay(date)
  return d.getUTCMonth() + 1 === today.month && d.getUTCDate() === today.day
}

/** Age a patient turns on their birthday, using Kampala's calendar year. */
export function kampalaAgeTurningToday(dob: Date | string, date: Date = new Date()): number {
  const d = dob instanceof Date ? dob : new Date(dob)
  return kampalaYear(date) - d.getUTCFullYear()
}
