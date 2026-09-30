// Covers the shared staff-notification fan-out helper
// (apps/api/src/services/notification.service.ts): the durable in-app
// Notification row is written first and always survives a push failure/
// rejection; multi-device fan-out is entirely delegated to sendPushToUser
// (one call per recipient regardless of how many devices they have
// registered); duplicate recipient ids collapse to one notification + one
// push; and a failed persistent write for one recipient never blocks
// another recipient in the same call.

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 20000 })

const store = vi.hoisted(() => ({
  notifications: [] as any[],
  failCreateForUserIds: new Set<string>(),
}))

vi.mock('../lib/prisma', () => ({
  prisma: {
    notification: {
      create: vi.fn(async ({ data }: any) => {
        if (store.failCreateForUserIds.has(data.userId)) {
          throw new Error('simulated DB failure')
        }
        const row = { id: `notif_${store.notifications.length + 1}`, isRead: false, ...data }
        store.notifications.push(row)
        return row
      }),
    },
  },
}))

const pushMock = vi.hoisted(() => vi.fn(async (_userId: string, _payload: { title: string; body: string; url?: string }) => {}))
vi.mock('../services/push.service', () => ({
  sendPushToUser: pushMock,
}))

beforeEach(() => {
  store.notifications.length = 0
  store.failCreateForUserIds.clear()
  pushMock.mockClear()
})

describe('notifyUsers', () => {
  it('fans out to every distinct recipient: one persistent notification + one push call per user', async () => {
    const { notifyUsers } = await import('../services/notification.service')

    await notifyUsers({
      userIds: ['user_1', 'user_2', 'user_3'],
      type: 'SYSTEM',
      title: 'Title',
      body: 'Body',
      href: '/somewhere',
    })

    expect(store.notifications).toHaveLength(3)
    expect(store.notifications.map(n => n.userId).sort()).toEqual(['user_1', 'user_2', 'user_3'])
    expect(pushMock).toHaveBeenCalledTimes(3)
  })

  it('collapses duplicate recipient ids to a single notification and a single push call', async () => {
    const { notifyUsers } = await import('../services/notification.service')

    await notifyUsers({
      userIds: ['user_1', 'user_1', 'user_1'],
      type: 'SYSTEM',
      title: 'Title',
      body: 'Body',
      href: '/somewhere',
    })

    expect(store.notifications).toHaveLength(1)
    expect(pushMock).toHaveBeenCalledTimes(1)
  })

  it('a single sendPushToUser call per user is correct regardless of how many devices that user has — device fan-out is push.service\'s responsibility, not this helper\'s', async () => {
    const { notifyUsers } = await import('../services/notification.service')

    await notifyUsers({ userIds: ['user_multi_device'], type: 'SYSTEM', title: 'T', body: 'B', href: '/x' })

    expect(pushMock).toHaveBeenCalledTimes(1)
    expect(pushMock).toHaveBeenCalledWith('user_multi_device', expect.objectContaining({ title: 'T', body: 'B', url: '/x' }))
  })

  it('the persistent notification is created and durable even when the push dispatch rejects — a push failure never destroys the in-app record', async () => {
    pushMock.mockRejectedValueOnce(new Error('OneSignal rejected'))
    const { notifyUsers } = await import('../services/notification.service')

    await notifyUsers({ userIds: ['user_1'], type: 'SYSTEM', title: 'T', body: 'B', href: '/x' })

    expect(store.notifications).toHaveLength(1)
    expect(store.notifications[0].userId).toBe('user_1')
  })

  it('a failed persistent write for one recipient does not prevent another recipient in the same call from being notified', async () => {
    store.failCreateForUserIds.add('user_bad')
    const { notifyUsers } = await import('../services/notification.service')

    await notifyUsers({ userIds: ['user_bad', 'user_good'], type: 'SYSTEM', title: 'T', body: 'B', href: '/x' })

    expect(store.notifications).toHaveLength(1)
    expect(store.notifications[0].userId).toBe('user_good')
    // Never push for a recipient whose durable record failed to write.
    expect(pushMock).not.toHaveBeenCalledWith('user_bad', expect.anything())
  })

  it('uses a generic pushBody for the OS push while the full body is kept in the persistent record, when the caller supplies a separate pushBody', async () => {
    const { notifyUsers } = await import('../services/notification.service')

    await notifyUsers({
      userIds: ['user_1'],
      type: 'SYSTEM',
      title: 'Follow-up due: Jane Doe',
      body: 'Jane Doe — full clinical detail',
      pushBody: 'A follow-up needs attention. Tap to review.',
      href: '/patients/p1',
    })

    expect(store.notifications[0].body).toBe('Jane Doe — full clinical detail')
    const pushPayload = pushMock.mock.calls[0][1]
    expect(pushPayload.body).toBe('A follow-up needs attention. Tap to review.')
    expect(pushPayload.body).not.toContain('Jane Doe')
  })

  it('is a safe no-op with zero recipients — never calls prisma or push', async () => {
    const { notifyUsers } = await import('../services/notification.service')

    await notifyUsers({ userIds: [], type: 'SYSTEM', title: 'T', body: 'B', href: '/x' })

    expect(store.notifications).toHaveLength(0)
    expect(pushMock).not.toHaveBeenCalled()
  })
})
