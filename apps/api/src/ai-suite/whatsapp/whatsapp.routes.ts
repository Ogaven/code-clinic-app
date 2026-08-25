import { Router, Request, Response } from 'express'
import Anthropic from '@anthropic-ai/sdk'
import * as fs from 'fs'
import { processInbound, sendWhatsAppMessage } from './whatsapp.service'
import { enqueueMessage } from './message-buffer'
import { handleStaffReply, STAFF_NUMBER, type AlertMeta } from './staff-relay.service'
import { isAgentEnabled } from '../takeover/takeover.service'
import { prisma } from '../../lib/prisma'

const router    = Router()
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ── Log conversation + send reply without going through full processInbound ──────
async function sendDirectReply(from: string, inboundText: string, reply: string, wamid: string): Promise<void> {
  // Normalize to E.164 — webhook delivers without '+', must match processInbound's convention
  if (!from.startsWith('+')) from = `+${from}`
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
    // logToConversation=false: already logged explicitly above — sendWhatsAppMessage's
    // default logging would otherwise double-write this same reply to ai_messages.
    await sendWhatsAppMessage(from, reply, wamid, false)
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
        const messages      = change.value?.messages
        const waDisplayName = change.value?.contacts?.[0]?.profile?.name ?? null
        const phoneNumberId = change.value?.metadata?.phone_number_id as string | undefined

        // ── Delivery status updates (sent / delivered / read / failed) ──────────
        const statuses = change.value?.statuses
        if (statuses?.length) {
          for (const s of statuses) {
            if (!s.id || !s.status) continue
            if (!['sent', 'delivered', 'read', 'failed'].includes(s.status)) continue
            prisma.aiMessage
              .updateMany({ where: { wamid: s.id }, data: { status: s.status } })
              .catch(() => {})
          }
        }

        if (!messages?.length) continue

        const seenFroms = new Set<string>()
        for (const msg of messages) {
          const from = msg.from
          seenFroms.add(from)

          // ── Text messages → normal Sarah flow ──────────────────────────────
          if (msg.type === 'text') {
            const text = msg.text?.body ?? ''
            if (!text) continue

            // Staff messages — route to relay handler or send staff-mode ack
            // Meta sends numbers without leading '+', so match both formats
            if (from === STAFF_NUMBER || from === STAFF_NUMBER.replace(/^\+/, '')) {
              // 1. Try exact context.id match (Meta threaded reply) — always unambiguous
              if (msg.context?.id) {
                const exactAlert = await prisma.aiMessage.findFirst({
                  where: {
                    role:     'SYSTEM',
                    content:  { contains: 'STAFF_ALERTED' },
                    NOT:      { content: { contains: '(RESOLVED)' } },
                    metadata: { contains: msg.context.id },
                  },
                })
                if (exactAlert?.metadata) {
                  try {
                    const meta = JSON.parse(exactAlert.metadata) as AlertMeta
                    console.log(`[StaffRelay] Exact match → conv ${exactAlert.conversationId}`)
                    const result = await handleStaffReply(exactAlert.conversationId, text, meta)
                    if (result === 'BOOKED' || result === 'RELAYED') {
                      await prisma.aiMessage.update({
                        where: { id: exactAlert.id },
                        data:  { content: 'STAFF_ALERTED: clinical concern (RESOLVED)' },
                      })
                    }
                  } catch (err: any) {
                    console.error('[StaffRelay] handleStaffReply error:', err.message)
                  }
                  continue
                }
              }

              // 2. Fallback: find ALL unresolved alerts within 4 hours — never guess when ambiguous
              const openAlerts = await prisma.aiMessage.findMany({
                where: {
                  role:      'SYSTEM',
                  content:   { contains: 'STAFF_ALERTED' },
                  NOT:       { content: { contains: '(RESOLVED)' } },
                  metadata:  { not: null },
                  createdAt: { gte: new Date(Date.now() - 4 * 60 * 60 * 1000) },
                },
                orderBy: { createdAt: 'desc' },
                take: 10,
              })

              if (openAlerts.length === 0) {
                await sendWhatsAppMessage(STAFF_NUMBER, `Hi! No active patient alerts right now. A new alert will come through as soon as a patient flags a concern 😊`)
              } else if (openAlerts.length > 1) {
                const list = openAlerts.map(a => {
                  try {
                    const m = JSON.parse(a.metadata!) as AlertMeta
                    return `• ${m.patientName || m.patientPhone} — "${(m.concernSummary ?? '').slice(0, 50)}"`
                  } catch { return null }
                }).filter(Boolean).join('\n')
                await sendWhatsAppMessage(STAFF_NUMBER, `I have ${openAlerts.length} open patient alerts:\n${list}\n\nWhich patient is this about? Reply with their name or concern and I'll handle it 😊`)
              } else {
                const alert = openAlerts[0]
                try {
                  const meta = JSON.parse(alert.metadata!) as AlertMeta
                  console.log(`[StaffRelay] Single alert match → conv ${alert.conversationId}`)
                  const result = await handleStaffReply(alert.conversationId, text, meta)
                  if (result === 'BOOKED' || result === 'RELAYED') {
                    await prisma.aiMessage.update({
                      where: { id: alert.id },
                      data:  { content: 'STAFF_ALERTED: clinical concern (RESOLVED)' },
                    })
                  }
                } catch (err: any) {
                  console.error('[StaffRelay] handleStaffReply error:', err.message)
                }
              }
              continue
            }

            enqueueMessage(from, text, msg.id, phoneNumberId)
            continue
          }

          console.log('[Sarah Media]', msg.type, 'from', from)

          // ── Reaction → store as USER note, no agent reply ─────────────────────
          if (msg.type === 'reaction') {
            const emoji    = msg.reaction?.emoji ?? '👍'
            const normFrom = from.startsWith('+') ? from : `+${from}`
            const conv = await prisma.aiConversation.findFirst({
              where:   { phoneNumber: normFrom, channel: 'WHATSAPP', status: 'ACTIVE' },
              orderBy: { createdAt: 'desc' },
            })
            if (conv) {
              prisma.aiMessage.create({
                data: { conversationId: conv.id, role: 'USER', content: `Reacted with ${emoji}`, wamid: msg.id },
              }).catch(() => {})
            }
            continue
          }

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

          // ── Audio / Voice note → Whisper transcription → Sarah flow ──────────
          if (msg.type === 'audio' && msg.audio?.id) {
            let handled = false
            try {
              const media = await downloadWhatsAppMedia(msg.audio.id)
              if (media) {
                const ts      = Date.now()
                const oggPath = `/tmp/voice-${ts}.ogg`
                try {
                  fs.writeFileSync(oggPath, Buffer.from(media.buffer))

                  const audioBlob = new Blob([fs.readFileSync(oggPath)], { type: 'audio/ogg' })
                  const formData  = new FormData()
                  formData.append('file', audioBlob, 'voice.ogg')
                  formData.append('model', 'whisper-1')

                  const whisperRes    = await fetch('https://api.openai.com/v1/audio/transcriptions', {
                    method:  'POST',
                    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
                    body:    formData,
                  })
                  const result        = await whisperRes.json() as { text?: string; error?: unknown }
                  const transcription = typeof result.text === 'string' ? result.text.trim() : null

                  if (transcription) {
                    console.log('[Whisper] Transcribed:', transcription.slice(0, 80))
                    enqueueMessage(from, `[Voice note]: ${transcription}`, msg.id)
                    handled = true
                  }
                } finally {
                  try { fs.unlinkSync(oggPath) } catch {}
                }
              }
            } catch (err) {
              console.warn('[Whisper] Transcription failed:', err)
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
                  model:      'claude-sonnet-5',
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
                    model:      'claude-sonnet-5',
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
        // Normalize before lookup — webhook delivers without '+' but conversations are stored with '+'
        if (waDisplayName) {
          for (const rawFrom of seenFroms) {
            const normFrom = rawFrom.startsWith('+') ? rawFrom : `+${rawFrom}`
            prisma.aiConversation.updateMany({
              where: { phoneNumber: { in: [normFrom, rawFrom] }, channel: 'WHATSAPP', waDisplayName: null },
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
  context?:  { id: string; from?: string }
  text?:     { body: string }
  audio?:    { id: string; mime_type: string; voice?: boolean }
  image?:    { id: string; mime_type: string; caption?: string }
  document?: { id: string; mime_type: string; filename?: string; caption?: string }
  video?:    { id: string; mime_type: string; caption?: string }
  sticker?:  { id: string; mime_type: string }
  location?: { latitude: number; longitude: number; name?: string; address?: string }
  reaction?: { message_id: string; emoji: string }
}

interface WhatsAppStatusUpdate {
  id:           string   // wamid of the message
  status:       string   // sent | delivered | read | failed
  timestamp:    string
  recipient_id: string
  errors?:      Array<{ code: number; title: string }>
}

interface WhatsAppWebhookPayload {
  object: string
  entry: Array<{
    id: string
    changes: Array<{
      value: {
        messages?: WhatsAppMessage[]
        statuses?: WhatsAppStatusUpdate[]
        contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>
        metadata?: { phone_number_id?: string; display_phone_number?: string }
      }
      field: string
    }>
  }>
}
