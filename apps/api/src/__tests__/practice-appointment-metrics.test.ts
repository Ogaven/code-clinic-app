import { describe, expect, it } from 'vitest'
import { summarizeBookedIntervals } from '../utils/practice-appointment-metrics'

const date = (time: string) => new Date('2026-10-21T' + time + ':00+03:00')
const start = date('08:00')
const end = date('18:00')

describe('practice appointment occupancy (read only)', () => {
  it('returns zero when no appointments exist', () => {
    expect(summarizeBookedIntervals([], start, end)).toEqual({
      summedBookedMinutes: 0, uniqueBookedMinutes: 0, overlappingMinutes: 0,
    })
  })

  it('deduplicates overlap for the same doctor', () => {
    const result = summarizeBookedIntervals([
      { doctorId: 'a', startAt: date('09:00'), endAt: date('10:00') },
      { doctorId: 'a', startAt: date('09:30'), endAt: date('10:30') },
    ], start, end)
    expect(result).toEqual({
      summedBookedMinutes: 120, uniqueBookedMinutes: 90, overlappingMinutes: 30,
    })
  })

  it('counts simultaneous bookings for different doctors separately', () => {
    const result = summarizeBookedIntervals([
      { doctorId: 'a', startAt: date('09:00'), endAt: date('10:00') },
      { doctorId: 'b', startAt: date('09:00'), endAt: date('10:00') },
    ], start, end)
    expect(result).toEqual({
      summedBookedMinutes: 120, uniqueBookedMinutes: 120, overlappingMinutes: 0,
    })
  })

  it('clips intervals to the report window and ignores invalid intervals', () => {
    const result = summarizeBookedIntervals([
      { doctorId: 'a', startAt: date('07:00'), endAt: date('08:30') },
      { doctorId: 'a', startAt: date('17:30'), endAt: date('19:00') },
      { doctorId: 'a', startAt: date('12:00'), endAt: date('11:00') },
    ], start, end)
    expect(result).toEqual({
      summedBookedMinutes: 60, uniqueBookedMinutes: 60, overlappingMinutes: 0,
    })
  })
})
