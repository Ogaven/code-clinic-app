// Regression coverage for "Campaigns -> Broadcast -> Patient Segment -> New
// Patients does not expose the date/date-range selector in production":
// the underlying request-building logic already worked, but had no dedicated
// test proving that changing From/To actually changes the segment-count
// request (as opposed to the UI silently no-oping). Extracted from the
// Campaigns page's fetchCount() so this is verifiable without rendering the
// component (no jsdom/testing-library in this project's web test setup).
//
// Note on scope: buildSegmentCountParams only shapes the segment-count GET
// request. The actual "does changing dates ever trigger a send" guarantee
// comes from the Campaigns page's own control flow, not from this function:
// handleSegment/handleNewPreset/handleCustomRangeChange (the only call sites
// that touch date state) call fetchCount() exclusively, never handleSend()
// -- POST /campaigns/whatsapp/broadcast is only ever reachable through the
// explicit Send Now/Confirm Schedule button in the preview modal, which
// calls handleSend() directly and is otherwise unreferenced by any date/
// segment change handler.

import { describe, expect, it } from 'vitest'
import { buildSegmentCountParams } from '../campaignSegmentParams'

describe('buildSegmentCountParams — New Patients date-range request shape', () => {
  it('ALL and ACTIVE never carry preset/from/to params', () => {
    expect(buildSegmentCountParams('ALL').toString()).toBe('segment=ALL')
    expect(buildSegmentCountParams('ACTIVE').toString()).toBe('segment=ACTIVE')
  })

  it('NEW with a non-custom preset carries the preset but no from/to', () => {
    const params = buildSegmentCountParams('NEW', 'week')
    expect(params.get('segment')).toBe('NEW')
    expect(params.get('preset')).toBe('week')
    expect(params.has('from')).toBe(false)
    expect(params.has('to')).toBe(false)
  })

  it('NEW defaults to the "today" preset when none is supplied yet (initial selection)', () => {
    const params = buildSegmentCountParams('NEW')
    expect(params.get('preset')).toBe('today')
  })

  it('NEW + custom preset carries both from and to in the request', () => {
    const params = buildSegmentCountParams('NEW', 'custom', '2026-09-01', '2026-09-15')
    expect(params.get('segment')).toBe('NEW')
    expect(params.get('preset')).toBe('custom')
    expect(params.get('from')).toBe('2026-09-01')
    expect(params.get('to')).toBe('2026-09-15')
  })

  it('changing From produces a genuinely different request than the previous From (regression: dates must actually reach the request)', () => {
    const before = buildSegmentCountParams('NEW', 'custom', '2026-09-01', '2026-09-15')
    const after  = buildSegmentCountParams('NEW', 'custom', '2026-09-05', '2026-09-15')
    expect(before.toString()).not.toBe(after.toString())
    expect(after.get('from')).toBe('2026-09-05')
  })

  it('changing To produces a genuinely different request than the previous To', () => {
    const before = buildSegmentCountParams('NEW', 'custom', '2026-09-01', '2026-09-15')
    const after  = buildSegmentCountParams('NEW', 'custom', '2026-09-01', '2026-09-20')
    expect(before.toString()).not.toBe(after.toString())
    expect(after.get('to')).toBe('2026-09-20')
  })

  it('every preset (today/week/month/custom) produces a distinct request for the same segment', () => {
    const requests = ['today', 'week', 'month'].map(p => buildSegmentCountParams('NEW', p).toString())
    requests.push(buildSegmentCountParams('NEW', 'custom', '2026-09-01', '2026-09-15').toString())
    expect(new Set(requests).size).toBe(4) // all four are unique -- no preset silently collapses into another
  })

  it('an empty custom range still requests segment=NEW&preset=custom (not silently falling back to a different segment)', () => {
    const params = buildSegmentCountParams('NEW', 'custom', '', '')
    expect(params.get('segment')).toBe('NEW')
    expect(params.get('preset')).toBe('custom')
    expect(params.get('from')).toBe('')
    expect(params.get('to')).toBe('')
  })
})
