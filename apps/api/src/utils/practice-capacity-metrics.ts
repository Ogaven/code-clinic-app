/**
 * Deterministic interval arithmetic for clinical schedule capacity.
 * All inputs are instants in milliseconds, not local clock strings.
 * This module never guesses doctor working hours or patient attendance.
 */
export type TimeInterval = { start: number; end: number }

export function mergeIntervals(intervals: TimeInterval[]): TimeInterval[] {
  const valid = intervals.filter(i => Number.isFinite(i.start) && Number.isFinite(i.end) && i.end > i.start)
    .sort((a, b) => a.start - b.start)
  const merged: TimeInterval[] = []
  for (const interval of valid) {
    const last = merged[merged.length - 1]
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end)
    else merged.push({ ...interval })
  }
  return merged
}

export function availableMinutes(working: TimeInterval[], unavailable: TimeInterval[]): number {
  const work = mergeIntervals(working)
  const blocks = mergeIntervals(unavailable)
  let available = 0
  for (const shift of work) {
    let cursor = shift.start
    for (const block of blocks) {
      if (block.end <= cursor || block.start >= shift.end) continue
      if (block.start > cursor) available += block.start - cursor
      cursor = Math.max(cursor, Math.min(shift.end, block.end))
      if (cursor >= shift.end) break
    }
    if (cursor < shift.end) available += shift.end - cursor
  }
  return Math.round(available / 60000)
}

/**
 * Converts a configured Kampala local day and HH:mm clock to an instant.
 * Uganda does not observe DST. Invalid clocks and ranges are rejected.
 */
export function kampalaClockInstant(day: string, clock: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(clock)) return null
  const timestamp = Date.parse(day + 'T' + clock + ':00+03:00')
  return Number.isFinite(timestamp) ? timestamp : null
}

export function configuredShift(day: string, openTime: string | null, closeTime: string | null): TimeInterval | null {
  if (!openTime || !closeTime) return null
  const start = kampalaClockInstant(day, openTime)
  const end = kampalaClockInstant(day, closeTime)
  return start !== null && end !== null && end > start ? { start, end } : null
}
