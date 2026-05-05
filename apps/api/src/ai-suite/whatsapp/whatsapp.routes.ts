import { Router, Request, Response } from 'express'
import Anthropic from '@anthropic-ai/sdk'
import { processInbound } from './whatsapp.service'

const router = Router()

// ── Media description helper ─────────────────────────────────────────────────
function getMediaDescription(message: WhatsAppMessage): string {
  switch (message.type) {
    case 'image':
      return message.image?.caption
        ? `[Patient sent an image with caption: "${message.image.caption}"]`
        : '[Patient sent an image]'
    case 'audio':
      return message.audio?.voice
        ? '[Patient sent a voice note]'
        : '[Patient sent an audio file]'
    case 'video':
      return message.video?.caption
        ? `[Patient sent a video with caption: "${message.video.caption}"]`
        : '[Patient sent a video]'
    case 'document':
      return `[Patient sent a document: ${message.document?.filename || 'file'}]`
    case 'sticker':
      return '[Patient sent a sticker]'
    case 'location':
      return '[Patient shared their location]'
    default:
      return `[Patient sent a ${message.type} message]`
  }
}

// ── GET /ai-suite/webhook — Meta webhook verification ────────────────────────
router.get('/webhook', (req, res) => {
  const mode      = req.query['hub.mode']
  const token     = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('[WhatsApp] Webhook verified')
    res.status(200).send(challenge)
  } else {
    console.warn('[WhatsApp] Webhook verification failed', { mode, token })
    res.sendStatus(403)
  }
})

// ── POST /ai-suite/webhook — inbound messages from Meta ──────────────────────
router.post('/webhook', async (req: Request, res: Response) => {
  console.log('[WEBHOOK RECEIVED]', JSON.stringify(req.body, null, 2))

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
          const from = msg.from
          let messageText: string

          if (msg.type === 'text') {
            messageText = msg.text?.body ?? ''
            if (!messageText) continue
          } else {
            messageText = getMediaDescription(msg)

            // Vision analysis for images
            if (msg.type === 'image' && msg.image?.id) {
              try {
                const mediaRes = await fetch(
                  `https://graph.facebook.com/v19.0/${msg.image.id}`,
                  { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } }
                )
                const mediaData = await mediaRes.json() as { url?: string; mime_type?: string }
                if (mediaData.url) {
                  const imgRes = await fetch(mediaData.url, {
                    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` }
                  })
                  const imgBuffer = await imgRes.arrayBuffer()
                  const base64 = Buffer.from(imgBuffer).toString('base64')
                  const mimeType = (mediaData.mime_type || 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

                  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
                  const visionRes = await anthropic.messages.create({
                    model: 'claude-sonnet-4-6',
                    max_tokens: 300,
                    messages: [{
                      role: 'user',
                      content: [
                        { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
                        { type: 'text', text: 'This image was sent by a dental clinic patient via WhatsApp. Describe what you see in 2-3 sentences, focusing on anything dental-health related if visible.' }
                      ]
                    }]
                  })
                  const first = visionRes.content[0]
                  if (first?.type === 'text' && first.text) {
                    messageText = `[Patient sent an image. Visual description: ${first.text}]`
                  }
                }
              } catch (err) {
                console.warn('[VISION] Image analysis failed:', err)
              }
            }

            // Voice note transcription via Whisper
            if (msg.type === 'audio' && msg.audio?.id) {
              try {
                const mediaRes = await fetch(
                  `https://graph.facebook.com/v19.0/${msg.audio.id}`,
                  { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } }
                )
                const mediaData = await mediaRes.json() as { url?: string; mime_type?: string }
                if (mediaData.url) {
                  const audioRes = await fetch(mediaData.url, {
                    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` }
                  })
                  const audioBuffer = await audioRes.arrayBuffer()

                  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
                  const FormData = require('form-data') as any
                  const form = new FormData()
                  form.append('file', Buffer.from(audioBuffer), {
                    filename: 'voice.ogg',
                    contentType: mediaData.mime_type || 'audio/ogg',
                  })
                  form.append('model', 'whisper-1')

                  const formBuffer = await new Promise<Buffer>((resolve, reject) => {
                    const chunks: Buffer[] = []
                    form.on('data', (chunk: Buffer) => chunks.push(chunk))
                    form.on('end', () => resolve(Buffer.concat(chunks)))
                    form.on('error', reject)
                  })
                  const whisperRes = await fetch(
                    'https://api.openai.com/v1/audio/transcriptions',
                    {
                      method: 'POST',
                      headers: {
                        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                        ...form.getHeaders(),
                      },
                      body: formBuffer,
                    }
                  )
                  const whisperData = await whisperRes.json() as { text?: string }
                  if (whisperData.text) {
                    messageText = `[Voice note transcript: "${whisperData.text}"]`
                  }
                }
              } catch (err) {
                console.warn('[WHISPER] Transcription failed:', err)
              }
            }
          }

          console.log('[AGENT CALL]', { phone: from, message: messageText, wamid: msg.id })
          await processInbound(from, messageText, msg.id)
        }
      }
    }
  } catch (err) {
    console.error('[WhatsApp] Error processing webhook payload:', err)
  }
})

export default router

// ── Types ────────────────────────────────────────────────────────────────────

interface WhatsAppMessage {
  from:      string
  id:        string
  type:      string
  timestamp: string
  text?:     { body: string }
  audio?:    { id: string; mime_type: string; voice?: boolean }
  image?:    { id: string; mime_type: string; caption?: string }
  document?: { id: string; mime_type: string; filename?: string; caption?: string }
  video?:    { id: string; mime_type: string; caption?: string }
  sticker?:  { id: string; mime_type: string }
  location?: { latitude: number; longitude: number; name?: string; address?: string }
}

interface WhatsAppWebhookPayload {
  object: string
  entry: Array<{
    id: string
    changes: Array<{
      value: {
        messages?: WhatsAppMessage[]
      }
      field: string
    }>
  }>
}
