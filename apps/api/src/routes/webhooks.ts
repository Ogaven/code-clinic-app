import { Router } from 'express'
import { processSocialMessage, processComment, processLeadAdSubmission } from '../ai-suite/facebook/facebook.routes'
import { checkMetaWebhookSignature } from '../lib/webhook-signature'

const router = Router()

// GET /webhooks/facebook — Meta webhook verification handshake
router.get('/facebook', (req, res) => {
  const mode      = req.query['hub.mode']
  const token     = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']

  const expected = process.env.FACEBOOK_VERIFY_TOKEN ?? process.env.WHATSAPP_VERIFY_TOKEN ?? 'codeclinic-facebook-2026'
  if (mode === 'subscribe' && token === expected) {
    console.log('[Webhooks] Facebook webhook verified')
    return res.status(200).send(challenge)
  }
  res.status(403).json({ error: 'Verification failed' })
})

// POST /webhooks/facebook — receive Facebook Messenger events from Meta
router.post('/facebook', async (req, res) => {
  // See lib/webhook-signature.ts — rejects only once a real app secret is
  // configured; today (no FACEBOOK_APP_SECRET set) this only logs a warning
  // and never blocks live traffic.
  if (checkMetaWebhookSignature(req, ['FACEBOOK_APP_SECRET', 'META_APP_SECRET'], 'Facebook') === 'REJECTED') {
    res.sendStatus(403)
    return
  }

  res.sendStatus(200) // Acknowledge immediately so Meta doesn't retry

  try {
    const body = req.body as any
    console.log(`[Webhooks] FB raw: object=${body.object} entries=${body.entry?.length ?? 0}`)

    // Meta delivers Instagram events to this SAME callback URL (one app,
    // one webhook endpoint, both the linked Page and the linked Instagram
    // professional account subscribed) — distinguished only by `object`.
    // This used to unconditionally `return` for anything that wasn't
    // `'page'`, which silently dropped every Instagram DM/comment payload
    // even though INSTAGRAM_ACCESS_TOKEN/INSTAGRAM_BUSINESS_ACCOUNT_ID are
    // configured and processSocialMessage/processComment already have full
    // 'INSTAGRAM'/'INSTAGRAM_COMMENT' support — the processing layer was
    // ready, this route just never dispatched to it. Internal routing bug,
    // not a Meta permission/review blocker.
    if (body.object === 'instagram') {
      await handleInstagramEntries(body.entry ?? [])
      return
    }
    if (body.object !== 'page') return

    for (const entry of body.entry ?? []) {
      // Messenger DMs
      for (const event of entry.messaging ?? []) {
        if (!event.message?.text) continue
        if (event.message?.is_echo) continue // never process our own outbound sends mirrored back
        const senderId  = String(event.sender.id)
        const text      = String(event.message.text)
        const messageId = event.message.mid ? String(event.message.mid) : undefined
        console.log(`[Webhooks] Facebook message from ${senderId}: ${text}`)
        await processSocialMessage(senderId, text, 'FACEBOOK', messageId)
      }
      // Page feed comments + native Lead Ads (leadgen) submissions
      for (const change of entry.changes ?? []) {
        console.log(`[Webhooks] FB change: field=${change.field} item=${change.value?.item} verb=${change.value?.verb} from=${change.value?.from?.id}`)

        // Meta Lead Ads / Instant Forms — the webhook payload never carries
        // the actual answers, only a leadgen_id; processLeadAdSubmission
        // fetches the real field_data via a follow-up Graph API call. See
        // that function for the current external permission blocker
        // (leads_retrieval) confirmed during the 2026-09-16 lead-engine audit.
        if (change.field === 'leadgen') {
          const leadgenId = change.value?.leadgen_id
          if (leadgenId) {
            console.log(`[Webhooks] Facebook Lead Ad submission, leadgen_id=${leadgenId}`)
            await processLeadAdSubmission(String(leadgenId))
          }
          continue
        }

        if (change.field !== 'feed') continue
        const v = change.value
        if (v?.item !== 'comment' || v?.verb !== 'add' || !v?.message) continue
        // Never process comments authored by the Page itself (prevents self-reply loops)
        if (String(v.from?.id ?? '') === '532091973485208') continue
        console.log(`[Webhooks] Facebook comment from ${v.from?.id}: ${v.message}`)
        await processComment(
          String(v.comment_id ?? ''),
          String(v.post_id    ?? ''),
          String(v.from?.id   ?? ''),
          String(v.from?.name ?? ''),
          String(v.message),
          'FACEBOOK_COMMENT',
          v.parent_id ? String(v.parent_id) : undefined,
        )
      }
    }
  } catch (err) {
    console.error('[Webhooks] Facebook processing error:', err)
  }
})

// Instagram DMs reuse the exact same `messaging[]` shape as Facebook
// Messenger (sender.id / message.text / message.mid / message.is_echo) —
// both ride the unified Messenger Platform webhook format. Instagram
// comments use a documented but distinct shape (`changes[].field ===
// 'comments'`, `value: { id, text, from: { id, username }, media, parent_id? }`)
// — handled conservatively here since it has not yet been exercised against
// a real live payload; unrecognized change fields are logged and skipped
// rather than guessed at further.
async function handleInstagramEntries(entries: any[]): Promise<void> {
  for (const entry of entries) {
    for (const event of entry.messaging ?? []) {
      if (!event.message?.text) continue
      if (event.message?.is_echo) continue
      const senderId  = String(event.sender.id)
      const text      = String(event.message.text)
      const messageId = event.message.mid ? String(event.message.mid) : undefined
      console.log(`[Webhooks] Instagram message from ${senderId}: ${text}`)
      await processSocialMessage(senderId, text, 'INSTAGRAM', messageId)
    }
    for (const change of entry.changes ?? []) {
      console.log(`[Webhooks] IG change: field=${change.field}`)
      if (change.field !== 'comments') continue
      const v = change.value
      if (!v?.text || !v?.from?.id) continue
      console.log(`[Webhooks] Instagram comment from ${v.from?.id}: ${v.text}`)
      await processComment(
        String(v.id ?? ''),
        String(v.media?.id ?? ''),
        String(v.from.id),
        String(v.from?.username ?? ''),
        String(v.text),
        'INSTAGRAM_COMMENT',
        v.parent_id ? String(v.parent_id) : undefined,
      )
    }
  }
}

export default router
