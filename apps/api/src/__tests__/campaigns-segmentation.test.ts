import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

// Regression coverage for the Campaigns audience-selector redesign: the
// primary selector now offers only All/Active/New Patients (was 8 status
// codes), Active keeps its existing patient.status-based definition
// untouched, and New reuses patient-analytics.service's canonical
// "first attended appointment in range" definition rather than inventing a
// campaign-local one.

const { getPatientsSeenMock, splitNewAndReturningMock } = vi.hoisted(() => ({
  getPatientsSeenMock: vi.fn(),
  splitNewAndReturningMock: vi.fn(),
}))

vi.mock('../services/patient-analytics.service', () => ({
  getPatientsSeen: getPatientsSeenMock,
  splitNewAndReturning: splitNewAndReturningMock,
}))

vi.mock('../lib/prisma', () => ({ prisma: {} }))
vi.mock('openai', () => ({ default: vi.fn().mockImplementation(() => ({})) }))
vi.mock('../ai-suite/whatsapp/whatsapp.service', () => ({
  sendWhatsAppMessage: vi.fn(), sendWhatsAppMessageDirect: vi.fn(), sendWhatsAppTemplate: vi.fn(),
}))

import {
  BROADCAST_SEGMENTS, parseTargetSegment, encodeTargetSegment, resolveRange,
  segmentWhere, newPatientIdsForSpec, type SegmentSpec,
} from '../routes/campaigns'
import { kampalaTodayRange, kampalaWeekToDateRange, kampalaMonthToDateRange } from '../utils/kampala-time'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('BROADCAST_SEGMENTS', () => {
  it('is narrowed to exactly All/Active/New — the redesigned primary selector', () => {
    expect(BROADCAST_SEGMENTS).toEqual(['ALL', 'ACTIVE', 'NEW'])
  })
})

describe('parseTargetSegment / encodeTargetSegment round-trip', () => {
  it('encodes a legacy/plain segment (ALL, ACTIVE, or any old status code) as a bare string', () => {
    expect(encodeTargetSegment({ segment: 'ACTIVE' })).toBe('ACTIVE')
    expect(encodeTargetSegment({ segment: 'LAPSED' })).toBe('LAPSED')
  })

  it('encodes NEW as JSON carrying the preset/range', () => {
    const encoded = encodeTargetSegment({ segment: 'NEW', preset: 'week' })
    expect(JSON.parse(encoded)).toEqual({ segment: 'NEW', preset: 'week' })
  })

  it('parses a legacy plain-string segment back correctly (old scheduled campaigns predate JSON encoding)', () => {
    expect(parseTargetSegment('LAPSED')).toEqual({ segment: 'LAPSED' })
    expect(parseTargetSegment('ACTIVE')).toEqual({ segment: 'ACTIVE' })
  })

  it('parses a JSON-encoded NEW+range segment back correctly', () => {
    const raw = encodeTargetSegment({ segment: 'NEW', preset: 'custom', from: '2026-09-01', to: '2026-09-18' })
    expect(parseTargetSegment(raw)).toEqual({ segment: 'NEW', preset: 'custom', from: '2026-09-01', to: '2026-09-18' })
  })

  it('defaults a null/missing targetSegment to ALL (never crashes on an old campaign with no segment recorded)', () => {
    expect(parseTargetSegment(null)).toEqual({ segment: 'ALL' })
    expect(parseTargetSegment(undefined)).toEqual({ segment: 'ALL' })
  })
})

describe('segmentWhere — Active Patients definition is untouched', () => {
  it('ALL is only gated on having a phone number', () => {
    expect(segmentWhere('ALL')).toEqual({ phone: { not: '' } })
  })

  it('ACTIVE filters on patient.status, the same column patient-status.service.ts computes nightly (completed appointment within 90 days) — not reimplemented here', () => {
    expect(segmentWhere('ACTIVE')).toEqual({ phone: { not: '' }, status: 'ACTIVE' })
  })

  it('still resolves legacy status codes for already-scheduled campaigns created before this redesign', () => {
    expect(segmentWhere('LAPSED')).toEqual({ phone: { not: '' }, status: 'LAPSED' })
    expect(segmentWhere('BALANCE_OWING')).toEqual({ phone: { not: '' }, status: 'BALANCE_OWING' })
  })
})

describe('resolveRange — preset resolution', () => {
  // Fixed "now" so today/week/month presets are deterministic and directly
  // comparable to calling the real kampala-time helper at the same instant —
  // this also confirms resolveRange delegates rather than reimplementing
  // Kampala day/week/month math locally.
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-16T12:00:00.000Z')) // a Wednesday
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('"today" matches kampalaTodayRange', () => {
    expect(resolveRange({ segment: 'NEW', preset: 'today' })).toEqual(kampalaTodayRange())
  })

  it('"week" matches kampalaWeekToDateRange', () => {
    expect(resolveRange({ segment: 'NEW', preset: 'week' })).toEqual(kampalaWeekToDateRange())
  })

  it('"month" matches kampalaMonthToDateRange', () => {
    expect(resolveRange({ segment: 'NEW', preset: 'month' })).toEqual(kampalaMonthToDateRange())
  })

  it('"custom" builds a range from the given from/to calendar dates, ignoring "now"', () => {
    const range = resolveRange({ segment: 'NEW', preset: 'custom', from: '2026-09-01', to: '2026-09-18' })
    expect(range.start.toISOString()).toBe('2026-08-31T21:00:00.000Z') // 2026-09-01 00:00 Kampala (UTC+3)
    expect(range.end.toISOString()).toBe('2026-09-18T21:00:00.000Z')   // 2026-09-19 00:00 Kampala (UTC+3)
  })
})

describe('newPatientIdsForSpec — reuses patient-analytics.service, not a campaign-local definition', () => {
  it('passes the resolved range to getPatientsSeen and returns the newIds bucket from splitNewAndReturning', async () => {
    getPatientsSeenMock.mockResolvedValue({ count: 2, patientIds: ['p1', 'p2'] })
    splitNewAndReturningMock.mockResolvedValue({ newIds: ['p1'], returningIds: ['p2'] })

    const spec: SegmentSpec = { segment: 'NEW', preset: 'week' }
    const ids = await newPatientIdsForSpec(spec)

    expect(getPatientsSeenMock).toHaveBeenCalled()
    expect(splitNewAndReturningMock).toHaveBeenCalledWith(['p1', 'p2'], expect.any(Date))
    expect(ids).toEqual(['p1'])
  })
})
