// Milestone: URGENT HOTFIX — Push Notifications. Covers push.service.ts's
// core contract: isPushConfigured() reflects real VAPID config (this is what
// /health's pushOk now checks, instead of the previously-unused
// FCM_SERVER_KEY/ONESIGNAL_APP_ID env vars), dispatch only reaches devices
// that actually have a stored subscription, and an expired/invalid
// subscription (404/410 from the push service) is cleaned up automatically
// so a dead device can never silently accumulate failed sends forever.
// No real network push is ever sent — webpush.sendNotification is mocked.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { sendNotificationMock, setVapidDetailsMock } = vi.hoisted(() => ({
  sendNotificationMock: vi.fn(),
  setVapidDetailsMock: vi.fn(),
}))

vi.mock('web-push', () => ({
  default: {
    setVapidDetails: setVapidDetailsMock,
    sendNotification: sendNotificationMock,
  },
}))

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    pushSubscription: {
      findMany: vi.fn(),
      delete: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockResolvedValue(1),
    },
    notification: {
      create: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({ role: 'ADMIN' }),
    },
  },
}))
vi.mock('../lib/prisma', () => ({ prisma: prismaMock }))

async function loadWithEnv(vapid: { VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string; VAPID_SUBJECT?: string }) {
  vi.resetModules()
  vi.doMock('../lib/env', () => ({ env: vapid }))
  return import('../services/push.service')
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.doUnmock('../lib/env')
})

describe('isPushConfigured', () => {
  it('is true only when all three VAPID values are present', async () => {
    const { isPushConfigured } = await loadWithEnv({
      VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:ops@codeclinicemr.com',
    })
    expect(isPushConfigured()).toBe(true)
  })

  it('is false when any of the three is missing (never printed — only presence is checked)', async () => {
    const { isPushConfigured } = await loadWithEnv({ VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: undefined, VAPID_SUBJECT: 'mailto:ops@codeclinicemr.com' })
    expect(isPushConfigured()).toBe(false)
  })

  it('is false when none are set', async () => {
    const { isPushConfigured } = await loadWithEnv({})
    expect(isPushConfigured()).toBe(false)
  })
})

describe('sendPushToUser', () => {
  const VAPID = { VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:ops@codeclinicemr.com' }

  it('is a safe no-op when push is not configured — never touches the database', async () => {
    const { sendPushToUser } = await loadWithEnv({})
    await sendPushToUser('user-1', { title: 't', body: 'b' })
    expect(prismaMock.pushSubscription.findMany).not.toHaveBeenCalled()
    expect(sendNotificationMock).not.toHaveBeenCalled()
  })

  it('sends to every stored subscription for the user', async () => {
    prismaMock.pushSubscription.findMany.mockResolvedValueOnce([
      { id: 'sub-1', endpoint: 'https://push.example/1', p256dh: 'p1', auth: 'a1' },
      { id: 'sub-2', endpoint: 'https://push.example/2', p256dh: 'p2', auth: 'a2' },
    ])
    sendNotificationMock.mockResolvedValue(undefined)
    const { sendPushToUser } = await loadWithEnv(VAPID)

    await sendPushToUser('user-1', { title: 'Hello', body: 'World' })

    expect(sendNotificationMock).toHaveBeenCalledTimes(2)
  })

  it('never sends when the user has no stored subscription', async () => {
    prismaMock.pushSubscription.findMany.mockResolvedValueOnce([])
    const { sendPushToUser } = await loadWithEnv(VAPID)

    await sendPushToUser('user-1', { title: 't', body: 'b' })

    expect(sendNotificationMock).not.toHaveBeenCalled()
  })

  it('removes a subscription that the push service reports as gone (404)', async () => {
    prismaMock.pushSubscription.findMany.mockResolvedValueOnce([
      { id: 'sub-dead', endpoint: 'https://push.example/dead', p256dh: 'p1', auth: 'a1' },
    ])
    sendNotificationMock.mockRejectedValueOnce({ statusCode: 404 })
    const { sendPushToUser } = await loadWithEnv(VAPID)

    await sendPushToUser('user-1', { title: 't', body: 'b' })

    expect(prismaMock.pushSubscription.delete).toHaveBeenCalledWith({ where: { id: 'sub-dead' } })
  })

  it('removes a subscription the push service reports as expired (410)', async () => {
    prismaMock.pushSubscription.findMany.mockResolvedValueOnce([
      { id: 'sub-expired', endpoint: 'https://push.example/expired', p256dh: 'p1', auth: 'a1' },
    ])
    sendNotificationMock.mockRejectedValueOnce({ statusCode: 410 })
    const { sendPushToUser } = await loadWithEnv(VAPID)

    await sendPushToUser('user-1', { title: 't', body: 'b' })

    expect(prismaMock.pushSubscription.delete).toHaveBeenCalledWith({ where: { id: 'sub-expired' } })
  })

  it('does NOT delete the subscription for a transient failure (e.g. 500) — only 404/410 mean "gone"', async () => {
    prismaMock.pushSubscription.findMany.mockResolvedValueOnce([
      { id: 'sub-flaky', endpoint: 'https://push.example/flaky', p256dh: 'p1', auth: 'a1' },
    ])
    sendNotificationMock.mockRejectedValueOnce({ statusCode: 500, message: 'push service unavailable' })
    const { sendPushToUser } = await loadWithEnv(VAPID)

    await sendPushToUser('user-1', { title: 't', body: 'b' })

    expect(prismaMock.pushSubscription.delete).not.toHaveBeenCalled()
  })

  it('never throws out of the caller even if the push service is fully down', async () => {
    prismaMock.pushSubscription.findMany.mockRejectedValueOnce(new Error('db unreachable'))
    const { sendPushToUser } = await loadWithEnv(VAPID)

    await expect(sendPushToUser('user-1', { title: 't', body: 'b' })).resolves.toBeUndefined()
  })
})

// A subscription dying (404/410) used to be handled with total silence once
// deleted — the user got no signal their OS-level push had stopped working,
// discoverable only by chance. This is the root cause found for "no push
// notification for two days" in the 2026-09-23 urgent fix: the admin's only
// subscription had silently expired. Now, the moment a user's LAST
// subscription is cleaned up, a persistent in-app notice is recorded so the
// next time they open the app for any reason, they see an actionable prompt.
describe('sendPushToUser — push-exhaustion self-alert', () => {
  const VAPID = { VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:ops@codeclinicemr.com' }

  it('records an in-app PROVIDER_HEALTH notice when an expired subscription was the user\'s last one', async () => {
    prismaMock.pushSubscription.findMany.mockResolvedValueOnce([
      { id: 'sub-dead', endpoint: 'https://push.example/dead', p256dh: 'p1', auth: 'a1' },
    ])
    prismaMock.pushSubscription.count.mockResolvedValueOnce(0) // none left after delete
    sendNotificationMock.mockRejectedValueOnce({ statusCode: 410 })
    const { sendPushToUser } = await loadWithEnv(VAPID)

    await sendPushToUser('user-1', { title: 't', body: 'b' })

    expect(prismaMock.notification.create).toHaveBeenCalledTimes(1)
    const call = prismaMock.notification.create.mock.calls[0][0].data
    expect(call.userId).toBe('user-1')
    expect(call.type).toBe('PROVIDER_HEALTH')
    expect(call.title).toContain('stopped working')
  })

  it('does NOT alert when the user still has other valid subscriptions remaining', async () => {
    prismaMock.pushSubscription.findMany.mockResolvedValueOnce([
      { id: 'sub-dead', endpoint: 'https://push.example/dead', p256dh: 'p1', auth: 'a1' },
    ])
    prismaMock.pushSubscription.count.mockResolvedValueOnce(1) // one other device still subscribed
    sendNotificationMock.mockRejectedValueOnce({ statusCode: 410 })
    const { sendPushToUser } = await loadWithEnv(VAPID)

    await sendPushToUser('user-1', { title: 't', body: 'b' })

    expect(prismaMock.notification.create).not.toHaveBeenCalled()
  })

  it('routes the RECEPTIONIST re-enable link to the receptionist-prefixed settings page', async () => {
    prismaMock.pushSubscription.findMany.mockResolvedValueOnce([
      { id: 'sub-dead', endpoint: 'https://push.example/dead', p256dh: 'p1', auth: 'a1' },
    ])
    prismaMock.pushSubscription.count.mockResolvedValueOnce(0)
    prismaMock.user.findUnique.mockResolvedValueOnce({ role: 'RECEPTIONIST' })
    sendNotificationMock.mockRejectedValueOnce({ statusCode: 410 })
    const { sendPushToUser } = await loadWithEnv(VAPID)

    await sendPushToUser('reception-1', { title: 't', body: 'b' })

    const call = prismaMock.notification.create.mock.calls[0][0].data
    expect(call.href).toBe('/receptionist/settings')
  })

  it('never throws out of the caller even if recording the exhaustion notice itself fails', async () => {
    prismaMock.pushSubscription.findMany.mockResolvedValueOnce([
      { id: 'sub-dead', endpoint: 'https://push.example/dead', p256dh: 'p1', auth: 'a1' },
    ])
    prismaMock.pushSubscription.count.mockResolvedValueOnce(0)
    prismaMock.notification.create.mockRejectedValueOnce(new Error('db down'))
    sendNotificationMock.mockRejectedValueOnce({ statusCode: 410 })
    const { sendPushToUser } = await loadWithEnv(VAPID)

    await expect(sendPushToUser('user-1', { title: 't', body: 'b' })).resolves.toBeUndefined()
  })

  it('does not blow up the dispatch loop if the remaining-count check itself throws', async () => {
    prismaMock.pushSubscription.findMany.mockResolvedValueOnce([
      { id: 'sub-dead', endpoint: 'https://push.example/dead', p256dh: 'p1', auth: 'a1' },
    ])
    prismaMock.pushSubscription.count.mockRejectedValueOnce(new Error('count not supported'))
    sendNotificationMock.mockRejectedValueOnce({ statusCode: 410 })
    const { sendPushToUser } = await loadWithEnv(VAPID)

    await expect(sendPushToUser('user-1', { title: 't', body: 'b' })).resolves.toBeUndefined()
    expect(prismaMock.pushSubscription.delete).toHaveBeenCalled() // deletion still happened despite the count failure
  })
})
