import { Router, Request, Response } from 'express'
import Anthropic from '@anthropic-ai/sdk'
import { execFileSync } from 'child_process'
import * as fs from 'fs'
import { processInbound, sendWhatsAppMessage } from './whatsapp.service'
import { isAgentEnabled } from '../takeover/takeover.service'
import { prisma } from '../../lib/prisma'

const router    = Router()
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ── Log conversation + send reply without going through full processInbound ──────
async function sendDirectReply(from: string, inboundText: string, reply: string, wamid: string): Promise<void> {
  try {
    const patient = await prisma.patient.findFirst({ where: { phone: from } })
    let conv = await prisma.aiConversation.findFirst({
      where: { phoneNumber: from, channel: 'WHATSAPP', status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    })
    if (!conv) {
      conv = await prisma.aiConversation.create({
        data: { patientId: patient?.id ?? null, channel: 'WHATSAPP', phoneNumber: from, status: 'ACTIVE', agentEnabled: true },
      })
    }
    const agentOn = await isAgentEnabled(conv.id)
    if (!agentOn) return
    await prisma.aiMessage.create({ data: { conversationId: conv.id, role: 'USER', content: inboundText } })
    await prisma.aiMessage.create({ data: { conversationId: conv.id, role: 'AGENT', content: reply } })
    await sendWhatsAppMessage(from, reply, wamid)
  } catch (err: any) {
    console.error('[WhatsApp] sendDirectReply error:', err.message)
  }
}

// ── Download a WhatsApp media file via Meta Graph API ────────────────────────────
async function downloadWhatsAppMedia(mediaId: string): Promise<{ buffer: ArrayBuffer; mimeType: string } | null> {
  try {
    const metaRes = await fetch(
      `https://graph.facebook.com/v19.0/${mediaId}`,
      { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } }
    )
    const meta = await metaRes.json() as { url?: string; mime_type?: string }
    if (!meta.url) return null
    const fileRes = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` }
    })
    const buffer = await fileRes.arrayBuffer()
    return { buffer, mimeType: meta.mime_type || 'application/octet-stream' }
  } catch { return null }
}

// ── GET /ai-suite/webhook — Meta webhook verification ────────────────────────────
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

// ── POST /ai-suite/webhook — inbound messages from Meta ──────────────────────────
router.post('/webhook', async (req: Request, res: Response) => {
  console.log('[WEBHOOK RECEIVED]', JSON.stringify(req.body, null, 2))

  // Always acknowledge immediately so Meta doesn't retry
  res.sendStatus(200)

  try {
    const body = req.body as WhatsAppWebhookPayload

    if (body.object !== 'whatsapp_business_account') return

    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const messages     = change.value?.messages
        const waDisplayName = change.value?.contacts?.[0]?.profile?.name ?? null
        if (!messages?.length) continue

        const seenFroms = new Set<string>()
        for (const msg of messages) {
          const from = msg.from
          seenFroms.add(from)

          // ── Text messages → normal Sarah flow ──────────────────────────────
          if (msg.type === 'text') {
            const text = msg.text?.body ?? ''
            if (!text) continue
            await processInbound(from, text, msg.id)
            continue
          }

          console.log('[Sarah Media]', msg.type, 'from', from)

          // ── Sticker → fixed friendly reply ─────────────────────────────────
          if (msg.type === 'sticker') {
            await sendDirectReply(
              from,
              '[Patient sent a sticker]',
              '😄 Love the sticker! What can I help you with today?',
              msg.id,
            )
            continue
          }

          // ── Video → fixed reply ─────────────────────────────────────────────
          if (msg.type === 'video') {
            await sendDirectReply(
              from,
              '[Patient sent a video]',
              'I can see you sent a video! I am not able to play videos just yet, but if you send me a photo or describe what you are seeing I can help right away 😊',
              msg.id,
            )
            continue
          }

          // ── Audio / Voice note → OGG→MP3 via FFmpeg → Claude → Sarah flow ────
          if (msg.type === 'audio' && msg.audio?.id) {
            let handled = false
            try {
              const media = await downloadWhatsAppMedia(msg.audio.id)
              if (media) {
                const ts      = Date.now()
                const oggPath = `/tmp/voice-${ts}.ogg`
                const mp3Path = `/tmp/voice-${ts}.mp3`
                try {
                  fs.writeFileSync(oggPath, Buffer.from(media.buffer))
                  execFileSync('ffmpeg', ['-y', '-i', oggPath, mp3Path], { stdio: 'ignore' })
                  const mp3Buffer = fs.readFileSync(mp3Path)
                  const base64    = mp3Buffer.toString('base64')

                  const audioRes = await anthropic.messages.create({
                    model:      'claude-sonnet-4-6',
                    max_tokens: 300,
                    system:     'You are a transcription assistant. Transcribe the audio exactly as spoken. Return only the transcribed text with no preamble.',
                    messages: [{
                      role:    'user',
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      content: [{ type: 'document', source: { type: 'base64', media_type: 'audio/mpeg', data: base64 } } as any],
                    }],
                  })

                  const block         = audioRes.content[0]
                  const transcription = block?.type === 'text' ? block.text.trim() : null

                  if (transcription) {
                    console.log('[Claude Audio] Transcribed:', transcription.slice(0, 80))
                    await processInbound(from, `[Voice note transcribed]: ${transcription}`, msg.id)
                    handled = true
                  }
                } finally {
                  try { fs.unlinkSync(oggPath) } catch {}
                  try { fs.unlinkSync(mp3Path) } catch {}
                }
              }
            } catch (err) {
              console.warn('[Claude Audio] Transcription failed:', err)
            }

            if (!handled) {
              await sendDirectReply(
                from,
                '[Patient sent a voice note]',
                'I had trouble understanding your voice note. Could you type your message? 😊',
                msg.id,
              )
            }
            continue
          }

          // ── Image → Claude vision → Sarah's direct response ─────────────────
          if (msg.type === 'image' && msg.image?.id) {
            let handled = false
            try {
              const media = await downloadWhatsAppMedia(msg.image.id)
              if (media) {
                const base64   = Buffer.from(media.buffer).toString('base64')
                const mimeType = (media.mimeType || 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'

                const visionRes = await anthropic.messages.create({
                  model:      'claude-sonnet-4-6',
                  max_tokens: 300,
                  system:     'You are Sarah, a dental clinic assistant at Code Clinic in Kampala Uganda. A patient sent you an image. Look at it carefully. If it shows a dental concern (tooth pain, swelling, broken tooth, cavity, gum issue, etc), acknowledge what you see, show empathy, and suggest they book an appointment. If it is not dental related, respond warmly and ask how you can help. Keep response under 150 words, plain text, no markdown, no asterisks.',
                  messages: [{
                    role:    'user',
                    content: [{ type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } }],
                  }],
                })

                const block = visionRes.content[0]
                const reply = block?.type === 'text' ? block.text : null
                if (reply) {
                  console.log('[Claude Vision] replied:', reply.slice(0, 80))
                  await sendDirectReply(from, '[Patient sent an image]', reply, msg.id)
                  handled = true
                }
              }
            } catch (err) {
              console.warn('[Claude Vision] failed:', err)
            }

            if (!handled) {
              await sendDirectReply(
                from,
                '[Patient sent an image]',
                "Thanks for the photo! I can see you sent an image — could you also describe what you're experiencing so I can help better? 😊",
                msg.id,
              )
            }
            continue
          }

          // ── Document / PDF → pdf-parse → Claude → Sarah's response ──────────
          if (msg.type === 'document' && msg.document?.id) {
            let handled = false
            try {
              const media = await downloadWhatsAppMedia(msg.document.id)
              if (media) {
                const mime       = media.mimeType || ''
                const filename   = msg.document.filename || ''
                const isPdf      = mime === 'application/pdf' || filename.toLowerCase().endsWith('.pdf')
                let extractedText = ''

                if (isPdf) {
                  // eslint-disable-next-line @typescript-eslint/no-require-imports
                  const pdfParse = require('pdf-parse')
                  const pdfData  = await pdfParse(Buffer.from(media.buffer))
                  extractedText  = (pdfData.text as string)?.trim().slice(0, 2000) ?? ''
                }

                if (extractedText) {
                  const docRes = await anthropic.messages.create({
                    model:      'claude-sonnet-4-6',
                    max_tokens: 200,
                    messages: [{
                      role:    'user',
                      content: `A patient sent a document with this content: ${extractedText}\n\nYou are Sarah, a friendly dental clinic assistant at Code Clinic in Kampala Uganda. Respond helpfully in context of dental care. Plain text only, no markdown, no asterisks, no bullet points.`,
                    }],
                  })
                  const block = docRes.content[0]
                  const reply = block?.type === 'text' ? block.text : null
                  if (reply) {
                    console.log('[Document] Claude replied:', reply.slice(0, 80))
                    await sendDirectReply(from, `[Patient sent a document: ${filename || 'file'}]`, reply, msg.id)
                    handled = true
                  }
                }
              }
            } catch (err) {
              console.warn('[Document] Processing failed:', err)
            }

            if (!handled) {
              await sendDirectReply(
                from,
                `[Patient sent a document: ${msg.document.filename || 'file'}]`,
                'Thanks for sending that! I am not able to open all file types — could you copy and paste the key details as a message? 😊',
                msg.id,
              )
            }
            continue
          }

          // ── Any other media type → pass generic description to Sarah ─────────
          const desc = getMediaDescription(msg)
          await processInbound(from, desc, msg.id)
        }

        // Persist WhatsApp display name for unrecognised contacts (fire-and-forget)
        if (waDisplayName) {
          for (const from of seenFroms) {
            prisma.aiConversation.updateMany({
              where: { phoneNumber: from, channel: 'WHATSAPP', waDisplayName: null },
              data:  { waDisplayName },
            }).catch(() => {})
          }
        }
      }
    }
  } catch (err) {
    console.error('[WhatsApp] Error processing webhook payload:', err)
  }
})

export default router

// ── Helpers ──────────────────────────────────────────────────────────────────────

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

// ── Types ────────────────────────────────────────────────────────────────────────

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
        contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>
      }
      field: string
    }>
  }>
}
