import { Router } from 'express'
import { processInboundSMS } from './sms.service'

const router = Router()

// POST /ai-suite/sms/incoming
// Africa's Talking delivers inbound SMS here.
// Body fields: from, to, text, date, id, linkId (all strings)
router.post('/incoming', (req, res) => {
  // ACK immediately — AT expects a fast 200, processing happens async
  res.sendStatus(200)

  const from = (req.body.from as string | undefined)?.trim()
  const text = (req.body.text as string | undefined)?.trim()

  if (!from || !text) {
    console.warn('[SMS] Inbound request missing from or text:', req.body)
    return
  }

  processInboundSMS(from, text).catch(err =>
    console.error('[SMS] processInboundSMS error (route):', err)
  )
})

export default router
