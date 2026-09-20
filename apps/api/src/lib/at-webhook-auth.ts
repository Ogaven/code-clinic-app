// ─────────────────────────────────────────────────────────────────────────
// Africa's Talking WhatsApp webhook (POST /agent/whatsapp/webhook) shared-
// secret verification.
//
// Africa's Talking has no per-request signing mechanism (no HMAC/app-secret
// header like Meta's X-Hub-Signature-256) — the callback URL is instead
// configured freely in the AT dashboard. This mirrors the same shared-secret
// pattern this codebase already uses safely for the ScoreApp webhook
// (routes/scoreapp-webhook.ts): a secret embedded in the registered callback
// URL (as a header or query param), checked on every inbound POST.
//
// Unlike ScoreApp — a new, optional integration that can safely fail CLOSED
// while unconfigured — this endpoint carries LIVE patient WhatsApp traffic
// today. Failing closed here would break real patient messages the moment
// this ships, before an operator has had a chance to set AT_WEBHOOK_SECRET
// and update the registered callback URL. So this follows the Meta
// webhook-signature migration pattern instead (lib/webhook-signature.ts):
// while unconfigured, every request is accepted with a loud structured
// warning; the moment AT_WEBHOOK_SECRET is set (and the registered AT
// callback URL updated to include it), enforcement activates with zero
// further code changes. Operator configuration is still required — this
// change alone provides no protection until that happens.
// ─────────────────────────────────────────────────────────────────────────
import { timingSafeEqual } from 'crypto'
import type { Request } from 'express'

export type AtWebhookAuthResult = 'OK' | 'UNVERIFIED' | 'REJECTED'

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

export function checkAfricasTalkingWebhookAuth(req: Request): AtWebhookAuthResult {
  const expected = process.env.AT_WEBHOOK_SECRET
  if (!expected) {
    console.warn(
      '[AT Webhook] AT_WEBHOOK_SECRET is not configured — this webhook is accepting requests ' +
      'unauthenticated. Set AT_WEBHOOK_SECRET and add the same value to the registered Africa\'s ' +
      'Talking callback URL (as an X-AT-Webhook-Secret header or a ?secret= query param) to enable enforcement.'
    )
    return 'UNVERIFIED'
  }

  const provided = req.get('x-at-webhook-secret') || (typeof req.query.secret === 'string' ? req.query.secret : '')
  if (!provided || !safeEqual(provided, expected)) {
    console.error('[AT Webhook] Webhook secret verification FAILED (missing/mismatched X-AT-Webhook-Secret header or ?secret= query param) — rejecting request')
    return 'REJECTED'
  }
  return 'OK'
}
