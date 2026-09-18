// ─────────────────────────────────────────────────────────────────────────
// Meta webhook (WhatsApp Business Platform + Facebook/Instagram Graph API)
// X-Hub-Signature-256 verification.
// https://developers.facebook.com/docs/graph-api/webhooks/getting-started#validate-payloads
//
// The GET verification-token handshake (hub.verify_token) only proves the
// *subscription* was configured correctly; it says nothing about whether a
// given POST body actually came from Meta. Every POST must additionally be
// checked against X-Hub-Signature-256, an HMAC-SHA256 of the raw request
// body keyed by the Meta App Secret for that app. As of the 2026-09
// lead-engine audit, neither the WhatsApp nor the Facebook webhook checked
// this — both accepted any POST body unauthenticated (the GET handshake is
// a one-time setup step, not a per-request check).
//
// Verification requires the exact raw request bytes (captured via
// express.json()'s `verify` callback in main.ts as req.rawBody) —
// JSON.stringify(req.body) is NOT guaranteed byte-identical to what Meta
// sent (key order, whitespace) and must never be used for this.
//
// Enforcement here is automatic and safe-by-construction: while the
// relevant app secret env var is unconfigured (true in this environment as
// of this writing — no WHATSAPP_APP_SECRET/FACEBOOK_APP_SECRET/
// META_APP_SECRET exists anywhere in this codebase or its env schema), a
// signature can never be verified, so the webhook stays exactly as open as
// it was before this change — this can never break live WhatsApp/Facebook
// traffic on deploy. The moment an operator sets one of the app-secret env
// vars below (from the real Meta App's dashboard), invalid or missing
// signatures start being rejected with zero further code changes required.
// ─────────────────────────────────────────────────────────────────────────
import { createHmac, timingSafeEqual } from 'crypto'
import type { Request } from 'express'

interface RequestWithRawBody extends Request {
  rawBody?: Buffer
}

function hasRawBody(req: Request): req is RequestWithRawBody & { rawBody: Buffer } {
  return Buffer.isBuffer((req as RequestWithRawBody).rawBody)
}

export function verifyMetaSignature(req: Request, appSecret: string): boolean {
  if (!hasRawBody(req)) return false
  const header = req.get('x-hub-signature-256')
  if (!header || !header.startsWith('sha256=')) return false

  const expectedHex = createHmac('sha256', appSecret).update(req.rawBody).digest('hex')
  const providedHex = header.slice('sha256='.length)

  // Buffer.from(hex) yields '' -> length-0 buffers for malformed hex, which
  // trivially fails the length check below rather than throwing.
  const expectedBuf = Buffer.from(expectedHex, 'hex')
  const providedBuf = Buffer.from(providedHex, 'hex')
  if (expectedBuf.length === 0 || expectedBuf.length !== providedBuf.length) return false
  return timingSafeEqual(expectedBuf, providedBuf)
}

export type MetaSignatureResult = 'OK' | 'UNVERIFIED' | 'REJECTED'

// Tries each env var in order (mirrors the existing FACEBOOK_VERIFY_TOKEN ??
// WHATSAPP_VERIFY_TOKEN fallback convention already used for the GET
// handshake in routes/webhooks.ts) so a single shared Meta App Secret works
// without operators having to set the same value under multiple names.
export function checkMetaWebhookSignature(req: Request, envVarNames: string[], logPrefix: string): MetaSignatureResult {
  const appSecret = envVarNames.map(name => process.env[name]).find(Boolean)
  if (!appSecret) {
    console.warn(
      `[${logPrefix}] No app secret configured (checked ${envVarNames.join(', ')}) — ` +
      'webhook signature NOT verified. This request is being processed unauthenticated. ' +
      'Set one of these env vars from the real Meta App dashboard to enable enforcement.'
    )
    return 'UNVERIFIED'
  }
  if (!verifyMetaSignature(req, appSecret)) {
    console.error(`[${logPrefix}] Webhook signature verification FAILED (X-Hub-Signature-256 mismatch or missing) — rejecting request`)
    return 'REJECTED'
  }
  return 'OK'
}
