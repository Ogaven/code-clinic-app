// Covers the "Lead needs help" staff notification sweep
// (apps/api/src/crm-automation/lead-needs-help-alerts.service.ts). This
// sweep invents no new lead state machine — it only reads the existing
// Needs Attention queue (mocked here at its own module boundary, since that
// queue's own correctness is covered by needs-attention.service's own
// tests) and turns "this lead needs attention" into owner-else-admin
// routing with unread-notification dedup and CRM operational-flag-gated
// push. These tests assert only THIS sweep's own logic.

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

const buildNeedsAttentionQueueMock = vi.hoisted(() => vi.fn())
vi.mock('../crm-automation/needs-attention.service', () => ({
  buildNeedsAttentionQueue: buildNeedsAttentionQueueMock,
}))

const isCrmFeatureLiveMock = vi.hoisted(() => vi.fn().mockReturnValue(false))
vi.mock('../crm-automation/dry-run', () => ({
  isCrmFeatureLive: isCrmFeatureLiveMock,
}))

const pushMock = vi.hoisted(() => vi.fn(async (_userId: string, _payload: { title: string; body: string; url?: string }) => {}))
vi.mock('../services/push.service', () => ({
  sendPushToUser: pushMock,
}))

function queueWith(categories: Array<{ key: string; items: any[] }>) {
  return {
    generatedAt: new Date().toISOString(),
    ownerId: null,
    distinctLeadCount: 0,
    distinctPeopleCount: 0,
    totalItems: 0,
    categories: categories.map(c => ({ key: c.key, label: c.key, scope: 'LEAD_OWNER', entityKind: 'LEAD', count: c.items.length, items: c.items })),
  }
}

beforeEach(() => {
  store.notifications.length = 0
  store.users.clear()
  pushMock.mockClear()
  isCrmFeatureLiveMock.mockReturnValue(false)
  buildNeedsAttentionQueueMock.mockReset()

  store.users.set('admin_1', { id: 'admin_1', role: 'ADMIN', isActive: true })
  store.users.set('reception_owner', { id: 'reception_owner', role: 'RECEPTIONIST', isActive: true })
})

describe('checkLeadNeedsHelpAlerts', () => {
  it('routes to the lead\'s own owner when one exists and is active, using the exact spec\'d title/body', async () => {
    buildNeedsAttentionQueueMock.mockResolvedValue(queueWith([
      { key: 'UNANSWERED_NEW', items: [{ id: 'lead_1', assignedTo: 'reception_owner' }] },
    ]))
    const { checkLeadNeedsHelpAlerts } = await import('../crm-automation/lead-needs-help-alerts.service')

    await checkLeadNeedsHelpAlerts()

    expect(store.notifications).toHaveLength(1)
    expect(store.notifications[0].userId).toBe('reception_owner')
    expect(store.notifications[0].title).toBe('Lead needs help')
    expect(store.notifications[0].body).toBe('A CRM lead needs staff assistance. Tap to review.')
  })

  it('uses the receptionist-scoped href for a RECEPTIONIST recipient and the admin-scoped href for an ADMIN recipient', async () => {
    buildNeedsAttentionQueueMock.mockResolvedValue(queueWith([
      { key: 'UNANSWERED_NEW', items: [{ id: 'lead_1', assignedTo: 'reception_owner' }] },
    ]))
    const { checkLeadNeedsHelpAlerts } = await import('../crm-automation/lead-needs-help-alerts.service')
    await checkLeadNeedsHelpAlerts()
    expect(store.notifications[0].href).toBe('/receptionist/leads?open=lead_1')

    store.notifications.length = 0
    buildNeedsAttentionQueueMock.mockResolvedValue(queueWith([
      { key: 'UNASSIGNED', items: [{ id: 'lead_2' }] },
    ]))
    const { checkLeadNeedsHelpAlerts: checkAgain } = await import('../crm-automation/lead-needs-help-alerts.service')
    await checkAgain()
    const adminNotif = store.notifications.find(n => n.userId === 'admin_1')
    expect(adminNotif!.href).toBe('/leads?open=lead_2')
  })

  it('routes an unassigned lead to every active admin', async () => {
    store.users.set('admin_2', { id: 'admin_2', role: 'ADMIN', isActive: true })
    buildNeedsAttentionQueueMock.mockResolvedValue(queueWith([
      { key: 'UNASSIGNED', items: [{ id: 'lead_unassigned' }] },
    ]))
    const { checkLeadNeedsHelpAlerts } = await import('../crm-automation/lead-needs-help-alerts.service')

    await checkLeadNeedsHelpAlerts()

    const recipientIds = store.notifications.map(n => n.userId).sort()
    expect(recipientIds).toEqual(['admin_1', 'admin_2'])
  })

  it('falls back to admins when the assigned owner is no longer active', async () => {
    store.users.set('reception_owner', { id: 'reception_owner', role: 'RECEPTIONIST', isActive: false })
    buildNeedsAttentionQueueMock.mockResolvedValue(queueWith([
      { key: 'OVERDUE_FOLLOWUP', items: [{ id: 'lead_3', assignedTo: 'reception_owner' }] },
    ]))
    const { checkLeadNeedsHelpAlerts } = await import('../crm-automation/lead-needs-help-alerts.service')

    await checkLeadNeedsHelpAlerts()

    const recipientIds = store.notifications.map(n => n.userId)
    expect(recipientIds).toEqual(['admin_1'])
  })

  it('a lead appearing in multiple Needs Attention categories still produces exactly one notification per recipient', async () => {
    buildNeedsAttentionQueueMock.mockResolvedValue(queueWith([
      { key: 'UNANSWERED_NEW',   items: [{ id: 'lead_dup', assignedTo: 'reception_owner' }] },
      { key: 'STALE_UNTOUCHED',  items: [{ id: 'lead_dup', assignedTo: 'reception_owner' }] },
      { key: 'QUALIFIED_UNBOOKED', items: [{ id: 'lead_dup', assignedTo: 'reception_owner' }] },
    ]))
    const { checkLeadNeedsHelpAlerts } = await import('../crm-automation/lead-needs-help-alerts.service')

    const result = await checkLeadNeedsHelpAlerts()

    expect(store.notifications).toHaveLength(1)
    expect(result.leadsConsidered).toBe(1)
  })

  it('does not create a duplicate while an unread alert for this exact lead+recipient is still open (idempotent across sweep runs)', async () => {
    buildNeedsAttentionQueueMock.mockResolvedValue(queueWith([
      { key: 'UNANSWERED_NEW', items: [{ id: 'lead_1', assignedTo: 'reception_owner' }] },
    ]))
    const { checkLeadNeedsHelpAlerts } = await import('../crm-automation/lead-needs-help-alerts.service')

    await checkLeadNeedsHelpAlerts()
    expect(store.notifications).toHaveLength(1)

    await checkLeadNeedsHelpAlerts()
    expect(store.notifications).toHaveLength(1) // second sweep run: still just one
  })

  it('a NO_SHOW / CANCELLED_UNREBOOKED / TREATMENT_OPPORTUNITY item (clinic-wide, not a lead-help category) is never turned into a "lead needs help" alert', async () => {
    buildNeedsAttentionQueueMock.mockResolvedValue(queueWith([
      { key: 'NO_SHOW', items: [{ id: 'appt_1', patientId: 'patient_1' }] },
    ]))
    const { checkLeadNeedsHelpAlerts } = await import('../crm-automation/lead-needs-help-alerts.service')

    const result = await checkLeadNeedsHelpAlerts()

    expect(store.notifications).toHaveLength(0)
    expect(result.leadsConsidered).toBe(0)
  })

  it('does not send a push when CRM OPERATIONAL is not live, but still writes the persistent notification', async () => {
    isCrmFeatureLiveMock.mockReturnValue(false)
    buildNeedsAttentionQueueMock.mockResolvedValue(queueWith([
      { key: 'UNANSWERED_NEW', items: [{ id: 'lead_1', assignedTo: 'reception_owner' }] },
    ]))
    const { checkLeadNeedsHelpAlerts } = await import('../crm-automation/lead-needs-help-alerts.service')

    await checkLeadNeedsHelpAlerts()

    expect(store.notifications).toHaveLength(1)
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('sends a push when CRM OPERATIONAL is live', async () => {
    isCrmFeatureLiveMock.mockReturnValue(true)
    buildNeedsAttentionQueueMock.mockResolvedValue(queueWith([
      { key: 'UNANSWERED_NEW', items: [{ id: 'lead_1', assignedTo: 'reception_owner' }] },
    ]))
    const { checkLeadNeedsHelpAlerts } = await import('../crm-automation/lead-needs-help-alerts.service')

    await checkLeadNeedsHelpAlerts()

    expect(pushMock).toHaveBeenCalledTimes(1)
    expect(pushMock).toHaveBeenCalledWith('reception_owner', expect.objectContaining({
      title: 'Lead needs help',
      body: 'A CRM lead needs staff assistance. Tap to review.',
    }))
  })

  it('an empty Needs Attention queue is a safe no-op', async () => {
    buildNeedsAttentionQueueMock.mockResolvedValue(queueWith([]))
    const { checkLeadNeedsHelpAlerts } = await import('../crm-automation/lead-needs-help-alerts.service')

    const result = await checkLeadNeedsHelpAlerts()

    expect(result).toEqual({ leadsConsidered: 0, notified: 0 })
    expect(store.notifications).toHaveLength(0)
  })
})
