import { Router } from 'express'
import { processSocialMessage } from '../ai-suite/facebook/facebook.routes'

const router = Router()

// GET /webhooks/facebook — Meta webhook verification handshake
router.get('/facebook', (req, res) => {
  const mode      = req.query['hub.mode']
  const token     = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
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
      for (const event of entry.messaging ?? []) {
        if (!event.message?.text) continue
        const senderId = String(event.sender.id)
        const text     = String(event.message.text)
        console.log(`[Webhooks] Facebook message from ${senderId}: ${text}`)
        await processSocialMessage(senderId, text, 'FACEBOOK')
      }
    }
  } catch (err) {
    console.error('[Webhooks] Facebook processing error:', err)
  }
})

export default router
