import { Router } from 'express'
import { enqueueMetaEvent } from '../services/meta-inbound-inbox'
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
  if (checkMetaWebhookSignature(req, ['FACEBOOK_APP_SECRET', 'META_APP_SECRET'], 'Facebook') === 'REJECTED') {
    res.sendStatus(403)
    return
  }
  try {
    await enqueueMetaEvent(req.body)
    res.sendStatus(200)
  } catch (error) {
    console.error('[Webhooks] Failed to persist Meta event:', error)
    res.sendStatus(503) // Meta must retry: never acknowledge a failed database write.
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
