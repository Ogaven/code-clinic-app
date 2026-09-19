import { beforeEach, describe, expect, it, vi } from 'vitest'

const { taskFindMany, taskFindUnique, taskUpdate, leadFindMany } = vi.hoisted(() => ({
  taskFindMany: vi.fn(), taskFindUnique: vi.fn(), taskUpdate: vi.fn(), leadFindMany: vi.fn(),
}))
vi.mock('../../lib/prisma', () => ({
  prisma: {
    task: { findMany: taskFindMany, findUnique: taskFindUnique, update: taskUpdate },
    lead: { findMany: leadFindMany },
  },
}))
import { buildLeadFollowUpSummary, completeLeadFollowUp } from '../../crm-automation/lead-followups.service'

beforeEach(() => {
  vi.clearAllMocks()
  leadFindMany.mockResolvedValue([{ id: 'lead-1', name: 'Jane Doe', phone: '+256700000000' }])
})

describe('buildLeadFollowUpSummary — buckets Task rows by due date, joins Lead context', () => {
  it('buckets into dueToday/overdue/upcoming/completed and attaches lead name/phone', async () => {
    taskFindMany
      .mockResolvedValueOnce([{ id: 't-today', title: 'Call back', description: null, dueAt: new Date(), status: 'OPEN', assignedToId: 'u1', entityId: 'lead-1' }])
      .mockResolvedValueOnce([{ id: 't-overdue', title: 'Follow up', description: null, dueAt: new Date(Date.now() - 86400000), status: 'OPEN', assignedToId: 'u1', entityId: 'lead-1' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const summary = await buildLeadFollowUpSummary()

    expect(summary.counts).toEqual({ dueToday: 1, overdue: 1, upcoming: 0, completed: 0 })
    expect(summary.dueToday[0]).toMatchObject({ id: 't-today', leadId: 'lead-1', leadName: 'Jane Doe', leadPhone: '+256700000000' })
    expect(summary.overdue[0]).toMatchObject({ id: 't-overdue', leadId: 'lead-1' })
  })

  it('scopes to a single owner when ownerId is provided', async () => {
    taskFindMany.mockResolvedValue([])
    await buildLeadFollowUpSummary({ ownerId: 'user-2' })
    for (const call of taskFindMany.mock.calls) {
      expect(call[0].where).toMatchObject({ entityType: 'LEAD', assignedToId: 'user-2' })
    }
  })

  it('does not fabricate a lead name when the linked lead no longer exists', async () => {
    leadFindMany.mockResolvedValue([])
    taskFindMany
      .mockResolvedValueOnce([{ id: 't-orphan', title: 'Call back', description: null, dueAt: new Date(), status: 'OPEN', assignedToId: null, entityId: 'lead-missing' }])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([])

    const summary = await buildLeadFollowUpSummary()
    expect(summary.dueToday[0]).toMatchObject({ leadName: null, leadPhone: null })
  })
})

describe('completeLeadFollowUp — only completes real LEAD-entity tasks', () => {
  it('marks a lead task DONE with a completedAt timestamp', async () => {
    taskFindUnique.mockResolvedValue({ id: 't-1', entityType: 'LEAD' })
    taskUpdate.mockResolvedValue({ id: 't-1', status: 'DONE' })

    const result = await completeLeadFollowUp('t-1')

    expect(result).toEqual({ id: 't-1', status: 'DONE' })
    expect(taskUpdate).toHaveBeenCalledWith({
      where: { id: 't-1' },
      data: expect.objectContaining({ status: 'DONE', completedAt: expect.any(Date) }),
      select: { id: true, status: true },
    })
  })

  it('rejects a task id that is not a LEAD task, without writing anything', async () => {
    taskFindUnique.mockResolvedValue({ id: 't-2', entityType: 'PATIENT' })
    await expect(completeLeadFollowUp('t-2')).rejects.toThrow('Follow-up task not found')
    expect(taskUpdate).not.toHaveBeenCalled()
  })

  it('rejects a missing task id', async () => {
    taskFindUnique.mockResolvedValue(null)
    await expect(completeLeadFollowUp('missing')).rejects.toThrow('Follow-up task not found')
  })
})
