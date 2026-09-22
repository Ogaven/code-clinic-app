import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.setConfig({ testTimeout: 20000 })

// getMetaIntegrationDiagnostics() must never claim "Connected"/"Subscribed"
// merely because credentials exist — every field is either real Graph API
// evidence or an honest null/'UNKNOWN'. This suite proves both directions:
// real data surfaces when Graph API returns it, and nothing is invented
// when a call fails or a var is unset.

const fetchMock = vi.fn()
global.fetch = fetchMock as any

const ENV_KEYS = [
  'FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET', 'FACEBOOK_PAGE_ACCESS_TOKEN',
  'INSTAGRAM_ACCESS_TOKEN', 'INSTAGRAM_BUSINESS_ACCOUNT_ID',
  'WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID',
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  for (const k of ENV_KEYS) delete process.env[k]
})

async function importFresh() {
  return import('../services/meta-integration-diagnostics.service')
}

describe('getMetaIntegrationDiagnostics — no fabricated "connected" status', () => {
  it('appConfigured is false and appSubscriptions is null when FACEBOOK_APP_ID/SECRET are unset — never guesses a subscription state', async () => {
    const { getMetaIntegrationDiagnostics } = await importFresh()
    const result = await getMetaIntegrationDiagnostics()

    expect(result.appConfigured).toBe(false)
    expect(result.appSubscriptions).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces real app-level subscriptions (callback_url/active/fields) when Graph API returns them', async () => {
    process.env.FACEBOOK_APP_ID = 'test-app-id'
    process.env.FACEBOOK_APP_SECRET = 'test-app-secret'
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/subscriptions')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              { object: 'page', callback_url: 'https://api.codeclinicemr.com/webhooks/facebook', active: true, fields: [{ name: 'messages' }, { name: 'feed' }] },
              { object: 'instagram', callback_url: 'https://api.codeclinicemr.com/ai-suite/instagram/webhook', active: true, fields: [{ name: 'messages' }, { name: 'comments' }] },
            ],
          }),
        }
      }
      return { ok: false, json: async () => ({ error: { message: 'unexpected url: ' + url } }) }
    })

    const { getMetaIntegrationDiagnostics } = await importFresh()
    const result = await getMetaIntegrationDiagnostics()

    expect(result.appConfigured).toBe(true)
    expect(result.appSubscriptions).toEqual([
      { object: 'page', callbackUrl: 'https://api.codeclinicemr.com/webhooks/facebook', active: true, fields: ['messages', 'feed'] },
      { object: 'instagram', callbackUrl: 'https://api.codeclinicemr.com/ai-suite/instagram/webhook', active: true, fields: ['messages', 'comments'] },
    ])
  })

  it('pageSubscribedToApp is null (not false) when there is no page token to check with', async () => {
    const { getMetaIntegrationDiagnostics } = await importFresh()
    const result = await getMetaIntegrationDiagnostics()
    expect(result.pageSubscribedToApp).toBeNull()
  })

  it('pageSubscribedToApp is true only when our exact app ID appears in the real subscribed_apps response', async () => {
    process.env.FACEBOOK_APP_ID = '1222866495977765'
    process.env.FACEBOOK_PAGE_ACCESS_TOKEN = 'test-page-token'
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/me?')) return { ok: true, json: async () => ({ id: '532091973485208', name: 'CODE Clinic' }) }
      if (url.includes('/subscribed_apps')) {
        return { ok: true, json: async () => ({ data: [{ id: '1222866495977765', subscribed_fields: ['messages', 'feed'] }] }) }
      }
      return { ok: false, json: async () => ({ error: { message: 'unexpected url: ' + url } }) }
    })

    const { getMetaIntegrationDiagnostics } = await importFresh()
    const result = await getMetaIntegrationDiagnostics()

    expect(result.pageReachable).toBe(true)
    expect(result.pageId).toBe('532091973485208')
    expect(result.pageSubscribedToApp).toBe(true)
    expect(result.pageSubscribedFields).toEqual(['messages', 'feed'])
  })

  it('pageSubscribedToApp is false when subscribed_apps returns a list that does not include our app ID', async () => {
    process.env.FACEBOOK_APP_ID = '1222866495977765'
    process.env.FACEBOOK_PAGE_ACCESS_TOKEN = 'test-page-token'
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/me?')) return { ok: true, json: async () => ({ id: '532091973485208', name: 'CODE Clinic' }) }
      if (url.includes('/subscribed_apps')) return { ok: true, json: async () => ({ data: [{ id: 'some-other-app' }] }) }
      return { ok: false, json: async () => ({ error: { message: 'unexpected url' } }) }
    })

    const { getMetaIntegrationDiagnostics } = await importFresh()
    const result = await getMetaIntegrationDiagnostics()

    expect(result.pageSubscribedToApp).toBe(false)
  })

  it('permission checks are UNKNOWN (never a fabricated true/false) when debug_token could not be run', async () => {
    const { getMetaIntegrationDiagnostics } = await importFresh()
    const result = await getMetaIntegrationDiagnostics()
    expect(result.permissionChecks.length).toBeGreaterThan(0)
    for (const check of result.permissionChecks) {
      expect(check.granted).toBe('UNKNOWN')
    }
  })

  it('permission checks reflect real granted scopes from debug_token, not a static assumption', async () => {
    process.env.FACEBOOK_APP_ID = 'test-app-id'
    process.env.FACEBOOK_APP_SECRET = 'test-app-secret'
    process.env.FACEBOOK_PAGE_ACCESS_TOKEN = 'test-page-token'
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/me?')) return { ok: true, json: async () => ({ id: 'pid', name: 'Page' }) }
      if (url.includes('/subscribed_apps')) return { ok: true, json: async () => ({ data: [] }) }
      if (url.includes('/debug_token')) {
        return { ok: true, json: async () => ({ data: { type: 'PAGE', scopes: ['pages_messaging', 'pages_read_engagement'], expires_at: 0, is_valid: true } }) }
      }
      if (url.includes('/subscriptions')) return { ok: true, json: async () => ({ data: [] }) }
      return { ok: false, json: async () => ({ error: { message: 'unexpected url: ' + url } }) }
    })

    const { getMetaIntegrationDiagnostics } = await importFresh()
    const result = await getMetaIntegrationDiagnostics()

    const messaging = result.permissionChecks.find(c => c.permission === 'pages_messaging')
    const comments = result.permissionChecks.find(c => c.permission === 'pages_manage_engagement')
    expect(messaging?.granted).toBe(true)
    expect(comments?.granted).toBe(false)
    expect(result.pageTokenInfo?.isValid).toBe(true)
  })

  it('never throws — a total Graph API outage produces null/UNKNOWN fields, not an unhandled rejection', async () => {
    process.env.FACEBOOK_APP_ID = 'test-app-id'
    process.env.FACEBOOK_APP_SECRET = 'test-app-secret'
    process.env.FACEBOOK_PAGE_ACCESS_TOKEN = 'test-page-token'
    fetchMock.mockRejectedValue(new Error('network down'))

    const { getMetaIntegrationDiagnostics } = await importFresh()
    await expect(getMetaIntegrationDiagnostics()).resolves.toBeDefined()
  })
})
