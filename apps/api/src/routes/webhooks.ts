import { Router } from 'express'

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

// POST /webhooks/facebook — receive Facebook Messenger events
router.post('/facebook', (req, res) => {
  res.sendStatus(200) // Acknowledge immediately so Meta doesn't retry
  console.log('[Webhooks] Facebook event received:', JSON.stringify(req.body))
})

export default router
