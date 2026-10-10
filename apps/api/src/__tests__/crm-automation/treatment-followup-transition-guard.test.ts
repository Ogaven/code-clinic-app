import { beforeEach, describe, expect, it, vi } from 'vitest'

const { db } = vi.hoisted(() => ({
  db: {
    patientActivity: { findMany: vi.fn() },
  },
}))

vi.mock('../../lib/prisma', () => ({ prisma: db }))

import {
  MINIMUM_TREATMENT_FOLLOWUP_ATTEMPTS,
  checkTreatmentFollowUpTransition,
  countTreatmentFollowUpAttempts,
} from '../../crm-automation/treatment-followup-transition-guard.service'

beforeEach(() => { vi.clearAllMocks() })

describe('treatment follow-up transition guard', () => {
  it('allows unrelated treatment plans without an active follow-up', async () => {
    const result = await checkTreatmentFollowUpTransition({ id: 'plan-1', patientId: 'patient-1', followUpAt: null })
    expect(result).toEqual({ allowed: true, attemptCount: 0, minimumAttempts: MINIMUM_TREATMENT_FOLLOWUP_ATTEMPTS })
    expect(db.patientActivity.findMany).not.toHaveBeenCalled()
  })

  it('blocks an active follow-up plan with fewer than three plan-specific attempts', async () => {
    db.patientActivity.findMany.mockResolvedValue([
      { metadata: JSON.stringify({ treatmentPlanId: 'plan-1' }) },
      { metadata: JSON.stringify({ treatmentPlanId: 'plan-1' }) },
      { metadata: JSON.stringify({ treatmentPlanId: 'another-plan' }) },
    ])
    const result = await checkTreatmentFollowUpTransition({ id: 'plan-1', patientId: 'patient-1', followUpAt: new Date() })
    expect(result).toMatchObject({ allowed: false, attemptCount: 2, minimumAttempts: 3 })
  })

  it('allows an active follow-up plan once three attempts are recorded', async () => {
    db.patientActivity.findMany.mockResolvedValue([
      { metadata: JSON.stringify({ treatmentPlanId: 'plan-1' }) },
      { metadata: JSON.stringify({ treatmentPlanId: 'plan-1' }) },
      { metadata: JSON.stringify({ treatmentPlanId: 'plan-1' }) },
    ])
    const result = await checkTreatmentFollowUpTransition({ id: 'plan-1', patientId: 'patient-1', followUpAt: new Date() })
    expect(result).toMatchObject({ allowed: true, attemptCount: 3, minimumAttempts: 3 })
  })

  it('ignores malformed metadata and attempts belonging to another plan', async () => {
    db.patientActivity.findMany.mockResolvedValue([
      { metadata: '{broken' },
      { metadata: JSON.stringify({ treatmentPlanId: 'another-plan' }) },
      { metadata: JSON.stringify({ treatmentPlanId: 'plan-1' }) },
    ])
    expect(await countTreatmentFollowUpAttempts('plan-1', 'patient-1')).toBe(1)
  })
})
