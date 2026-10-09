import { beforeEach, describe, expect, it, vi } from 'vitest'
const { db } = vi.hoisted(() => ({
  db: {
    treatmentPlan: { findUnique: vi.fn() },
    patientActivity: { create: vi.fn(), findMany: vi.fn() },
  },
}))
vi.mock('../../lib/prisma', () => ({ prisma: db }))
import { listTreatmentContactAttempts, recordTreatmentContactAttempt, validateContactAttempt } from '../../crm-automation/treatment-contact-attempts.service'

const input = { method: 'PHONE', outcome: 'NO_ANSWER', comment: 'Left a voicemail', nextReminderAt: '2026-11-01T09:00:00.000Z' }
const staff = { id: 'staff-1', firstName: 'Jane', lastName: 'Doe' }
beforeEach(() => { vi.clearAllMocks() })

describe('treatment plan contact attempts', () => {
  it('rejects invalid method, outcome and empty comments', () => {
    expect(validateContactAttempt({ ...input, method: 'AUTO_SEND' })).toBeTruthy()
    expect(validateContactAttempt({ ...input, outcome: 'UNKNOWN' })).toBeTruthy()
    expect(validateContactAttempt({ ...input, comment: ' ' })).toBeTruthy()
    expect(validateContactAttempt(input)).toBeNull()
  })
  it('writes one staff-attributed append-only activity without sending messages or changing pipeline stage', async () => {
    db.treatmentPlan.findUnique.mockResolvedValue({ patientId: 'patient-1', followUpAt: new Date(), status: 'On Hold' })
    db.patientActivity.create.mockResolvedValue({ id: 'attempt-1' })
    await recordTreatmentContactAttempt('plan-1', input, staff)
    expect(db.patientActivity.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      patientId: 'patient-1', userId: 'staff-1', userName: 'Jane Doe', action: 'TREATMENT_FOLLOWUP_CONTACT_ATTEMPT',
    }) })
    const metadata = JSON.parse(db.patientActivity.create.mock.calls[0][0].data.metadata)
    expect(metadata).toMatchObject({ treatmentPlanId: 'plan-1', method: 'PHONE', nextReminderAt: input.nextReminderAt })
  })
  it('does not record attempts against resolved plans', async () => {
    db.treatmentPlan.findUnique.mockResolvedValue({ patientId: 'patient-1', followUpAt: new Date(), status: 'Completed' })
    expect(await recordTreatmentContactAttempt('plan-1', input, staff)).toBeNull()
    expect(db.patientActivity.create).not.toHaveBeenCalled()
  })
  it('returns only attempts linked to the selected plan, retaining chronological order', async () => {
    db.treatmentPlan.findUnique.mockResolvedValue({ patientId: 'patient-1' })
    db.patientActivity.findMany.mockResolvedValue([
      { id: 'a', userId: 'u', userName: 'Jane', createdAt: new Date(), metadata: JSON.stringify({ treatmentPlanId: 'plan-1', ...input }) },
      { id: 'b', userId: 'u', userName: 'Jane', createdAt: new Date(), metadata: JSON.stringify({ treatmentPlanId: 'other', ...input }) },
    ])
    const result = await listTreatmentContactAttempts('plan-1')
    expect(result).toHaveLength(1)
    expect(result?.[0].id).toBe('a')
  })
})
