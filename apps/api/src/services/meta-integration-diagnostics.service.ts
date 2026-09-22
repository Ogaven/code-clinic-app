// ─────────────────────────────────────────────────────────────────────────
// Read-only Meta integration diagnostics for the Facebook/Instagram/WhatsApp
// "Meta Integration Health" cards. Every call here is a GET against Graph
// API using already-configured tokens — nothing here can send a message,
// reply to a comment, or change a Meta subscription. Built 2026-09-20 to
// give staff (and future debugging) real, evidence-backed answers instead
// of "Connected" merely because credentials exist:
//
//   - app-level webhook subscriptions (callback_url/active/fields per
//     object), from GET /{app-id}/subscriptions using an app access token
//   - whether the Page itself is subscribed to receive from OUR app, from
//     GET /me/subscribed_apps using the Page token (distinct from the
//     app-level check above — an app can have an active subscription while
//     a specific Page was never actually subscribed to it)
//   - Page/Instagram asset reachability, from a plain GET on each asset
//   - granted token scopes, from GET /debug_token
//
// Every field degrades to null/'UNKNOWN' with a stated reason rather than
// guessing — see getMetaIntegrationDiagnostics's docstring for the exact
// "cannot determine without X" cases this produces.
// ─────────────────────────────────────────────────────────────────────────
import { getWhatsAppToken } from '../config/meta-config'

const GRAPH_VER = 'v24.0'

export interface AppSubscriptionInfo {
  object: string
  callbackUrl: string | null
  active: boolean | null
  fields: string[]
}

export interface TokenInfo {
  type: string | null
  scopes: string[]
  expiresAt: string | null
  isValid: boolean | null
}

export interface PermissionCheck {
  permission: string
  requiredByFeature: string
  granted: boolean | 'UNKNOWN'
}

export interface MetaIntegrationDiagnostics {
  appConfigured: boolean
  appSubscriptions: AppSubscriptionInfo[] | null
  pageSubscribedToApp: boolean | null
  pageSubscribedFields: string[] | null
  pageReachable: boolean | null
  pageId: string | null
  pageName: string | null
  instagramReachable: boolean | null
  instagramAccountId: string | null
  instagramUsername: string | null
  pageTokenInfo: TokenInfo | null
  whatsappPhoneSubscribed: boolean | null
  permissionChecks: PermissionCheck[]
  graphApiError: string | null
  fetchedAt: string
}

async function graphGet(url: string): Promise<{ ok: boolean; json: any }> {
  try {
    const res = await fetch(url)
    const json = await res.json() as any
    return { ok: res.ok && !json.error, json }
  } catch (e: any) {
    return { ok: false, json: { error: { message: e.message } } }
  }
}

// Documents which real, already-granted-or-not permission each live Meta
// feature in this codebase actually depends on — see facebook.routes.ts and
// routes/webhooks.ts for where each is used. Not a guess: this list mirrors
// the exact Graph API calls those files make.
const REQUIRED_PERMISSIONS: { permission: string; requiredByFeature: string }[] = [
  { permission: 'pages_messaging',        requiredByFeature: 'Facebook Messenger DMs (receive + reply)' },
  { permission: 'pages_read_engagement',  requiredByFeature: 'Facebook Page feed events (reactions/posts)' },
  { permission: 'pages_read_user_content', requiredByFeature: 'Facebook comment content in webhook payloads' },
  { permission: 'pages_manage_engagement', requiredByFeature: 'Posting Facebook comment replies' },
  { permission: 'instagram_basic',         requiredByFeature: 'Instagram account identity lookups' },
  { permission: 'instagram_manage_messages', requiredByFeature: 'Instagram DMs (receive + reply)' },
  { permission: 'instagram_manage_comments', requiredByFeature: 'Instagram comment replies' },
  { permission: 'business_management',     requiredByFeature: 'WhatsApp/Business Manager account queries' },
]

export async function getMetaIntegrationDiagnostics(): Promise<MetaIntegrationDiagnostics> {
  const now = new Date().toISOString()
  const appId     = process.env.FACEBOOK_APP_ID?.trim() || null
  const appSecret = process.env.FACEBOOK_APP_SECRET?.trim() || null
  const pageToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN?.trim() || null
  const igToken   = process.env.INSTAGRAM_ACCESS_TOKEN?.trim() || pageToken
  const igAccountId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID?.trim() || null
  const waToken   = getWhatsAppToken()
  const wabaPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() || null

  const appConfigured = !!(appId && appSecret)
  let graphApiError: string | null = null

  // ── App-level webhook subscriptions — requires an app access token ──────
  let appSubscriptions: AppSubscriptionInfo[] | null = null
  if (appConfigured) {
    const appAccessToken = `${appId}|${appSecret}`
    const { ok, json } = await graphGet(`https://graph.facebook.com/${GRAPH_VER}/${appId}/subscriptions?access_token=${appAccessToken}`)
    if (ok && Array.isArray(json.data)) {
      appSubscriptions = json.data.map((s: any) => ({
        object:      s.object,
        callbackUrl: s.callback_url ?? null,
        active:      s.active ?? null,
        fields:      Array.isArray(s.fields) ? s.fields.map((f: any) => (typeof f === 'string' ? f : f.name)) : [],
      }))
    } else {
      graphApiError = json.error?.message ?? 'Failed to fetch app subscriptions'
    }
  }

  // ── Is the Page itself subscribed to receive from our app? ──────────────
  let pageSubscribedToApp: boolean | null = null
  let pageSubscribedFields: string[] | null = null
  let pageReachable: boolean | null = null
  let pageId: string | null = null
  let pageName: string | null = null
  if (pageToken) {
    const identity = await graphGet(`https://graph.facebook.com/${GRAPH_VER}/me?fields=id,name&access_token=${pageToken}`)
    pageReachable = identity.ok
    if (identity.ok) { pageId = identity.json.id ?? null; pageName = identity.json.name ?? null }
    else if (!graphApiError) graphApiError = identity.json.error?.message ?? 'Page not reachable'

    if (appId) {
      const subs = await graphGet(`https://graph.facebook.com/${GRAPH_VER}/me/subscribed_apps?access_token=${pageToken}`)
      if (subs.ok && Array.isArray(subs.json.data)) {
        const ours = subs.json.data.find((a: any) => String(a.id) === String(appId))
        pageSubscribedToApp = !!ours
        pageSubscribedFields = ours?.subscribed_fields ?? null
      } else if (!graphApiError) {
        graphApiError = subs.json.error?.message ?? 'Failed to fetch page subscribed_apps'
      }
    }
  }

  // ── Instagram asset reachability ─────────────────────────────────────────
  let instagramReachable: boolean | null = null
  let instagramUsername: string | null = null
  if (igToken && igAccountId) {
    const ig = await graphGet(`https://graph.facebook.com/${GRAPH_VER}/${igAccountId}?fields=id,username&access_token=${igToken}`)
    instagramReachable = ig.ok
    if (ig.ok) instagramUsername = ig.json.username ?? null
    else if (!graphApiError) graphApiError = ig.json.error?.message ?? 'Instagram account not reachable'
  }

  // ── Page token scopes (debug_token) ──────────────────────────────────────
  let pageTokenInfo: TokenInfo | null = null
  if (appConfigured && pageToken) {
    const appAccessToken = `${appId}|${appSecret}`
    const dbg = await graphGet(`https://graph.facebook.com/${GRAPH_VER}/debug_token?input_token=${pageToken}&access_token=${appAccessToken}`)
    if (dbg.ok && dbg.json.data) {
      const d = dbg.json.data
      pageTokenInfo = {
        type: d.type ?? null,
        scopes: Array.isArray(d.scopes) ? d.scopes : [],
        expiresAt: d.expires_at && d.expires_at > 0 ? new Date(d.expires_at * 1000).toISOString() : null, // 0 = never expires (system/page tokens commonly don't)
        isValid: d.is_valid ?? null,
      }
    }
  }

  // ── WhatsApp phone number subscribed_apps (GET, read-only — does not subscribe anything) ──
  let whatsappPhoneSubscribed: boolean | null = null
  if (waToken && wabaPhoneNumberId) {
    const sub = await graphGet(`https://graph.facebook.com/${GRAPH_VER}/${wabaPhoneNumberId}/subscribed_apps?access_token=${waToken}`)
    if (sub.ok) whatsappPhoneSubscribed = Array.isArray(sub.json.data) && sub.json.data.length > 0
  }

  const grantedScopes = new Set(pageTokenInfo?.scopes ?? [])
  const permissionChecks: PermissionCheck[] = REQUIRED_PERMISSIONS.map(p => ({
    ...p,
    granted: pageTokenInfo ? grantedScopes.has(p.permission) : 'UNKNOWN',
  }))

  return {
    appConfigured,
    appSubscriptions,
    pageSubscribedToApp,
    pageSubscribedFields,
    pageReachable,
    pageId,
    pageName,
    instagramReachable,
    instagramAccountId: igAccountId,
    instagramUsername,
    pageTokenInfo,
    whatsappPhoneSubscribed,
    permissionChecks,
    graphApiError,
    fetchedAt: now,
  }
}
