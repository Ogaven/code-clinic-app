import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { patient: { findMany: vi.fn() } },
}))
vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))

import { listPatientReferrals } from '../../crm-automation/referrals.service'

beforeEach(() => { vi.clearAllMocks() })

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
