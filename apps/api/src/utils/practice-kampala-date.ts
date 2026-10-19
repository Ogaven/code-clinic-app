/** Validate YYYY-MM-DD against the Kampala calendar, including leap days. */
export function isValidKampalaCalendarDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const midnight = new Date(date + 'T00:00:00+03:00')
  return !Number.isNaN(midnight.getTime()) &&
    new Date(midnight.getTime() + 12 * 60 * 60 * 1000).toISOString().slice(0, 10) === date
}
