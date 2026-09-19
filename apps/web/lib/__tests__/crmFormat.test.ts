import { describe, expect, it } from 'vitest'
import { formatFunnelRate, formatResponseMinutes, overallAverageResponseMinutes } from '../crmFormat'

describe('formatFunnelRate', () => {
  it('renders an unavailable dash rather than a fabricated 0% when there is no denominator', () => {
    expect(formatFunnelRate(null)).toBe('—')
  })
  it('renders a rounded percentage for a real rate', () => {
    expect(formatFunnelRate(0.5)).toBe('50%')
    expect(formatFunnelRate(0.333)).toBe('33%')
  })
})

describe('formatResponseMinutes', () => {
  it('shows whole minutes under an hour', () => {
    expect(formatResponseMinutes(42.6)).toBe('43m')
  })
  it('switches to hours at 60 minutes and above', () => {
    expect(formatResponseMinutes(90)).toBe('1.5h')
    expect(formatResponseMinutes(60)).toBe('1.0h')
  })
})

describe('overallAverageResponseMinutes', () => {
  it('returns null instead of a fabricated 0 when there is no data', () => {
    expect(overallAverageResponseMinutes(null)).toBeNull()
    expect(overallAverageResponseMinutes([])).toBeNull()
  })

  it('weights each owner by their own lead count rather than averaging averages', () => {
    // Owner A: 1 lead at 100min. Owner B: 9 leads at 10min each.
    // A naive average-of-averages would give (100+10)/2 = 55.
    // Weighted by volume: (1*100 + 9*10)/10 = 19.
    const result = overallAverageResponseMinutes([
      { leadCount: 1, avgMinutes: 100 },
      { leadCount: 9, avgMinutes: 10 },
    ])
    expect(result).toBe(19)
  })
})
