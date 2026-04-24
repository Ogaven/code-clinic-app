import { Router, Request, Response } from 'express'
import { processInbound } from './whatsapp.service'

const router = Router()

// ── GET /ai-suite/webhook — Meta webhook verification ────────────────────────
router.get('/webhook', (req: Request, res: Response) => {
  const mode      = req.query['hub.mode']
  const token     = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('[WhatsApp] Webhook verified')
    return res.status(200).send(challenge)
  }

  console.warn('[WhatsApp] Webhook verification failed — bad token or mode')
  return res.sendStatus(403)
})

// ── POST /ai-suite/webhook — inbound messages from Meta ──────────────────────
router.post('/webhook', async (req: Request, res: Response) => {
  // Always acknowledge immediately so Meta doesn't retry
  res.sendStatus(200)

  try {
    const body = req.body as WhatsAppWebhookPayload

    if (body.object !== 'whatsapp_business_account') return

    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const messages = change.value?.messages
        if (!messages?.length) continue

        for (const msg of messages) {
          if (msg.type !== 'text') continue

          const from = msg.from              // international format e.g. "256700000000"
          const text = msg.text?.body ?? ''

          await processInbound(from, text)
        }
      }
    }
  } catch (err) {
    console.error('[WhatsApp] Error processing webhook payload:', err)
  }
})

export default router

// ── Types ────────────────────────────────────────────────────────────────────

interface WhatsAppWebhookPayload {
  object: string
  entry: Array<{
    id: string
    changes: Array<{
      value: {
        messages?: Array<{
          from: string
          id: string
          type: string
          text?: { body: string }
          timestamp: string
        }>
      }
      field: string
    }>
  }>
}
