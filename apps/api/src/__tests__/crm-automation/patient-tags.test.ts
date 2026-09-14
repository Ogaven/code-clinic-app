import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.setConfig({ testTimeout: 20000 })

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    patient: {
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    automationEvent: { create: vi.fn().mockResolvedValue({ id: 'evt' }), update: vi.fn() },
    sequenceDefinition: { findMany: vi.fn().mockResolvedValue([]) },
    collectionsCase: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      update: vi.fn(),
    },
    sequenceEnrollment: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
    scheduledTouch: { updateMany: vi.fn() },
  },
}))

vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))

import { applyPatientTagUpdate, recordVisitFlag } from '../../crm-automation/patient-tags.service'

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.collectionsCase.findUnique.mockResolvedValue(null)
  prismaMock.sequenceEnrollment.findMany.mockResolvedValue([])
})

describe('applyPatientTagUpdate', () => {
  it('writes multi-value tag arrays (treatmentTypes) and tagsUpdatedBy', async () => {
    prismaMock.patient.findUniqueOrThrow.mockResolvedValue({ id: 'p-1', treatmentTypes: [], recallStatus: 'NOT_DUE', treatmentPlanStatus: 'NONE', balanceStatus: 'CURRENT', lifecycleStage: 'NEW', valueTier: 'STANDARD', declineReason: null })
    prismaMock.patient.update.mockResolvedValue({ id: 'p-1', treatmentTypes: ['ORTHO', 'IMPLANT'], recallStatus: 'NOT_DUE', treatmentPlanStatus: 'NONE', balanceStatus: 'CURRENT', lifecycleStage: 'NEW', valueTier: 'STANDARD', declineReason: null })

    await applyPatientTagUpdate('p-1', { treatmentTypes: ['ORTHO', 'IMPLANT'] as any }, 'user-1')

    expect(prismaMock.patient.update).toHaveBeenCalledWith({
      where: { id: 'p-1' },
      data: expect.objectContaining({ treatmentTypes: ['ORTHO', 'IMPLANT'], tagsUpdatedBy: 'user-1' }),
    })
  })

  it('emits an automation event when recallStatus transitions to OVERDUE_30 (Part B worked example)', async () => {
    prismaMock.patient.findUniqueOrThrow.mockResolvedValue({ id: 'p-1', recallStatus: 'DUE', treatmentPlanStatus: 'NONE', balanceStatus: 'CURRENT', lifecycleStage: 'NEW', valueTier: 'STANDARD', declineReason: null })
    prismaMock.patient.update.mockResolvedValue({ id: 'p-1', recallStatus: 'OVERDUE_30', treatmentPlanStatus: 'NONE', balanceStatus: 'CURRENT', lifecycleStage: 'NEW', valueTier: 'STANDARD', declineReason: null })

    await applyPatientTagUpdate('p-1', { recallStatus: 'OVERDUE_30' as any }, null)

    expect(prismaMock.automationEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ entityType: 'PATIENT', entityId: 'p-1', eventType: 'recall_status_changed', fromValue: 'DUE', toValue: 'OVERDUE_30' }),
    })
  })

  it('does not emit an event when a watched field is written but unchanged', async () => {
    prismaMock.patient.findUniqueOrThrow.mockResolvedValue({ id: 'p-1', recallStatus: 'DUE', treatmentPlanStatus: 'NONE', balanceStatus: 'CURRENT', lifecycleStage: 'NEW', valueTier: 'STANDARD', declineReason: null })
    prismaMock.patient.update.mockResolvedValue({ id: 'p-1', recallStatus: 'DUE', treatmentPlanStatus: 'NONE', balanceStatus: 'CURRENT', lifecycleStage: 'NEW', valueTier: 'STANDARD', declineReason: null })

    await applyPatientTagUpdate('p-1', { recallStatus: 'DUE' as any }, null)

    expect(prismaMock.automationEvent.create).not.toHaveBeenCalled()
  })

  it('treatment-plan status transition to INCOMPLETE emits its own event independent of recallStatus', async () => {
    prismaMock.patient.findUniqueOrThrow.mockResolvedValue({ id: 'p-1', recallStatus: 'NOT_DUE', treatmentPlanStatus: 'PROPOSED', balanceStatus: 'CURRENT', lifecycleStage: 'NEW', valueTier: 'STANDARD', declineReason: null })
    prismaMock.patient.update.mockResolvedValue({ id: 'p-1', recallStatus: 'NOT_DUE', treatmentPlanStatus: 'INCOMPLETE', balanceStatus: 'CURRENT', lifecycleStage: 'NEW', valueTier: 'STANDARD', declineReason: null })

    await applyPatientTagUpdate('p-1', { treatmentPlanStatus: 'INCOMPLETE' as any }, null)

    expect(prismaMock.automationEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ eventType: 'treatment_plan_status_changed', toValue: 'INCOMPLETE' }),
    })
  })

  describe('collections routing (Part E)', () => {
    it('opens a collections case when balance becomes OWING while a plan is INCOMPLETE', async () => {
      prismaMock.patient.findUniqueOrThrow.mockResolvedValue({ id: 'p-1', recallStatus: 'NOT_DUE', treatmentPlanStatus: 'INCOMPLETE', balanceStatus: 'CURRENT', lifecycleStage: 'NEW', valueTier: 'STANDARD', declineReason: null })
      prismaMock.patient.update.mockResolvedValue({ id: 'p-1', recallStatus: 'NOT_DUE', treatmentPlanStatus: 'INCOMPLETE', balanceStatus: 'OWING', lifecycleStage: 'NEW', valueTier: 'STANDARD', declineReason: null })
      prismaMock.collectionsCase.findUnique.mockResolvedValue(null)

      await applyPatientTagUpdate('p-1', { balanceStatus: 'OWING' as any }, null)

      expect(prismaMock.collectionsCase.create).toHaveBeenCalledWith({
        data: { patientId: 'p-1', status: 'OPEN', reason: 'BALANCE_OWING_TREATMENT_INCOMPLETE' },
      })
    })

    it('closes an existing collections case once the patient no longer qualifies', async () => {
      prismaMock.patient.findUniqueOrThrow.mockResolvedValue({ id: 'p-1', recallStatus: 'NOT_DUE', treatmentPlanStatus: 'INCOMPLETE', balanceStatus: 'OWING', lifecycleStage: 'NEW', valueTier: 'STANDARD', declineReason: null })
      prismaMock.patient.update.mockResolvedValue({ id: 'p-1', recallStatus: 'NOT_DUE', treatmentPlanStatus: 'ACCEPTED', balanceStatus: 'OWING', lifecycleStage: 'NEW', valueTier: 'STANDARD', declineReason: null })
      prismaMock.collectionsCase.findUnique.mockResolvedValue({ patientId: 'p-1', status: 'IN_PROGRESS' })

      await applyPatientTagUpdate('p-1', { treatmentPlanStatus: 'ACCEPTED' as any }, null)

      expect(prismaMock.collectionsCase.update).toHaveBeenCalledWith({
        where: { patientId: 'p-1' },
        data: { status: 'CLOSED', resolvedAt: expect.any(Date) },
      })
    })

    it('exits active marketing enrollments the moment a patient moves into collections (Part D tag-change exit)', async () => {
      prismaMock.patient.findUniqueOrThrow.mockResolvedValue({ id: 'p-1', recallStatus: 'NOT_DUE', treatmentPlanStatus: 'INCOMPLETE', balanceStatus: 'CURRENT', lifecycleStage: 'NEW', valueTier: 'STANDARD', declineReason: null })
      prismaMock.patient.update.mockResolvedValue({ id: 'p-1', recallStatus: 'NOT_DUE', treatmentPlanStatus: 'INCOMPLETE', balanceStatus: 'OWING', lifecycleStage: 'NEW', valueTier: 'STANDARD', declineReason: null })
      prismaMock.sequenceEnrollment.findMany.mockResolvedValueOnce([{ id: 'enr-1' }])

      await applyPatientTagUpdate('p-1', { balanceStatus: 'OWING' as any }, null)

      expect(prismaMock.sequenceEnrollment.update).toHaveBeenCalledWith({
        where: { id: 'enr-1' },
        data: expect.objectContaining({ status: 'EXITED_TAG_CHANGE' }),
      })
    })
  })
})

describe('recordVisitFlag', () => {
  it('increments noShowCount and emits visit_flag_no_show', async () => {
    prismaMock.patient.findUniqueOrThrow.mockResolvedValue({ noShowCount: 1 })
    prismaMock.patient.update.mockResolvedValue({ noShowCount: 2 })

    await recordVisitFlag('p-1', 'NO_SHOW')

    expect(prismaMock.patient.update).toHaveBeenCalledWith({ where: { id: 'p-1' }, data: { noShowCount: { increment: 1 } } })
    expect(prismaMock.automationEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ eventType: 'visit_flag_no_show', fromValue: '1', toValue: '2' }),
    })
  })
})