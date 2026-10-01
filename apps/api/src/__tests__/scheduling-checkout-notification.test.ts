// Covers notifyReceptionOfCheckout (apps/api/src/routes/scheduling.ts) —
// exported (like notifyDoctorAssigned in pipeline.ts) for direct unit
// testing. Previously this fired only a persistent Notification for
// SESSION_COMPLETE/CHECKOUT/READY_CHECKOUT with no push — the OneSignal
// attention layer never reached a receptionist who didn't have the tab open.

import { describe, expect, it, vi, beforeEach } from 'vitest'

// scheduling.ts has a heavy import graph (multer, xlsx, many ai-suite
// modules) — the one-time module-load cost on first access in this file
// comfortably exceeds the usual 20s default under system load.
vi.setConfig({ testTimeout: 60000 })

process.env.DATABASE_URL       ??= 'postgresql://test:test@localhost:5432/test'
process.env.JWT_SECRET         ??= 'test-jwt-secret-not-real-'.padEnd(32, '0')
process.env.JWT_REFRESH_SECRET ??= 'test-jwt-refresh-not-real-'.padEnd(32, '0')
process.env.OPENAI_API_KEY     ??= 'test-key-not-real'

const store = vi.hoisted(() => ({
  notifications: [] as any[],
  users: new Map<string, any>(),
}))

vi.mock('../lib/prisma', () => ({
  prisma: {
    user: {
      findMany: vi.fn(async ({ where }: any) => {
        return [...store.users.values()].filter(u => u.role === where.role && u.isActive === where.isActive)
      }),
    },
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
  },
}))

const pushMock = vi.hoisted(() => vi.fn(async (_userId: string, _payload: { title: string; body: string; url?: string }) => {}))
vi.mock('../services/push.service', () => ({ sendPushToUser: pushMock }))

beforeEach(() => {
  store.notifications.length = 0
  store.users.clear()
  pushMock.mockClear()
  store.users.set('reception_1', { id: 'reception_1', role: 'RECEPTIONIST', isActive: true })
  store.users.set('reception_2', { id: 'reception_2', role: 'RECEPTIONIST', isActive: true })
})

describe('notifyReceptionOfCheckout', () => {
  it('notifies every active receptionist with a persistent notification AND a push', async () => {
    const { notifyReceptionOfCheckout } = await import('../routes/scheduling')

    await notifyReceptionOfCheckout('appt-1', 'Jane Doe')

    const recipientIds = store.notifications.map(n => n.userId).sort()
    expect(recipientIds).toEqual(['reception_1', 'reception_2'])
    expect(pushMock).toHaveBeenCalledTimes(2)
  })

  it('the push body never contains the patient name — only the in-app body does', async () => {
    const { notifyReceptionOfCheckout } = await import('../routes/scheduling')

    await notifyReceptionOfCheckout('appt-1', 'Jane Doe')

    const pushPayload = pushMock.mock.calls[0][1]
    expect(pushPayload.body).not.toContain('Jane Doe')
    const notif = store.notifications[0]
    expect(notif.body).toContain('Jane Doe')
  })

  it('does not notify a Doctor — this query only ever selects RECEPTIONIST', async () => {
    store.users.set('doctor_1', { id: 'doctor_1', role: 'DOCTOR', isActive: true })
    const { notifyReceptionOfCheckout } = await import('../routes/scheduling')

    await notifyReceptionOfCheckout('appt-1', 'Jane Doe')

    expect(store.notifications.map(n => n.userId)).not.toContain('doctor_1')
  })

  it('collapses repeated checkout-funnel transitions for the SAME appointment into one alert (dedup)', async () => {
    const { notifyReceptionOfCheckout } = await import('../routes/scheduling')

    // SESSION_COMPLETE, then CHECKOUT, then READY_CHECKOUT — three real
    // status hops for the same appointment, same patient.
    await notifyReceptionOfCheckout('appt-1', 'Jane Doe')
    await notifyReceptionOfCheckout('appt-1', 'Jane Doe')
    await notifyReceptionOfCheckout('appt-1', 'Jane Doe')

    expect(store.notifications).toHaveLength(2) // 2 receptionists, not 6
    expect(pushMock).toHaveBeenCalledTimes(2)
  })

  it('a different appointment still gets its own fresh alert', async () => {
    const { notifyReceptionOfCheckout } = await import('../routes/scheduling')

    await notifyReceptionOfCheckout('appt-1', 'Jane Doe')
    await notifyReceptionOfCheckout('appt-2', 'John Smith')

    expect(store.notifications).toHaveLength(4)
  })

  it('a push rejection never destroys the already-written persistent notification', async () => {
    pushMock.mockRejectedValueOnce(new Error('OneSignal rejected'))
    const { notifyReceptionOfCheckout } = await import('../routes/scheduling')

    await notifyReceptionOfCheckout('appt-1', 'Jane Doe')

    expect(store.notifications.length).toBeGreaterThan(0)
  })
})
