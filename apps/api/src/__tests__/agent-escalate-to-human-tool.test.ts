// Covers the structured `escalate_to_human` agent tool
// (apps/api/src/services/agent/agent-tools.ts handle_escalate_to_human).
//
// Previously this handler duplicated Escalation-record creation and the
// staff Notification fan-out inline, with NO push — every other escalation
// trigger in the codebase (unified-agent.ts, whatsapp.service.ts,
// booking.service.ts cancelAppointment) already routed through the shared
// createEscalation()/notifyStaffInApp() helper, which pairs the persistent
// Notification with a real OneSignal push. This suite proves the tool call
// now goes through that same shared path instead of a second, incomplete
// implementation.

import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.setConfig({ testTimeout: 20000 })

process.env.DATABASE_URL       ??= 'postgresql://test:test@localhost:5432/test'
process.env.JWT_SECRET         ??= 'test-jwt-secret-not-real-'.padEnd(32, '0')
process.env.JWT_REFRESH_SECRET ??= 'test-jwt-refresh-not-real-'.padEnd(32, '0')

const store = vi.hoisted(() => ({
  escalations:   [] as any[],
  notifications: [] as any[],
  users:         new Map<string, any>(),
}))

vi.mock('../lib/prisma', () => ({
  prisma: {
    patient: {
      findFirst: vi.fn(async () => null),
    },
    escalation: {
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `esc_${store.escalations.length + 1}`, createdAt: new Date(), ...data }
        store.escalations.push(row)
        return row
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        return store.escalations.find(e =>
          e.phoneNumber === where.phoneNumber && e.status === where.status && e.createdAt >= where.createdAt.gte
        ) ?? null
      }),
    },
    user: {
      findMany: vi.fn(async ({ where }: any) => {
        const roles: string[] = where?.role?.in ?? []
        return [...store.users.values()].filter(u => roles.includes(u.role) && u.isActive)
      }),
    },
    notification: {
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `notif_${store.notifications.length + 1}`, isRead: false, ...data }
        store.notifications.push(row)
        return row
      }),
    },
  },
}))

const pushMock = vi.hoisted(() => vi.fn(async (_userId: string, _payload: { title: string; body: string; url?: string }) => {}))
vi.mock('../services/push.service', () => ({ sendPushToUser: pushMock }))

beforeEach(() => {
  store.escalations.length = 0
  store.notifications.length = 0
  store.users.clear()
  pushMock.mockClear()
  vi.useRealTimers()

  store.users.set('reception_1', { id: 'reception_1', role: 'RECEPTIONIST', isActive: true })
  store.users.set('admin_1', { id: 'admin_1', role: 'ADMIN', isActive: true })
  store.users.set('doctor_1', { id: 'doctor_1', role: 'DOCTOR', isActive: true })
})

describe('escalate_to_human tool — routed through the shared createEscalation/notifyStaffInApp path', () => {
  it('creates a real Escalation row and notifies Reception + Admin with a persistent notification and a push', async () => {
    const { executeAgentTool } = await import('../services/agent/agent-tools')

    await executeAgentTool('escalate_to_human', { reason: 'Patient is upset about a billing issue', urgency: 'HIGH', channel: 'WHATSAPP' }, { phoneNumber: '+256700111222', channel: 'WHATSAPP' })

    expect(store.escalations).toHaveLength(1)
    expect(store.escalations[0]).toMatchObject({ phoneNumber: '+256700111222', channel: 'WHATSAPP', status: 'PENDING' })

    const recipientIds = store.notifications.map(n => n.userId).sort()
    expect(recipientIds).toEqual(['admin_1', 'reception_1'])
    expect(pushMock).toHaveBeenCalledTimes(2)
  })

  it('never notifies a Doctor user', async () => {
    const { executeAgentTool } = await import('../services/agent/agent-tools')

    await executeAgentTool('escalate_to_human', { reason: 'Patient wants a refund', urgency: 'MEDIUM', channel: 'WHATSAPP' }, { phoneNumber: '+256700111222', channel: 'WHATSAPP' })

    const recipientIds = store.notifications.map(n => n.userId)
    expect(recipientIds).not.toContain('doctor_1')
    expect(pushMock).not.toHaveBeenCalledWith('doctor_1', expect.anything())
  })

  it('the push body never contains the patient phone number or the raw reason text — only the in-app body does', async () => {
    const { executeAgentTool } = await import('../services/agent/agent-tools')

    await executeAgentTool('escalate_to_human', { reason: 'Patient is furious about a missed appointment', urgency: 'HIGH', channel: 'WHATSAPP' }, { phoneNumber: '+256700111222', channel: 'WHATSAPP' })

    const pushPayload = pushMock.mock.calls[0][1]
    expect(pushPayload.body).not.toContain('+256700111222')
    expect(pushPayload.body).not.toContain('furious')

    const notif = store.notifications[0]
    expect(notif.body).toContain('+256700111222')
  })

  it('a push rejection never destroys the already-written persistent Escalation/Notification', async () => {
    pushMock.mockRejectedValueOnce(new Error('OneSignal rejected'))
    const { executeAgentTool } = await import('../services/agent/agent-tools')

    await executeAgentTool('escalate_to_human', { reason: 'test', urgency: 'LOW', channel: 'WHATSAPP' }, { phoneNumber: '+256700111222', channel: 'WHATSAPP' })

    expect(store.escalations).toHaveLength(1)
    expect(store.notifications.length).toBeGreaterThan(0)
  })

  it('does not create a second Escalation for the same phone number within 5 minutes (tool-call retry dedup)', async () => {
    const { executeAgentTool } = await import('../services/agent/agent-tools')

    await executeAgentTool('escalate_to_human', { reason: 'first call', urgency: 'HIGH', channel: 'WHATSAPP' }, { phoneNumber: '+256700111222', channel: 'WHATSAPP' })
    expect(store.escalations).toHaveLength(1)
    pushMock.mockClear()

    await executeAgentTool('escalate_to_human', { reason: 'retried call, same concern', urgency: 'HIGH', channel: 'WHATSAPP' }, { phoneNumber: '+256700111222', channel: 'WHATSAPP' })

    expect(store.escalations).toHaveLength(1) // still just one — no duplicate
    expect(pushMock).not.toHaveBeenCalled() // no re-notification for the retry
  })

  it('a DIFFERENT phone number within the same window still gets its own escalation — dedup is per-phone, not global', async () => {
    const { executeAgentTool } = await import('../services/agent/agent-tools')

    await executeAgentTool('escalate_to_human', { reason: 'patient A', urgency: 'HIGH', channel: 'WHATSAPP' }, { phoneNumber: '+256700111222', channel: 'WHATSAPP' })
    await executeAgentTool('escalate_to_human', { reason: 'patient B', urgency: 'HIGH', channel: 'WHATSAPP' }, { phoneNumber: '+256700999888', channel: 'WHATSAPP' })

    expect(store.escalations).toHaveLength(2)
  })
})
