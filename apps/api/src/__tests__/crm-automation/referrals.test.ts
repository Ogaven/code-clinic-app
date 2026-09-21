import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { patient: { findMany: vi.fn(), groupBy: vi.fn() } },
}))
vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))

import { listPatientReferrals, isPatientReferralSourceText, legacyReferralSourceOverview } from '../../crm-automation/referrals.service'

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.patient.groupBy.mockResolvedValue([]) // no legacy source data by default — existing tests below don't exercise it
})

describe('listPatientReferrals', () => {
  it('only includes patients whose referral source is PATIENT_REFERRAL with a real linked referrer', async () => {
    prismaMock.patient.findMany.mockResolvedValue([
      {
        id: 'p1', firstName: 'Jane', lastName: 'Doe', phone: '+256700000001', tagsUpdatedAt: new Date('2026-01-01'),
        treatmentPlanStatus: 'ACCEPTED', crmReferredByPatient: { id: 'ref-1', firstName: 'Mary', lastName: 'Smith' },
      },
    ])
    const result = await listPatientReferrals()
    expect(result.referrals).toHaveLength(1)
    expect(result.referrals[0]).toMatchObject({
      referredPatientId: 'p1', referredPatientName: 'Jane Doe',
      referringPatientId: 'ref-1', referringPatientName: 'Mary Smith',
      treatmentPlanStatus: 'ACCEPTED',
    })
    expect(prismaMock.patient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { crmReferralSource: 'PATIENT_REFERRAL', crmReferredByPatientId: { not: null } } })
    )
  })

  it('excludes a row if the referring patient relation somehow failed to resolve (never fabricates a referrer)', async () => {
    prismaMock.patient.findMany.mockResolvedValue([
      { id: 'p1', firstName: 'A', lastName: 'B', phone: '1', tagsUpdatedAt: null, treatmentPlanStatus: 'NONE', crmReferredByPatient: null },
    ])
    const result = await listPatientReferrals()
    expect(result.referrals).toEqual([])
  })

  it('ranks top referrers by real referral count, not alphabetically or by recency', async () => {
    const referrer = { id: 'ref-1', firstName: 'Mary', lastName: 'Smith' }
    prismaMock.patient.findMany.mockResolvedValue([
      { id: 'p1', firstName: 'A', lastName: 'A', phone: '1', tagsUpdatedAt: new Date(), treatmentPlanStatus: 'NONE', crmReferredByPatient: referrer },
      { id: 'p2', firstName: 'B', lastName: 'B', phone: '2', tagsUpdatedAt: new Date(), treatmentPlanStatus: 'NONE', crmReferredByPatient: referrer },
      { id: 'p3', firstName: 'C', lastName: 'C', phone: '3', tagsUpdatedAt: new Date(), treatmentPlanStatus: 'NONE', crmReferredByPatient: { id: 'ref-2', firstName: 'X', lastName: 'Y' } },
    ])
    const result = await listPatientReferrals()
    expect(result.topReferrers[0]).toMatchObject({ patientId: 'ref-1', count: 2 })
    expect(result.topReferrers[1]).toMatchObject({ patientId: 'ref-2', count: 1 })
  })

  it('does not compute or claim any revenue-per-referral figure', async () => {
    prismaMock.patient.findMany.mockResolvedValue([
      { id: 'p1', firstName: 'A', lastName: 'B', phone: '1', tagsUpdatedAt: new Date(), treatmentPlanStatus: 'ACCEPTED', crmReferredByPatient: { id: 'ref-1', firstName: 'M', lastName: 'S' } },
    ])
    const result = await listPatientReferrals()
    expect(result.referrals[0]).not.toHaveProperty('revenue')
    expect(result.referrals[0]).not.toHaveProperty('collectedUGX')
  })
})

// Milestone: CRM operational functionality closure — Issue Four (restore
// Referrals). The dashboard/referrals-page discrepancy's real fix is
// reconciling semantics, not fabricating data — these KPIs are derived
// purely from the already-fetched `referrals` rows above, no new query,
// no new field, no guessing.
describe('listPatientReferrals — summary KPIs (Issue Four)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-21T12:00:00.000Z')) // Kampala UTC+3 -> Sept 21
  })
  afterEach(() => { vi.useRealTimers() })

  it('totalReferred and uniqueReferrers count the real rows, not a guessed/rounded figure', async () => {
    const referrer = { id: 'ref-1', firstName: 'Mary', lastName: 'Smith' }
    prismaMock.patient.findMany.mockResolvedValue([
      { id: 'p1', firstName: 'A', lastName: 'A', phone: '1', tagsUpdatedAt: new Date('2026-09-10'), treatmentPlanStatus: 'NONE', crmReferredByPatient: referrer },
      { id: 'p2', firstName: 'B', lastName: 'B', phone: '2', tagsUpdatedAt: new Date('2026-09-10'), treatmentPlanStatus: 'NONE', crmReferredByPatient: referrer },
      { id: 'p3', firstName: 'C', lastName: 'C', phone: '3', tagsUpdatedAt: new Date('2026-09-10'), treatmentPlanStatus: 'NONE', crmReferredByPatient: { id: 'ref-2', firstName: 'X', lastName: 'Y' } },
    ])
    const result = await listPatientReferrals()
    expect(result.summary.totalReferred).toBe(3)
    expect(result.summary.uniqueReferrers).toBe(2)
  })

  it('newThisMonth only counts referrals recorded within the current Kampala month', async () => {
    prismaMock.patient.findMany.mockResolvedValue([
      { id: 'p1', firstName: 'A', lastName: 'A', phone: '1', tagsUpdatedAt: new Date('2026-09-05'), treatmentPlanStatus: 'NONE', crmReferredByPatient: { id: 'ref-1', firstName: 'M', lastName: 'S' } },
      { id: 'p2', firstName: 'B', lastName: 'B', phone: '2', tagsUpdatedAt: new Date('2026-08-15'), treatmentPlanStatus: 'NONE', crmReferredByPatient: { id: 'ref-1', firstName: 'M', lastName: 'S' } },
    ])
    const result = await listPatientReferrals()
    expect(result.summary.newThisMonth).toBe(1)
  })

  it('convertedTreatment reuses the real treatmentPlanStatus:ACCEPTED signal, not a referral-local definition', async () => {
    prismaMock.patient.findMany.mockResolvedValue([
      { id: 'p1', firstName: 'A', lastName: 'A', phone: '1', tagsUpdatedAt: new Date(), treatmentPlanStatus: 'ACCEPTED', crmReferredByPatient: { id: 'ref-1', firstName: 'M', lastName: 'S' } },
      { id: 'p2', firstName: 'B', lastName: 'B', phone: '2', tagsUpdatedAt: new Date(), treatmentPlanStatus: 'PROPOSED', crmReferredByPatient: { id: 'ref-1', firstName: 'M', lastName: 'S' } },
    ])
    const result = await listPatientReferrals()
    expect(result.summary.convertedTreatment).toBe(1)
  })

  it('every summary figure is zero, never undefined or fabricated, when there are no referrals at all', async () => {
    prismaMock.patient.findMany.mockResolvedValue([])
    const result = await listPatientReferrals()
    expect(result.summary).toEqual({ totalReferred: 0, uniqueReferrers: 0, newThisMonth: 0, convertedTreatment: 0 })
  })
})

// Milestone: CRM Data/Role-Parity closure. The clinic's real referral data
// lives on the legacy Patient.referralSource free-text field (866 real
// production patients), populated since before crmReferralSource/
// crmReferredByPatientId existed — these tests cover the classifier and
// the reconciliation layer that surfaces it without fabricating a specific
// referrer identity the data doesn't actually name.
describe('isPatientReferralSourceText — classifies real production values correctly', () => {
  it('matches clear patient/word-of-mouth referral phrasing', () => {
    expect(isPatientReferralSourceText('Friends and Family')).toBe(true)
    expect(isPatientReferralSourceText('Word of mouth')).toBe(true)
    expect(isPatientReferralSourceText('Patient Referral')).toBe(true)
    expect(isPatientReferralSourceText('Referred by Friend / Family')).toBe(true)
  })

  it('does NOT match a professional/provider referral — a distinct concept', () => {
    expect(isPatientReferralSourceText('Doctor referral')).toBe(false)
  })

  it('does not match digital channels or institutional partners', () => {
    expect(isPatientReferralSourceText('Google Search')).toBe(false)
    expect(isPatientReferralSourceText('Instagram')).toBe(false)
    expect(isPatientReferralSourceText('NWSC')).toBe(false)
    expect(isPatientReferralSourceText('BNI')).toBe(false)
    expect(isPatientReferralSourceText('Walk-in')).toBe(false)
  })
})

describe('legacyReferralSourceOverview', () => {
  it('reports the real referralSource breakdown verbatim, never re-categorized', async () => {
    prismaMock.patient.groupBy.mockResolvedValue([
      { referralSource: 'Friends and Family', _count: 464 },
      { referralSource: 'Instagram', _count: 50 },
    ])
    const result = await legacyReferralSourceOverview()
    expect(result.sourceBreakdown).toEqual([
      { source: 'Friends and Family', count: 464 },
      { source: 'Instagram', count: 50 },
    ])
    expect(result.totalWithSourceRecorded).toBe(514)
  })

  it('sums only patient-referral-like categories into patientReferralUnknownCount, never crmReferredByPatientId-derived numbers', async () => {
    prismaMock.patient.groupBy.mockResolvedValue([
      { referralSource: 'Friends and Family', _count: 464 },
      { referralSource: 'Word of mouth', _count: 9 },
      { referralSource: 'Google Search', _count: 11 },
    ])
    prismaMock.patient.findMany.mockResolvedValue([])
    const result = await legacyReferralSourceOverview()
    expect(result.patientReferralUnknownCount).toBe(473) // 464 + 9, Google excluded
  })

  it('never queries or sets crmReferredByPatientId — the unknown-referrer list is READ-only against referralSource', async () => {
    prismaMock.patient.groupBy.mockResolvedValue([{ referralSource: 'Patient Referral', _count: 1 }])
    prismaMock.patient.findMany.mockResolvedValue([
      { id: 'p1', firstName: 'A', lastName: 'B', referralSource: 'Patient Referral', createdAt: new Date() },
    ])
    await legacyReferralSourceOverview()
    expect(prismaMock.patient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ crmReferredByPatientId: null }) })
    )
  })

  it('returns an empty overview, not an error, when no patient has any referralSource set', async () => {
    prismaMock.patient.groupBy.mockResolvedValue([])
    const result = await legacyReferralSourceOverview()
    expect(result).toEqual({ totalWithSourceRecorded: 0, sourceBreakdown: [], patientReferralUnknownCount: 0, patientReferralUnknownRecent: [] })
  })
})

describe('listPatientReferrals — reconciliation with legacy data', () => {
  it('includes legacySource alongside the existing known-referrer fields, never replacing them', async () => {
    prismaMock.patient.findMany.mockResolvedValue([]) // no known crmReferredByPatientId links
    prismaMock.patient.groupBy.mockResolvedValue([{ referralSource: 'Friends and Family', _count: 464 }])
    const result = await listPatientReferrals()
    expect(result.referrals).toEqual([]) // still honestly empty — no fabricated referrer link
    expect(result.legacySource.totalWithSourceRecorded).toBe(464)
    expect(result.legacySource.patientReferralUnknownCount).toBe(464)
  })
})
