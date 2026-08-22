import { Router } from 'express'
import { google } from 'googleapis'
import { randomBytes, createCipheriv, createDecipheriv } from 'crypto'
import { requireAuth } from '../middleware/auth'
import { adminOnly } from '../middleware/rbac'
import { prisma } from '../lib/prisma'

// Google Business Profile connection — verification/diagnostic phase only.
// Deliberately kept separate from ../routes/integrations.ts (Google Calendar):
// dedicated OAuth client credentials only (no fallback), separate redirect
// URI, separate app_settings token key (encrypted independently of Calendar's
// plaintext gcal_tokens), and a single scope (business.manage) — so a
// Calendar reconnect/disconnect can never touch GBP tokens or vice versa.
const router = Router()

const GBP_SCOPE          = 'https://www.googleapis.com/auth/business.manage'
const GBP_TOKENS_KEY     = 'gbp_tokens'
const GBP_EMAIL_KEY      = 'gbp_email'
const GBP_STATE_PREFIX   = 'gbp_oauth_state:'
const STATE_TTL_MS       = 10 * 60 * 1000
const GOOGLE_API_TIMEOUT_MS = 8000

const ACCOUNTS_CACHE_TTL_MS        = 15 * 60 * 1000
const LOCATIONS_CACHE_TTL_MS       = 15 * 60 * 1000
const REVIEW_SUMMARY_CACHE_TTL_MS  = 5  * 60 * 1000

class GbpConfigError extends Error {
  constructor(message: string) { super(message); Object.setPrototypeOf(this, GbpConfigError.prototype) }
}
class GbpEncryptionUnavailableError extends Error {
  constructor() {
    super('ENCRYPTION_KEY is not configured — Google Business Profile tokens cannot be stored securely.')
    Object.setPrototypeOf(this, GbpEncryptionUnavailableError.prototype)
  }
}

function getGbpRedirectUri() {
  if (process.env.GOOGLE_GBP_REDIRECT_URI) return process.env.GOOGLE_GBP_REDIRECT_URI
  if (process.env.RAILWAY_PUBLIC_DOMAIN)
    return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/business-profile/google/callback`
  return 'https://api.codeclinicemr.com/business-profile/google/callback'
}

// Dedicated GBP credentials only — no fallback to GOOGLE_CLIENT_ID/SECRET.
// business.manage is a broader, more sensitive scope than Calendar's; a
// shared client would mean the two integrations couldn't be revoked or
// rotated independently.
function makeGbpOAuth2Client() {
  const clientId     = process.env.GOOGLE_GBP_CLIENT_ID
  const clientSecret = process.env.GOOGLE_GBP_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new GbpConfigError('GOOGLE_GBP_CLIENT_ID and GOOGLE_GBP_CLIENT_SECRET must both be set — Google Business Profile no longer falls back to Calendar credentials.')
  }
  const redirectUri = getGbpRedirectUri()
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri)
}

function isGbpConfigured(): boolean {
  return !!(process.env.GOOGLE_GBP_CLIENT_ID && process.env.GOOGLE_GBP_CLIENT_SECRET)
}

// ─── Token encryption at rest (AES-256-GCM) ────────────────────
// Independent of the medical-notes AES helper in
// services/agent/agent-tools.ts (different data, different lifecycle,
// not shared or modified). Ciphertext is stored as `iv:authTag:cipher`
// (all hex) inside the existing app_settings.value column — no schema
// change. In production, a missing/malformed ENCRYPTION_KEY is a hard
// failure (tokens are never written or read in plaintext). Outside
// production only, falls back to a clearly-marked `plain:` prefix so local
// dev works without provisioning a key — this path is refused in production.
function getGbpEncryptionKey(): Buffer | null {
  const raw = process.env.ENCRYPTION_KEY
  if (!raw || !/^[0-9a-fA-F]{64}$/.test(raw)) return null
  return Buffer.from(raw, 'hex')
}

function encryptGbpPayload(plaintext: string): string {
  const key = getGbpEncryptionKey()
  if (!key) {
    if (process.env.NODE_ENV === 'production') throw new GbpEncryptionUnavailableError()
    console.warn('[GBP] ENCRYPTION_KEY missing/invalid — storing tokens in PLAINTEXT (non-production only).')
    return `plain:${plaintext}`
  }
  const iv         = randomBytes(12)
  const cipher      = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext  = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag     = cipher.getAuthTag()
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`
}

function decryptGbpPayload(stored: string): string {
  if (stored.startsWith('plain:')) return stored.slice('plain:'.length)
  const key = getGbpEncryptionKey()
  if (!key) throw new GbpEncryptionUnavailableError()
  const [ivHex, authTagHex, cipherHex] = stored.split(':')
  if (!ivHex || !authTagHex || !cipherHex) throw new Error('Malformed encrypted Google Business Profile token payload')
  const iv       = Buffer.from(ivHex, 'hex')
  const authTag  = Buffer.from(authTagHex, 'hex')
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(Buffer.from(cipherHex, 'hex')), decipher.final()]).toString('utf8')
}

// ─── DB-backed token store (separate key from gcal_tokens) ────
async function loadTokens(): Promise<any | null> {
  const rows = await prisma.$queryRaw<{ value: string }[]>`SELECT value FROM app_settings WHERE key = ${GBP_TOKENS_KEY} LIMIT 1`.catch(() => [] as { value: string }[])
  if (!rows.length) return null
  const decrypted = decryptGbpPayload(rows[0].value) // throws GbpEncryptionUnavailableError if unconfigured in production
  return JSON.parse(decrypted)
}

async function saveTokens(tokens: any) {
  const value = encryptGbpPayload(JSON.stringify(tokens)) // throws GbpEncryptionUnavailableError if unconfigured in production
  await prisma.$executeRaw`
    INSERT INTO app_settings (key, value, "updatedAt")
    VALUES (${GBP_TOKENS_KEY}, ${value}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = ${value}, "updatedAt" = NOW()
  `
  invalidateGbpCaches()
}

async function deleteTokens() {
  try { await prisma.$executeRaw`DELETE FROM app_settings WHERE key = ${GBP_TOKENS_KEY}` } catch {}
  invalidateGbpCaches()
}

// ─── Lightweight in-memory caches ──────────────────────────────
// Single shared GBP connection for the whole clinic (not per-admin), so a
// small constant/URL-derived key is enough. Never populated on error paths
// — auth/permission failures are never cached, only successful responses.
interface CacheEntry<T> { value: T; expiresAt: number }
const accountsCache      = new Map<string, CacheEntry<any>>()
const locationsCache     = new Map<string, CacheEntry<any>>()
const reviewSummaryCache = new Map<string, CacheEntry<any>>()

function cacheGet<T>(cache: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const entry = cache.get(key)
  if (!entry) return undefined
  if (Date.now() > entry.expiresAt) { cache.delete(key); return undefined }
  return entry.value
}
function cacheSet<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs })
}
function invalidateGbpCaches() {
  accountsCache.clear()
  locationsCache.clear()
  reviewSummaryCache.clear()
}

// Prevents a slow/hanging Google API call from blocking a request forever.
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>
}

// ─── OAuth state (CSRF) store ───────────────────────────────────
// One-time, server-verified, short-lived. Stored in app_settings (no
// migration needed — it's already a free-text key/value table) under a
// per-state key so each authorization attempt gets its own row;
// consumeOAuthState() deletes it on read so it can't be replayed.
interface OAuthStatePayload {
  returnTo: string
  createdAt: number
  expiresAt: number
  adminUserId?: string
}

async function createOAuthState(returnTo: string, adminUserId?: string): Promise<string> {
  const state = randomBytes(32).toString('hex')
  const payload: OAuthStatePayload = { returnTo, createdAt: Date.now(), expiresAt: Date.now() + STATE_TTL_MS, adminUserId }
  const value = JSON.stringify(payload)
  await prisma.$executeRaw`
    INSERT INTO app_settings (key, value, "updatedAt")
    VALUES (${GBP_STATE_PREFIX + state}, ${value}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = ${value}, "updatedAt" = NOW()
  `
  return state
}

async function consumeOAuthState(state: string): Promise<OAuthStatePayload | null> {
  const key = GBP_STATE_PREFIX + state
  const rows = await prisma.$queryRaw<{ value: string }[]>`SELECT value FROM app_settings WHERE key = ${key} LIMIT 1`
  await prisma.$executeRaw`DELETE FROM app_settings WHERE key = ${key}` // consume unconditionally — single use, no replay
  if (!rows.length) return null
  try {
    const payload = JSON.parse(rows[0].value) as OAuthStatePayload
    if (Date.now() > payload.expiresAt) return null
    return payload
  } catch { return null }
}

// Restricts post-auth redirects to internal, relative application paths —
// rejects protocol-relative ("//evil.com"), absolute URLs, and anything
// outside a safe charset, closing off open-redirect via a crafted returnTo.
function sanitizeReturnTo(input: unknown): string {
  const fallback = '/settings'
  if (typeof input !== 'string' || !input) return fallback
  if (!/^\/(?!\/)[A-Za-z0-9\-_/]*$/.test(input)) return fallback
  return input
}

// Returns a ready-to-use, auto-refreshed OAuth2 client, or a structured error
async function getReadyAuth(): Promise<{ auth: any } | { error: string; status: number; message: string }> {
  let tokens: any
  try {
    tokens = await loadTokens()
  } catch (e: any) {
    if (e instanceof GbpEncryptionUnavailableError) return { error: 'encryption_not_configured', status: 500, message: e.message }
    return { error: 'not_connected', status: 401, message: 'Could not load stored Google Business Profile tokens.' }
  }
  if (!tokens) {
    return { error: 'not_connected', status: 401, message: 'Google Business Profile not connected — call GET /business-profile/auth-url to begin.' }
  }

  let auth: any
  try {
    auth = makeGbpOAuth2Client()
  } catch (e: any) {
    return { error: 'gbp_not_configured', status: 500, message: e.message }
  }
  auth.setCredentials(tokens)
  auth.on('tokens', async (t: any) => {
    try {
      const current = await loadTokens()
      await saveTokens({ ...current, ...t })
    } catch (e: any) {
      console.error('[GBP] Background token refresh save failed:', e.message)
    }
  })

  if (tokens.expiry_date && Date.now() >= tokens.expiry_date) {
    if (!tokens.refresh_token) {
      await deleteTokens()
      return { error: 'token_expired', status: 401, message: 'Google Business Profile session expired and no refresh token was issued — please reconnect.' }
    }
    try {
      const { credentials } = await withTimeout<any>(auth.refreshAccessToken(), GOOGLE_API_TIMEOUT_MS, 'token refresh')
      const merged = { ...tokens, ...credentials }
      await saveTokens(merged)
      auth.setCredentials(merged)
    } catch (e: any) {
      if (e instanceof GbpEncryptionUnavailableError) return { error: 'encryption_not_configured', status: 500, message: e.message }
      await deleteTokens()
      return { error: 'token_expired', status: 401, message: 'Google Business Profile session expired — please reconnect.' }
    }
  }
  return { auth }
}

// Google's Business Profile APIs return 0 quota until Google manually
// approves a "Basic API Access" request for the project — that shows up as
// a 403 PERMISSION_DENIED here. Flagged explicitly so it isn't mistaken for
// a code bug.
function formatGoogleError(e: any, context: string) {
  const status  = e.code || e.status || e.response?.status || 500
  const message = e.errors?.[0]?.message || e.response?.data?.error?.message || e.message || 'Unknown Google API error'
  const likelyAccessNotApproved = status === 403 && /permission|quota|not.*enabled|not.*verified/i.test(String(message))
  return { error: 'google_api_error', context, status, message, likelyAccessNotApproved }
}

// ─── GET /business-profile/status ──────────────────────────────
router.get('/status', requireAuth, adminOnly, async (_req, res) => {
  const configured           = isGbpConfigured()
  const encryptionConfigured = !!getGbpEncryptionKey()
  if (!configured) {
    return res.json({ connected: false, configured: false, encryptionConfigured, scope: GBP_SCOPE, message: 'GOOGLE_GBP_CLIENT_ID / GOOGLE_GBP_CLIENT_SECRET are not set.' })
  }

  let tokens: any
  try {
    tokens = await loadTokens()
  } catch (e: any) {
    return res.json({ connected: false, configured: true, encryptionConfigured, scope: GBP_SCOPE, error: 'encryption_not_configured', message: e.message })
  }
  if (!tokens) return res.json({ connected: false, configured: true, encryptionConfigured, scope: GBP_SCOPE })

  const emailRow = await prisma.$queryRaw<{ value: string }[]>`SELECT value FROM app_settings WHERE key = ${GBP_EMAIL_KEY} LIMIT 1`.catch(() => [])
  let email: string | null = emailRow.length ? emailRow[0].value : null
  if (email) { try { email = JSON.parse(email) } catch { /* raw value is fine */ } }
  res.json({
    connected: true,
    configured: true,
    encryptionConfigured,
    email,
    hasRefresh:  !!tokens.refresh_token,
    expiry:      tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
    redirectUri: getGbpRedirectUri(),
    scope:       GBP_SCOPE,
  })
})

// ─── GET /business-profile/auth-url ────────────────────────────
// Returns JSON { url } — the sole OAuth initiation path. Called via the
// app's normal fetch-with-Authorization-header pattern (same as every other
// admin endpoint), never a bare browser navigation, so no JWT ever appears
// in a URL.
router.get('/auth-url', requireAuth, adminOnly, async (req, res) => {
  let auth: any
  try {
    auth = makeGbpOAuth2Client()
  } catch (e: any) {
    return res.status(500).json({ error: 'gbp_not_configured', message: e.message })
  }
  const returnTo = sanitizeReturnTo(req.query.returnTo)
  const state     = await createOAuthState(returnTo, req.user?.id)
  const url = auth.generateAuthUrl({
    access_type: 'offline',
    prompt:      'consent',
    scope:       [GBP_SCOPE],
    state,
  })
  res.json({ url })
})

// ─── GET /business-profile/google/callback ─────────────────────
// Google sends the admin back here with ?code=&state=. Public route (Google
// can't send an Authorization header) — protected instead by the one-time
// server-side state issued in /auth-url: unknown or expired state is
// rejected outright, and any state — valid or not — is deleted on first use
// so it can never be replayed.
router.get('/google/callback', async (req, res) => {
  const { code, error, state } = req.query as Record<string, string>
  const front = process.env.APP_URL || 'http://localhost:3000'

  if (!state) {
    console.error('[GBP] Callback rejected — missing state')
    return res.redirect(`${front}/settings?gbp=error&reason=missing_state`)
  }
  const statePayload = await consumeOAuthState(state)
  if (!statePayload) {
    console.error('[GBP] Callback rejected — unknown or expired state')
    return res.redirect(`${front}/settings?gbp=error&reason=invalid_state`)
  }
  const returnTo = statePayload.returnTo
  console.log('[GBP] Callback hit — code:', !!code, 'error:', error || 'none', 'initiatedBy:', statePayload.adminUserId || 'unknown')

  if (error || !code) {
    const reason = error || 'no_code'
    console.error('[GBP] OAuth error:', reason)
    return res.redirect(`${front}${returnTo}?gbp=error&reason=${encodeURIComponent(reason)}`)
  }

  let auth: any
  try {
    auth = makeGbpOAuth2Client()
  } catch (e: any) {
    console.error('[GBP] Callback config error:', e.message)
    return res.redirect(`${front}${returnTo}?gbp=error&reason=gbp_not_configured`)
  }

  try {
    const { tokens } = await withTimeout<any>(auth.getToken(code), GOOGLE_API_TIMEOUT_MS, 'token exchange')
    await saveTokens(tokens)
    try {
      auth.setCredentials(tokens)
      const oauth2 = google.oauth2({ version: 'v2', auth })
      const info   = await withTimeout(oauth2.userinfo.get(), GOOGLE_API_TIMEOUT_MS, 'userinfo fetch')
      const email  = info.data.email
      if (email) {
        await prisma.$executeRaw`
          INSERT INTO app_settings (key, value, "updatedAt") VALUES (${GBP_EMAIL_KEY}, ${email}, NOW())
          ON CONFLICT (key) DO UPDATE SET value = ${email}, "updatedAt" = NOW()
        `
        console.log('[GBP] Connected as', email)
      }
    } catch (emailErr: any) { console.warn('[GBP] Could not fetch email:', emailErr.message) }
    res.redirect(`${front}${returnTo}?gbp=connected`)
  } catch (e: any) {
    if (e instanceof GbpEncryptionUnavailableError) {
      console.error('[GBP] Token storage failed — encryption not configured')
      return res.redirect(`${front}${returnTo}?gbp=error&reason=encryption_not_configured`)
    }
    console.error('[GBP] Token exchange error:', e.message)
    res.redirect(`${front}${returnTo}?gbp=error&reason=${encodeURIComponent(e.message)}`)
  }
})

// ─── DELETE /business-profile/disconnect ───────────────────────
router.delete('/disconnect', requireAuth, adminOnly, async (_req, res) => {
  await deleteTokens()
  res.json({ message: 'Google Business Profile disconnected' })
})

// ─── GET /business-profile/accounts ────────────────────────────
// Diagnostic: lists the Business Profile accounts visible to the connected
// Google account. Cached 15 minutes on success only.
router.get('/accounts', requireAuth, adminOnly, async (_req, res) => {
  const ready = await getReadyAuth()
  if ('error' in ready) return res.status(ready.status).json(ready)

  const cached = cacheGet(accountsCache, 'accounts')
  if (cached) return res.json(cached)

  const start = Date.now()
  try {
    const mbam = google.mybusinessaccountmanagement({ version: 'v1', auth: ready.auth })
    const r    = await withTimeout(mbam.accounts.list({}), GOOGLE_API_TIMEOUT_MS, 'accounts.list')
    const accounts = (r.data.accounts || []).map(a => ({
      name:              a.name,
      accountName:       a.accountName,
      type:              a.type,
      role:              a.role,
      verificationState: a.verificationState,
    }))
    console.log('[GBP] accounts.list ok in %dms — %d account(s)', Date.now() - start, accounts.length)
    const payload = { accounts }
    cacheSet(accountsCache, 'accounts', payload, ACCOUNTS_CACHE_TTL_MS)
    res.json(payload)
  } catch (e: any) {
    console.error('[GBP] accounts.list failed in %dms:', Date.now() - start, e.message)
    const formatted = formatGoogleError(e, 'accounts.list')
    res.status(formatted.status).json(formatted)
  }
})

// ─── GET /business-profile/locations?accountId= ────────────────
// Diagnostic: lists locations for a given account (or every account found,
// if accountId is omitted). Cached 15 minutes, only when no per-account
// errors occurred (never caches a permission/auth failure).
router.get('/locations', requireAuth, adminOnly, async (req, res) => {
  const ready = await getReadyAuth()
  if ('error' in ready) return res.status(ready.status).json(ready)
  const accountIdParam = req.query.accountId as string | undefined
  const cacheKey = accountIdParam || 'all'

  const cached = cacheGet(locationsCache, cacheKey)
  if (cached) return res.json(cached)

  const start = Date.now()
  try {
    const mbbi = google.mybusinessbusinessinformation({ version: 'v1', auth: ready.auth })
    let accountResourceNames: string[]

    if (accountIdParam) {
      accountResourceNames = [accountIdParam.startsWith('accounts/') ? accountIdParam : `accounts/${accountIdParam}`]
    } else {
      const mbam   = google.mybusinessaccountmanagement({ version: 'v1', auth: ready.auth })
      const accRes = await withTimeout(mbam.accounts.list({}), GOOGLE_API_TIMEOUT_MS, 'accounts.list')
      accountResourceNames = (accRes.data.accounts || []).map(a => a.name).filter((n): n is string => !!n)
    }

    const results: any[] = []
    for (const parent of accountResourceNames) {
      try {
        const locRes = await withTimeout(
          mbbi.accounts.locations.list({ parent, readMask: 'name,title,storefrontAddress,phoneNumbers,metadata', pageSize: 100 }),
          GOOGLE_API_TIMEOUT_MS, 'locations.list',
        )
        results.push({
          account: parent,
          locations: (locRes.data.locations || []).map(l => ({
            name:         l.name,
            title:        l.title,
            address:      l.storefrontAddress,
            phoneNumbers: l.phoneNumbers,
            placeId:      l.metadata?.placeId,
          })),
        })
      } catch (e: any) {
        results.push({ account: parent, error: formatGoogleError(e, 'locations.list') })
      }
    }
    console.log('[GBP] locations.list ok in %dms — %d account(s) queried', Date.now() - start, accountResourceNames.length)
    const payload = { results }
    const hasErrors = results.some(r => 'error' in r)
    if (!hasErrors) cacheSet(locationsCache, cacheKey, payload, LOCATIONS_CACHE_TTL_MS)
    res.json(payload)
  } catch (e: any) {
    console.error('[GBP] locations.list failed in %dms:', Date.now() - start, e.message)
    const formatted = formatGoogleError(e, 'locations.list')
    res.status(formatted.status).json(formatted)
  }
})

// ─── GET /business-profile/reviews?accountId=&locationId=&pageSize=&pageToken= ──
// Diagnostic only — returns one page of Google's real review data for a
// location. Never auto-paginates the full history; caller must pass
// nextPageToken back in as pageToken to fetch more. Nothing is written to
// the database (no Review model exists yet — connection/verification phase
// only).
router.get('/reviews', requireAuth, adminOnly, async (req, res) => {
  const ready = await getReadyAuth()
  if ('error' in ready) return res.status(ready.status).json(ready)

  const accountId  = req.query.accountId as string | undefined
  const locationId = req.query.locationId as string | undefined
  if (!accountId || !locationId) {
    return res.status(400).json({
      error: 'missing_params',
      message: 'Provide ?accountId= and ?locationId= — discover them via GET /business-profile/accounts and /business-profile/locations first.',
    })
  }
  const accId = accountId.replace(/^accounts\//, '')
  const locId = locationId.replace(/^locations\//, '')

  const DEFAULT_PAGE_SIZE = 20
  const MAX_PAGE_SIZE     = 50
  let pageSize = parseInt(req.query.pageSize as string, 10)
  if (!Number.isFinite(pageSize) || pageSize <= 0) pageSize = DEFAULT_PAGE_SIZE
  pageSize = Math.min(pageSize, MAX_PAGE_SIZE)
  const pageToken = req.query.pageToken as string | undefined

  const qs = new URLSearchParams({ pageSize: String(pageSize) })
  if (pageToken) qs.set('pageToken', pageToken)

  const start = Date.now()
  try {
    // No typed googleapis client exists for the legacy v4 My Business API
    // (reviews were never migrated to the newer mybusiness* services) — call
    // it directly through the authenticated client's generic request().
    const r: any = await withTimeout(
      ready.auth.request({ url: `https://mybusiness.googleapis.com/v4/accounts/${accId}/locations/${locId}/reviews?${qs.toString()}`, method: 'GET' }),
      GOOGLE_API_TIMEOUT_MS, 'reviews.list',
    )
    console.log('[GBP] reviews.list ok in %dms — %d review(s), pageSize=%d', Date.now() - start, (r.data.reviews || []).length, pageSize)
    res.json({
      averageRating:    r.data.averageRating ?? null,
      totalReviewCount: r.data.totalReviewCount ?? 0,
      nextPageToken:    r.data.nextPageToken || null,
      reviews: (r.data.reviews || []).map((rev: any) => ({
        reviewId:    rev.reviewId,
        starRating:  rev.starRating,
        comment:     rev.comment,
        reviewer:    rev.reviewer?.displayName,
        createTime:  rev.createTime,
        updateTime:  rev.updateTime,
        reviewReply: rev.reviewReply?.comment || null,
      })),
    })
  } catch (e: any) {
    console.error('[GBP] reviews.list failed in %dms:', Date.now() - start, e.message)
    const formatted = formatGoogleError(e, 'reviews.list')
    res.status(formatted.status).json(formatted)
  }
})

// ─── GET /business-profile/reviews/summary?accountId=&locationId= ──────
// What the future Dashboard/CRM should consume — never the full review
// feed. Always resolves with a coherent connection/status shape (200) so a
// widget can render a truthful "unavailable" state without special-casing
// HTTP error codes. Cached 5 minutes, success only.
router.get('/reviews/summary', requireAuth, adminOnly, async (req, res) => {
  const accountId  = req.query.accountId as string | undefined
  const locationId = req.query.locationId as string | undefined
  if (!accountId || !locationId) {
    return res.status(400).json({ error: 'missing_params', message: 'Provide ?accountId= and ?locationId=.' })
  }
  const accId = accountId.replace(/^accounts\//, '')
  const locId = locationId.replace(/^locations\//, '')
  const cacheKey = `${accId}/${locId}`

  const cached = cacheGet(reviewSummaryCache, cacheKey)
  if (cached) return res.json(cached)

  const ready = await getReadyAuth()
  if ('error' in ready) {
    return res.json({ connected: false, reason: ready.error, averageRating: null, totalReviewCount: 0, recentReviewCount: null })
  }

  const start = Date.now()
  try {
    const r: any = await withTimeout(
      ready.auth.request({ url: `https://mybusiness.googleapis.com/v4/accounts/${accId}/locations/${locId}/reviews?pageSize=20`, method: 'GET' }),
      GOOGLE_API_TIMEOUT_MS, 'reviews.summary',
    )
    console.log('[GBP] reviews.summary ok in %dms', Date.now() - start)
    const reviews = r.data.reviews || []
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000
    // Best-effort — based on the most recently fetched page only, not the
    // full review history (see /reviews for full pagination).
    const recentReviewCount = reviews.filter((rev: any) => rev.createTime && (Date.now() - new Date(rev.createTime).getTime()) <= THIRTY_DAYS_MS).length
    const summary = {
      connected:         true,
      averageRating:     r.data.averageRating ?? null,
      totalReviewCount:  r.data.totalReviewCount ?? 0,
      recentReviewCount,
    }
    cacheSet(reviewSummaryCache, cacheKey, summary, REVIEW_SUMMARY_CACHE_TTL_MS)
    res.json(summary)
  } catch (e: any) {
    console.error('[GBP] reviews.summary failed in %dms:', Date.now() - start, e.message)
    const formatted = formatGoogleError(e, 'reviews.summary')
    // Not cached — this is exactly the auth/permission-error case that must
    // stay uncached so it's retried fresh next call.
    res.json({ connected: true, reason: formatted.error, likelyAccessNotApproved: formatted.likelyAccessNotApproved, averageRating: null, totalReviewCount: 0, recentReviewCount: null })
  }
})

// ─── GET /business-profile/verify ──────────────────────────────
// One-shot diagnostic chain: connection → accounts → locations → attempt to
// identify Code Clinic's location → attempt to read its reviews. Always
// live (not cached) — this endpoint's purpose is to reflect the current
// real state, not a stale snapshot.
router.get('/verify', requireAuth, adminOnly, async (_req, res) => {
  const verifyStart = Date.now()
  const report: any = {
    connected: false,
    accountsFound: 0,
    accounts: [] as any[],
    locationsFound: 0,
    locations: [] as any[],
    codeClinicLocationMatch: null as any,
    reviewsAccessible: false,
    sampleReviewCount: 0,
    averageRating: null as number | null,
    totalReviewCount: 0,
    errors: [] as any[],
  }

  const ready = await getReadyAuth()
  if ('error' in ready) { report.errors.push({ step: 'auth', ...ready }); return res.json(report) }
  report.connected = true

  let accounts: any[] = []
  try {
    const mbam   = google.mybusinessaccountmanagement({ version: 'v1', auth: ready.auth })
    const accRes = await withTimeout(mbam.accounts.list({}), GOOGLE_API_TIMEOUT_MS, 'accounts.list')
    accounts = accRes.data.accounts || []
    report.accountsFound = accounts.length
    report.accounts = accounts.map(a => ({ name: a.name, accountName: a.accountName, type: a.type }))
  } catch (e: any) {
    report.errors.push({ step: 'accounts.list', ...formatGoogleError(e, 'accounts.list') })
    console.log('[GBP] verify finished in %dms (failed at accounts.list)', Date.now() - verifyStart)
    return res.json(report)
  }

  const mbbi = google.mybusinessbusinessinformation({ version: 'v1', auth: ready.auth })
  const allLocations: any[] = []
  for (const acc of accounts) {
    if (!acc.name) continue
    try {
      const locRes = await withTimeout(
        mbbi.accounts.locations.list({ parent: acc.name, readMask: 'name,title,storefrontAddress,phoneNumbers', pageSize: 100 }),
        GOOGLE_API_TIMEOUT_MS, 'locations.list',
      )
      for (const l of (locRes.data.locations || [])) allLocations.push({ ...l, accountName: acc.name })
    } catch (e: any) {
      report.errors.push({ step: 'locations.list', account: acc.name, ...formatGoogleError(e, 'locations.list') })
    }
  }
  report.locationsFound = allLocations.length
  report.locations = allLocations.map(l => ({ account: l.accountName, name: l.name, title: l.title, address: l.storefrontAddress }))

  const match = allLocations.find(l => (l.title || '').toLowerCase().includes('code clinic'))
  report.codeClinicLocationMatch = match ? { account: match.accountName, name: match.name, title: match.title } : null

  const target = match || allLocations[0]
  if (target) {
    const accId = target.accountName.replace(/^accounts\//, '')
    const locId = target.name.replace(/^locations\//, '')
    try {
      const r: any = await withTimeout(
        ready.auth.request({ url: `https://mybusiness.googleapis.com/v4/accounts/${accId}/locations/${locId}/reviews`, method: 'GET' }),
        GOOGLE_API_TIMEOUT_MS, 'reviews.list',
      )
      report.reviewsAccessible  = true
      report.sampleReviewCount  = (r.data.reviews || []).length
      report.averageRating      = r.data.averageRating ?? null
      report.totalReviewCount   = r.data.totalReviewCount ?? 0
    } catch (e: any) {
      report.errors.push({ step: 'reviews.list', location: target.name, ...formatGoogleError(e, 'reviews.list') })
    }
  }

  console.log('[GBP] verify finished in %dms — accounts=%d locations=%d reviewsAccessible=%s', Date.now() - verifyStart, report.accountsFound, report.locationsFound, report.reviewsAccessible)
  res.json(report)
})

export default router
