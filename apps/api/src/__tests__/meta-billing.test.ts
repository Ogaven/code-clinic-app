import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.setConfig({ testTimeout: 20000 })

// getMetaBillingStatus() must never fabricate a balance. Real production
// investigation (2026-09-15) confirmed Meta's Graph API returns real credit-
// line data via /extendedcredits for this token, but NOT a distinctly-
// labeled "WhatsApp invoice" figure (payment_methods/adaccounts/funding
// fields all return permission-denied). This suite proves: real data is
// surfaced when available, nothing is invented when it isn't, and the
// admin action URL only ever comes from a real persisted Meta error
// response — never constructed from guesswork.

const { prismaMock, fsMock } = vi.hoisted(() => ({
  prismaMock: {
    metaDeliveryFailure: { findFirst: vi.fn().mockResolvedValue(null) },
  },
  fsMock: {
    readFileSync: vi.fn<[string, string?], string>(() => { throw new Error('no cache') }),
    writeFileSync: vi.fn(),
  },
}))

vi.mock('../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('fs', () => ({ default: fsMock, ...fsMock }))

const fetchMock = vi.fn()
global.fetch = fetchMock as any

beforeEach(() => {
  vi.clearAllMocks()
  fsMock.readFileSync.mockImplementation(() => { throw new Error('no cache') })
  prismaMock.metaDeliveryFailure.findFirst.mockResolvedValue(null)
  delete process.env.WHATSAPP_TOKEN
  delete process.env.WHATSAPP_WABA_ID
  delete process.env.WHATSAPP_PHONE_NUMBER_ID
})

async function importFresh() {
  vi.resetModules()
  return import('../services/meta-billing.service')
}

describe('getMetaBillingStatus — no fabricated balances', () => {
  it('returns NOT_AVAILABLE-equivalent (UNKNOWN, empty credit lines) when WHATSAPP_TOKEN is absent, never fabricating a figure', async () => {
    const { getMetaBillingStatus } = await importFresh()
    const status = await getMetaBillingStatus()

    expect(status.creditLines).toEqual([])
    expect(status.creditLinesSource).toBe('UNAVAILABLE')
    expect(status.billingStatus).toBe('UNKNOWN')
    expect(status.graphApiError).toMatch(/WHATSAPP_TOKEN/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces real credit-line data when Graph API returns it, with explicit sourcing (never relabeled as "the WhatsApp invoice")', async () => {
    process.env.WHATSAPP_TOKEN = 'test-token'
    prismaMock.metaDeliveryFailure.findFirst.mockResolvedValue({
      code: 131042,
      title: 'Business eligibility payment issue',
      details: 'unsettled payments. Visit https://business.facebook.com/billing_hub/accounts/details/?business_id=339508138390029&asset_id=1035568108843333&wizard_name=PAY_NOW&account_type=whatsapp-business-account to resolve.',
      occurredAt: new Date(), // recent -> within 24h
    })

    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('account_review_status')) {
        return { ok: true, json: async () => ({ account_review_status: 'APPROVED' }) }
      }
      if (url.includes('/extendedcredits')) {
        return { ok: true, json: async () => ({ data: [{ id: '27323648533991106' }] }) }
      }
      if (url.includes('27323648533991106')) {
        return { ok: true, json: async () => ({ legal_entity_name: 'Ajua Inc.', balance: { amount: '0.14', currency: 'USD' }, is_access_revoked: false }) }
      }
      return { ok: false, json: async () => ({ error: { message: 'unexpected url' } }) }
    })

    const { getMetaBillingStatus } = await importFresh()
    const status = await getMetaBillingStatus()

    expect(status.creditLines).toHaveLength(1)
    expect(status.creditLines[0]).toMatchObject({ legalEntityName: 'Ajua Inc.', balance: { amount: '0.14', currency: 'USD' } })
    expect(status.creditLinesSource).toBe('GRAPH_API_EXTENDEDCREDITS')
    expect(status.creditLinesNote).toMatch(/not a distinctly-labeled WhatsApp messaging invoice/)
  })

  it('sources adminActionUrl only from a real persisted Meta error response, never constructing one', async () => {
    process.env.WHATSAPP_TOKEN = 'test-token'
    prismaMock.metaDeliveryFailure.findFirst.mockResolvedValue({
      code: 131042,
      details: 'unsettled payments. Visit https://business.facebook.com/billing_hub/accounts/details/?business_id=339508138390029&asset_id=1035568108843333&wizard_name=PAY_NOW&account_type=whatsapp-business-account to resolve.',
      occurredAt: new Date(),
    })
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: [] }) })

    const { getMetaBillingStatus } = await importFresh()
    const status = await getMetaBillingStatus()

    expect(status.adminActionUrl).toBe('https://business.facebook.com/billing_hub/accounts/details/?business_id=339508138390029&asset_id=1035568108843333&wizard_name=PAY_NOW&account_type=whatsapp-business-account')
  })

  it('adminActionUrl is null when no 131042 failure has ever been recorded — never guessed', async () => {
    process.env.WHATSAPP_TOKEN = 'test-token'
    prismaMock.metaDeliveryFailure.findFirst.mockResolvedValue(null)
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ account_review_status: 'APPROVED' }) })

    const { getMetaBillingStatus } = await importFresh()
    const status = await getMetaBillingStatus()

    expect(status.adminActionUrl).toBeNull()
    expect(status.recent131042).toBe(false)
  })

  it('billingStatus is ATTENTION_REQUIRED when a 131042 occurred within the last 24 hours', async () => {
    process.env.WHATSAPP_TOKEN = 'test-token'
    prismaMock.metaDeliveryFailure.findFirst.mockResolvedValue({
      code: 131042, details: null, occurredAt: new Date(Date.now() - 60 * 60 * 1000), // 1h ago
    })
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ account_review_status: 'APPROVED' }) })

    const { getMetaBillingStatus } = await importFresh()
    const status = await getMetaBillingStatus()

    expect(status.billingStatus).toBe('ATTENTION_REQUIRED')
    expect(status.recent131042Within24h).toBe(true)
  })

  it('caches the slow Graph API fields and does not re-fetch within the TTL', async () => {
    process.env.WHATSAPP_TOKEN = 'test-token'
    const cached = {
      wabaStatus: 'APPROVED', businessId: null, creditLines: [],
      creditLinesSource: 'UNAVAILABLE', creditLinesNote: 'cached',
      graphApiError: null, cachedAt: new Date().toISOString(),
    }
    fsMock.readFileSync.mockReturnValue(JSON.stringify(cached))

    const { getMetaBillingStatus } = await importFresh()
    const status = await getMetaBillingStatus()

    expect(status.creditLinesNote).toBe('cached')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // Regression for a real production incident (2026-09-15): the whole
  // response — including the 131042-recency check — used to be cached as
  // one blob for CACHE_TTL_MS (6h). A fresh 131042 that landed after the
  // cache was built kept being reported as billingStatus: 'HEALTHY' for
  // hours, directly contradicting the (uncached) WhatsApp delivery-health
  // card, which correctly showed DOWN from the same underlying failure.
  it('reports ATTENTION_REQUIRED for a 131042 that landed AFTER a still-fresh Graph API cache was written, never serving the stale cached billingStatus', async () => {
    process.env.WHATSAPP_TOKEN = 'test-token'
    // A Graph API cache written before the failure — well within TTL, so it
    // would normally be reused as-is for the slow fields.
    const cachedBeforeFailure = {
      wabaStatus: 'APPROVED', businessId: null, creditLines: [],
      creditLinesSource: 'UNAVAILABLE', creditLinesNote: 'no business_id known yet',
      graphApiError: null, cachedAt: new Date().toISOString(),
    }
    fsMock.readFileSync.mockReturnValue(JSON.stringify(cachedBeforeFailure))
    // A 131042 that occurred AFTER the cache was written — must still be
    // picked up, because recent-failure evidence is never itself cached.
    prismaMock.metaDeliveryFailure.findFirst.mockResolvedValue({
      code: 131042, details: null, occurredAt: new Date(Date.now() - 5 * 60 * 1000), // 5 min ago
    })

    const { getMetaBillingStatus } = await importFresh()
    const status = await getMetaBillingStatus()

    expect(status.billingStatus).toBe('ATTENTION_REQUIRED')
    expect(status.recent131042Within24h).toBe(true)
    // The slow Graph API fields still legitimately came from cache.
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// Regression suite for the 2026-09-20 wrong-WABA fix: `wabaAccountReviewStatus`
// used to be queried against a hardcoded WABA ID (`1754698499275270`) that
// does not own Code Clinic's real phone number, templates, or delivery
// failures. It must now come exclusively from WHATSAPP_WABA_ID.
describe('getMetaBillingStatus — WABA configuration source of truth', () => {
  const LEGACY_DECOY_WABA = '1754698499275270'
  const REAL_WABA = '1035568108843333'

  it('queries the configured WHATSAPP_WABA_ID for account_review_status, never the legacy hardcoded WABA', async () => {
    process.env.WHATSAPP_TOKEN = 'test-token'
    process.env.WHATSAPP_WABA_ID = REAL_WABA
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes(LEGACY_DECOY_WABA)) {
        throw new Error('TEST FAILURE: queried the legacy decoy WABA, not the configured one')
      }
      if (url.includes(REAL_WABA) && url.includes('account_review_status')) {
        return { ok: true, json: async () => ({ account_review_status: 'APPROVED' }) }
      }
      if (url.includes('message_templates')) {
        return { ok: true, json: async () => ({ data: [] }) }
      }
      return { ok: false, json: async () => ({ error: { message: 'unexpected url: ' + url } }) }
    })

    const { getMetaBillingStatus } = await importFresh()
    const status = await getMetaBillingStatus()

    expect(status.wabaAccountReviewStatus).toBe('APPROVED')
    expect(status.wabaConfigured).toBe(true)
    const calledUrls = fetchMock.mock.calls.map((c: any[]) => c[0] as string)
    expect(calledUrls.some(u => u.includes(REAL_WABA))).toBe(true)
    expect(calledUrls.some(u => u.includes(LEGACY_DECOY_WABA))).toBe(false)
  })

  it('fails safely (no crash, clear error, wabaConfigured=false) when WHATSAPP_WABA_ID is not set', async () => {
    process.env.WHATSAPP_TOKEN = 'test-token'
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: [] }) })

    const { getMetaBillingStatus } = await importFresh()
    const status = await getMetaBillingStatus()

    expect(status.wabaConfigured).toBe(false)
    expect(status.wabaAccountReviewStatus).toBeNull()
    expect(status.graphApiError).toMatch(/WHATSAPP_WABA_ID not configured/)
    const calledUrls = fetchMock.mock.calls.map((c: any[]) => c[0] as string)
    expect(calledUrls.some(u => u.includes(LEGACY_DECOY_WABA))).toBe(false)
  })
})

describe('getMetaBillingStatus — verified WhatsApp health fields (phone, templates, payment error)', () => {
  it('surfaces real phone-number status when WHATSAPP_PHONE_NUMBER_ID is configured', async () => {
    process.env.WHATSAPP_TOKEN = 'test-token'
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'test-phone-id'
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('test-phone-id')) {
        return { ok: true, json: async () => ({ display_phone_number: '+256 741 087667', verified_name: 'Code Clinic', quality_rating: 'GREEN', code_verification_status: 'EXPIRED', name_status: 'APPROVED' }) }
      }
      return { ok: true, json: async () => ({ data: [] }) }
    })

    const { getMetaBillingStatus } = await importFresh()
    const status = await getMetaBillingStatus()

    expect(status.phoneNumber).toMatchObject({ displayPhoneNumber: '+256 741 087667', verifiedName: 'Code Clinic', qualityRating: 'GREEN' })
  })

  it('phoneNumber is null (not fabricated) when WHATSAPP_PHONE_NUMBER_ID is not configured', async () => {
    process.env.WHATSAPP_TOKEN = 'test-token'
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: [] }) })

    const { getMetaBillingStatus } = await importFresh()
    const status = await getMetaBillingStatus()

    expect(status.phoneNumber).toBeNull()
  })

  it('summarises real approved/pending/rejected template counts from Graph API, never a guessed count', async () => {
    process.env.WHATSAPP_TOKEN = 'test-token'
    process.env.WHATSAPP_WABA_ID = '1035568108843333'
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('message_templates')) {
        return { ok: true, json: async () => ({ data: [{ status: 'APPROVED' }, { status: 'APPROVED' }, { status: 'PENDING' }, { status: 'REJECTED' }] }) }
      }
      return { ok: true, json: async () => ({ account_review_status: 'APPROVED' }) }
    })

    const { getMetaBillingStatus } = await importFresh()
    const status = await getMetaBillingStatus()

    expect(status.templates).toEqual({ approvedCount: 2, pendingCount: 1, rejectedCount: 1, totalCount: 4 })
  })

  it('always includes an honest billingDataNote explaining WhatsApp payment data is not available via this API', async () => {
    const { getMetaBillingStatus } = await importFresh()
    const status = await getMetaBillingStatus()
    expect(status.billingDataNote).toMatch(/Meta Business Manager/)
  })

  it('latestPaymentError reflects the real persisted 131042 record, scoped to payment/eligibility only', async () => {
    process.env.WHATSAPP_TOKEN = 'test-token'
    const occurredAt = new Date(Date.now() - 2 * 60 * 60 * 1000)
    prismaMock.metaDeliveryFailure.findFirst.mockResolvedValue({
      code: 131042, title: 'Business eligibility payment issue', details: null, occurredAt,
    })
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: [] }) })

    const { getMetaBillingStatus } = await importFresh()
    const status = await getMetaBillingStatus()

    expect(status.latestPaymentError).toEqual({
      code: 131042,
      title: 'Business eligibility payment issue',
      occurredAt: occurredAt.toISOString(),
    })
  })

  it('latestPaymentError is null when no 131042 has ever been recorded', async () => {
    const { getMetaBillingStatus } = await importFresh()
    const status = await getMetaBillingStatus()
    expect(status.latestPaymentError).toBeNull()
  })
})
