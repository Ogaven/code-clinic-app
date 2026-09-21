import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

// Milestone: patient CRM sequence content/activation pass, section 5 — proves
// activating recall_due_reminder / recall_dormant_reactivation /
// treatment_incomplete_followup does NOT retroactively enroll the existing
// backlog of already-overdue/already-incomplete patients.
//
// The engine only ever enrolls off an AutomationEvent, and
// runDailyPatientTagDerivation only writes (and therefore only ever emits an
// event for) a patient whose recomputed tag value differs from what's
// already stored (see patient-tags.service.ts). A patient who was ALREADY
// recallStatus:'DUE' (etc.) before a sequence goes ACTIVE recomputes to the
// exact same value every night forever — no write, no event, no enrollment,
// no matter how long the sequence has been ACTIVE. Only a genuine future
// transition (a patient newly crossing into DUE/OVERDUE_180_PLUS/INCOMPLETE)
// ever produces an event. This is what makes the backlog safe by
// construction, not a special-cased check added for activation.

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    patient: { findMany: vi.fn(), findUniqueOrThrow: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    appointment: { findFirst: vi.fn().mockResolvedValue(null) },
    invoice: { findFirst: vi.fn().mockResolvedValue(null) },
    treatmentPlan: { findMany: vi.fn().mockResolvedValue([]) },
    automationEvent: { create: vi.fn().mockResolvedValue({ id: 'evt' }), update: vi.fn() },
    sequenceDefinition: { findMany: vi.fn().mockResolvedValue([]) },
    collectionsCase: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn(), update: vi.fn() },
    sequenceEnrollment: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
    scheduledTouch: { updateMany: vi.fn() },
  },
}))

vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))

import { runDailyPatientTagDerivation } from '../../crm-automation/patient-tags.service'

const NOW = new Date('2026-09-21T08:00:00.000Z')

function backlogPatient(overrides: Record<string, any> = {}) {
  // Already 190 days past a SIX_MONTH (180-day) recall interval -> already
  // DUE today, well before any sequence is ever activated.
  return {
    id: 'p-backlog-1',
    createdAt: new Date(NOW.getTime() - 400 * 86_400_000),
    accountBalance: 0,
    recallInterval: 'SIX_MONTH',
    recallStatus: 'DUE',
    balanceStatus: 'CURRENT',
    balanceAgingBucket: null,
    lifecycleStage: 'ESTABLISHED',
    valueTier: 'STANDARD',
    treatmentTypes: [],
    treatmentPlanStatus: 'NONE',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  prismaMock.appointment.findFirst.mockResolvedValue(null)
  prismaMock.invoice.findFirst.mockResolvedValue(null)
  prismaMock.treatmentPlan.findMany.mockResolvedValue([])
})

afterEach(() => {
  vi.useRealTimers()
})

describe('runDailyPatientTagDerivation — backlog safety on activation', () => {
  it('does NOT write or emit an event for a patient whose computed recall status already matches what is stored (already-DUE backlog, no transition)', async () => {
    const patient = backlogPatient()
    prismaMock.patient.findMany.mockResolvedValue([patient])
    // The lastCompletedAt lookup happens per-patient inside the loop.
    prismaMock.appointment.findFirst.mockResolvedValue({ startAt: new Date(NOW.getTime() - 190 * 86_400_000) })

    const result = await runDailyPatientTagDerivation()

    expect(result).toEqual({ scanned: 1, updated: 0 })
    expect(prismaMock.patient.update).not.toHaveBeenCalled()
    expect(prismaMock.automationEvent.create).not.toHaveBeenCalled()
  })

  it('does NOT write or emit an event for a patient already OVERDUE_180_PLUS (dormant-reactivation backlog)', async () => {
    const patient = backlogPatient({ recallStatus: 'OVERDUE_180_PLUS' })
    prismaMock.patient.findMany.mockResolvedValue([patient])
    // 400 days past due -> OVERDUE_180_PLUS, matches stored value.
    prismaMock.appointment.findFirst.mockResolvedValue({ startAt: new Date(NOW.getTime() - (180 + 400) * 86_400_000) })

    const result = await runDailyPatientTagDerivation()

    expect(result).toEqual({ scanned: 1, updated: 0 })
    expect(prismaMock.patient.update).not.toHaveBeenCalled()
    expect(prismaMock.automationEvent.create).not.toHaveBeenCalled()
  })

  it('does NOT write or emit an event for a patient already treatmentPlanStatus:INCOMPLETE (treatment-followup backlog)', async () => {
    const patient = backlogPatient({ recallStatus: 'NOT_DUE', recallInterval: null, treatmentPlanStatus: 'INCOMPLETE' })
    prismaMock.patient.findMany.mockResolvedValue([patient])
    prismaMock.treatmentPlan.findMany.mockResolvedValue([{ stage: 'Follow-up Due' }]) // derives back to INCOMPLETE

    const result = await runDailyPatientTagDerivation()

    expect(result).toEqual({ scanned: 1, updated: 0 })
    expect(prismaMock.patient.update).not.toHaveBeenCalled()
    expect(prismaMock.automationEvent.create).not.toHaveBeenCalled()
  })

  it('DOES write and emit recall_status_changed for a genuine future transition into DUE (prospective enrollment path stays intact)', async () => {
    const patient = backlogPatient({ recallStatus: 'NOT_DUE' }) // stored value has not caught up yet
    prismaMock.patient.findMany.mockResolvedValue([patient])
    prismaMock.appointment.findFirst.mockResolvedValue({ startAt: new Date(NOW.getTime() - 190 * 86_400_000) }) // computes to DUE
    prismaMock.patient.findUniqueOrThrow.mockResolvedValue(patient)
    prismaMock.patient.update.mockResolvedValue({ ...patient, recallStatus: 'DUE' })

    const result = await runDailyPatientTagDerivation()

    expect(result).toEqual({ scanned: 1, updated: 1 })
    expect(prismaMock.patient.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p-backlog-1' }, data: expect.objectContaining({ recallStatus: 'DUE' }) })
    )
    expect(prismaMock.automationEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ entityType: 'PATIENT', entityId: 'p-backlog-1', eventType: 'recall_status_changed', fromValue: 'NOT_DUE', toValue: 'DUE' }),
    })
  })
})
