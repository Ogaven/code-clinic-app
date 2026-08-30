import { describe, expect, it } from 'vitest'
import { kampalaDay } from '../routes/attendance'

describe('Kampala attendance day boundaries', () => {
  it('rolls the attendance date at Kampala midnight', () => {
    expect(kampalaDay(new Date('2026-08-29T20:59:59.000Z')).date.toISOString()).toBe('2026-08-29T00:00:00.000Z')
    expect(kampalaDay(new Date('2026-08-29T21:00:00.000Z')).date.toISOString()).toBe('2026-08-30T00:00:00.000Z')
  })

  it('returns exact UTC instants for a Kampala day', () => {
    const day = kampalaDay(new Date('2026-08-30T12:00:00.000Z'))
    expect(day.start.toISOString()).toBe('2026-08-29T21:00:00.000Z')
    expect(day.end.toISOString()).toBe('2026-08-30T21:00:00.000Z')
  })
})
