import { Router } from 'express'
import * as fs from 'fs'
import { getAgentReplyV2OpenAI, getCommentReplyOpenAI } from '../agent/agent.service'
import { isAgentEnabled } from '../takeover/takeover.service'
import { prisma } from '../../lib/prisma'
import { maybeNotifyStaff } from '../whatsapp/whatsapp.service'
import { findOrCreateLeadForChannel } from '../../crm-automation/lead-intake.service'
import { normalizePhone } from '../../utils/phone'
import { checkMetaWebhookSignature } from '../../lib/webhook-signature'

const router = Router()

// ── OpenAI comment-reply pilot — 48h live monitoring log ─────────────────────
// Flat-file, append-only, readable with `tail -f` without needing DB access.
// The rollback instructions live in the file itself (seeded once at go-live),
// not just in code, per the go-live plan.
const OPENAI_COMMENT_LOG_PATH = process.env.OPENAI_COMMENT_LOG_PATH || '/var/log/openai-comment-pilot.log'

function logOpenAICommentReply(channel: string, fromId: string, text: string, reply: string) {
  try {
    const line = `[${new Date().toISOString()}] [${channel}] from=${fromId} IN: ${JSON.stringify(text)} OUT: ${JSON.stringify(reply)}\n`
    fs.appendFileSync(OPENAI_COMMENT_LOG_PATH, line)
  } catch (err: any) {
    console.error('[OpenAI Comment Pilot] Failed to write monitoring log:', err?.message)
  }
}

const GRAPH_VERSION = 'v24.0'

// Our own Page/IG account identity — used to guard against ever processing
// our own outbound sends as if they were inbound (self-reply loop). Shared
// by both the comment path (processComment) and the DM path
// (processSocialMessage) — see the 2026-09-20 idempotency/echo-guard audit.
const FB_PAGE_ID    = '532091973485208'
const IG_ACCOUNT_ID = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID ?? '17841404690443540'

// ── Post caption + thumbnail caches (in-memory, 1-hour TTL) ──────────────────
const postCaptionCache   = new Map<string, { caption: string; fetchedAt: number }>()
const postThumbnailCache = new Map<string, { url: string | null; fetchedAt: number }>()
const CAPTION_TTL_MS     = 60 * 60 * 1000

async function fetchPostCaption(
  postId:  string,
  channel: 'FACEBOOK_COMMENT' | 'INSTAGRAM_COMMENT',
  token:   string,
): Promise<string | null> {
  const cached = postCaptionCache.get(postId)
  if (cached && Date.now() - cached.fetchedAt < CAPTION_TTL_MS) return cached.caption

  try {
    const field = channel === 'FACEBOOK_COMMENT' ? 'message' : 'caption'
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${postId}?fields=${field}&access_token=${token}`
    const res  = await fetch(url)
    if (!res.ok) return null
    const data  = await res.json() as any
    const caption: string | undefined = data.message ?? data.caption
    if (caption) {
      postCaptionCache.set(postId, { caption, fetchedAt: Date.now() })
      return caption
    }
  } catch {}
  return null
}

export async function fetchPostThumbnail(
  postId:  string,
  token:   string,
): Promise<string | null> {
  const cached = postThumbnailCache.get(postId)
  if (cached && Date.now() - cached.fetchedAt < CAPTION_TTL_MS) return cached.url
  try {
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${postId}?fields=full_picture&access_token=${token}`
    const res  = await fetch(url)
    if (!res.ok) { postThumbnailCache.set(postId, { url: null, fetchedAt: Date.now() }); return null }
    const data = await res.json() as any
    const thumb: string | null = data.full_picture ?? null
    postThumbnailCache.set(postId, { url: thumb, fetchedAt: Date.now() })
    return thumb
  } catch {
    postThumbnailCache.set(postId, { url: null, fetchedAt: Date.now() })
    return null
  }
}

// ── Messenger user info fetch (name + profile picture) ────────────────────────
async function fetchFbUserInfo(
  psid:  string,
  token: string,
): Promise<{ name: string | null; pictureUrl: string | null }> {
  try {
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${psid}?fields=name,profile_pic&access_token=${token}`
    const res  = await fetch(url)
    const data = await res.json() as any
    if (!res.ok) {
      // Was previously swallowed entirely — no way to tell "Meta rejected this
      // (e.g. pages_messaging still in Standard Access)" from "no token" from
      // "PSID not reachable" without this. Logged, not thrown: a missing name/
      // pic must never block the DM itself from being processed.
      console.error(`[Facebook] Profile fetch failed for PSID ${psid}:`, JSON.stringify(data?.error ?? data))
      return { name: null, pictureUrl: null }
    }
    return { name: data.name ?? null, pictureUrl: data.profile_pic ?? null }
  } catch (err: any) {
    console.error(`[Facebook] Profile fetch error for PSID ${psid}:`, err?.message)
    return { name: null, pictureUrl: null }
  }
}

// ── Facebook Messenger ────────────────────────────────────────────────────────

// GET /ai-suite/facebook/webhook — Meta webhook verification
router.get('/facebook/webhook', (req, res) => {
  const mode      = req.query['hub.mode']
  const token     = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']

  if (mode === 'subscribe' && token === (process.env.FACEBOOK_VERIFY_TOKEN ?? 'codeclinic-facebook-2026')) {
    console.log('[Facebook] Webhook verified')
    return res.status(200).send(challenge)
  }
  res.status(403).json({ error: 'Verification failed' })
})

// POST /ai-suite/facebook/webhook — receive Messenger messages
router.post('/facebook/webhook', async (req, res) => {
  // See lib/webhook-signature.ts — rejects only once a real app secret is
  // configured; today this only logs a warning and never blocks live traffic.
  if (checkMetaWebhookSignature(req, ['FACEBOOK_APP_SECRET', 'META_APP_SECRET'], 'Facebook') === 'REJECTED') {
    res.sendStatus(403)
    return
  }

  res.sendStatus(200) // Acknowledge immediately so Meta doesn't retry

  try {
    const body = req.body as any
    if (body.object !== 'page') return

    for (const entry of body.entry ?? []) {
      for (const event of entry.messaging ?? []) {
        if (!event.message?.text) continue
        if (event.message?.is_echo) continue // never process our own outbound sends mirrored back
        await processSocialMessage(
          String(event.sender.id),
          String(event.message.text),
          'FACEBOOK',
          event.message.mid ? String(event.message.mid) : undefined,
        )
      }
    }
  } catch (err) {
    console.error('[Facebook] Webhook error:', err)
  }
})

// ── Instagram DMs ─────────────────────────────────────────────────────────────

// GET /ai-suite/instagram/webhook
router.get('/instagram/webhook', (req, res) => {
  const mode      = req.query['hub.mode']
  const token     = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']

  if (mode === 'subscribe' && token === (process.env.INSTAGRAM_VERIFY_TOKEN ?? 'codeclinic-instagram-2026')) {
    console.log('[Instagram] Webhook verified')
    return res.status(200).send(challenge)
  }
  res.status(403).json({ error: 'Verification failed' })
})

// POST /ai-suite/instagram/webhook
router.post('/instagram/webhook', async (req, res) => {
  // See lib/webhook-signature.ts — rejects only once a real app secret is
  // configured; today this only logs a warning and never blocks live traffic.
  if (checkMetaWebhookSignature(req, ['INSTAGRAM_APP_SECRET', 'FACEBOOK_APP_SECRET', 'META_APP_SECRET'], 'Instagram') === 'REJECTED') {
    res.sendStatus(403)
    return
  }

  res.sendStatus(200)

  try {
    const body = req.body as any
    if (body.object !== 'instagram') return

    for (const entry of body.entry ?? []) {
      // DMs
      for (const event of entry.messaging ?? []) {
        if (!event.message?.text) continue
        if (event.message?.is_echo) continue // never process our own outbound sends mirrored back
        await processSocialMessage(
          String(event.sender.id),
          String(event.message.text),
          'INSTAGRAM',
          event.message.mid ? String(event.message.mid) : undefined,
        )
      }
      // Post comments
      for (const change of entry.changes ?? []) {
        if (change.field !== 'comments') continue
        const v = change.value
        if (!v?.text || !v?.id) continue
        // Never process comments authored by our own IG account (prevents self-reply loops)
        if (String(v.from?.id ?? '') === IG_ACCOUNT_ID) continue
        await processComment(
          String(v.id),
          String(v.media?.id ?? ''),
          String(v.from?.id ?? ''),
          String(v.from?.username ?? ''),
          String(v.text),
          'INSTAGRAM_COMMENT',
          v.parent_id ? String(v.parent_id) : undefined,
        )
      }
    }
  } catch (err) {
    console.error('[Instagram] Webhook error:', err)
  }
})

// ── Comment helpers ───────────────────────────────────────────────────────────

function isDirectedAtUs(text: string): boolean {
  return /code.?clinic|@code_clinic|@codeclinic|tooth|teeth|dental|dentist|appointment|book|cost|price|how much|whiten|brac|implant|filling|cavity|gum|pain|extract|bleach|veneer|crown|root.?canal|braces|invisalign/i.test(text)
}

// ── Comment processor ─────────────────────────────────────────────────────────

export async function processComment(
  commentId: string,
  postId:    string,
  fromId:    string,
  fromName:  string,
  text:      string,
  channel:   'FACEBOOK_COMMENT' | 'INSTAGRAM_COMMENT',
  parentId?: string,
): Promise<void> {
  try {
    // ── 0. Hard guard: never process our own Page/account comments ────────────
    if (fromId === FB_PAGE_ID || fromId === IG_ACCOUNT_ID) {
      console.log(`[${channel}] Ignoring own-account comment — self-reply loop guard`)
      return
    }

    // ── A. Filter: skip nested replies not directed at the clinic ─────────────
    if (parentId) {
      // Facebook: parentId === postId means it's a top-level comment (parent is the post itself)
      const isFbTopLevel = channel === 'FACEBOOK_COMMENT' && parentId === postId
      if (!isFbTopLevel) {
        // Always respond if parent is a comment we already processed (we started this thread)
        const parentInDb = await prisma.aiMessage.findFirst({
          where: { metadata: { contains: `"commentId":"${parentId}"` } },
        })
        if (!parentInDb && !isDirectedAtUs(text)) {
          console.log(`[${channel}] Skipping nested reply (no known parent, no keywords): "${text.slice(0, 60)}"`)
          return
        }
      }
    }

    // ── B. Idempotency: skip if we've already processed this comment ──────────
    const marker = `"commentId":"${commentId}"`
    const alreadyProcessed = await prisma.aiMessage.findFirst({
      where: { metadata: { contains: marker } },
    })
    if (alreadyProcessed) {
      console.log(`[${channel}] Duplicate webhook — commentId ${commentId} already processed, skipping`)
      return
    }

    // ── C. Get or create conversation, updating displayName if we have it ────────
    const config = await prisma.aiAgentConfig.findFirst()
    const token  = channel === 'FACEBOOK_COMMENT'
      ? (config?.facebookPageAccessToken || process.env.FACEBOOK_PAGE_ACCESS_TOKEN || null)
      : (config?.instagramAccessToken    || process.env.INSTAGRAM_ACCESS_TOKEN     || null)

    let conversation = await prisma.aiConversation.findFirst({
      where:   { phoneNumber: fromId, channel, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    })
    const isNew = !conversation
    const resolvedName = fromName || null

    if (!conversation) {
      conversation = await prisma.aiConversation.create({
        data: { channel, phoneNumber: fromId, status: 'ACTIVE', agentEnabled: true, displayName: resolvedName },
      })
    } else if (resolvedName && !conversation.displayName) {
      // Back-fill name on existing conversations that didn't have one yet
      await prisma.aiConversation.update({
        where: { id: conversation.id },
        data:  { displayName: resolvedName },
      })
      conversation = { ...conversation, displayName: resolvedName }
    }

    // ── D. Fetch post caption (cached) ────────────────────────────────────────
    let postCaption: string | null = null
    if (postId && token) {
      postCaption = await fetchPostCaption(postId, channel, token)
    }

    const baseChannel = channel === 'FACEBOOK_COMMENT' ? 'FACEBOOK' : 'INSTAGRAM'
    // Routed through the single lead-creation orchestration entry point
    // (Part K). Acknowledgement is skipped: the AI agent already replies to
    // this same comment in real time through the normal pipeline.
    await findOrCreateLeadForChannel({
      where:      { phone: fromId, status: { notIn: ['CONVERTED', 'LOST'] } },
      createData: { name: fromName || undefined, phone: fromId, source: baseChannel, status: 'NEW', stage: 'NEW', lastMessage: text },
      onExistingMessage: text,
      intakeOptions: { skipAcknowledgement: true },
      // The lead just commented — real operational contact-origin evidence.
      // Lead-directed sends in this codebase (ack/SLA warm message) only ever
      // go via WhatsApp today, so evidence is recorded against that channel
      // regardless of the originating social platform.
      contactEvidence: { channel: 'WHATSAPP', source: 'INBOUND_MESSAGE' },
    })

    // Store user message with commentId + postCaption in metadata
    await prisma.aiMessage.create({
      data: {
        conversationId: conversation.id,
        role:     'USER',
        content:  text,
        metadata: JSON.stringify({ commentId, postId, fromName, parentId, postCaption: postCaption?.slice(0, 200) ?? null }),
      },
    })

    // Creating a message does NOT bump the parent conversation's updatedAt —
    // touch it explicitly so reused threads (repeat commenters) sort by real
    // last-activity instead of whenever the conversation row was last written.
    if (!isNew) {
      await prisma.aiConversation.update({
        where: { id: conversation.id },
        data:  { updatedAt: new Date() },
      })
    }

    maybeNotifyStaff(conversation.id, fromId, fromName || fromId, channel, isNew)

    // ── Channel kill-switch ───────────────────────────────────────────────────
    const commentToggleField = channel === 'FACEBOOK_COMMENT' ? 'fbCommentsEnabled' : 'igCommentsEnabled'
    const commentChannelOn = (config as any)?.[commentToggleField] ?? true
    if (!commentChannelOn) {
      console.log(`[${channel}] Channel disabled — comment stored, no auto-reply`)
      return
    }

    const agentOn = await isAgentEnabled(conversation.id)
    if (!agentOn) {
      console.log(`[${channel}] Human takeover — comment saved, no auto-reply`)
      return
    }

    // OpenAI is the only comment-reply provider now (live since 2026-08-26,
    // formerly gated behind COMMENT_REPLY_PROVIDER — Anthropic cut over
    // entirely as of the provider hotfix, so this call is unconditional).
    const reply = await getCommentReplyOpenAI(conversation.id, text, channel, fromId, postCaption ?? undefined)

    logOpenAICommentReply(channel, fromId, text, reply)

    await prisma.aiMessage.create({
      data: {
        conversationId: conversation.id,
        role:     'AGENT',
        content:  reply,
        metadata: JSON.stringify({ commentId, postId }),
      },
    })

    await sendCommentReply(commentId, reply, channel)
  } catch (err) {
    console.error(`[${channel}] processComment error:`, err)
  }
}

export async function sendCommentReply(
  commentId: string,
  text:      string,
  channel:   'FACEBOOK_COMMENT' | 'INSTAGRAM_COMMENT',
): Promise<void> {
  const config = await prisma.aiAgentConfig.findFirst()
  const token = channel === 'FACEBOOK_COMMENT'
    ? (config?.facebookPageAccessToken || process.env.FACEBOOK_PAGE_ACCESS_TOKEN || null)
    : (config?.instagramAccessToken    || process.env.INSTAGRAM_ACCESS_TOKEN     || null)

  if (!token) {
    console.warn(`[${channel}] No access token configured — comment reply not sent`)
    return
  }

  // Facebook comments: POST /{comment_id}/comments
  // Instagram comments: POST /{comment_id}/replies
  // Graph API comment endpoints require form-encoded params, not JSON
  const replyPath = channel === 'FACEBOOK_COMMENT' ? 'comments' : 'replies'
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${commentId}/${replyPath}`

  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ message: text, access_token: token }).toString(),
  })

  if (!res.ok) {
    console.error(`[${channel}] Failed to send comment reply:`, await res.text())
  } else {
    console.log(`[${channel}] Comment reply sent to ${commentId}`)
  }
}

// ── Shared processor ──────────────────────────────────────────────────────────

export async function processSocialMessage(
  senderId:  string,
  text:      string,
  channel:   'FACEBOOK' | 'INSTAGRAM',
  messageId?: string,
): Promise<void> {
  try {
    // ── 0. Hard guard: never process our own Page/account as a "sender" ──────
    // (self-reply loop guard — mirrors processComment's guard above. Not
    // currently reachable in production since message_echoes isn't a
    // subscribed webhook field, per live Graph API /app/subscriptions checks
    // during the 2026-09-20 investigation — but the field-subscription state
    // is external Meta configuration, not something this code controls, so
    // the guard exists defensively rather than relying on that staying true.)
    const ownAccountId = channel === 'FACEBOOK' ? FB_PAGE_ID : IG_ACCOUNT_ID
    if (senderId === ownAccountId) {
      console.log(`[${channel}] Ignoring own-account message event — self-reply loop guard`)
      return
    }

    // ── 1. Idempotency: skip if we've already processed this exact message ───
    // Meta delivers webhooks at-least-once — a retried delivery of the same
    // messaging event must not create a second stored message, a second AI
    // reply, or a second staff escalation. Mirrors processComment's
    // commentId-marker pattern (metadata JSON, no schema change required).
    if (messageId) {
      const marker = `"messageId":"${messageId}"`
      const alreadyProcessed = await prisma.aiMessage.findFirst({
        where: { metadata: { contains: marker } },
      })
      if (alreadyProcessed) {
        console.log(`[${channel}] Duplicate webhook — messageId ${messageId} already processed, skipping`)
        return
      }
    }

    const config    = await prisma.aiAgentConfig.findFirst()
    const dmToken   = channel === 'FACEBOOK'
      ? (config?.facebookPageAccessToken || process.env.FACEBOOK_PAGE_ACCESS_TOKEN || null)
      : (config?.instagramAccessToken    || process.env.INSTAGRAM_ACCESS_TOKEN     || null)

    let conversation = await prisma.aiConversation.findFirst({
      where:   { phoneNumber: senderId, channel, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    })
    const isNew = !conversation

    // Fetch real name + profile picture for new DM conversations (or if missing)
    let resolvedName: string | null   = null
    let pictureUrl:   string | null   = null
    if (dmToken && (!conversation || !conversation.displayName)) {
      const info = await fetchFbUserInfo(senderId, dmToken)
      resolvedName = info.name
      pictureUrl   = info.pictureUrl
    }

    if (!conversation) {
      conversation = await prisma.aiConversation.create({
        data: {
          channel, phoneNumber: senderId, status: 'ACTIVE', agentEnabled: true,
          displayName: resolvedName, profilePictureUrl: pictureUrl,
        },
      })
    } else if (resolvedName && !conversation.displayName) {
      await prisma.aiConversation.update({
        where: { id: conversation.id },
        data:  { displayName: resolvedName, profilePictureUrl: pictureUrl },
      })
      conversation = { ...conversation, displayName: resolvedName, profilePictureUrl: pictureUrl }
    }

    // Create or update Lead for this social contact — routed through the
    // single lead-creation orchestration entry point (Part K).
    // Acknowledgement is skipped: the AI agent already replies to this same
    // DM in real time through the normal pipeline.
    const source = channel // 'FACEBOOK' | 'INSTAGRAM'
    await findOrCreateLeadForChannel({
      where:      { phone: senderId, status: { notIn: ['CONVERTED', 'LOST'] } },
      createData: { phone: senderId, source, status: 'NEW', stage: 'NEW', lastMessage: text },
      onExistingMessage: text,
      intakeOptions: { skipAcknowledgement: true },
      contactEvidence: { channel: 'WHATSAPP', source: 'INBOUND_MESSAGE' },
    })

    await prisma.aiMessage.create({
      data: {
        conversationId: conversation.id, role: 'USER', content: text,
        metadata: messageId ? JSON.stringify({ messageId }) : undefined,
      },
    })

    // Creating a message does NOT bump the parent conversation's updatedAt —
    // touch it explicitly so reused threads sort by real last-activity.
    if (!isNew) {
      await prisma.aiConversation.update({
        where: { id: conversation.id },
        data:  { updatedAt: new Date() },
      })
    }

    // Notify staff of new or unattended conversations (fire-and-forget)
    maybeNotifyStaff(conversation.id, senderId, resolvedName || senderId, channel, isNew)

    // ── Channel kill-switch: check per-channel toggle from config ─────────────
    const toggleField = channel === 'FACEBOOK' ? 'fbDmsEnabled' : 'igDmsEnabled'
    const channelOn = (config as any)?.[toggleField] ?? true
    if (!channelOn) {
      console.log(`[${channel}] Channel disabled — message stored, no auto-reply`)
      return
    }

    const agentOn = await isAgentEnabled(conversation.id)
    if (!agentOn) {
      console.log(`[${channel}] Human takeover — message saved, no auto-reply`)
      return
    }

    const reply = await getAgentReplyV2OpenAI(conversation.id, senderId, text, channel)

    await prisma.aiMessage.create({
      data: { conversationId: conversation.id, role: 'AGENT', content: reply },
    })

    await sendSocialReply(senderId, reply, channel)
  } catch (err) {
    console.error(`[${channel}] processSocialMessage error:`, err)
  }
}

export async function sendSocialReply(
  recipientId: string,
  text:        string,
  channel:     'FACEBOOK' | 'INSTAGRAM',
): Promise<void> {
  // Token is stored in DB via OAuth or manual form; fall back to env var
  const config = await prisma.aiAgentConfig.findFirst()
  const token = channel === 'FACEBOOK'
    ? (config?.facebookPageAccessToken || process.env.FACEBOOK_PAGE_ACCESS_TOKEN || null)
    : (config?.instagramAccessToken    || process.env.INSTAGRAM_ACCESS_TOKEN     || null)

  if (!token) {
    console.warn(`[${channel}] No page access token configured — reply not sent`)
    return
  }

  // Both Facebook and Instagram DMs use /me/messages with the Page token.
  // The /{ig-acct-id}/messages endpoint returns error #3 (capability) even with
  // instagram_manage_messages scope; /me/messages resolves correctly for both.
  const sendUrl = `https://graph.facebook.com/${GRAPH_VERSION}/me/messages`

  const res = await fetch(sendUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message:   { text },
    }),
  })

  if (!res.ok) {
    console.error(`[${channel}] Failed to send reply:`, await res.text())
  } else {
    console.log(`[${channel}] Reply sent to ${recipientId}`)
  }
}

// ── Meta Lead Ads (native Instant Forms) ───────────────────────────────────
// Distinct from Messenger DMs/comments above and from Click-to-WhatsApp ads
// (which just open a WhatsApp conversation — already covered by the
// WhatsApp intake path). This is Meta's dedicated "leadgen" webhook field,
// fired when someone submits a native Lead Ad / Instant Form.
//
// As of the 2026-09-16 lead-engine audit this was NOT implemented at all —
// confirmed both by a repo-wide grep (zero "leadgen" references anywhere)
// and by calling Meta's own /{app-id}/subscriptions endpoint directly, which
// showed the "page" object subscribed only to `messages` and `feed`, never
// `leadgen`. This function is the receiving half of that gap.
//
// IMPORTANT — genuinely blocked on an external permission, not a code issue:
// the leadgen webhook payload never contains the actual answers, only a
// `leadgen_id`; the real field data must be fetched via a follow-up
// GET /{leadgen_id} call, which requires the page token to carry the
// `leads_retrieval` (and typically `pages_manage_ads`) permission. A
// read-only check against the current FACEBOOK_PAGE_ACCESS_TOKEN during
// this audit got back Meta error #200 "Requires pages_manage_ads permission"
// on the simpler /me/leadgen_forms call — so this fetch WILL fail until that
// permission is granted to the page token via Meta Business Suite. Left
// wired (not stubbed out) so it starts working the moment that's fixed,
// rather than needing a second deploy.
export async function processLeadAdSubmission(leadgenId: string): Promise<void> {
  try {
    // Idempotency: Meta delivers webhooks at-least-once, so the exact same
    // leadgen_id can arrive twice. Checked FIRST, before spending a Graph API
    // call on a submission we've already processed — externalSubmissionId is
    // the durable identity key for "have we already handled this exact
    // submission" (phone/email dedup further below still protects a second
    // lead row from being created, but would otherwise misfile a redelivery
    // as a genuine "resubmitted the form" event).
    const alreadyProcessed = await prisma.lead.findFirst({ where: { source: 'FACEBOOK_LEAD_AD', externalSubmissionId: leadgenId } })
    if (alreadyProcessed) {
      console.log(`[LeadAds] leadgen_id=${leadgenId} already processed (lead ${alreadyProcessed.id}) — skipping duplicate webhook delivery`)
      return
    }

    const config = await prisma.aiAgentConfig.findFirst()
    const token = config?.facebookPageAccessToken || process.env.FACEBOOK_PAGE_ACCESS_TOKEN || null
    if (!token) {
      console.error('[LeadAds] No Facebook Page access token configured — cannot fetch lead', leadgenId)
      return
    }

    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${leadgenId}?fields=field_data,ad_id,form_id,created_time&access_token=${token}`
    const res = await fetch(url)
    if (!res.ok) {
      console.error(`[LeadAds] Failed to fetch lead ${leadgenId} (likely missing leads_retrieval permission on the page token):`, await res.text())
      return
    }
    const data = await res.json() as { field_data?: { name: string; values: string[] }[]; ad_id?: string; form_id?: string }

    const fields: Record<string, string> = {}
    for (const f of data.field_data ?? []) fields[f.name] = f.values?.[0] ?? ''

    const rawPhone = fields.phone_number || fields.phone || null
    const email    = fields.email || null
    const fullName = fields.full_name || [fields.first_name, fields.last_name].filter(Boolean).join(' ') || null

    if (!rawPhone && !email) {
      console.warn(`[LeadAds] Lead ${leadgenId} has no phone or email in field_data — cannot create a lead`)
      return
    }

    const normalizedPhone = rawPhone ? normalizePhone(rawPhone) : null

    await findOrCreateLeadForChannel({
      where: normalizedPhone
        ? { phone: normalizedPhone, status: { notIn: ['CONVERTED', 'LOST'] } }
        : { email: email!, status: { notIn: ['CONVERTED', 'LOST'] } },
      createData: {
        name:   fullName,
        phone:  normalizedPhone,
        email:  email || null,
        source: 'FACEBOOK_LEAD_AD',
        status: 'NEW',
        stage:  'NEW',
        notes:  `Meta Lead Ad submission (form ${data.form_id ?? 'unknown'})`,
        provider:             'META_LEAD_ADS',
        formId:               data.form_id ?? null,
        adId:                 data.ad_id ?? null,
        externalSubmissionId: leadgenId,
      },
      onExistingMessage: `Resubmitted Meta Lead Ad (form ${data.form_id ?? 'unknown'})`,
      intakeOptions: { skipAcknowledgement: true }, // no live agent conversation exists yet to skip a duplicate ack for
      contactEvidence: { channel: normalizedPhone ? 'WHATSAPP' : 'EMAIL', source: 'WEB_FORM' },
    })
  } catch (e: any) {
    console.error('[LeadAds] Processing error:', e?.message)
  }
}

export default router
