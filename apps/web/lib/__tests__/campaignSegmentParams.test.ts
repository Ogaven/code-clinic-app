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

// Milestone: CRM operational functionality closure — Issue Three. The
// registered-date ("date added") filter is a separate concept from NEW's
// own preset/from/to, and — unlike it — must combine with ANY segment.
describe('buildSegmentCountParams — registered-date filter, combinable with ANY segment', () => {
  it('ALL with a registered-date preset carries registeredPreset (previously impossible — date filter was NEW-only)', () => {
    const params = buildSegmentCountParams('ALL', undefined, undefined, undefined, 'month')
    expect(params.get('segment')).toBe('ALL')
    expect(params.get('registeredPreset')).toBe('month')
    expect(params.has('preset')).toBe(false) // NEW's own preset field must stay untouched
  })

  it('ACTIVE combines with a registered-date preset too', () => {
    const params = buildSegmentCountParams('ACTIVE', undefined, undefined, undefined, 'year')
    expect(params.get('segment')).toBe('ACTIVE')
    expect(params.get('registeredPreset')).toBe('year')
  })

  it('NEW can carry BOTH its own preset AND a registered-date preset simultaneously, as two distinct fields', () => {
    const params = buildSegmentCountParams('NEW', 'week', undefined, undefined, 'month')
    expect(params.get('preset')).toBe('week')
    expect(params.get('registeredPreset')).toBe('month')
  })

  it('a custom registered range carries registeredFrom/registeredTo', () => {
    const params = buildSegmentCountParams('ALL', undefined, undefined, undefined, 'custom', '2026-01-01', '2026-01-31')
    expect(params.get('registeredPreset')).toBe('custom')
    expect(params.get('registeredFrom')).toBe('2026-01-01')
    expect(params.get('registeredTo')).toBe('2026-01-31')
  })

  it('omitting registeredPreset entirely never adds any registered* param (default/no-filter case unchanged)', () => {
    const params = buildSegmentCountParams('ALL')
    expect(params.has('registeredPreset')).toBe(false)
    expect(params.has('registeredFrom')).toBe(false)
    expect(params.has('registeredTo')).toBe(false)
  })
})
