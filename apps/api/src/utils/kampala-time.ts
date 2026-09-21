// Single source of truth for Africa/Kampala (UTC+3, no DST) day/week/month
// boundaries. Every "today" / "this week" / "month to date" calculation in
// reporting, dashboards, and confirmations must go through this file instead
// of `new Date()` (which follows the host process's TZ) so numbers don't
// silently shift at UTC midnight instead of Kampala midnight.

const KAMPALA_TZ = 'Africa/Kampala'
const KAMPALA_OFFSET_MS = 3 * 60 * 60 * 1000 // UTC+3, fixed, no DST

/** Returns the wall-clock Y/M/D/H/M/S for `date` as observed in Kampala. */
function kampalaParts(date: Date) {
  const shifted = new Date(date.getTime() + KAMPALA_OFFSET_MS)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(), // 0-indexed
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    weekday: shifted.getUTCDay(), // 0=Sun..6=Sat
  }
}

/** UTC instant corresponding to a given Kampala-local Y/M/D 00:00. */
function kampalaMidnightUtc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day, 0, 0, 0, 0) - KAMPALA_OFFSET_MS)
}

/** Start of the Kampala calendar day containing `date` (defaults to now). */
export function startOfKampalaDay(date: Date = new Date()): Date {
  const { year, month, day } = kampalaParts(date)
  return kampalaMidnightUtc(year, month, day)
}

/**
 * Calendar month (1-12) and day (1-31) for `date` as observed in Kampala.
 * Use this for "is it their birthday" comparisons instead of hand-rolling
 * `toLocaleDateString(..., { timeZone: 'Africa/Kampala' })` inline — that
 * pattern has drifted/duplicated across the birthday code paths before.
 */
export function kampalaMonthDay(date: Date = new Date()): { month: number; day: number } {
  const { month, day } = kampalaParts(date)
  return { month: month + 1, day }
}

/** Calendar year for `date` as observed in Kampala. */
export function kampalaYear(date: Date = new Date()): number {
  return kampalaParts(date).year
}

/** Start of the next Kampala calendar day after the one containing `date`. */
export function endOfKampalaDay(date: Date = new Date()): Date {
  const start = startOfKampalaDay(date)
  return new Date(start.getTime() + 24 * 60 * 60 * 1000)
}

/** [start, end) for "tomorrow" in Kampala time, relative to `date` (defaults to now). */
export function kampalaTomorrowRange(date: Date = new Date()): { start: Date; end: Date } {
  const start = endOfKampalaDay(date)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return { start, end }
}

/** Monday 00:00 Kampala of the week containing `date`. */
export function startOfKampalaWeek(date: Date = new Date()): Date {
  const { year, month, day, weekday } = kampalaParts(date)
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday
  const monday = new Date(Date.UTC(year, month, day + mondayOffset))
  return kampalaMidnightUtc(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate())
}

/** 1st of the month 00:00 Kampala containing `date`. */
export function startOfKampalaMonth(date: Date = new Date()): Date {
  const { year, month } = kampalaParts(date)
  return kampalaMidnightUtc(year, month, 1)
}

/** Jan 1st 00:00 Kampala of the year containing `date`. */
export function startOfKampalaYear(date: Date = new Date()): Date {
  const { year } = kampalaParts(date)
  return kampalaMidnightUtc(year, 0, 1)
}

/** 1st of the previous month 00:00 Kampala, relative to `date`. */
export function startOfPreviousKampalaMonth(date: Date = new Date()): Date {
  const { year, month } = kampalaParts(date)
  return kampalaMidnightUtc(year, month - 1, 1)
}

/** 1st of the next month 00:00 Kampala, relative to `date`. */
export function startOfNextKampalaMonth(date: Date = new Date()): Date {
  const { year, month } = kampalaParts(date)
  return kampalaMidnightUtc(year, month + 1, 1)
}

export interface DateRange {
  start: Date
  end: Date
}

/** [today 00:00, tomorrow 00:00) in Kampala time. */
export function kampalaTodayRange(date: Date = new Date()): DateRange {
  return { start: startOfKampalaDay(date), end: endOfKampalaDay(date) }
}

/** [Monday 00:00 this week, now] in Kampala time. */
export function kampalaWeekToDateRange(date: Date = new Date()): DateRange {
  return { start: startOfKampalaWeek(date), end: date }
}

/** The 7-day window immediately preceding the current week-to-date window, same length. */
export function kampalaPreviousWeekToDateRange(date: Date = new Date()): DateRange {
  const thisWeekStart = startOfKampalaWeek(date)
  const start = new Date(thisWeekStart.getTime() - 7 * 24 * 60 * 60 * 1000)
  const end = new Date(date.getTime() - 7 * 24 * 60 * 60 * 1000)
  return { start, end }
}

/** [1st of month 00:00, now] in Kampala time — "month to date". */
export function kampalaMonthToDateRange(date: Date = new Date()): DateRange {
  return { start: startOfKampalaMonth(date), end: date }
}

/** [Jan 1st 00:00, now] in Kampala time — "year to date". */
export function kampalaYearToDateRange(date: Date = new Date()): DateRange {
  return { start: startOfKampalaYear(date), end: date }
}

/**
 * The same number of days into the previous month as `date` is into the
 * current month, e.g. "14 Sep MTD" vs "1-14 Aug" — used for fair trend
 * comparisons instead of comparing a partial month to a full one.
 */
export function kampalaPreviousMonthToDateRange(date: Date = new Date()): DateRange {
  const { day } = kampalaParts(date)
  const prevMonthStart = startOfPreviousKampalaMonth(date)
  const { year, month } = kampalaParts(prevMonthStart)
  const end = kampalaMidnightUtc(year, month, Math.min(day + 1, 28))
  return { start: prevMonthStart, end }
}

/** Safe percentage change: null when there is no meaningful baseline. */
export function safePercentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null
  return Math.round(((current - previous) / previous) * 1000) / 10
}
