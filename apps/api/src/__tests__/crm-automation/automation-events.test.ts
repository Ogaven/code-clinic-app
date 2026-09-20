import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.setConfig({ testTimeout: 20000 })

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    automationEvent: {
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    sequenceDefinition: { findMany: vi.fn().mockResolvedValue([]) },
    sequenceEnrollment: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
    },
    sequenceTouchTemplate: { findMany: vi.fn().mockResolvedValue([]) },
    scheduledTouch: { createMany: vi.fn(), updateMany: vi.fn() },
    patient: { findUnique: vi.fn() },
    lead: { findUnique: vi.fn() },
  },
}))

vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))

import {
  emitAutomationEvent,
  enrollEntityInSequence,
  exitActiveEnrollments,
  ruleMatchesEntity,
} from '../../crm-automation/automation-events.service'

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.sequenceEnrollment.findFirst.mockResolvedValue(null)
  prismaMock.sequenceDefinition.findMany.mockResolvedValue([])
})

describe('ruleMatchesEntity', () => {
  it('matches plain equality', () => {
    expect(ruleMatchesEntity({ balanceStatus: 'OWING' }, { balanceStatus: 'OWING' })).toBe(true)
    expect(ruleMatchesEntity({ balanceStatus: 'OWING' }, { balanceStatus: 'CURRENT' })).toBe(false)
  })

  it('matches array-column membership for multi-value tags', () => {
    expect(ruleMatchesEntity({ treatmentTypes: { in: ['ORTHO', 'IMPLANT'] } }, { treatmentTypes: ['ORTHO', 'CLEANING'] })).toBe(true)
    expect(ruleMatchesEntity({ treatmentTypes: { in: ['ORTHO'] } }, { treatmentTypes: ['CLEANING'] })).toBe(false)
  })

  it('requires every field in an AND rule to match (Part E exclusion example)', () => {
    const rule = { balanceStatus: 'OWING', treatmentPlanStatus: 'INCOMPLETE' }
    expect(ruleMatchesEntity(rule, { balanceStatus: 'OWING', treatmentPlanStatus: 'INCOMPLETE' })).toBe(true)
    expect(ruleMatchesEntity(rule, { balanceStatus: 'OWING', treatmentPlanStatus: 'ACCEPTED' })).toBe(false)
  })
})

describe('emitAutomationEvent', () => {
  it('creates the event row and marks it processed after evaluation succeeds', async () => {
    prismaMock.automationEvent.create.mockResolvedValue({ id: 'evt-1', entityType: 'PATIENT', entityId: 'p-1', eventType: 'recall_status_changed', toValue: 'OVERDUE_30' })
    await emitAutomationEvent({ entityType: 'PATIENT', entityId: 'p-1', eventType: 'recall_status_changed', toValue: 'OVERDUE_30' })
    expect(prismaMock.automationEvent.create).toHaveBeenCalled()
    expect(prismaMock.automationEvent.update).toHaveBeenCalledWith({ where: { id: 'evt-1' }, data: { processedAt: expect.any(Date) } })
  })

  it('leaves processedAt null when rule evaluation throws, for the recovery sweep to retry', async () => {
    prismaMock.automationEvent.create.mockResolvedValue({ id: 'evt-2', entityType: 'PATIENT', entityId: 'p-1', eventType: 'recall_status_changed', toValue: 'OVERDUE_30' })
    prismaMock.sequenceDefinition.findMany.mockRejectedValueOnce(new Error('db blip'))
    await emitAutomationEvent({ entityType: 'PATIENT', entityId: 'p-1', eventType: 'recall_status_changed', toValue: 'OVERDUE_30' })
    expect(prismaMock.automationEvent.update).not.toHaveBeenCalled()
  })
})

describe('enrollEntityInSequence — duplicate + conflict protection (Part D)', () => {
  const sequence = { id: 'seq-1', exclusionRule: null, audienceRule: null, conflictGroup: null } as any

  it('does not enroll when the entity no longer exists', async () => {
    prismaMock.patient.findUnique.mockResolvedValue(null)
    const result = await enrollEntityInSequence(sequence, 'PATIENT', 'p-missing')
    expect(result).toEqual({ enrolled: false, reason: 'entity_not_found' })
  })

  it('refuses a second ACTIVE enrollment in the same sequence for the same patient', async () => {
    prismaMock.patient.findUnique.mockResolvedValue({ id: 'p-1', balanceStatus: 'CURRENT' })
    prismaMock.sequenceEnrollment.findFirst.mockResolvedValueOnce({ id: 'existing' })
    const result = await enrollEntityInSequence(sequence, 'PATIENT', 'p-1')
    expect(result).toEqual({ enrolled: false, reason: 'duplicate' })
    expect(prismaMock.sequenceEnrollment.create).not.toHaveBeenCalled()
  })

  it('refuses enrollment when a conflicting ACTIVE enrollment exists in the same conflictGroup', async () => {
    const grouped = { ...sequence, conflictGroup: 'recall_marketing' }
    prismaMock.patient.findUnique.mockResolvedValue({ id: 'p-1' })
    prismaMock.sequenceEnrollment.findFirst
      .mockResolvedValueOnce(null) // no duplicate of same sequence
      .mockResolvedValueOnce({ id: 'other-active' }) // conflict group check
    const result = await enrollEntityInSequence(grouped, 'PATIENT', 'p-1')
    expect(result).toEqual({ enrolled: false, reason: 'conflict_group' })
  })

  it('excludes balance-owing + treatment-incomplete patients from a general marketing sequence (Part E)', async () => {
    const marketingSeq = { ...sequence, exclusionRule: JSON.stringify({ balanceStatus: 'OWING', treatmentPlanStatus: 'INCOMPLETE' }) }
    prismaMock.patient.findUnique.mockResolvedValue({ id: 'p-1', balanceStatus: 'OWING', treatmentPlanStatus: 'INCOMPLETE' })
    const result = await enrollEntityInSequence(marketingSeq, 'PATIENT', 'p-1')
    expect(result).toEqual({ enrolled: false, reason: 'excluded' })
  })

  it('refuses enrollment when the sequence has no touch templates defined yet', async () => {
    prismaMock.patient.findUnique.mockResolvedValue({ id: 'p-1' })
    prismaMock.sequenceTouchTemplate.findMany.mockResolvedValueOnce([])
    const result = await enrollEntityInSequence(sequence, 'PATIENT', 'p-1')
    expect(result).toEqual({ enrolled: false, reason: 'no_touches_defined' })
  })

  it('enrolls and schedules one touch per template using its delayDays offset', async () => {
    prismaMock.patient.findUnique.mockResolvedValue({ id: 'p-1' })
    prismaMock.sequenceTouchTemplate.findMany.mockResolvedValueOnce([
      { id: 't-0', order: 0, delayDays: 0 },
      { id: 't-1', order: 1, delayDays: 3 },
    ])
    prismaMock.sequenceEnrollment.create.mockResolvedValueOnce({ id: 'enr-1' })

    const result = await enrollEntityInSequence(sequence, 'PATIENT', 'p-1')

    expect(result).toEqual({ enrolled: true, enrollmentId: 'enr-1' })
    expect(prismaMock.scheduledTouch.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ enrollmentId: 'enr-1', touchTemplateId: 't-0', dryRun: true }),
        expect.objectContaining({ enrollmentId: 'enr-1', touchTemplateId: 't-1', dryRun: true }),
      ],
    })
  })
})

describe('exitActiveEnrollments (Part D exit conditions)', () => {
  it('marks every active enrollment exited and cancels pending touches when no scope is given', async () => {
    prismaMock.sequenceEnrollment.findMany.mockResolvedValueOnce([{ id: 'enr-1' }, { id: 'enr-2' }])
    const count = await exitActiveEnrollments('PATIENT', 'p-1', 'EXITED_REPLY', 'patient replied')
    expect(count).toBe(2)
    expect(prismaMock.sequenceEnrollment.findMany).toHaveBeenCalledWith({
      where: { patientId: 'p-1', status: 'ACTIVE' },
    })
    expect(prismaMock.sequenceEnrollment.update).toHaveBeenCalledTimes(2)
    expect(prismaMock.scheduledTouch.updateMany).toHaveBeenCalledWith({
      where: { enrollmentId: 'enr-1', status: 'PENDING' },
      data: { status: 'CANCELLED' },
    })
  })

  it('narrows to the given conflictGroup only, leaving unrelated active enrollments untouched (Milestone D scoped exit)', async () => {
    prismaMock.sequenceEnrollment.findMany.mockResolvedValueOnce([{ id: 'enr-recall' }])
    const count = await exitActiveEnrollments('PATIENT', 'p-1', 'EXITED_BOOKED', 'appointment_booked', { conflictGroup: 'PATIENT_RECALL' })
    expect(count).toBe(1)
    expect(prismaMock.sequenceEnrollment.findMany).toHaveBeenCalledWith({
      where: { patientId: 'p-1', status: 'ACTIVE', sequence: { conflictGroup: 'PATIENT_RECALL' } },
    })
  })

  it('narrows to the given channel only (consent opt-out scoped exit)', async () => {
    prismaMock.sequenceEnrollment.findMany.mockResolvedValueOnce([])
    await exitActiveEnrollments('PATIENT', 'p-1', 'STOPPED', 'consent_opt_out', { channel: 'WHATSAPP' })
    expect(prismaMock.sequenceEnrollment.findMany).toHaveBeenCalledWith({
      where: { patientId: 'p-1', status: 'ACTIVE', sequence: { channel: 'WHATSAPP' } },
    })
  })

  it('LEAD exits still use leadId, unaffected by the new scope parameter being optional', async () => {
    prismaMock.sequenceEnrollment.findMany.mockResolvedValueOnce([])
    await exitActiveEnrollments('LEAD', 'lead-1', 'EXITED_BOOKED', 'converted')
    expect(prismaMock.sequenceEnrollment.findMany).toHaveBeenCalledWith({
      where: { leadId: 'lead-1', status: 'ACTIVE' },
    })
  })
})