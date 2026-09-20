import { describe, expect, it, vi, beforeEach } from 'vitest'

// Milestone B/C — the default recall/treatment-follow-up sequence templates
// must be created in DRAFT status only, with placeholder copy, and the
// upsert must never touch a sequence again after first creation (an admin
// may have already edited/activated it).

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    sequenceDefinition: { upsert: vi.fn().mockResolvedValue({}) },
  },
}))

vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))

import { ensureDefaultCrmSequences } from '../../crm-automation/seed-default-sequences'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ensureDefaultCrmSequences', () => {
  it('creates exactly the recall and treatment-follow-up sequences, all in DRAFT status', async () => {
    await ensureDefaultCrmSequences()

    expect(prismaMock.sequenceDefinition.upsert).toHaveBeenCalledTimes(3)
    const keys = prismaMock.sequenceDefinition.upsert.mock.calls.map((c: any) => c[0].where.key)
    expect(keys.sort()).toEqual(['recall_due_reminder', 'recall_dormant_reactivation', 'treatment_incomplete_followup'].sort())

    for (const call of prismaMock.sequenceDefinition.upsert.mock.calls as any[]) {
      expect(call[0].create.status).toBe('DRAFT')
      expect(call[0].create.entityType).toBe('PATIENT')
      for (const touch of call[0].create.touches.create) {
        expect(touch.messageTemplate).toMatch(/^\[PLACEHOLDER/)
      }
    }
  })

  it('never overwrites an existing sequence on repeat calls (idempotent, admin edits preserved)', async () => {
    await ensureDefaultCrmSequences()
    for (const call of prismaMock.sequenceDefinition.upsert.mock.calls as any[]) {
      expect(call[0].update).toEqual({})
    }
  })

  it('scopes the recall sequences to the recall_status_changed trigger and the treatment sequence to treatment_plan_status_changed', async () => {
    await ensureDefaultCrmSequences()
    const byKey = new Map(prismaMock.sequenceDefinition.upsert.mock.calls.map((c: any) => [c[0].where.key, c[0].create]))

    expect(byKey.get('recall_due_reminder').triggerEventType).toBe('recall_status_changed')
    expect(JSON.parse(byKey.get('recall_due_reminder').triggerCondition)).toEqual({ toValue: 'DUE' })
    expect(byKey.get('recall_dormant_reactivation').triggerEventType).toBe('recall_status_changed')
    expect(JSON.parse(byKey.get('recall_dormant_reactivation').triggerCondition)).toEqual({ toValue: 'OVERDUE_180_PLUS' })
    expect(byKey.get('treatment_incomplete_followup').triggerEventType).toBe('treatment_plan_status_changed')
    expect(JSON.parse(byKey.get('treatment_incomplete_followup').triggerCondition)).toEqual({ toValue: 'INCOMPLETE' })
  })
})
