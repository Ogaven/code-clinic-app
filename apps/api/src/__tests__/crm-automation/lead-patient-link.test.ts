import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.setConfig({ testTimeout: 20000 })

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    lead: { findFirst: vi.fn(), update: vi.fn(), findUniqueOrThrow: vi.fn() },
    leadStageHistory: { create: vi.fn() },
    automationEvent: { create: vi.fn().mockResolvedValue({ id: 'evt' }), update: vi.fn() },
    sequenceEnrollment: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
    scheduledTouch: { updateMany: vi.fn() },
  },
}))

vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))

import { resolveQualifiedLeadForPatient, checkAndConvertLeadOnBooking, checkAndConvertLeadOnTreatmentStart, checkAndConvertLeadsForPatients } from '../../crm-automation/lead-patient-link.service'

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.sequenceEnrollment.findMany.mockResolvedValue([])
})

describe('resolveQualifiedLeadForPatient — matching order (no name-only matching)', () => {
  it('tier 1: an explicit convertedToPatientId link wins, even without checking phone', async () => {
    prismaMock.lead.findFirst.mockResolvedValueOnce({ id: 'lead-1', status: 'QUALIFIED', convertedToPatientId: 'patient-1' })
    const lead = await resolveQualifiedLeadForPatient({ id: 'patient-1', phone: '+256700000000' })
    expect(lead?.id).toBe('lead-1')
    expect(prismaMock.lead.findFirst).toHaveBeenCalledTimes(1)
    expect(prismaMock.lead.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { convertedToPatientId: 'patient-1', status: 'QUALIFIED' },
    }))
  })

  it('tier 2: falls back to a normalized-phone match when no explicit link exists', async () => {
    prismaMock.lead.findFirst
      .mockResolvedValueOnce(null) // tier 1 miss
      .mockResolvedValueOnce({ id: 'lead-2', status: 'QUALIFIED', phone: '0700000000' }) // tier 2 hit
    const lead = await resolveQualifiedLeadForPatient({ id: 'patient-1', phone: '+256700000000' })
    expect(lead?.id).toBe('lead-2')
    const tier2Call = prismaMock.lead.findFirst.mock.calls[1][0]
    expect(tier2Call.where.status).toBe('QUALIFIED')
    expect(Array.isArray(tier2Call.where.phone.in)).toBe(true)
  })

  it('never matches by name — returns null when there is no phone at all', async () => {
    prismaMock.lead.findFirst.mockResolvedValueOnce(null)
    const lead = await resolveQualifiedLeadForPatient({ id: 'patient-1', phone: '' as any })
    expect(lead).toBeNull()
    expect(prismaMock.lead.findFirst).toHaveBeenCalledTimes(1) // only the tier-1 explicit-link check ran
  })

  it('returns null when neither tier finds a QUALIFIED lead', async () => {
    prismaMock.lead.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    const lead = await resolveQualifiedLeadForPatient({ id: 'patient-1', phone: '+256700000000' })
    expect(lead).toBeNull()
  })
})

describe('checkAndConvertLeadOnBooking / checkAndConvertLeadOnTreatmentStart — Part N conversion', () => {
  it('converts a matched QUALIFIED lead and links it to the booking patient', async () => {
    prismaMock.lead.findFirst.mockResolvedValueOnce({ id: 'lead-1', status: 'QUALIFIED', convertedToPatientId: null })
    prismaMock.lead.findUniqueOrThrow.mockResolvedValue({ id: 'lead-1', status: 'QUALIFIED', lossReason: null })
    prismaMock.lead.update.mockResolvedValue({ id: 'lead-1', status: 'CONVERTED' })

    await checkAndConvertLeadOnBooking({ id: 'patient-1', phone: '+256700000000' })

    expect(prismaMock.lead.update).toHaveBeenCalledWith({ where: { id: 'lead-1' }, data: { convertedToPatientId: 'patient-1' } })
    expect(prismaMock.leadStageHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ toStage: 'CONVERTED', trigger: 'AUTOMATION' }) })
    )
  })

  it('treatment-start uses the identical matching + conversion behavior as booking', async () => {
    prismaMock.lead.findFirst.mockResolvedValueOnce({ id: 'lead-1', status: 'QUALIFIED', convertedToPatientId: null })
    prismaMock.lead.findUniqueOrThrow.mockResolvedValue({ id: 'lead-1', status: 'QUALIFIED', lossReason: null })
    prismaMock.lead.update.mockResolvedValue({ id: 'lead-1', status: 'CONVERTED' })

    await checkAndConvertLeadOnTreatmentStart({ id: 'patient-1', phone: '+256700000000' })

    expect(prismaMock.leadStageHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ toStage: 'CONVERTED' }) })
    )
  })

  it('does nothing when no matching lead exists', async () => {
    prismaMock.lead.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    await checkAndConvertLeadOnBooking({ id: 'patient-1', phone: '+256700000000' })
    expect(prismaMock.lead.update).not.toHaveBeenCalled()
    expect(prismaMock.leadStageHistory.create).not.toHaveBeenCalled()
  })

  it('does not re-link a lead already explicitly converted to a DIFFERENT patient (shared-phone guard)', async () => {
    prismaMock.lead.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'lead-1', status: 'QUALIFIED', convertedToPatientId: 'patient-999' })
    await checkAndConvertLeadOnBooking({ id: 'patient-1', phone: '+256700000000' })
    expect(prismaMock.lead.update).not.toHaveBeenCalled()
    expect(prismaMock.leadStageHistory.create).not.toHaveBeenCalled()
  })

  it('calling it twice for the same lead never creates a second stage-history row (duplicate protection)', async () => {
    // First call: lead is QUALIFIED -> converts.
    prismaMock.lead.findFirst.mockResolvedValueOnce({ id: 'lead-1', status: 'QUALIFIED', convertedToPatientId: null })
    prismaMock.lead.findUniqueOrThrow.mockResolvedValueOnce({ id: 'lead-1', status: 'QUALIFIED', lossReason: null })
    prismaMock.lead.update.mockResolvedValueOnce({ id: 'lead-1', status: 'CONVERTED' })
    await checkAndConvertLeadOnBooking({ id: 'patient-1', phone: '+256700000000' })
    expect(prismaMock.leadStageHistory.create).toHaveBeenCalledTimes(1)

    // Second call (e.g. a second appointment booked): lead now already CONVERTED —
    // resolveQualifiedLeadForPatient's tier-1 query filters status:'QUALIFIED', so an
    // already-CONVERTED lead no longer matches at all, and nothing further happens.
    prismaMock.lead.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    await checkAndConvertLeadOnBooking({ id: 'patient-1', phone: '+256700000000' })
    expect(prismaMock.leadStageHistory.create).toHaveBeenCalledTimes(1) // still just once
  })
})

describe('checkAndConvertLeadsForPatients — bulk treatment-status conversion (Part 9 fix)', () => {
  it('converts a matching QUALIFIED lead for a single patient', async () => {
    prismaMock.lead.findFirst.mockResolvedValueOnce({ id: 'lead-1', status: 'QUALIFIED', convertedToPatientId: null })
    prismaMock.lead.findUniqueOrThrow.mockResolvedValue({ id: 'lead-1', status: 'QUALIFIED', lossReason: null })
    prismaMock.lead.update.mockResolvedValue({ id: 'lead-1', status: 'CONVERTED' })

    await checkAndConvertLeadsForPatients([{ id: 'patient-1', phone: '+256700000000' }])

    expect(prismaMock.leadStageHistory.create).toHaveBeenCalledTimes(1)
  })

  it('converts matching leads independently for multiple affected patients', async () => {
    prismaMock.lead.findFirst
      .mockResolvedValueOnce({ id: 'lead-1', status: 'QUALIFIED', convertedToPatientId: null }) // patient-1 tier-1
      .mockResolvedValueOnce({ id: 'lead-2', status: 'QUALIFIED', convertedToPatientId: null }) // patient-2 tier-1
    prismaMock.lead.findUniqueOrThrow
      .mockResolvedValueOnce({ id: 'lead-1', status: 'QUALIFIED', lossReason: null })
      .mockResolvedValueOnce({ id: 'lead-2', status: 'QUALIFIED', lossReason: null })
    prismaMock.lead.update
      .mockResolvedValueOnce({ id: 'lead-1', status: 'CONVERTED' })
      .mockResolvedValueOnce({ id: 'lead-2', status: 'CONVERTED' })

    await checkAndConvertLeadsForPatients([
      { id: 'patient-1', phone: '+256700000001' },
      { id: 'patient-2', phone: '+256700000002' },
    ])

    expect(prismaMock.leadStageHistory.create).toHaveBeenCalledTimes(2)
  })

  it('does not duplicate-convert a patient whose lead is already CONVERTED', async () => {
    // Already-CONVERTED leads never match resolveQualifiedLeadForPatient's
    // status:'QUALIFIED' filter, so both tiers return null for this patient.
    prismaMock.lead.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    await checkAndConvertLeadsForPatients([{ id: 'patient-1', phone: '+256700000000' }])
    expect(prismaMock.leadStageHistory.create).not.toHaveBeenCalled()
  })

  it('does nothing for an empty patient list', async () => {
    await checkAndConvertLeadsForPatients([])
    expect(prismaMock.lead.findFirst).not.toHaveBeenCalled()
  })
})
