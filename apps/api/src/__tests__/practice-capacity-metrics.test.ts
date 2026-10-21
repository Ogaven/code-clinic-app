import { describe, expect, it } from 'vitest'
import { availableMinutes, mergeIntervals } from '../utils/practice-capacity-metrics'

const interval = (start: number, end: number) => ({ start: start * 60000, end: end * 60000 })

describe('doctor capacity interval arithmetic', () => {
  it('returns zero without explicitly configured working time', () => {
    expect(availableMinutes([], [interval(0, 120)])).toBe(0)
  })

  it('deduplicates overlapping breaks and blocked times', () => {
    expect(availableMinutes([interval(8 * 60, 18 * 60)], [
      interval(12 * 60, 13 * 60), interval(12 * 60 + 30, 13 * 60 + 30),
    ])).toBe(510)
  })

  it('clips blocks to working hours and respects multiple shifts', () => {
    expect(availableMinutes([interval(8 * 60, 10 * 60), interval(14 * 60, 16 * 60)], [
      interval(7 * 60, 9 * 60), interval(15 * 60, 19 * 60),
    ])).toBe(120)
  })

  it('does not double-count overlapping working intervals', () => {
    expect(availableMinutes([interval(8 * 60, 10 * 60), interval(9 * 60, 11 * 60)], [])).toBe(180)
  })

  it('ignores invalid intervals and merges adjacent ones', () => {
    expect(mergeIntervals([interval(2, 1), interval(1, 2), interval(2, 3)])).toEqual([interval(1, 3)])
  })
})
