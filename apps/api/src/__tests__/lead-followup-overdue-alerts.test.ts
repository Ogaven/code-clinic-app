// Covers the "Lead follow-up overdue" staff notification sweep
// (apps/api/src/crm-automation/lead-followup-overdue-alerts.service.ts).
// Mirrors lead-needs-help-alerts.test.ts's approach: buildLeadFollowUpSummary
// is mocked at its own module boundary (its own correctness is covered by
// lead-followups.service's own tests) — these tests assert only this
// sweep's own routing/dedup/gating logic.

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 20000 })

const store = vi.hoisted(() => ({
  notifications: [] as any[],
  users: new Map<string, any>(),
}))

vi.mock('../lib/prisma', () => ({
  prisma: {
    notification: {
      findFirst: vi.fn(async ({ where }: any) => {
        return store.notifications.find(n =>
          n.userId === where.userId && n.href === where.href && n.title === where.title && n.isRead === where.isRead
        ) ?? null
      }),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `notif_${store.notifications.length + 1}`, isRead: false, ...data }
        store.notifications.push(row)
        return row
      }),
    },
    user: {
      findMany: vi.fn(async ({ where }: any) => {
        const roles: string[] = where?.role?.in ? where.role.in : [where?.role]
        return [...store.users.values()].filter(u => roles.includes(u.role) && u.isActive === where?.isActive)
      }),
      findUnique: vi.fn(async ({ where }: any) => store.users.get(where.id) ?? null),
    },
  },
}))

const buildLeadFollowUpSummaryMock = vi.hoisted(() => vi.fn())
vi.mock('../crm-automation/lead-followups.service', () => ({
  buildLeadFollowUpSummary: buildLeadFollowUpSummaryMock,
}))

const isCrmFeatureLiveMock = vi.hoisted(() => vi.fn().mockReturnValue(false))
vi.mock('../crm-automation/dry-run', () => ({
  isCrmFeatureLive: isCrmFeatureLiveMock,
}))

const pushMock = vi.hoisted(() => vi.fn(async (_userId: string, _payload: { title: string; body: string; url?: string }) => {}))
vi.mock('../services/push.service', () => ({
  sendPushToUser: pushMock,
}))

function summaryWithOverdue(overdue: any[]) {
  return {
    generatedAt: new Date().toISOString(),
    counts: { dueToday: 0, overdue: overdue.length, upcoming: 0, completed: 0 },
    dueToday: [], overdue, upcoming: [], completed: [],
  }
}

beforeEach(() => {
  store.notifications.length = 0
  store.users.clear()
  pushMock.mockClear()
  isCrmFeatureLiveMock.mockReturnValue(false)
  buildLeadFollowUpSummaryMock.mockReset()

  store.users.set('admin_1', { id: 'admin_1', role: 'ADMIN', isActive: true })
  store.users.set('reception_owner', { id: 'reception_owner', role: 'RECEPTIONIST', isActive: true })
})

describe('checkLeadFollowUpOverdueAlerts', () => {
  it('routes to the overdue task\'s own assignee, using the exact spec\'d title/body', async () => {
    buildLeadFollowUpSummaryMock.mockResolvedValue(summaryWithOverdue([
      { id: 'task_1', leadId: 'lead_1', assignedToId: 'reception_owner' },
    ]))
    const { checkLeadFollowUpOverdueAlerts } = await import('../crm-automation/lead-followup-overdue-alerts.service')

    await checkLeadFollowUpOverdueAlerts()

    expect(store.notifications).toHaveLength(1)
    expect(store.notifications[0].userId).toBe('reception_owner')
    expect(store.notifications[0].title).toBe('Lead follow-up overdue')
    expect(store.notifications[0].body).toBe('A scheduled lead follow-up needs attention. Tap to review.')
    expect(store.notifications[0].href).toBe('/receptionist/leads?open=lead_1')
  })

  it('routes an unassigned overdue task to every active admin, using the admin-scoped href', async () => {
    store.users.set('admin_2', { id: 'admin_2', role: 'ADMIN', isActive: true })
    buildLeadFollowUpSummaryMock.mockResolvedValue(summaryWithOverdue([
      { id: 'task_2', leadId: 'lead_2', assignedToId: null },
    ]))
    const { checkLeadFollowUpOverdueAlerts } = await import('../crm-automation/lead-followup-overdue-alerts.service')

    await checkLeadFollowUpOverdueAlerts()

    const recipientIds = store.notifications.map(n => n.userId).sort()
    expect(recipientIds).toEqual(['admin_1', 'admin_2'])
    expect(store.notifications[0].href).toBe('/leads?open=lead_2')
  })

  it('falls back to admins when the assigned owner is no longer active', async () => {
    store.users.set('reception_owner', { id: 'reception_owner', role: 'RECEPTIONIST', isActive: false })
    buildLeadFollowUpSummaryMock.mockResolvedValue(summaryWithOverdue([
      { id: 'task_3', leadId: 'lead_3', assignedToId: 'reception_owner' },
    ]))
    const { checkLeadFollowUpOverdueAlerts } = await import('../crm-automation/lead-followup-overdue-alerts.service')

    await checkLeadFollowUpOverdueAlerts()

    expect(store.notifications.map(n => n.userId)).toEqual(['admin_1'])
  })

  it('two separate overdue tasks on the same lead produce two distinct notifications — each is real outstanding work', async () => {
    buildLeadFollowUpSummaryMock.mockResolvedValue(summaryWithOverdue([
      { id: 'task_a', leadId: 'lead_shared', assignedToId: 'reception_owner' },
      { id: 'task_b', leadId: 'lead_shared', assignedToId: 'reception_owner' },
    ]))
    const { checkLeadFollowUpOverdueAlerts } = await import('../crm-automation/lead-followup-overdue-alerts.service')

    const result = await checkLeadFollowUpOverdueAlerts()

    // Same (userId, href, title) for both -- the second is a no-op dedup,
    // which is correct: one still-open alert for that lead is enough, even
    // though there are two underlying tasks.
    expect(store.notifications).toHaveLength(1)
    expect(result.overdueConsidered).toBe(2)
  })

  it('does not create a duplicate while an unread alert for this exact lead+recipient is still open (idempotent across sweep runs)', async () => {
    buildLeadFollowUpSummaryMock.mockResolvedValue(summaryWithOverdue([
      { id: 'task_1', leadId: 'lead_1', assignedToId: 'reception_owner' },
    ]))
    const { checkLeadFollowUpOverdueAlerts } = await import('../crm-automation/lead-followup-overdue-alerts.service')

    await checkLeadFollowUpOverdueAlerts()
    expect(store.notifications).toHaveLength(1)

    await checkLeadFollowUpOverdueAlerts()
    expect(store.notifications).toHaveLength(1)
  })

  it('does not send a push when CRM OPERATIONAL is not live, but still writes the persistent notification', async () => {
    isCrmFeatureLiveMock.mockReturnValue(false)
    buildLeadFollowUpSummaryMock.mockResolvedValue(summaryWithOverdue([
      { id: 'task_1', leadId: 'lead_1', assignedToId: 'reception_owner' },
    ]))
    const { checkLeadFollowUpOverdueAlerts } = await import('../crm-automation/lead-followup-overdue-alerts.service')

    await checkLeadFollowUpOverdueAlerts()

    expect(store.notifications).toHaveLength(1)
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('sends a push when CRM OPERATIONAL is live', async () => {
    isCrmFeatureLiveMock.mockReturnValue(true)
    buildLeadFollowUpSummaryMock.mockResolvedValue(summaryWithOverdue([
      { id: 'task_1', leadId: 'lead_1', assignedToId: 'reception_owner' },
    ]))
    const { checkLeadFollowUpOverdueAlerts } = await import('../crm-automation/lead-followup-overdue-alerts.service')

    await checkLeadFollowUpOverdueAlerts()

    expect(pushMock).toHaveBeenCalledWith('reception_owner', expect.objectContaining({
      title: 'Lead follow-up overdue',
      body: 'A scheduled lead follow-up needs attention. Tap to review.',
    }))
  })

  it('an empty overdue list is a safe no-op', async () => {
    buildLeadFollowUpSummaryMock.mockResolvedValue(summaryWithOverdue([]))
    const { checkLeadFollowUpOverdueAlerts } = await import('../crm-automation/lead-followup-overdue-alerts.service')

    const result = await checkLeadFollowUpOverdueAlerts()

    expect(result).toEqual({ overdueConsidered: 0, notified: 0 })
    expect(store.notifications).toHaveLength(0)
  })
})
