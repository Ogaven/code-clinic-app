import { describe, expect, it, vi, beforeEach } from 'vitest'

const { db } = vi.hoisted(() => ({
  db: {
    patient: { findMany: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
    appointment: { findMany: vi.fn() },
    invoice: { findFirst: vi.fn() },
    treatmentPlan: { findMany: vi.fn() },
    automationEvent: { create: vi.fn(), update: vi.fn() },
    sequenceDefinition: { findMany: vi.fn() },
    collectionsCase: { findUnique: vi.fn() },
    sequenceEnrollment: { findMany: vi.fn() },
  },
}))
vi.mock('../../lib/prisma', () => ({ prisma: db }))
import { runDailyPatientTagDerivation } from '../../crm-automation/patient-tags.service'

beforeEach(() => {
  vi.clearAllMocks()
  db.patient.findMany.mockResolvedValue([])
  db.appointment.findMany.mockResolvedValue([])
  db.invoice.findFirst.mockResolvedValue(null)
  db.treatmentPlan.findMany.mockResolvedValue([])
  db.sequenceDefinition.findMany.mockResolvedValue([])
  db.collectionsCase.findUnique.mockResolvedValue(null)
  db.sequenceEnrollment.findMany.mockResolvedValue([])
})

const patient = {
  id: 'p1', createdAt: new Date('2025-01-01'), accountBalance: 0,
  recallInterval: 'SIX_MONTH', recallStatus: 'NOT_DUE', balanceStatus: 'CURRENT',
  balanceAgingBucket: null, lifecycleStage: 'ESTABLISHED', valueTier: 'STANDARD',
  treatmentTypes: [], treatmentPlanStatus: 'NONE',
}

describe('daily recall hygiene derivation', () => {
  it('does not count ordinary completed appointments as a hygiene baseline', async () => {
    db.patient.findMany.mockResolvedValue([patient])
    db.appointment.findMany.mockResolvedValue([{ startAt: new Date('2025-01-01'), service: { name: 'Consultation' } }])
    const result = await runDailyPatientTagDerivation()
    expect(result.scanned).toBe(1)
    expect(db.appointment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { patientId: 'p1', status: 'COMPLETED' },
      select: { startAt: true, service: { select: { name: true } } },
    }))
    expect(db.patient.update).not.toHaveBeenCalled()
  })

  it('ignores a newer Check & Treat when an older hygiene visit is due', async () => {
    db.patient.findMany.mockResolvedValue([patient])
    db.appointment.findMany.mockResolvedValue([
      { startAt: new Date(), service: { name: 'Check & Treat' } },
      { startAt: new Date('2025-01-01'), service: { name: 'Periodontal Maintenance' } },
    ])
    db.patient.findUniqueOrThrow.mockResolvedValue({ ...patient, declineReason: null })
    db.patient.update.mockResolvedValue({ ...patient, recallStatus: 'OVERDUE_180_PLUS', declineReason: null })
    await runDailyPatientTagDerivation()
    expect(db.patient.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ recallStatus: 'OVERDUE_180_PLUS' }),
    }))
  })
})
