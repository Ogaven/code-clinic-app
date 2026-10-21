/**
 * Read-only appointment occupancy calculation.
 * Appointment status filters are applied by the caller. This helper measures
 * unique scheduled time per dentist; it never assumes scheduled time is worked
 * time, and it never infers available dentist capacity.
 */
export type AppointmentInterval = {
  doctorId: string
  startAt: Date
  endAt: Date
}

export function summarizeBookedIntervals(
  appointments: AppointmentInterval[],
  rangeStart: Date,
  rangeEnd: Date,
): { summedBookedMinutes: number; uniqueBookedMinutes: number; overlappingMinutes: number } {
  const byDoctor = new Map<string, Array<[number, number]>>()
  let summedMilliseconds = 0
  for (const appointment of appointments) {
    const start = Math.max(appointment.startAt.getTime(), rangeStart.getTime())
    const end = Math.min(appointment.endAt.getTime(), rangeEnd.getTime())
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue
    summedMilliseconds += end - start
    const intervals = byDoctor.get(appointment.doctorId) ?? []
    intervals.push([start, end])
    byDoctor.set(appointment.doctorId, intervals)
  }
  let uniqueMilliseconds = 0
  for (const intervals of byDoctor.values()) {
    intervals.sort((a, b) => a[0] - b[0])
    let left = -Infinity
    let right = -Infinity
    for (const [start, end] of intervals) {
      if (start > right) {
        if (right > left) uniqueMilliseconds += right - left
        left = start
        right = end
      } else {
        right = Math.max(right, end)
      }
    }
    if (right > left) uniqueMilliseconds += right - left
  }
  return {
    summedBookedMinutes: Math.round(summedMilliseconds / 60000),
    uniqueBookedMinutes: Math.round(uniqueMilliseconds / 60000),
    overlappingMinutes: Math.round((summedMilliseconds - uniqueMilliseconds) / 60000),
  }
}
