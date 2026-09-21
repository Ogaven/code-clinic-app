import { describe, expect, it, vi, beforeEach } from 'vitest'

// Milestone B/C — the default recall/treatment-follow-up sequence templates
// must be created in DRAFT status only. Milestone (patient sequence content
// & safe activation, 2026-09-21): the placeholder copy is replaced with
// clinic-approved wording, and re-running the seed on a later boot must
// refresh a still-DRAFT sequence's touches to the latest approved copy while
// never touching one an admin has already moved to ACTIVE/PAUSED/ARCHIVED.

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    sequenceDefinition: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    sequenceTouchTemplate: {
      deleteMany: vi.fn().mockResolvedValue({}),
      createMany: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn(async (ops: any[]) => Promise.all(ops)),
  },
}))

vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))

import { ensureDefaultCrmSequences } from '../../crm-automation/seed-default-sequences'
import { PATIENT_RECALL_CONFLICT_GROUP, PATIENT_TREATMENT_FOLLOWUP_CONFLICT_GROUP } from '../../crm-automation/sequence-groups'

const KEYS = ['recall_due_reminder', 'recall_dormant_reactivation', 'treatment_incomplete_followup']

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.sequenceDefinition.findUnique.mockResolvedValue(null)
})

describe('ensureDefaultCrmSequences — first creation', () => {
  it('creates exactly the recall and treatment-follow-up sequences, all in DRAFT status, with clinic-approved (non-placeholder) copy', async () => {
    await ensureDefaultCrmSequences()

    expect(prismaMock.sequenceDefinition.create).toHaveBeenCalledTimes(3)
    const keys = prismaMock.sequenceDefinition.create.mock.calls.map((c: any) => c[0].data.key)
    expect(keys.sort()).toEqual([...KEYS].sort())

    for (const call of prismaMock.sequenceDefinition.create.mock.calls as any[]) {
      expect(call[0].data.status).toBe('DRAFT')
      expect(call[0].data.entityType).toBe('PATIENT')
      for (const touch of call[0].data.touches.create) {
        expect(touch.messageTemplate).not.toMatch(/PLACEHOLDER/)
        expect(touch.messageTemplate).toContain('{firstName}')
        expect(touch.messageTemplate).toMatch(/Code Clinic/)
      }
    }
  })

  it('never touches diagnosis, procedure names, balances, or invoice amounts in any touch body (privacy rule)', async () => {
    await ensureDefaultCrmSequences()
    const forbidden = /diagnos|\bbalance\b|\binvoice\b|\bowing\b|amount due|UGX|\$\d/i
    for (const call of prismaMock.sequenceDefinition.create.mock.calls as any[]) {
      for (const touch of call[0].data.touches.create) {
        expect(touch.messageTemplate).not.toMatch(forbidden)
      }
    }
  })

  it('gives recall_due_reminder exactly 2 touches (day 0, day 5)', async () => {
    await ensureDefaultCrmSequences()
    const call = prismaMock.sequenceDefinition.create.mock.calls.find((c: any) => c[0].data.key === 'recall_due_reminder')!
    const touches = call[0].data.touches.create
    expect(touches.map((t: any) => t.delayDays)).toEqual([0, 5])
  })

  it('gives recall_dormant_reactivation exactly 3 touches (day 0, day 7, day 30)', async () => {
    await ensureDefaultCrmSequences()
    const call = prismaMock.sequenceDefinition.create.mock.calls.find((c: any) => c[0].data.key === 'recall_dormant_reactivation')!
    const touches = call[0].data.touches.create
    expect(touches.map((t: any) => t.delayDays)).toEqual([0, 7, 30])
  })

  it('gives treatment_incomplete_followup exactly 3 touches (day 0, day 5, day 10)', async () => {
    await ensureDefaultCrmSequences()
    const call = prismaMock.sequenceDefinition.create.mock.calls.find((c: any) => c[0].data.key === 'treatment_incomplete_followup')!
    const touches = call[0].data.touches.create
    expect(touches.map((t: any) => t.delayDays)).toEqual([0, 5, 10])
  })

  it('treatment_incomplete_followup never names the treatment/procedure itself', async () => {
    await ensureDefaultCrmSequences()
    const call = prismaMock.sequenceDefinition.create.mock.calls.find((c: any) => c[0].data.key === 'treatment_incomplete_followup')!
    for (const touch of call[0].data.touches.create) {
      expect(touch.messageTemplate).not.toMatch(/root canal|extraction|filling|crown|implant|ortho/i)
    }
  })

  it('recall_due_reminder and recall_dormant_reactivation share the PATIENT_RECALL conflict group (a patient can never run both recall sequences at once)', async () => {
    await ensureDefaultCrmSequences()
    const byKey = new Map(prismaMock.sequenceDefinition.create.mock.calls.map((c: any) => [c[0].data.key, c[0].data]))
    expect(byKey.get('recall_due_reminder').conflictGroup).toBe(PATIENT_RECALL_CONFLICT_GROUP)
    expect(byKey.get('recall_dormant_reactivation').conflictGroup).toBe(PATIENT_RECALL_CONFLICT_GROUP)
    expect(byKey.get('treatment_incomplete_followup').conflictGroup).toBe(PATIENT_TREATMENT_FOLLOWUP_CONFLICT_GROUP)
  })

  it('scopes the recall sequences to the recall_status_changed trigger and the treatment sequence to treatment_plan_status_changed', async () => {
    await ensureDefaultCrmSequences()
    const byKey = new Map(prismaMock.sequenceDefinition.create.mock.calls.map((c: any) => [c[0].data.key, c[0].data]))

    expect(byKey.get('recall_due_reminder').triggerEventType).toBe('recall_status_changed')
    expect(JSON.parse(byKey.get('recall_due_reminder').triggerCondition)).toEqual({ toValue: 'DUE' })
    expect(byKey.get('recall_dormant_reactivation').triggerEventType).toBe('recall_status_changed')
    expect(JSON.parse(byKey.get('recall_dormant_reactivation').triggerCondition)).toEqual({ toValue: 'OVERDUE_180_PLUS' })
    expect(byKey.get('treatment_incomplete_followup').triggerEventType).toBe('treatment_plan_status_changed')
    expect(JSON.parse(byKey.get('treatment_incomplete_followup').triggerCondition)).toEqual({ toValue: 'INCOMPLETE' })
  })
})

describe('ensureDefaultCrmSequences — repeat boot, sequence still DRAFT', () => {
  it('refreshes touches to the latest approved copy via deleteMany+createMany, never via create (idempotent, no duplicate SequenceDefinition)', async () => {
    prismaMock.sequenceDefinition.findUnique.mockResolvedValue({ id: 'seq-db-1', key: 'recall_due_reminder', status: 'DRAFT' })

    await ensureDefaultCrmSequences()

    // Only the still-DRAFT sequence's touches are refreshed; the other two
    // (also mocked as not-yet-existing via the default findUnique below)
    // still go through create — assert specifically on this one's path.
    expect(prismaMock.sequenceDefinition.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ key: 'recall_due_reminder' }) })
    )
    expect(prismaMock.sequenceTouchTemplate.deleteMany).toHaveBeenCalledWith({ where: { sequenceId: 'seq-db-1' } })
    expect(prismaMock.sequenceTouchTemplate.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([expect.objectContaining({ sequenceId: 'seq-db-1', delayDays: 0 })]),
    })
  })

  it('never refreshes (or otherwise touches) a sequence an admin has already activated', async () => {
    prismaMock.sequenceDefinition.findUnique.mockResolvedValue({ id: 'seq-db-1', key: 'recall_due_reminder', status: 'ACTIVE' })

    await ensureDefaultCrmSequences()

    expect(prismaMock.sequenceTouchTemplate.deleteMany).not.toHaveBeenCalledWith({ where: { sequenceId: 'seq-db-1' } })
    expect(prismaMock.sequenceDefinition.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'seq-db-1' } })
    )
  })

  it('never refreshes (or otherwise touches) a paused sequence either', async () => {
    prismaMock.sequenceDefinition.findUnique.mockResolvedValue({ id: 'seq-db-1', key: 'recall_due_reminder', status: 'PAUSED' })

    await ensureDefaultCrmSequences()

    expect(prismaMock.sequenceTouchTemplate.deleteMany).not.toHaveBeenCalledWith({ where: { sequenceId: 'seq-db-1' } })
  })
})
