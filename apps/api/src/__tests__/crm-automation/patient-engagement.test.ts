import { describe, expect, it, vi, beforeEach } from 'vitest'

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    patient: { findMany: vi.fn() },
    task: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}))

vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))

import { recallOverview, treatmentFollowUpList, assignTreatmentFollowUpOwner, reactivationCandidates } from '../../crm-automation/patient-engagement.service'

beforeEach(() => { vi.clearAllMocks() })

describe('recallOverview', () => {
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
  })

  it('never activates or touches any sequence — this is a pure read', async () => {
    prismaMock.patient.findMany.mockResolvedValue([])
    await recallOverview()
    expect(prismaMock.patient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ recallStatus: { in: ['DUE', 'OVERDUE_30', 'OVERDUE_90', 'OVERDUE_180_PLUS'] } }) })
    )
  })
})

describe('treatmentFollowUpList', () => {
  it('returns incomplete-treatment patients with no owner when no Task exists yet', async () => {
    prismaMock.patient.findMany.mockResolvedValue([{ id: 'p1', firstName: 'A', lastName: 'B', phone: '1', tagsUpdatedAt: new Date() }])
    prismaMock.task.findMany.mockResolvedValue([])
    const result = await treatmentFollowUpList()
    expect(result).toHaveLength(1)
    expect(result[0].ownerId).toBeNull()
    expect(result[0].ownerName).toBeNull()
  })

  it('attaches the assigned owner from the existing generic Task model (no new schema)', async () => {
    prismaMock.patient.findMany.mockResolvedValue([{ id: 'p1', firstName: 'A', lastName: 'B', phone: '1', tagsUpdatedAt: new Date() }])
    prismaMock.task.findMany.mockResolvedValue([
      { entityId: 'p1', assignedToId: 'user-1', status: 'OPEN', assignedTo: { firstName: 'Jane', lastName: 'Doe' } },
    ])
    const result = await treatmentFollowUpList()
    expect(result[0].ownerId).toBe('user-1')
    expect(result[0].ownerName).toBe('Jane Doe')
  })

  it('queries the real treatmentPlanStatus INCOMPLETE value, scoped to active patients', async () => {
    prismaMock.patient.findMany.mockResolvedValue([])
    await treatmentFollowUpList()
    expect(prismaMock.patient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true, treatmentPlanStatus: 'INCOMPLETE' } })
    )
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

describe('reactivationCandidates', () => {
  it('classifies by dormant-recall vs repeated-no-show reason', async () => {
    prismaMock.patient.findMany.mockResolvedValue([
      { id: 'p1', firstName: 'A', lastName: 'B', phone: '1', recallStatus: 'OVERDUE_180_PLUS', noShowCount: 0, lateCancelCount: 0, tagsUpdatedAt: new Date() },
      { id: 'p2', firstName: 'C', lastName: 'D', phone: '2', recallStatus: 'DUE', noShowCount: 3, lateCancelCount: 0, tagsUpdatedAt: new Date() },
    ])
    const result = await reactivationCandidates()
    expect(result.find(r => r.id === 'p1')!.reason).toBe('DORMANT_180_PLUS')
    expect(result.find(r => r.id === 'p2')!.reason).toBe('REPEATED_NO_SHOW')
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
