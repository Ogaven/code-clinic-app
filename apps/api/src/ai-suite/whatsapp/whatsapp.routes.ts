import { Router, Request, Response } from 'express'
import OpenAI from 'openai'
import * as fs from 'fs'
import { processInbound, sendWhatsAppMessage } from './whatsapp.service'
import { enqueueMessage } from './message-buffer'
import { handleStaffReply, STAFF_NUMBER, type AlertMeta } from './staff-relay.service'
import { isAgentEnabled } from '../takeover/takeover.service'
import { prisma } from '../../lib/prisma'
import { sendPushToUser } from '../../services/push.service'
import { checkMetaWebhookSignature } from '../../lib/webhook-signature'

const router = Router()
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// ── Provider-health safeguard: "your WhatsApp alerts are not being delivered" ──
// Fires when Meta's delivery-status webhook reports a failed send to the staff
// number, for ANY reason (billing, 24h window, bad number, outage). Uses two
// channels that don't share a failure mode with WhatsApp itself: an in-app
// notification (free, no external dependency) and a push notification (free,
// VAPID-based). Also makes a best-effort real SMS attempt.
//
// Audience + type: ADMIN only, type 'PROVIDER_HEALTH' (not 'SYSTEM'/reception).
// This used to go to every RECEPTIONIST too under the generic 'SYSTEM' type,
// which meant Meta infrastructure noise sat in the exact same bell/feed
// reception staff use for real patient escalations — repeated billing
// failures could crowd those out. Only admins can actually act on a Meta
// billing/eligibility problem (see meta-billing.service.ts, the linked
// /ai-suite/analytics page is gated `isAdmin`), so only admins need to be
// paged for it; reception's feed is now unaffected by this entirely.
//
// Dedup: keyed per Meta error CODE, not a single global cooldown. A 131042
// (billing) and a later 131047 (re-engagement window) are different incidents
// an admin needs to know about separately — collapsing them under one
// constant title (the old behavior) meant the second, genuinely different,
// error silently never got surfaced if it arrived inside the first one's
// cooldown window. The DB check (title + createdAt) survives a process
// restart, since an in-memory-only cooldown resets to zero on every deploy
// and a burst of failures shortly after would defeat it. The in-memory map
// stays as a same-process fast path per code to skip the DB round trip for
// the (common) case of many failures for the same code arriving in seconds.
const lastDeliveryFailureAlertAtByCode = new Map<number | 'unknown', number>()
const DELIVERY_FAILURE_ALERT_COOLDOWN_MS = 30 * 60 * 1000
const DELIVERY_FAILURE_ALERT_TITLE_BASE = '⚠️ Staff WhatsApp alerts are failing to deliver'
const PROVIDER_HEALTH_HREF = '/ai-suite/analytics'

function deliveryFailureAlertTitle(code?: number): string {
  return `${DELIVERY_FAILURE_ALERT_TITLE_BASE} (#${code ?? 'unknown'})`
}

export async function notifyStaffOfDeliveryFailure(code?: number, message?: string, details?: string): Promise<void> {
  const codeKey = code ?? 'unknown'
  const now = Date.now()
  const lastAt = lastDeliveryFailureAlertAtByCode.get(codeKey) ?? 0
  if (now - lastAt < DELIVERY_FAILURE_ALERT_COOLDOWN_MS) return

  const title = deliveryFailureAlertTitle(code)
  const cooldownStart = new Date(now - DELIVERY_FAILURE_ALERT_COOLDOWN_MS)
  const recent = await prisma.notification.findFirst({
    where: { type: 'PROVIDER_HEALTH', title, createdAt: { gte: cooldownStart } },
    select: { id: true },
  }).catch(() => null)
  if (recent) { lastDeliveryFailureAlertAtByCode.set(codeKey, now); return }

  lastDeliveryFailureAlertAtByCode.set(codeKey, now)

  const body = `Meta error #${code ?? '?'}: ${message ?? 'unknown'}${details ? ` — ${details}` : ''}. ` +
    `Clinical concern / escalation alerts may not be reaching this WhatsApp number right now — check WhatsApp Health in AI Suite Analytics.`

  try {
    const admins = await prisma.user.findMany({ where: { role: 'ADMIN', isActive: true } })
    await Promise.all(admins.map(async u => {
      await prisma.notification.create({
        data: { userId: u.id, type: 'PROVIDER_HEALTH', title, body, href: PROVIDER_HEALTH_HREF },
      }).catch(() => {})
      sendPushToUser(u.id, { title, body, url: PROVIDER_HEALTH_HREF }).catch(() => {})
    }))
  } catch (e: any) {
    console.error('[WhatsApp] notifyStaffOfDeliveryFailure notification error:', e.message)
  }

  try {
    const { sendStaffSMS } = await import('../sms/sms.service')
    await sendStaffSMS(STAFF_NUMBER, `Code Clinic: ${title}. ${body}`)
  } catch (e: any) {
    console.error('[WhatsApp] notifyStaffOfDeliveryFailure SMS fallback error:', e.message)
  }
}

// ── Persist a real Meta delivery failure (extracted for direct unit testing) ─────
export interface DeliveryFailureParams {
  wamid: string | null
  wabaId: string | null
  phoneNumberId: string | null
  recipientId: string | null
  code: number
  title: string
  message: string | null
  details: string | null
  timestamp: string | undefined
}

export async function persistDeliveryFailure(params: DeliveryFailureParams): Promise<void> {
  await prisma.metaDeliveryFailure.create({
    data: {
      wamid:         params.wamid,
      wabaId:        params.wabaId,
      phoneNumberId: params.phoneNumberId,
      recipientId:   params.recipientId,
      code:          params.code,
      title:         params.title,
      message:       params.message,
      details:       params.details,
      occurredAt:    params.timestamp ? new Date(Number(params.timestamp) * 1000) : new Date(),
    },
  })
}

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
  // See lib/webhook-signature.ts — rejects only once a real app secret is
  // configured; today (no WHATSAPP_APP_SECRET set) this only logs a warning
  // and never blocks live patient traffic.
  if (checkMetaWebhookSignature(req, ['WHATSAPP_APP_SECRET', 'META_APP_SECRET'], 'WhatsApp') === 'REJECTED') {
    res.sendStatus(403)
    return
  }

  // Never log the full raw payload — it carries patient message content,
  // phone numbers, and names. A structural summary is enough to debug
  // delivery/routing issues without writing patient data to application logs.
  const bodyForLog = req.body as WhatsAppWebhookPayload
  const entryCount = bodyForLog?.entry?.length ?? 0
  const messageCount = (bodyForLog?.entry ?? []).reduce((n, e) => n + (e.changes ?? []).reduce((m, c) => m + (c.value?.messages?.length ?? 0), 0), 0)
  const statusCount = (bodyForLog?.entry ?? []).reduce((n, e) => n + (e.changes ?? []).reduce((m, c) => m + (c.value?.statuses?.length ?? 0), 0), 0)
  console.log(`[WEBHOOK RECEIVED] object=${bodyForLog?.object} entries=${entryCount} messages=${messageCount} statuses=${statusCount}`)

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

            // A synchronous "accepted"/"sent" response from Meta's send API does NOT
            // mean the message was delivered — real failures (wrong number, 24h window,
            // billing/eligibility issues) only surface here, asynchronously. A staff
            // alert whose send call "succeeded" but whose real delivery failed here
            // went unnoticed for weeks in 2026-09 (Meta billing issue, error 131042)
            // because nothing ever looked at this webhook's failures. Any failed send
            // to the staff number is always worth surfacing loudly, regardless of
            // which flow sent it.
            if (s.status === 'failed') {
              const err = s.errors?.[0]
              console.error(
                `[WhatsApp] DELIVERY FAILED to ${s.recipient_id}: #${err?.code ?? '?'} ${err?.message ?? err?.title ?? 'unknown error'}` +
                (err?.error_data?.details ? ` — ${err.error_data.details}` : '')
              )

              // Persist what used to be console-only — turns 131042/billing tracking
              // into a real, queryable, ongoing metric (Analytics & Costs) instead of
              // a one-time log grep that doesn't survive log rotation.
              if (err?.code) {
                persistDeliveryFailure({
                  wamid:         s.id ?? null,
                  wabaId:        entry.id ?? null,
                  phoneNumberId: phoneNumberId ?? null,
                  recipientId:   s.recipient_id ?? null,
                  code:          err.code,
                  title:         err.title ?? err.message ?? 'Unknown error',
                  message:       err.message ?? null,
                  details:       err.error_data?.details ?? null,
                  timestamp:     s.timestamp,
                }).catch((e: any) => console.error('[WhatsApp] Failed to persist MetaDeliveryFailure:', e.message))
              }

              const recipientDigits = s.recipient_id?.replace(/\D/g, '') ?? ''
              const staffDigits     = STAFF_NUMBER.replace(/\D/g, '')
              if (recipientDigits && staffDigits && recipientDigits === staffDigits) {
                notifyStaffOfDeliveryFailure(err?.code, err?.message ?? err?.title, err?.error_data?.details).catch(() => {})
              }
            }
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

          // ── Image → OpenAI vision → Sarah's direct response ──────────────────
          if (msg.type === 'image' && msg.image?.id) {
            let handled = false
            try {
              const media = await downloadWhatsAppMedia(msg.image.id)
              if (media) {
                const base64   = Buffer.from(media.buffer).toString('base64')
                const mimeType = media.mimeType || 'image/jpeg'

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const visionRes: any = await openai.responses.create({
                  model: 'gpt-5.6-luna',
                  input: [{
                    role: 'user',
                    content: [
                      { type: 'input_text', text: 'You are Sarah, a dental clinic assistant at Code Clinic in Kampala Uganda. A patient sent you an image. Look at it carefully. If it shows a dental concern (tooth pain, swelling, broken tooth, cavity, gum issue, etc), acknowledge what you see, show empathy, and suggest they book an appointment. If it is not dental related, respond warmly and ask how you can help. Keep response under 150 words, plain text, no markdown, no asterisks.' },
                      { type: 'input_image', image_url: `data:${mimeType};base64,${base64}`, detail: 'auto' },
                    ],
                  }],
                  max_output_tokens: 300,
                })

                const reply = (visionRes.output_text ?? '').trim() || null
                if (reply) {
                  console.log('[OpenAI Vision] replied:', reply.slice(0, 80))
                  await sendDirectReply(from, '[Patient sent an image]', reply, msg.id)
                  handled = true
                }
              }
            } catch (err) {
              console.warn('[OpenAI Vision] failed:', err)
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

          // ── Document / PDF → pdf-parse → OpenAI → Sarah's response ──────────
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
                  const docRes = await openai.responses.create({
                    model: 'gpt-5.6-luna',
                    input: [{
                      role:    'user',
                      content: `A patient sent a document with this content: ${extractedText}\n\nYou are Sarah, a friendly dental clinic assistant at Code Clinic in Kampala Uganda. Respond helpfully in context of dental care. Plain text only, no markdown, no asterisks, no bullet points.`,
                    }],
                    max_output_tokens: 200,
                  })
                  const reply = (docRes.output_text ?? '').trim() || null
                  if (reply) {
                    console.log('[Document] OpenAI replied:', reply.slice(0, 80))
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
  errors?:      Array<{ code: number; title: string; message?: string; error_data?: { details?: string } }>
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
