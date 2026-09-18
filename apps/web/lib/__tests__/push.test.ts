import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resyncPushSubscription } from '../push'

// Regression coverage for the pushsubscriptionchange fix: a rotated push
// subscription must actually reach the backend, not just get re-created
// locally. resyncPushSubscription() is what both app-load bootstrap and the
// service worker's rotation message now call to make that happen.

function stubBrowserEnv(overrides: {
  notificationPermission?: NotificationPermission
  subscription?: { endpoint: string; keys?: { p256dh: string; auth: string } } | null
  token?: string | null
} = {}) {
  const {
    notificationPermission = 'granted',
    subscription = { endpoint: 'https://push.example/ep-1', keys: { p256dh: 'p', auth: 'a' } },
    token = 'test-access-token',
  } = overrides

  const sub = subscription
    ? { endpoint: subscription.endpoint, toJSON: () => subscription }
    : null

  const notificationGlobal = { permission: notificationPermission }
  vi.stubGlobal('Notification', notificationGlobal)
  vi.stubGlobal('window', { PushManager: {}, Notification: notificationGlobal })
  vi.stubGlobal('navigator', {
    serviceWorker: {
      ready: Promise.resolve({
        pushManager: { getSubscription: vi.fn().mockResolvedValue(sub) },
      }),
    },
  })
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key === 'cc_token' ? token : null),
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('resyncPushSubscription', () => {
  it('posts the current subscription to /push/subscribe when permission is granted', async () => {
    stubBrowserEnv()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    await resyncPushSubscription()

    expect(fetchMock).toHaveBeenCalledWith('/api-proxy/push/subscribe', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer test-access-token' }),
    }))
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toEqual({ endpoint: 'https://push.example/ep-1', keys: { p256dh: 'p', auth: 'a' } })
  })

  it('does nothing when notification permission is not granted (never silently prompts)', async () => {
    stubBrowserEnv({ notificationPermission: 'default' })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await resyncPushSubscription()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does nothing when there is no active subscription to resync', async () => {
    stubBrowserEnv({ subscription: null })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await resyncPushSubscription()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does nothing when signed out (no cc_token) even if a subscription exists', async () => {
    stubBrowserEnv({ token: null })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await resyncPushSubscription()

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
