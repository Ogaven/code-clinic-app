import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

describe('buildLeadFollowUpSummary — day boundaries are Africa/Kampala, not host-process local time', () => {
  afterEach(() => { vi.useRealTimers() })

  // Regression: this service used to compute "today"/"tomorrow" via
  // new Date().setHours(0,0,0,0), which follows the test/host process's TZ
  // (often UTC in CI) rather than Africa/Kampala (UTC+3, no DST). Kampala is
  // ahead of UTC, so in the ~3-hour window after UTC midnight but before
  // Kampala midnight has actually rolled — no, more precisely: any UTC
  // instant from 21:00 to 23:59 already belongs to the *next* Kampala
  // calendar day. A UTC-local "today" calculation would misclassify a
  // follow-up due right at that boundary as Overdue/Upcoming a full day
  // off. Fixed by routing through utils/kampala-time.ts's
  // startOfKampalaDay/endOfKampalaDay, which do explicit UTC+3 arithmetic
  // independent of process.env.TZ.
  it('treats a task due at Kampala midnight as "due today", using the Kampala day boundary rather than the UTC day boundary', async () => {
    // 2026-06-15T22:15:00Z UTC == 2026-06-16T01:15:00 Kampala (UTC+3) — i.e.
    // the Kampala calendar day is already the 16th, while the UTC calendar
    // day is still the 15th.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-15T22:15:00.000Z'))
    taskFindMany.mockResolvedValue([])

    await buildLeadFollowUpSummary()

    // Kampala midnight for the 16th is 2026-06-15T21:00:00Z (00:00 + a
    // UTC-3 shift back); the next Kampala midnight (the "tomorrow" bound) is
    // 2026-06-16T21:00:00Z. A UTC-local implementation would instead have
    // used 2026-06-15T00:00:00Z / 2026-06-16T00:00:00Z — 21 hours off.
    const expectedTodayStart = new Date('2026-06-15T21:00:00.000Z')
    const expectedTomorrowStart = new Date('2026-06-16T21:00:00.000Z')

    const [dueTodayCall, overdueCall, upcomingCall] = taskFindMany.mock.calls
    expect(dueTodayCall[0].where.dueAt).toEqual({ gte: expectedTodayStart, lt: expectedTomorrowStart })
    expect(overdueCall[0].where.dueAt).toEqual({ lt: expectedTodayStart })
    expect(upcomingCall[0].where.dueAt).toEqual({ gte: expectedTomorrowStart })
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
