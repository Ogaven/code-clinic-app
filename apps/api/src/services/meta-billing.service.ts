// ─────────────────────────────────────────────────────────────────────────
// Real Meta WhatsApp Business billing status — built from live Graph API
// calls made during the 2026-09-15 production investigation (see
// docs/ if that report is kept, or git history for this file's introducing
// commit). Two things were confirmed by actually calling Meta's API, not
// assumed:
//
//   1. The Business Manager's /extendedcredits edge DOES return real credit-
//      line balances for this token — but those are Marketing-API credit
//      lines tied to reseller entities ("Ajua Inc.", "LeadConnector LLC"),
//      not a distinctly-labeled "WhatsApp messaging invoice" figure. They're
//      shown here as exactly what they are, never relabeled as "the"
//      WhatsApp balance.
//   2. /payment_methods, /adaccounts, and WABA-level primary_funding_id all
//      return permission-denied ("requires Business Solution Provider
//      status") for this token — there is no way to fetch a definitive
//      outstanding-invoice figure via this API. The one authoritative,
//      unfabricated action Meta itself provides is the `href` PAY_NOW link
//      embedded in real 131042 error responses (persisted to
//      MetaDeliveryFailure by the webhook handler) — that is what this
//      service surfaces as the admin action, never a constructed URL.
//
// 2026-09-20 correction: `wabaAccountReviewStatus` used to be queried
// against a hardcoded WABA ID (`1754698499275270`) left over from before
// Code Clinic migrated off Africa's Talking onto direct Meta Cloud API
// (see whatsapp.service.ts's "Zero AT involvement" send path). That ID
// belongs to a different WABA under the same Business Manager — it is not
// the account that sends Code Clinic's messages, is not the account named
// in real MetaDeliveryFailure records, and does not own Code Clinic's real
// phone number or approved templates. It was live-verified to still
// resolve (returning APPROVED), which is exactly why the drift went
// unnoticed — a wrong-but-successful answer looks identical to a right one
// unless you check which account it actually describes. The real
// production WABA (`1035568108843333`) is now read from the same
// WHATSAPP_WABA_ID env var the actual messaging path and
// connections.routes.ts already use — see config/meta-config.ts, now the
// single accessor for this ID so it can't drift out of sync again.
// ─────────────────────────────────────────────────────────────────────────
import fs from 'fs'
import { prisma } from '../lib/prisma'
import { getWhatsAppWabaId, getWhatsAppPhoneNumberId } from '../config/meta-config'

const GRAPH_VER    = 'v25.0'
const CACHE_FILE   = '/tmp/codeclinic-meta-billing.json'
const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6 hours — billing data changes slowly; avoid hammering Graph API

export type BillingStatus = 'HEALTHY' | 'ATTENTION_REQUIRED' | 'UNKNOWN'

export interface CreditLine {
  id: string
  legalEntityName: string | null
  balance: { amount: string; currency: string } | null
  creditAvailable: { amount: string; currency: string } | null
  isAccessRevoked: boolean | null
}

export interface PhoneNumberStatus {
  displayPhoneNumber: string | null
  verifiedName: string | null
  qualityRating: string | null
  codeVerificationStatus: string | null
  nameStatus: string | null
}

export interface TemplateSummary {
  approvedCount: number
  pendingCount: number
  rejectedCount: number
  totalCount: number
}

export interface MetaBillingStatus {
  billingStatus: BillingStatus
  wabaConfigured: boolean
  wabaAccountReviewStatus: string | null
  phoneNumber: PhoneNumberStatus | null
  templates: TemplateSummary | null
  creditLines: CreditLine[]
  creditLinesSource: 'GRAPH_API_EXTENDEDCREDITS' | 'UNAVAILABLE'
  creditLinesNote: string
  recent131042: boolean
  recent131042Within24h: boolean
  latestPaymentError: { code: number; title: string; occurredAt: string } | null
  adminActionUrl: string | null
  adminActionSource: 'META_ERROR_RESPONSE' | 'NONE'
  billingDataNote: string
  fetchedAt: string
  graphApiError: string | null
}

async function graphGet(url: string): Promise<any> {
  const res = await fetch(url)
  const json = await res.json() as any
  if (!res.ok || json.error) throw new Error(json.error?.message ?? `HTTP ${res.status}`)
  return json
}

async function fetchCreditLines(businessId: string, token: string): Promise<{ lines: CreditLine[]; error: string | null }> {
  try {
    const list = await graphGet(`https://graph.facebook.com/${GRAPH_VER}/${businessId}/extendedcredits?access_token=${token}`)
    const ids: string[] = (list.data ?? []).map((d: any) => d.id)
    const lines = await Promise.all(ids.map(async (id): Promise<CreditLine> => {
      try {
        const detail = await graphGet(
          `https://graph.facebook.com/${GRAPH_VER}/${id}?fields=legal_entity_name,balance,credit_available,is_access_revoked&access_token=${token}`
        )
        return {
          id,
          legalEntityName: detail.legal_entity_name ?? null,
          balance: detail.balance ? { amount: detail.balance.amount, currency: detail.balance.currency } : null,
          creditAvailable: detail.credit_available ? { amount: detail.credit_available.amount, currency: detail.credit_available.currency } : null,
          isAccessRevoked: detail.is_access_revoked ?? null,
        }
      } catch {
        return { id, legalEntityName: null, balance: null, creditAvailable: null, isAccessRevoked: null }
      }
    }))
    return { lines, error: null }
  } catch (e: any) {
    return { lines: [], error: e.message }
  }
}

async function fetchPhoneNumberStatus(phoneNumberId: string, token: string): Promise<PhoneNumberStatus | null> {
  try {
    const data = await graphGet(
      `https://graph.facebook.com/${GRAPH_VER}/${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,code_verification_status,name_status&access_token=${token}`
    )
    return {
      displayPhoneNumber: data.display_phone_number ?? null,
      verifiedName: data.verified_name ?? null,
      qualityRating: data.quality_rating ?? null,
      codeVerificationStatus: data.code_verification_status ?? null,
      nameStatus: data.name_status ?? null,
    }
  } catch {
    return null
  }
}

// Meta's default page size comfortably covers Code Clinic's real template
// count (17 as of the 2026-09-20 investigation); if it ever grows past this,
// undercounting here degrades gracefully to an honest partial count rather
// than an error, since staff care about "roughly how many," not an exact
// total requiring full pagination.
async function fetchTemplateSummary(wabaId: string, token: string): Promise<TemplateSummary | null> {
  try {
    const data = await graphGet(
      `https://graph.facebook.com/${GRAPH_VER}/${wabaId}/message_templates?fields=status&limit=250&access_token=${token}`
    )
    const templates: { status?: string }[] = data.data ?? []
    let approvedCount = 0, pendingCount = 0, rejectedCount = 0
    for (const t of templates) {
      if (t.status === 'APPROVED') approvedCount++
      else if (t.status === 'PENDING') pendingCount++
      else if (t.status === 'REJECTED') rejectedCount++
    }
    return { approvedCount, pendingCount, rejectedCount, totalCount: templates.length }
  } catch {
    return null
  }
}

// The most recent real 131042 failure this app has actually seen, and its
// Meta-provided action URL — never constructed, only ever read back from
// what Meta itself returned in an error response. This is a cheap local DB
// read, not a Graph API call, and is deliberately NEVER cached: it decides
// whether an active incident is reported as ATTENTION_REQUIRED, so it must
// reflect the database at request time, not up to CACHE_TTL_MS stale. (Real
// incident this fixes: the whole response used to be cached as one blob, so
// this file kept serving 'HEALTHY' for hours after a fresh 131042 had
// already landed, because it was cached alongside the genuinely-slow Graph
// API fields below.)
interface RecentFailureEvidence {
  recentFailure: { occurredAt: Date; details: string | null; code: number; title: string } | null
  within24h: boolean
  adminActionUrl: string | null
}

async function getRecentFailureEvidence(): Promise<RecentFailureEvidence> {
  const recentFailure = await prisma.metaDeliveryFailure.findFirst({
    where: { code: 131042 },
    orderBy: { occurredAt: 'desc' },
    select: { occurredAt: true, details: true, code: true, title: true },
  })
  const within24h = recentFailure
    ? Date.now() - recentFailure.occurredAt.getTime() < 24 * 60 * 60 * 1000
    : false
  let adminActionUrl: string | null = null
  if (recentFailure?.details) {
    const match = recentFailure.details.match(/https:\/\/business\.facebook\.com\/billing_hub\/\S+/)
    if (match) adminActionUrl = match[0].replace(/[.,]$/, '')
  }
  return { recentFailure, within24h, adminActionUrl }
}

// Genuinely slow-changing, real external calls (WABA review status, credit
// lines) — the only part worth CACHE_TTL_MS caching, so as not to hammer
// Graph API. businessId is only ever derived from RecentFailureEvidence
// (never queried), so it's passed in rather than looked up here.
interface GraphBillingData {
  wabaStatus: string | null
  businessId: string | null
  phoneNumber: PhoneNumberStatus | null
  templates: TemplateSummary | null
  creditLines: CreditLine[]
  creditLinesSource: MetaBillingStatus['creditLinesSource']
  creditLinesNote: string
  graphApiError: string | null
}

interface GraphCacheShape extends GraphBillingData { cachedAt: string }

function readGraphCache(): GraphCacheShape | null {
  try {
    const c = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')) as GraphCacheShape
    if (Date.now() - new Date(c.cachedAt).getTime() < CACHE_TTL_MS) return c
    return null
  } catch { return null }
}

function writeGraphCache(data: GraphBillingData): void {
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify({ ...data, cachedAt: new Date().toISOString() }), 'utf-8') } catch {}
}

async function fetchGraphBillingData(token: string, businessId: string | null, forceRefresh: boolean): Promise<GraphBillingData> {
  if (!forceRefresh) {
    const cached = readGraphCache()
    // Only reuse the cache if it was built for the same businessId — a
    // businessId we've only just learned (first-ever 131042) must not
    // silently reuse a stale "no business_id known" cache entry.
    if (cached && cached.businessId === businessId) {
      const { wabaStatus, phoneNumber, templates, creditLines, creditLinesSource, creditLinesNote, graphApiError } = cached
      // A cache file written by a pre-2026-09-20 deploy won't have
      // phoneNumber/templates keys at all — default them rather than let
      // `undefined` leak into fields typed `T | null`. Self-heals within
      // CACHE_TTL_MS regardless.
      return { wabaStatus, businessId, phoneNumber: phoneNumber ?? null, templates: templates ?? null, creditLines, creditLinesSource, creditLinesNote, graphApiError }
    }
  }

  let wabaStatus: string | null = null
  let graphApiError: string | null = null
  const wabaId = getWhatsAppWabaId()
  if (!wabaId) {
    graphApiError = 'WHATSAPP_WABA_ID not configured — cannot query the production WABA.'
  } else {
    try {
      const waba = await graphGet(`https://graph.facebook.com/${GRAPH_VER}/${wabaId}?fields=account_review_status&access_token=${token}`)
      wabaStatus = waba.account_review_status ?? null
    } catch (e: any) {
      graphApiError = e.message
    }
  }

  const phoneNumberId = getWhatsAppPhoneNumberId()
  const phoneNumber = phoneNumberId ? await fetchPhoneNumberStatus(phoneNumberId, token) : null
  const templates    = wabaId ? await fetchTemplateSummary(wabaId, token) : null

  let creditLines: CreditLine[] = []
  let creditLinesSource: MetaBillingStatus['creditLinesSource'] = 'UNAVAILABLE'
  let creditLinesNote = 'No business_id known yet (derived only from a real 131042 error response) — nothing to query.'

  if (businessId) {
    const result = await fetchCreditLines(businessId, token)
    if (result.error) {
      creditLinesNote = `Graph API error: ${result.error}`
      if (!graphApiError) graphApiError = result.error
    } else {
      creditLines = result.lines
      creditLinesSource = 'GRAPH_API_EXTENDEDCREDITS'
      creditLinesNote = 'Marketing API credit-line balances for this Business Manager account — not a distinctly-labeled WhatsApp messaging invoice figure. Meta does not expose that to this app’s token (payment_methods/adaccounts/funding fields all return permission-denied).'
    }
  }

  const data: GraphBillingData = { wabaStatus, businessId, phoneNumber, templates, creditLines, creditLinesSource, creditLinesNote, graphApiError }
  writeGraphCache(data)
  return data
}

const BILLING_DATA_NOTE =
  'Detailed WhatsApp payment method and outstanding balance are managed in Meta Business Manager and are not available through the current API connection.'

export async function getMetaBillingStatus(forceRefresh = false): Promise<MetaBillingStatus> {
  const token = process.env.WHATSAPP_TOKEN
  const now = new Date().toISOString()

  // Always fresh — see getRecentFailureEvidence's comment above.
  const { recentFailure, within24h, adminActionUrl } = await getRecentFailureEvidence()

  // The business_id isn't a WABA field — it's only known via the href Meta
  // put in a real error response. If we've never seen a 131042, we genuinely
  // don't have a business_id to query extendedcredits for.
  let businessId: string | null = null
  if (recentFailure?.details) {
    const bizMatch = recentFailure.details.match(/business_id=(\d+)/)
    if (bizMatch) businessId = bizMatch[1]
  }
  if (!businessId && adminActionUrl) {
    const bizMatch = adminActionUrl.match(/business_id=(\d+)/)
    if (bizMatch) businessId = bizMatch[1]
  }

  const latestPaymentError = recentFailure ? {
    code: recentFailure.code,
    title: recentFailure.title ?? 'Business eligibility payment issue',
    occurredAt: recentFailure.occurredAt.toISOString(),
  } : null

  if (!token) {
    return {
      billingStatus: within24h ? 'ATTENTION_REQUIRED' : 'UNKNOWN',
      wabaConfigured: getWhatsAppWabaId() != null,
      wabaAccountReviewStatus: null,
      phoneNumber: null,
      templates: null,
      creditLines: [],
      creditLinesSource: 'UNAVAILABLE',
      creditLinesNote: 'WHATSAPP_TOKEN not configured — cannot query Meta.',
      recent131042: recentFailure != null,
      recent131042Within24h: within24h,
      latestPaymentError,
      adminActionUrl,
      adminActionSource: adminActionUrl ? 'META_ERROR_RESPONSE' : 'NONE',
      billingDataNote: BILLING_DATA_NOTE,
      fetchedAt: now,
      graphApiError: 'WHATSAPP_TOKEN not configured',
    }
  }

  const graph = await fetchGraphBillingData(token, businessId, forceRefresh)

  const billingStatus: BillingStatus = within24h
    ? 'ATTENTION_REQUIRED'
    : (graph.graphApiError && graph.creditLines.length === 0) ? 'UNKNOWN' : 'HEALTHY'

  return {
    billingStatus,
    wabaConfigured: getWhatsAppWabaId() != null,
    wabaAccountReviewStatus: graph.wabaStatus,
    phoneNumber: graph.phoneNumber,
    templates: graph.templates,
    creditLines: graph.creditLines,
    creditLinesSource: graph.creditLinesSource,
    creditLinesNote: graph.creditLinesNote,
    recent131042: recentFailure != null,
    recent131042Within24h: within24h,
    latestPaymentError,
    adminActionUrl,
    adminActionSource: adminActionUrl ? 'META_ERROR_RESPONSE' : 'NONE',
    billingDataNote: BILLING_DATA_NOTE,
    fetchedAt: now,
    graphApiError: graph.graphApiError,
  }
}
