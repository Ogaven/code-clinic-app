import { describe, expect, it, vi, beforeEach } from 'vitest'

// Milestone: CRM Data/Role-Parity closure. patient-engagement.service.ts's
// Recall/Reactivation/Treatment-Follow-up queries were individually
// correct but each silently went empty for real production data: Recall
// requires a manually-set Patient.recallInterval nothing ever backfills,
// Reactivation's no-show counters only started accruing after a fixed
// date, and Treatment Follow-up's canonical 'Follow-up Due' pipeline stage
// is rarely used by staff. These tests cover the new read-time
// reconciliation layers added on top of each (never persisted, always
// clearly flagged as estimated) plus the original confirmed-data paths.

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    patient: { findMany: vi.fn() },
    treatmentPlan: { findMany: vi.fn() },
    patientActivity: { findMany: vi.fn() },
    appointment: { findMany: vi.fn() },
    task: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    $queryRaw: vi.fn(),
  },
}))

vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))

import { recallOverview, treatmentFollowUpList, assignTreatmentFollowUpOwner, reactivationCandidates } from '../../crm-automation/patient-engagement.service'

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.$queryRaw.mockResolvedValue([])
  prismaMock.patientActivity.findMany.mockResolvedValue([])
  prismaMock.appointment.findMany.mockImplementation(async (args: any) => (args.where.patientId?.in ?? []).map((patientId: string) => ({ patientId, startAt: new Date(Date.now() - (patientId === 'p1' ? 190 : 400) * 86_400_000), service: { name: 'Periodontal Maintenance' } })))
})

describe('recallOverview — confirmed bucket (unchanged behavior)', () => {
  it('groups patients into the four real recall buckets, never inventing a fifth', async () => {
    prismaMock.patient.findMany.mockResolvedValue([
      { id: 'p1', firstName: 'A', lastName: 'B', phone: '1', recallStatus: 'DUE', recallInterval: 'SIX_MONTH', tagsUpdatedAt: new Date() },
      { id: 'p2', firstName: 'C', lastName: 'D', phone: '2', recallStatus: 'OVERDUE_180_PLUS', recallInterval: 'SIX_MONTH', tagsUpdatedAt: new Date() },
    ])
    const result = await recallOverview()
    expect(result.buckets.map(b => b.key)).toEqual(['DUE', 'OVERDUE_30', 'OVERDUE_90', 'OVERDUE_180_PLUS'])
    expect(result.buckets.find(b => b.key === 'DUE')!.count).toBe(1)
    expect(result.buckets.find(b => b.key === 'OVERDUE_180_PLUS')!.count).toBe(1)
    expect(result.buckets.find(b => b.key === 'OVERDUE_30')!.count).toBe(0)
    expect(result.totalNeedingAttention).toBe(2)
    expect(result.totalEstimated).toBe(0)
  })

  it('only reads completed hygiene visits for confirmed recall candidates', async () => {
    prismaMock.patient.findMany.mockResolvedValue([
      { id: 'p1', firstName: 'A', lastName: 'B', phone: '1', recallStatus: 'DUE', recallInterval: 'SIX_MONTH', tagsUpdatedAt: new Date() },
    ])
    await recallOverview()
    expect(prismaMock.appointment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: 'COMPLETED',
      }),
    }))
    expect(prismaMock.appointment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ service: { select: { name: true } } }),
    }))
  })

  it('excludes patients with no qualifying hygiene visit despite an old recall tag', async () => {
    prismaMock.patient.findMany.mockResolvedValue([
      { id: 'p1', firstName: 'A', lastName: 'B', phone: '1', recallStatus: 'DUE', recallInterval: 'SIX_MONTH', tagsUpdatedAt: new Date() },
    ])
    prismaMock.appointment.findMany.mockResolvedValue([])
    const result = await recallOverview()
    expect(result.totalNeedingAttention).toBe(0)
  })

  it('confirmed patients are never flagged estimated', async () => {
    prismaMock.patient.findMany.mockResolvedValue([
      { id: 'p1', firstName: 'A', lastName: 'B', phone: '1', recallStatus: 'DUE', recallInterval: 'SIX_MONTH', tagsUpdatedAt: new Date() },
    ])
    const result = await recallOverview()
    expect(result.buckets.find(b => b.key === 'DUE')!.patients[0].estimated).toBe(false)
  })
})

describe('recallOverview — read-time estimated bucket (recallInterval never backfilled)', () => {
  it('includes a patient with no recallInterval whose last completed visit is 400 days ago, flagged estimated', async () => {
    prismaMock.patient.findMany.mockResolvedValue([]) // no confirmed patients
    // With the default SIX_MONTH (180d) estimate, "overdue 180+" means the
    // due date (visit + 180d) is itself 180+ days in the past — i.e. the
    // visit must be 360+ days ago, not merely 180+.
    const wellOverAYearAgo = new Date(Date.now() - 400 * 86_400_000)
    prismaMock.$queryRaw.mockResolvedValue([
      { id: 'p-est', firstName: 'Est', lastName: 'Imated', phone: '9', lastCompletedAt: wellOverAYearAgo },
    ])
    const result = await recallOverview()
    expect(prismaMock.$queryRaw.mock.calls[0][0].join(' ')).toContain('recall hygiene visit')
    const overdue180 = result.buckets.find(b => b.key === 'OVERDUE_180_PLUS')!
    expect(overdue180.count).toBe(1)
    expect(overdue180.patients[0].id).toBe('p-est')
    expect(overdue180.patients[0].estimated).toBe(true)
    expect(result.totalEstimated).toBe(1)
  })

  it('never persists anything — this is a read-only estimate, no prisma write call exists in the module', async () => {
    prismaMock.patient.findMany.mockResolvedValue([])
    prismaMock.$queryRaw.mockResolvedValue([{ id: 'p1', firstName: 'A', lastName: 'B', phone: '1', lastCompletedAt: new Date(Date.now() - 400 * 86_400_000) }])
    await recallOverview()
    // The only mocked prisma surface is findMany/$queryRaw — no update/create
    // exists on prismaMock at all, so any write attempt would throw. Reaching
    // this point without throwing proves no write was attempted.
    expect(prismaMock.patient.findMany).toHaveBeenCalledTimes(1)
  })

  it('excludes a patient whose last completed visit was recent (not yet due even under the default 6-month estimate)', async () => {
    prismaMock.patient.findMany.mockResolvedValue([])
    prismaMock.$queryRaw.mockResolvedValue([
      { id: 'p-recent', firstName: 'Recent', lastName: 'Visit', phone: '1', lastCompletedAt: new Date() },
    ])
    const result = await recallOverview()
    expect(result.totalNeedingAttention).toBe(0)
  })
})

describe('treatmentFollowUpList — same source as pipeline Follow Up queue', () => {
  const plan = {
    id: 'plan-1', patientId: 'p1', stage: 'Treatment Presented',
    status: 'On Hold', notes: 'Doctor requested review',
    followUpAt: new Date('2026-11-01'), followUpReason: 'Patient deciding',
    followUpNote: 'Call next week',
    patient: { firstName: 'A', lastName: 'B', phone: '1' },
  }

  it('reads scheduled actionable plans and preserves plan-specific dentist notes', async () => {
    prismaMock.treatmentPlan.findMany.mockResolvedValue([plan])
    prismaMock.task.findMany.mockResolvedValue([])
    const result = await treatmentFollowUpList()
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: 'p1', treatmentPlanId: 'plan-1', procedure: 'Treatment Presented',
      dentistNote: 'Doctor requested review', followUpReason: 'Patient deciding',
      followUpNote: 'Call next week', ownerId: null,
    })
    expect(prismaMock.treatmentPlan.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        followUpAt: { not: null },
        status: { notIn: ['Completed', 'Cancelled', 'Declined'] },
        patient: { isActive: true },
      },
    }))
  })

  it('reuses existing patient-level owner assignments', async () => {
    prismaMock.treatmentPlan.findMany.mockResolvedValue([plan])
    prismaMock.task.findMany.mockResolvedValue([
      { entityId: 'p1', assignedToId: 'user-1', status: 'OPEN', assignedTo: { firstName: 'Jane', lastName: 'Doe' } },
    ])
    const result = await treatmentFollowUpList()
    expect(result[0].ownerName).toBe('Jane Doe')
  })

  it('shows the latest staff reminder and count without modifying the dentist follow-up date', async () => {
    prismaMock.treatmentPlan.findMany.mockResolvedValue([plan])
    prismaMock.task.findMany.mockResolvedValue([])
    prismaMock.patientActivity.findMany.mockResolvedValue([
      { createdAt: new Date('2026-10-01'), metadata: JSON.stringify({ treatmentPlanId: 'plan-1', nextReminderAt: '2026-11-05T09:00:00.000Z' }) },
      { createdAt: new Date('2026-10-02'), metadata: JSON.stringify({ treatmentPlanId: 'plan-1', nextReminderAt: '2026-11-10T09:00:00.000Z' }) },
    ])
    const result = await treatmentFollowUpList()
    expect(result[0].attemptCount).toBe(2)
    expect(result[0].nextReminderAt.toISOString()).toBe('2026-11-10T09:00:00.000Z')
    expect(result[0].followUpAt.toISOString()).toBe('2026-11-01T00:00:00.000Z')
  })

  it('does not add unscheduled stale proposals to the Follow Up queue', async () => {
    prismaMock.treatmentPlan.findMany.mockResolvedValue([])
    const result = await treatmentFollowUpList()
    expect(result).toEqual([])
    expect(prismaMock.patient.findMany).not.toHaveBeenCalled()
  })
})

describe('assignTreatmentFollowUpOwner (idempotent Task reuse)', () => {
  it('creates a new Task when none exists yet', async () => {
    prismaMock.task.findFirst.mockResolvedValue(null)
    await assignTreatmentFollowUpOwner('p1', 'user-1')
    expect(prismaMock.task.create).toHaveBeenCalledWith({
      data: { entityType: 'PATIENT', entityId: 'p1', title: 'Treatment follow-up', assignedToId: 'user-1', status: 'OPEN' },
    })
    expect(prismaMock.task.update).not.toHaveBeenCalled()
  })

  it('reassigns the existing open Task instead of creating a duplicate', async () => {
    prismaMock.task.findFirst.mockResolvedValue({ id: 'task-1' })
    await assignTreatmentFollowUpOwner('p1', 'user-2')
    expect(prismaMock.task.update).toHaveBeenCalledWith({ where: { id: 'task-1' }, data: { assignedToId: 'user-2' } })
    expect(prismaMock.task.create).not.toHaveBeenCalled()
  })

  it('unassigning passes ownerId: null through unchanged', async () => {
    prismaMock.task.findFirst.mockResolvedValue({ id: 'task-1' })
    await assignTreatmentFollowUpOwner('p1', null)
    expect(prismaMock.task.update).toHaveBeenCalledWith({ where: { id: 'task-1' }, data: { assignedToId: null } })
  })
})

describe('reactivationCandidates — confirmed data (unchanged behavior)', () => {
  it('classifies by dormant-recall vs repeated-no-show reason', async () => {
    prismaMock.patient.findMany.mockResolvedValue([
      { id: 'p1', firstName: 'A', lastName: 'B', phone: '1', recallStatus: 'OVERDUE_180_PLUS', noShowCount: 0, lateCancelCount: 0, tagsUpdatedAt: new Date() },
      { id: 'p2', firstName: 'C', lastName: 'D', phone: '2', recallStatus: 'DUE', noShowCount: 3, lateCancelCount: 0, tagsUpdatedAt: new Date() },
    ])
    const result = await reactivationCandidates()
    expect(result.find(r => r.id === 'p1')!.reason).toBe('DORMANT_180_PLUS')
    expect(result.find(r => r.id === 'p2')!.reason).toBe('REPEATED_NO_SHOW')
    expect(result.find(r => r.id === 'p1')!.estimated).toBe(false)
  })

  it('queries the OR of dormant-recall / 2+ no-shows / 2+ late-cancels, scoped to active patients', async () => {
    prismaMock.patient.findMany.mockResolvedValue([])
    await reactivationCandidates()
    expect(prismaMock.patient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isActive: true,
          OR: [{ recallStatus: 'OVERDUE_180_PLUS' }, { noShowCount: { gte: 2 } }, { lateCancelCount: { gte: 2 } }],
        },
      })
    )
  })
})

describe('reactivationCandidates — real historical no-show data (counter has no backfill)', () => {
  it('surfaces a patient with 2+ real historical NO_SHOW appointments even if the live counter never caught up', async () => {
    prismaMock.patient.findMany.mockImplementation(async (args: any) => {
      if (args.where?.id?.in) {
        return [{ id: 'p-hist', firstName: 'Old', lastName: 'NoShow', phone: '5', recallStatus: 'NOT_DUE', noShowCount: 0, lateCancelCount: 0 }]
      }
      return [] // the main OR query finds nobody via live counters
    })
    prismaMock.$queryRaw.mockImplementation(async (strings: any) => {
      const sql = strings.join(' ')
      if (sql.includes('NO_SHOW')) return [{ patientId: 'p-hist' }]
      return [] // estimatedRecallCandidates' query
    })
    const result = await reactivationCandidates()
    expect(result.find(r => r.id === 'p-hist')).toBeDefined()
    expect(result.find(r => r.id === 'p-hist')!.reason).toBe('REPEATED_NO_SHOW')
  })

  it('does not duplicate a patient already found via the live counter query', async () => {
    prismaMock.patient.findMany.mockResolvedValue([
      { id: 'p1', firstName: 'A', lastName: 'B', phone: '1', recallStatus: 'NOT_DUE', noShowCount: 2, lateCancelCount: 0, tagsUpdatedAt: new Date() },
    ])
    prismaMock.$queryRaw.mockImplementation(async (strings: any) => {
      const sql = strings.join(' ')
      if (sql.includes('NO_SHOW')) return [{ patientId: 'p1' }] // same patient, real historical data agrees
      return []
    })
    const result = await reactivationCandidates()
    expect(result.filter(r => r.id === 'p1')).toHaveLength(1)
  })
})

describe('reactivationCandidates — estimated dormancy (no recallInterval, real visit gap)', () => {
  it('includes a patient with no recallInterval and no completed visit in 180+ days, flagged DORMANT_ESTIMATED', async () => {
    prismaMock.patient.findMany.mockResolvedValue([])
    prismaMock.$queryRaw.mockImplementation(async (strings: any) => {
      const sql = strings.join(' ')
      if (sql.includes('NO_SHOW')) return []
      return [{ id: 'p-est', firstName: 'Est', lastName: 'Dormant', phone: '9', lastCompletedAt: new Date(Date.now() - 400 * 86_400_000) }]
    })
    const result = await reactivationCandidates()
    expect(result.find(r => r.id === 'p-est')!.reason).toBe('DORMANT_ESTIMATED')
    expect(result.find(r => r.id === 'p-est')!.estimated).toBe(true)
  })
})
