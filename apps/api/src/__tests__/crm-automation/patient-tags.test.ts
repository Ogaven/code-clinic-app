import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.setConfig({ testTimeout: 20000 })

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    patient: {
      findUniqueOrThrow: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    treatmentPlan: { findMany: vi.fn().mockResolvedValue([]) },
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

import {
  applyPatientTagUpdate, recordVisitFlag,
  deriveTreatmentPlanStatusFromStages, syncTreatmentPlanStatusFromPipeline,
} from '../../crm-automation/patient-tags.service'
import { PATIENT_RECALL_CONFLICT_GROUP, PATIENT_TREATMENT_FOLLOWUP_CONFLICT_GROUP } from '../../crm-automation/sequence-groups'

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

// ── Milestone: automatic sequence exit on resolution (Part D) ──────────────
describe('automatic exit on recall/treatment resolution', () => {
  it('exits only the PATIENT_RECALL conflict group when recallStatus resolves back to NOT_DUE', async () => {
    prismaMock.patient.findUniqueOrThrow.mockResolvedValue({ id: 'p-1', recallStatus: 'OVERDUE_30', treatmentPlanStatus: 'NONE', balanceStatus: 'CURRENT', lifecycleStage: 'NEW', valueTier: 'STANDARD', declineReason: null })
    prismaMock.patient.update.mockResolvedValue({ id: 'p-1', recallStatus: 'NOT_DUE', treatmentPlanStatus: 'NONE', balanceStatus: 'CURRENT', lifecycleStage: 'NEW', valueTier: 'STANDARD', declineReason: null })
    prismaMock.sequenceEnrollment.findMany.mockResolvedValueOnce([{ id: 'enr-recall' }])

    await applyPatientTagUpdate('p-1', { recallStatus: 'NOT_DUE' as any }, null)

    expect(prismaMock.sequenceEnrollment.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ patientId: 'p-1', status: 'ACTIVE', sequence: { conflictGroup: PATIENT_RECALL_CONFLICT_GROUP } }),
    })
    expect(prismaMock.sequenceEnrollment.update).toHaveBeenCalledWith({
      where: { id: 'enr-recall' },
      data: expect.objectContaining({ status: 'EXITED_TAG_CHANGE', exitReason: 'recall_resolved' }),
    })
  })

  it('does not fire the recall-resolved exit for a non-NOT_DUE transition (e.g. DUE -> OVERDUE_30)', async () => {
    prismaMock.patient.findUniqueOrThrow.mockResolvedValue({ id: 'p-1', recallStatus: 'DUE', treatmentPlanStatus: 'NONE', balanceStatus: 'CURRENT', lifecycleStage: 'NEW', valueTier: 'STANDARD', declineReason: null })
    prismaMock.patient.update.mockResolvedValue({ id: 'p-1', recallStatus: 'OVERDUE_30', treatmentPlanStatus: 'NONE', balanceStatus: 'CURRENT', lifecycleStage: 'NEW', valueTier: 'STANDARD', declineReason: null })

    await applyPatientTagUpdate('p-1', { recallStatus: 'OVERDUE_30' as any }, null)

    expect(prismaMock.sequenceEnrollment.findMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ sequence: { conflictGroup: PATIENT_RECALL_CONFLICT_GROUP } }) })
    )
  })

  it('exits only the PATIENT_TREATMENT_FOLLOWUP conflict group when treatmentPlanStatus resolves away from INCOMPLETE', async () => {
    prismaMock.patient.findUniqueOrThrow.mockResolvedValue({ id: 'p-1', recallStatus: 'NOT_DUE', treatmentPlanStatus: 'INCOMPLETE', balanceStatus: 'CURRENT', lifecycleStage: 'NEW', valueTier: 'STANDARD', declineReason: null })
    prismaMock.patient.update.mockResolvedValue({ id: 'p-1', recallStatus: 'NOT_DUE', treatmentPlanStatus: 'ACCEPTED', balanceStatus: 'CURRENT', lifecycleStage: 'NEW', valueTier: 'STANDARD', declineReason: null })
    prismaMock.sequenceEnrollment.findMany.mockResolvedValueOnce([{ id: 'enr-treatment' }])

    await applyPatientTagUpdate('p-1', { treatmentPlanStatus: 'ACCEPTED' as any }, null)

    expect(prismaMock.sequenceEnrollment.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ sequence: { conflictGroup: PATIENT_TREATMENT_FOLLOWUP_CONFLICT_GROUP } }),
    })
    expect(prismaMock.sequenceEnrollment.update).toHaveBeenCalledWith({
      where: { id: 'enr-treatment' },
      data: expect.objectContaining({ status: 'EXITED_TAG_CHANGE', exitReason: 'treatment_resolved' }),
    })
  })
})

// ── Milestone: referral relationship consistency (Part G) ─────────────────
describe('referral source / referred-by consistency', () => {
  it('clears crmReferredByPatientId when the source changes away from PATIENT_REFERRAL without an explicit new value', async () => {
    prismaMock.patient.findUniqueOrThrow.mockResolvedValue({ id: 'p-1', recallStatus: 'NOT_DUE', treatmentPlanStatus: 'NONE', balanceStatus: 'CURRENT', lifecycleStage: 'NEW', valueTier: 'STANDARD', declineReason: null, crmReferralSource: 'PATIENT_REFERRAL', crmReferredByPatientId: 'ref-1' })
    prismaMock.patient.update.mockResolvedValue({ id: 'p-1', recallStatus: 'NOT_DUE', treatmentPlanStatus: 'NONE', balanceStatus: 'CURRENT', lifecycleStage: 'NEW', valueTier: 'STANDARD', declineReason: null, crmReferralSource: 'GOOGLE', crmReferredByPatientId: null })

    await applyPatientTagUpdate('p-1', { crmReferralSource: 'GOOGLE' as any }, 'user-1')

    expect(prismaMock.patient.update).toHaveBeenCalledWith({
      where: { id: 'p-1' },
      data: expect.objectContaining({ crmReferralSource: 'GOOGLE', crmReferredByPatientId: null }),
    })
  })

  it('does not clear crmReferredByPatientId when the caller explicitly supplies a new one in the same request', async () => {
    prismaMock.patient.findUniqueOrThrow.mockResolvedValue({ id: 'p-1', recallStatus: 'NOT_DUE', treatmentPlanStatus: 'NONE', balanceStatus: 'CURRENT', lifecycleStage: 'NEW', valueTier: 'STANDARD', declineReason: null, crmReferralSource: 'PATIENT_REFERRAL', crmReferredByPatientId: 'ref-1' })
    prismaMock.patient.update.mockResolvedValue({ id: 'p-1', recallStatus: 'NOT_DUE', treatmentPlanStatus: 'NONE', balanceStatus: 'CURRENT', lifecycleStage: 'NEW', valueTier: 'STANDARD', declineReason: null, crmReferralSource: 'PATIENT_REFERRAL', crmReferredByPatientId: 'ref-2' })

    await applyPatientTagUpdate('p-1', { crmReferralSource: 'PATIENT_REFERRAL' as any, crmReferredByPatientId: 'ref-2' }, 'user-1')

    expect(prismaMock.patient.update).toHaveBeenCalledWith({
      where: { id: 'p-1' },
      data: expect.objectContaining({ crmReferredByPatientId: 'ref-2' }),
    })
  })

  it('leaves crmReferredByPatientId untouched when crmReferralSource is not part of the update at all', async () => {
    prismaMock.patient.findUniqueOrThrow.mockResolvedValue({ id: 'p-1', recallStatus: 'NOT_DUE', treatmentPlanStatus: 'NONE', balanceStatus: 'CURRENT', lifecycleStage: 'NEW', valueTier: 'STANDARD', declineReason: null, crmReferralSource: 'PATIENT_REFERRAL', crmReferredByPatientId: 'ref-1' })
    prismaMock.patient.update.mockResolvedValue({ id: 'p-1', recallStatus: 'NOT_DUE', treatmentPlanStatus: 'NONE', balanceStatus: 'CURRENT', lifecycleStage: 'NEW', valueTier: 'STANDARD', declineReason: null, languagePref: 'Luganda' })

    await applyPatientTagUpdate('p-1', { languagePref: 'Luganda' }, 'user-1')

    const call = prismaMock.patient.update.mock.calls[0][0]
    expect(call.data).not.toHaveProperty('crmReferredByPatientId')
  })
})

// ── Milestone: treatment-plan-status derivation from canonical pipeline data (Part C) ──
describe('deriveTreatmentPlanStatusFromStages', () => {
  it('returns NONE when the patient has no treatment plans at all', () => {
    expect(deriveTreatmentPlanStatusFromStages([])).toBe('NONE')
  })
  it('returns INCOMPLETE when any plan is in the pipeline\'s own Follow-up Due stage, even alongside an accepted one', () => {
    expect(deriveTreatmentPlanStatusFromStages(['Accepted & Scheduled', 'Follow-up Due'])).toBe('INCOMPLETE')
  })
  it('returns PROPOSED when a plan is only Consulted/Presented, no Follow-up Due', () => {
    expect(deriveTreatmentPlanStatusFromStages(['Treatment Presented'])).toBe('PROPOSED')
  })
  it('returns ACCEPTED for Accepted & Scheduled / Unscheduled / Completed', () => {
    expect(deriveTreatmentPlanStatusFromStages(['Accepted & Unscheduled'])).toBe('ACCEPTED')
    expect(deriveTreatmentPlanStatusFromStages(['Completed'])).toBe('ACCEPTED')
  })
  it('returns DECLINED only when every plan is Declined', () => {
    expect(deriveTreatmentPlanStatusFromStages(['Declined'])).toBe('DECLINED')
    expect(deriveTreatmentPlanStatusFromStages(['Declined', 'Consulted'])).toBe('PROPOSED')
  })
})

describe('syncTreatmentPlanStatusFromPipeline', () => {
  it('writes the derived status through applyPatientTagUpdate (system actor) when it actually changed', async () => {
    prismaMock.treatmentPlan.findMany.mockResolvedValueOnce([{ stage: 'Follow-up Due' }])
    prismaMock.patient.findUnique.mockResolvedValueOnce({ treatmentPlanStatus: 'PROPOSED' })
    prismaMock.patient.findUniqueOrThrow.mockResolvedValue({ id: 'p-1', recallStatus: 'NOT_DUE', treatmentPlanStatus: 'PROPOSED', balanceStatus: 'CURRENT', lifecycleStage: 'NEW', valueTier: 'STANDARD', declineReason: null })
    prismaMock.patient.update.mockResolvedValue({ id: 'p-1', recallStatus: 'NOT_DUE', treatmentPlanStatus: 'INCOMPLETE', balanceStatus: 'CURRENT', lifecycleStage: 'NEW', valueTier: 'STANDARD', declineReason: null })

    await syncTreatmentPlanStatusFromPipeline('p-1')

    expect(prismaMock.patient.update).toHaveBeenCalledWith({
      where: { id: 'p-1' },
      data: expect.objectContaining({ treatmentPlanStatus: 'INCOMPLETE', tagsUpdatedBy: null }),
    })
  })

  it('does nothing when the derived status matches what is already stored', async () => {
    prismaMock.treatmentPlan.findMany.mockResolvedValueOnce([{ stage: 'Accepted & Scheduled' }])
    prismaMock.patient.findUnique.mockResolvedValueOnce({ treatmentPlanStatus: 'ACCEPTED' })

    await syncTreatmentPlanStatusFromPipeline('p-1')

    expect(prismaMock.patient.update).not.toHaveBeenCalled()
  })

  it('does nothing when the patient no longer exists', async () => {
    prismaMock.treatmentPlan.findMany.mockResolvedValueOnce([])
    prismaMock.patient.findUnique.mockResolvedValueOnce(null)

    await syncTreatmentPlanStatusFromPipeline('missing')

    expect(prismaMock.patient.update).not.toHaveBeenCalled()
  })
})