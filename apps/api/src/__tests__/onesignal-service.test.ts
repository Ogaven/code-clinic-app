// Regression coverage for the latency-observability logging added to
// sendOneSignalToUser (Code Clinic ticket: "why did a test push take ~5
// minutes to arrive?"). No real network call is ever made — fetch is always
// mocked. These tests only assert the function's own contract (return shape,
// accepted/rejected outcomes) and that a success/failure is always logged
// with timing info, never that any particular delay is fast — actual device
// delivery time is outside this process and can't be asserted here.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

async function loadWithEnv(vars: { ONESIGNAL_APP_ID?: string; ONESIGNAL_REST_API_KEY?: string }) {
  vi.resetModules()
  vi.doMock('../lib/env', () => ({ env: vars }))
  return import('../services/onesignal.service')
}

const ENV = { ONESIGNAL_APP_ID: 'app-123', ONESIGNAL_REST_API_KEY: 'key-123' }

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.doUnmock('../lib/env')
  vi.unstubAllGlobals()
})

describe('isOneSignalConfigured', () => {
  it('is true only when both app id and REST key are present', async () => {
    const { isOneSignalConfigured } = await loadWithEnv(ENV)
    expect(isOneSignalConfigured()).toBe(true)
  })

  it('is false when the REST key is missing (e.g. the empty-value incident)', async () => {
    const { isOneSignalConfigured } = await loadWithEnv({ ONESIGNAL_APP_ID: 'app-123', ONESIGNAL_REST_API_KEY: '' })
    expect(isOneSignalConfigured()).toBe(false)
  })
})

describe('sendOneSignalToUser', () => {
  it('is a safe no-op when not configured — never calls fetch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { sendOneSignalToUser } = await loadWithEnv({})

    const result = await sendOneSignalToUser('user-1', { title: 't', body: 'b' })

    expect(result).toEqual({ configured: false, accepted: false, error: 'not_configured' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('targets only the given external_id, never a broadcast', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'notif-1' }) })
    vi.stubGlobal('fetch', fetchMock)
    const { sendOneSignalToUser } = await loadWithEnv(ENV)

    await sendOneSignalToUser('user-42', { title: 'Code Clinic notification test', body: 'Notifications are working on this device.' })

    const [, requestInit] = fetchMock.mock.calls[0]
    const body = JSON.parse(requestInit.body)
    expect(body.include_aliases).toEqual({ external_id: ['user-42'] })
  })

  it('sends an explicit TTL so a temporarily offline device still gets the push on reconnect, instead of relying on an undocumented provider default', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'notif-1' }) })
    vi.stubGlobal('fetch', fetchMock)
    const { sendOneSignalToUser } = await loadWithEnv(ENV)

    await sendOneSignalToUser('user-42', { title: 't', body: 'b' })

    const [, requestInit] = fetchMock.mock.calls[0]
    const body = JSON.parse(requestInit.body)
    expect(body.ttl).toBeGreaterThan(0)
    expect(typeof body.ttl).toBe('number')
  })

  it('reports accepted with the notification id when OneSignal returns 200 + an id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'notif-1' }) }))
    const { sendOneSignalToUser } = await loadWithEnv(ENV)

    const result = await sendOneSignalToUser('user-1', { title: 't', body: 'b' })

    expect(result).toEqual({ configured: true, accepted: true, notificationId: 'notif-1' })
  })

  it('logs a success line with elapsed time and notification-id presence, not the id itself (no PHI/secrets)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'notif-1' }) }))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { sendOneSignalToUser } = await loadWithEnv(ENV)

    await sendOneSignalToUser('user-1', { title: 't', body: 'b' })

    expect(logSpy).toHaveBeenCalledWith('[OneSignal] Push accepted', expect.objectContaining({
      elapsedMs: expect.any(Number),
      hasNotificationId: true,
      targetedExternalIds: 1,
    }))
    const loggedPayload = logSpy.mock.calls[0][1]
    expect(JSON.stringify(loggedPayload)).not.toContain('notif-1')
    logSpy.mockRestore()
  })

  it('reports not accepted when OneSignal rejects the request (e.g. an invalid REST key)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ errors: ['Access denied'] }) }))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { sendOneSignalToUser } = await loadWithEnv(ENV)

    const result = await sendOneSignalToUser('user-1', { title: 't', body: 'b' })

    expect(result).toEqual({ configured: true, accepted: false, error: 'http_401' })
    // Never logs the REST key or the raw error body — only status + a boolean.
    const loggedArgs = errorSpy.mock.calls[0]
    expect(JSON.stringify(loggedArgs)).not.toContain('key-123')
    errorSpy.mockRestore()
  })

  it('reports not accepted (not a thrown error) when the network call itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch failed')))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { sendOneSignalToUser } = await loadWithEnv(ENV)

    const result = await sendOneSignalToUser('user-1', { title: 't', body: 'b' })

    expect(result).toEqual({ configured: true, accepted: false, error: 'network_error' })
  })
})
