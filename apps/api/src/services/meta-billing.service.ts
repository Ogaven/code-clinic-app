// ─────────────────────────────────────────────────────────────────────────
// Real Meta WhatsApp Business account/health status.
//
// 2026-09-22 cleanup: this used to also fetch the Business Manager's
// /extendedcredits edge and surface the results ("Ajua Inc.", "LeadConnector
// LLC" — real Marketing API credit-line entities, never Code Clinic's own
// WhatsApp billing) under a "Meta Billing" card. Confirmed unfixable by
// relabeling: Meta genuinely does not expose a WhatsApp-specific outstanding
// balance to this token (payment_methods/adaccounts/primary_funding_id all
// return permission-denied — "requires Business Solution Provider status").
// Per an explicit instruction to remove all non-Code-Clinic billing data
// from Analytics & Costs, that call and every credit-line field have been
// deleted outright rather than kept-but-demoted. The one authoritative,
// unfabricated signal this service still surfaces is the real #131042 error
// text and its Meta-provided `PAY_NOW` action URL — read back from a
// persisted MetaDeliveryFailure row, never constructed.
//
// 2026-09-20 correction (still in effect): `wabaAccountReviewStatus` used to
// be queried against a hardcoded WABA ID (`1754698499275270`) left over from
// before Code Clinic migrated off Africa's Talking onto direct Meta Cloud
// API (see whatsapp.service.ts's "Zero AT involvement" send path). That ID
// belongs to a different WABA under the same Business Manager. The real
// production WABA (`1035568108843333`) is read from WHATSAPP_WABA_ID via
// config/meta-config.ts — the single accessor for this ID.
// ─────────────────────────────────────────────────────────────────────────
import fs from 'fs'
import { prisma } from '../lib/prisma'
import { getWhatsAppWabaId, getWhatsAppPhoneNumberId } from '../config/meta-config'

const GRAPH_VER    = 'v25.0'
const CACHE_FILE   = '/tmp/codeclinic-meta-billing.json'
const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6 hours — this data changes slowly; avoid hammering Graph API

export type BillingStatus = 'HEALTHY' | 'ATTENTION_REQUIRED' | 'UNKNOWN'

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
// count (16 as of the 2026-09-22 verification); if it ever grows past this,
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
// reflect the database at request time, not up to CACHE_TTL_MS stale.
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

// Genuinely slow-changing, real external calls (WABA review status, phone
// number, templates) — the only part worth CACHE_TTL_MS caching, so as not
// to hammer Graph API.
interface GraphBillingData {
  wabaStatus: string | null
  phoneNumber: PhoneNumberStatus | null
  templates: TemplateSummary | null
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

async function fetchGraphBillingData(token: string, forceRefresh: boolean): Promise<GraphBillingData> {
  if (!forceRefresh) {
    const cached = readGraphCache()
    if (cached) {
      const { wabaStatus, phoneNumber, templates, graphApiError } = cached
      // A cache file written by an older deploy may not have every current
      // key — default rather than let `undefined` leak into `T | null` fields.
      return { wabaStatus, phoneNumber: phoneNumber ?? null, templates: templates ?? null, graphApiError }
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

  const data: GraphBillingData = { wabaStatus, phoneNumber, templates, graphApiError }
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

  const graph = await fetchGraphBillingData(token, forceRefresh)

  const billingStatus: BillingStatus = within24h
    ? 'ATTENTION_REQUIRED'
    : graph.graphApiError ? 'UNKNOWN' : 'HEALTHY'

  return {
    billingStatus,
    wabaConfigured: getWhatsAppWabaId() != null,
    wabaAccountReviewStatus: graph.wabaStatus,
    phoneNumber: graph.phoneNumber,
    templates: graph.templates,
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
