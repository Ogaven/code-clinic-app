import { Router } from 'express'
import { processSocialMessage, processComment } from '../ai-suite/facebook/facebook.routes'

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
  res.sendStatus(200) // Acknowledge immediately so Meta doesn't retry

  try {
    const body = req.body as any
    if (body.object !== 'page') return

    for (const entry of body.entry ?? []) {
      // Messenger DMs
      for (const event of entry.messaging ?? []) {
        if (!event.message?.text) continue
        const senderId = String(event.sender.id)
        const text     = String(event.message.text)
        console.log(`[Webhooks] Facebook message from ${senderId}: ${text}`)
        await processSocialMessage(senderId, text, 'FACEBOOK')
      }
      // Page feed comments
      for (const change of entry.changes ?? []) {
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

export default router
