import { Router } from 'express'
import { createHash, randomUUID } from 'crypto'
import { persistMetaEvents, drainMetaEvents } from './meta-inbox.worker'
import type { MetaInboxProvider, MetaInboxPayload } from './meta-inbox.types'
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
  const cacheKey = `${channel}:${postId}`
  const cached = postCaptionCache.get(cacheKey)
  if (cached && Date.now() - cached.fetchedAt < CAPTION_TTL_MS) return cached.caption

  try {
    const field = channel === 'FACEBOOK_COMMENT' ? 'message' : 'caption'
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${postId}?fields=${field}&access_token=${token}`
    const res  = await fetch(url)
    if (!res.ok) return null
    const data  = await res.json() as any
    const caption: string | undefined = data.message ?? data.caption
    if (caption) {
      postCaptionCache.set(cacheKey, { caption, fetchedAt: Date.now() })
      return caption
    }
  } catch {}
  return null
}

export async function fetchPostThumbnail(
  postId: string,
  token: string,
  channel: 'FACEBOOK_COMMENT' | 'INSTAGRAM_COMMENT' = 'FACEBOOK_COMMENT',
): Promise<string | null> {
  // The same post identifier must never share cached results across channels.
  const cacheKey = `${channel}:${postId}`
  const cached = postThumbnailCache.get(cacheKey)
  if (cached && Date.now() - cached.fetchedAt < CAPTION_TTL_MS) return cached.url
  try {
    const fields = channel === 'INSTAGRAM_COMMENT'
      ? 'media_url,thumbnail_url,media_type'
      : 'full_picture'
    const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(postId)}`)
    url.searchParams.set('fields', fields)
    url.searchParams.set('access_token', token)
    const res = await fetch(url.toString())
    if (!res.ok) {
      // Record only diagnostic codes, never customer IDs, URLs, or access tokens.
      const payload = await res.json().catch(() => null) as { error?: { code?: number; error_subcode?: number } } | null
      console.warn('[MetaPostThumbnail] Graph request rejected', {
        channel, status: res.status,
        metaCode: payload?.error?.code ?? null,
        metaSubcode: payload?.error?.error_subcode ?? null,
      })
      return null
    }
    const data = await res.json() as {
      full_picture?: string
      media_url?: string
      thumbnail_url?: string
      media_type?: string
    }
    const thumb = channel === 'INSTAGRAM_COMMENT'
      ? (data.media_type === 'VIDEO' ? data.thumbnail_url || data.media_url : data.media_url || data.thumbnail_url) || null
      : data.full_picture || null
    // Missing images may become available after Meta finishes processing media.
    // Do not cache a null result for an hour.
    if (thumb) postThumbnailCache.set(cacheKey, { url: thumb, fetchedAt: Date.now() })
    return thumb
  } catch {
    console.warn('[MetaPostThumbnail] Graph request failed', { channel })
    return null
  }
}

// ── Messenger user info fetch (name + profile picture) ────────────────────────
export async function fetchFbUserInfo(
  psid:  string,
  token: string,
): Promise<{ name: string | null; pictureUrl: string | null }> {
  try {
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${psid}?fields=first_name,last_name,profile_pic&access_token=${token}`
    const res  = await fetch(url)
    const data = await res.json() as any
    if (!res.ok) {
      // Was previously swallowed entirely — no way to tell "Meta rejected this
      // (e.g. pages_messaging still in Standard Access)" from "no token" from
      // "PSID not reachable" without this. Logged, not thrown: a missing name/
      // pic must never block the DM itself from being processed.
      console.warn('[Facebook] Profile lookup rejected', { status: res.status, metaCode: typeof data?.error?.code === 'number' ? data.error.code : null, metaSubcode: typeof data?.error?.error_subcode === 'number' ? data.error.error_subcode : null })
      return { name: null, pictureUrl: null }
    }
    return { name: [data.first_name, data.last_name].filter(Boolean).join(' ').trim() || null, pictureUrl: data.profile_pic ?? null }
  } catch (err: any) {
    console.warn('[Facebook] Profile lookup network failure', { type: err?.name || 'unknown' })
    return { name: null, pictureUrl: null }
  }
}

// Instagram messaging identities use Instagram's supported profile fields,
// not the Facebook Messenger PSID fields (first_name/last_name).
export async function fetchInstagramUserInfo(
  igsid: string,
  token: string,
): Promise<{ name: string | null; pictureUrl: string | null }> {
  try {
    const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(igsid)}`)
    url.searchParams.set('fields', 'name,username,profile_pic')
    url.searchParams.set('access_token', token)
    const res = await fetch(url.toString())
    const data = await res.json() as {
      name?: string
      username?: string
      profile_pic?: string
      error?: { code?: number; error_subcode?: number; type?: string }
    }
    if (!res.ok) {
      // Log only Meta's numeric diagnostic codes and error type. Never log
      // customer identifiers, request URLs, access tokens, or error messages.
      console.warn('[Instagram] Profile lookup rejected', {
        status: res.status,
        metaCode: typeof data?.error?.code === 'number' ? data.error.code : null,
        metaSubcode: typeof data?.error?.error_subcode === 'number' ? data.error.error_subcode : null,
        metaType: typeof data?.error?.type === 'string' ? data.error.type.slice(0, 80) : null,
      })
      return { name: null, pictureUrl: null }
    }
    return {
      name: data.name?.trim() || (data.username ? `@${data.username.replace(/^@/, '')}` : null),
      pictureUrl: data.profile_pic || null,
    }
  } catch {
    return { name: null, pictureUrl: null }
  }
}

// ── Facebook Messenger ────────────────────────────────────────────────────────

// GET /ai-suite/facebook/webhook — Meta webhook verification
router.get('/facebook/webhook', (req, res) => {
  const mode      = req.query['hub.mode']
  const token     = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']

  if (mode === 'subscribe' && typeof process.env.FACEBOOK_VERIFY_TOKEN === 'string' && process.env.FACEBOOK_VERIFY_TOKEN.length > 0 && token === process.env.FACEBOOK_VERIFY_TOKEN) {
    console.log('[Facebook] Webhook verified')
    return res.status(200).send(challenge)
  }
  res.status(403).json({ error: 'Verification failed' })
})

// Webhook payloads must be persisted before acknowledging Meta.
function extractInboxEvents(body: any, provider: MetaInboxProvider): Array<{ key: string; payload: MetaInboxPayload }> {
  const events: Array<{ key: string; payload: MetaInboxPayload }> = []
  for (const entry of body.entry ?? []) {
    for (const event of entry.messaging ?? []) {
      if (!event.message?.text || event.message.is_echo || !event.sender?.id) continue
      const mid = event.message.mid ? String(event.message.mid) : undefined
      const key = mid ? `message:${mid}` : `message:${createHash('sha256').update(JSON.stringify(event)).digest('hex')}`
      events.push({ key, payload: { kind: 'message', fromId: String(event.sender.id), text: String(event.message.text), mid } })
    }
    for (const change of entry.changes ?? []) {
      const v = change.value
      if (provider === 'FACEBOOK') {
        if (change.field !== 'feed' || v?.item !== 'comment' || v?.verb !== 'add') continue
        const commentId = v.comment_id ?? v.id
        if (!commentId || !v.post_id || !v.from?.id || !v.message || String(v.from.id) === FB_PAGE_ID) continue
        events.push({ key: `comment:${commentId}`, payload: { kind: 'comment', commentId: String(commentId),
          postId: String(v.post_id), fromId: String(v.from.id), fromName: String(v.from.name ?? ''),
          text: String(v.message), parentId: v.parent_id ? String(v.parent_id) : undefined } })
      } else {
        if (change.field !== 'comments' || !v?.id || !v?.text || String(v.from?.id ?? '') === IG_ACCOUNT_ID) continue
        events.push({ key: `comment:${v.id}`, payload: { kind: 'comment', commentId: String(v.id),
          postId: String(v.media?.id ?? ''), fromId: String(v.from?.id ?? ''),
          fromName: String(v.from?.username ?? ''), text: String(v.text),
          parentId: v.parent_id ? String(v.parent_id) : undefined } })
      }
    }
  }
  return events
}

async function processInboxEvent(provider: MetaInboxProvider, event: MetaInboxPayload): Promise<void> {
  if (event.kind === 'message') {
    await processSocialMessage(event.fromId, event.text, provider, event.mid)
  } else {
    await processComment(event.commentId, event.postId, event.fromId, event.fromName, event.text,
      provider === 'FACEBOOK' ? 'FACEBOOK_COMMENT' : 'INSTAGRAM_COMMENT', event.parentId)
  }
}

const metaInboxTimer = setInterval(() => {
  void drainMetaEvents(processInboxEvent).catch(error => console.error('[Meta inbox] drain failed:', error))
}, 5000)
metaInboxTimer.unref()

async function acceptMetaWebhook(req: import('express').Request, res: import('express').Response, provider: MetaInboxProvider): Promise<void> {
  const secrets = provider === 'FACEBOOK' ? ['FACEBOOK_APP_SECRET', 'META_APP_SECRET']
    : ['INSTAGRAM_APP_SECRET', 'FACEBOOK_APP_SECRET', 'META_APP_SECRET']
  // Fail closed: no Meta secret means we cannot authenticate this webhook.
  // Never persist or act on unauthenticated customer messages/comments.
  if (checkMetaWebhookSignature(req, secrets, provider) !== 'OK') {
    res.sendStatus(403)
    return
  }
  const body = req.body as any
  if (body?.object !== (provider === 'FACEBOOK' ? 'page' : 'instagram')) {
    res.sendStatus(200)
    return
  }
  try {
    await persistMetaEvents(provider, extractInboxEvents(body, provider))
    res.sendStatus(200)
    void drainMetaEvents(processInboxEvent).catch(error => console.error('[Meta inbox] drain failed:', error))
  } catch (error) {
    console.error('[Meta inbox] failed to persist; Meta may retry:', error)
    res.sendStatus(503)
  }
}

// POST /ai-suite/facebook/webhook
router.post('/facebook/webhook', (req, res) => { void acceptMetaWebhook(req, res, 'FACEBOOK') })

// GET /ai-suite/instagram/webhook
router.get('/instagram/webhook', (req, res) => {
  const mode = req.query['hub.mode']
  const token = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']
  if (mode === 'subscribe' && typeof process.env.INSTAGRAM_VERIFY_TOKEN === 'string' && process.env.INSTAGRAM_VERIFY_TOKEN.length > 0 && token === process.env.INSTAGRAM_VERIFY_TOKEN) {
    return res.status(200).send(challenge)
  }
  res.status(403).json({ error: 'Verification failed' })
})

// POST /ai-suite/instagram/webhook
router.post('/instagram/webhook', (req, res) => { void acceptMetaWebhook(req, res, 'INSTAGRAM') })

// ── Comment helpers ───────────────────────────────────────────────────────────

function isDirectedAtUs(text: string): boolean {
  return /code.?clinic|@code_clinic|@codeclinic|tooth|teeth|dental|dentist|appointment|book|cost|price|how much|whiten|brac|implant|filling|cavity|gum|pain|extract|bleach|veneer|crown|root.?canal|braces|invisalign/i.test(text)
}

// Only genuine patient enquiries belong in the clinical leads pipeline.
// Apply before creating a Lead; still retain the conversation for staff review.
function classifyNonPatientEnquiry(message: string): 'JOB' | 'SUPPLIER' | null {
  const text = message.trim().toLowerCase()
  if (/\b(job|jobs|vacanc(?:y|ies)|employment|recruit(?:ment|ing)?|internship|attachment|work opportunity|hiring|apply for (?:a |the )?(?:job|position)|send (?:my |a )?cv)\b/.test(text) &&
      /\b(job|jobs|vacanc(?:y|ies)|employment|recruit(?:ment|ing)?|internship|attachment|work opportunity|hiring|apply|cv|position)\b/.test(text)) return 'JOB'
  if (/\b(?:we|i) (?:sell|supply|offer|provide|distribute|market)\b|\b(?:our|my) (?:products|services|catalogue|quotation|proposal)\b|\b(?:supplier|vendor|wholesale|distributor|marketing agency|advertising services)\b/.test(text) &&
      !/\b(?:i need|i want|my tooth|my teeth|toothache|dental appointment|book an appointment)\b/.test(text)) return 'SUPPLIER'
  return null
}

const JOB_ENQUIRY_REPLY = 'Thank you for your interest in working with Code Clinic. Please send your application or CV to dentist@codeclinic.ug.'
const SUPPLIER_ENQUIRY_REPLY = 'Thank you for contacting Code Clinic. This channel is for patient enquiries; our reception team can review relevant business proposals separately.'

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
    const alreadyPublished = await prisma.aiMessage.findFirst({
      where: { role: 'AGENT', metadata: { contains: marker } },
    })
    if (alreadyPublished) {
      console.log(`[${channel}] Comment reply already recorded — commentId ${commentId}, skipping`)
      return
    }
    // A previous attempt may have stored the inbound comment before Meta
    // rejected the reply. Allow a retry without duplicating the USER message.
    const existingInbound = await prisma.aiMessage.findFirst({
      where: { role: 'USER', metadata: { contains: marker } },
    })

    // ── C. Get or create conversation, updating displayName if we have it ────────
    const config = await prisma.aiAgentConfig.findFirst()
    const token  = channel === 'FACEBOOK_COMMENT'
      ? (config?.facebookPageAccessToken || process.env.FACEBOOK_PAGE_ACCESS_TOKEN || null)
      : (config?.instagramAccessToken    || process.env.INSTAGRAM_ACCESS_TOKEN     || null)

    // Comment threads are scoped to both the commenter and the originating
    // post. Reusing one conversation for the same person across different
    // posts makes the /posts inbox group fresh comments under whichever post
    // that person commented on first.
    let conversation = await prisma.aiConversation.findFirst({
      where: {
        phoneNumber: fromId,
        channel,
        status: 'ACTIVE',
        messages: { some: { metadata: { contains: `"postId":"${postId}"` } } },
      },
      orderBy: { createdAt: 'desc' },
    })
    const isNew = !conversation

    // Facebook comment webhook payloads are not guaranteed to contain all
    // profile fields. Resolve the commenter through the Graph API so the
    // clinic inbox can show the person's real name and profile photo whenever
    // Meta makes them available. Failure is non-blocking: the comment still
    // gets processed with the webhook identity/fallback.
    let resolvedName: string | null = fromName || conversation?.displayName || null
    let pictureUrl: string | null = conversation?.profilePictureUrl ?? null
    if (channel === 'FACEBOOK_COMMENT' && token && fromId && (!resolvedName || !pictureUrl)) {
      const info = await fetchFbUserInfo(fromId, token)
      resolvedName = resolvedName || info.name
      pictureUrl = pictureUrl || info.pictureUrl
    }

    if (!conversation) {
      conversation = await prisma.aiConversation.create({
        data: {
          channel, phoneNumber: fromId, status: 'ACTIVE', agentEnabled: true,
          displayName: resolvedName, profilePictureUrl: pictureUrl,
        },
      })
    } else {
      const identityPatch: { displayName?: string; profilePictureUrl?: string } = {}
      if (!conversation.displayName && resolvedName) identityPatch.displayName = resolvedName
      if (!conversation.profilePictureUrl && pictureUrl) identityPatch.profilePictureUrl = pictureUrl
      if (Object.keys(identityPatch).length) {
        await prisma.aiConversation.update({
          where: { id: conversation.id },
          data: identityPatch,
        })
        conversation = { ...conversation, ...identityPatch }
      }
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
    const nonPatientEnquiry = classifyNonPatientEnquiry(text)
    if (!nonPatientEnquiry && !existingInbound) {
      await findOrCreateLeadForChannel({
        where:      { phone: fromId, status: { notIn: ['CONVERTED', 'LOST'] } },
        createData: { name: resolvedName || undefined, phone: fromId, source: baseChannel, status: 'NEW', stage: 'NEW', lastMessage: text },
        onExistingMessage: text,
        intakeOptions: { skipAcknowledgement: true },
        // The lead just commented — real operational contact-origin evidence.
        // Lead-directed sends in this codebase (ack/SLA warm message) only ever
        // go via WhatsApp today, so evidence is recorded against that channel
        // regardless of the originating social platform.
        contactEvidence: { channel: 'WHATSAPP', source: 'INBOUND_MESSAGE' },
      })
    }

    // Store user message with commentId + postCaption in metadata
    if (!existingInbound) {
      await prisma.aiMessage.create({
        data: {
          conversationId: conversation.id,
          role:     'USER',
          content:  text,
          metadata: JSON.stringify({ commentId, postId, fromName, parentId, postCaption: postCaption?.slice(0, 200) ?? null }),
        },
      })
    }

    // Creating a message does NOT bump the parent conversation's updatedAt —
    // touch it explicitly so reused threads (repeat commenters) sort by real
    // last-activity instead of whenever the conversation row was last written.
    if (!isNew) {
      await prisma.aiConversation.update({
        where: { id: conversation.id },
        data:  { updatedAt: new Date() },
      })
    }

    maybeNotifyStaff(conversation.id, fromId, resolvedName || fromId, channel, isNew)

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
    const reply = nonPatientEnquiry === 'JOB' ? JOB_ENQUIRY_REPLY
      : nonPatientEnquiry === 'SUPPLIER' ? SUPPLIER_ENQUIRY_REPLY
      : await getCommentReplyOpenAI(conversation.id, text, channel, fromId, postCaption ?? undefined)

    if (!reply?.trim()) {
      console.warn(`[${channel}] Empty comment reply suppressed: commentId=${commentId}`)
      return
    }

    // Only record an outbound AGENT message after Meta confirms publication.
    // Previously a failed Graph API call left a phantom reply in the inbox.
    // Claim before calling Meta. A timeout/crash after Meta accepts a reply
    // must never trigger a second automatic public reply on webhook redelivery.
    // Ambiguous sends are held for staff reconciliation rather than replayed.
    const claimed = await prisma.$executeRawUnsafe(
      `INSERT INTO "meta_comment_publish_claims" ("id","channel","commentId")
       VALUES ($1,$2,$3) ON CONFLICT ("channel","commentId") DO NOTHING`,
      randomUUID(), channel, commentId,
    )
    if (claimed === 0) {
      console.warn(`[${channel}] Public reply already claimed; requires reconciliation if no agent message exists`)
      return
    }
    try {
      await sendCommentReply(commentId, reply, channel)
      await prisma.$executeRawUnsafe(
        `UPDATE "meta_comment_publish_claims" SET "status"='PUBLISHED',"publishedAt"=NOW()
         WHERE "channel"=$1 AND "commentId"=$2`, channel, commentId)
    } catch (error: any) {
      await prisma.$executeRawUnsafe(
        `UPDATE "meta_comment_publish_claims" SET "status"='REVIEW_REQUIRED',"lastError"=$3
         WHERE "channel"=$1 AND "commentId"=$2`,
        channel, commentId, String(error?.message ?? error).slice(0, 500))
      throw error
    }

    await prisma.aiMessage.create({
      data: {
        conversationId: conversation.id,
        role:     'AGENT',
        content:  reply,
        metadata: JSON.stringify({ commentId, postId }),
      },
    })
    logOpenAICommentReply(channel, fromId, text, reply)
  } catch (err) {
    console.error(`[${channel}] processComment error:`, err)
    // Propagate failures to the webhook caller and future durable retry worker.
    // Swallowing this exception incorrectly reports processing as successful.
    throw err
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
    // Do not silently report success: callers must not persist an AGENT
    // message when the reply was never sent to Meta.
    throw new Error(`[${channel}] No access token configured — comment reply not sent`)
  }

  // Facebook comments: POST /{comment_id}/comments
  // Instagram comments: POST /{comment_id}/replies
  // Graph API comment endpoints require form-encoded params, not JSON
  const replyPath = channel === 'FACEBOOK_COMMENT' ? 'comments' : 'replies'
  // Instagram Business Login issues Instagram access tokens that must be sent
  // to graph.instagram.com. Sending that token to graph.facebook.com produces
  // OAuthException #190 ("Cannot parse access token") even though inbound
  // comments and AI generation succeed.
  const graphHost = channel === 'INSTAGRAM_COMMENT'
    ? 'graph.instagram.com'
    : 'graph.facebook.com'
  const url = `https://${graphHost}/${GRAPH_VERSION}/${commentId}/${replyPath}`

  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ message: text, access_token: token }).toString(),
  })

  const rawBody = await res.text()
  let responseBody: any = null
  try {
    responseBody = rawBody ? JSON.parse(rawBody) : null
  } catch {
    responseBody = rawBody
  }

  if (!res.ok) {
    const detail = typeof responseBody === 'string'
      ? responseBody
      : JSON.stringify(responseBody)
    throw new Error(`[${channel}] Failed to send comment reply (HTTP ${res.status}): ${detail}`)
  }

  // Meta's create-comment/reply endpoints return the created reply id on
  // success. Treat a 2xx without that id as unverified rather than claiming
  // the reply was delivered; this makes production diagnostics trustworthy.
  const replyId = responseBody && typeof responseBody === 'object'
    ? responseBody.id
    : null

  if (!replyId || typeof replyId !== 'string') {
    const detail = typeof responseBody === 'string'
      ? responseBody
      : JSON.stringify(responseBody)
    throw new Error(`[${channel}] Comment reply response missing created reply id: ${detail}`)
  }

  console.log(`[${channel}] Comment reply created: parent=${commentId} reply=${replyId}`)
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

    // A persisted inbound DM is not proof that the outbound reply succeeded.
    // On a queue retry, reuse that inbound record rather than abandoning delivery.
    const inboundMarker = messageId ? JSON.stringify({ messageId }) : undefined
    const existingInbound = inboundMarker
      ? await prisma.aiMessage.findFirst({ where: { metadata: { contains: inboundMarker } } })
      : null
    const replyMarker = messageId ? JSON.stringify({ outboundForMessageId: messageId }) : undefined
    if (replyMarker) {
      const existingReply = await prisma.aiMessage.findFirst({
        where: { role: 'AGENT', metadata: { contains: replyMarker } },
      })
      if (existingReply) return
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

    // Fetch/refresh the person's real Meta identity whenever either field is
    // missing. Previously an existing displayName prevented us from ever
    // back-filling a missing profile photo, leaving many inbox rows generic.
    // Numeric/generic placeholders are not verified customer names. Retry
    // resolution when the customer sends another message, without blocking DMs.
    const isPlaceholder = (name: string | null | undefined) =>
      !name || /^FB User(?:\s+\d+)?$/i.test(name.trim())
        || /^Facebook User$/i.test(name.trim())
        || /^Instagram User$/i.test(name.trim())
        || /^@?(?:ig_)?\d+$/i.test(name.trim())
    let resolvedName: string | null = conversation?.displayName ?? null
    let pictureUrl: string | null = conversation?.profilePictureUrl ?? null
    if (dmToken && (isPlaceholder(resolvedName) || !pictureUrl)) {
      const info = channel === 'INSTAGRAM'
        ? await fetchInstagramUserInfo(senderId, dmToken)
        : await fetchFbUserInfo(senderId, dmToken)
      if (info.name && !isPlaceholder(info.name) && isPlaceholder(resolvedName)) resolvedName = info.name
      pictureUrl = pictureUrl || info.pictureUrl
    }

    if (!conversation) {
      conversation = await prisma.aiConversation.create({
        data: {
          channel, phoneNumber: senderId, status: 'ACTIVE', agentEnabled: true,
          displayName: resolvedName, profilePictureUrl: pictureUrl,
        },
      })
    } else {
      const identityPatch: { displayName?: string; profilePictureUrl?: string } = {}
      if (isPlaceholder(conversation.displayName) && resolvedName && !isPlaceholder(resolvedName) && resolvedName !== conversation.displayName) identityPatch.displayName = resolvedName
      if (!conversation.profilePictureUrl && pictureUrl) identityPatch.profilePictureUrl = pictureUrl
      if (Object.keys(identityPatch).length) {
        await prisma.aiConversation.update({
          where: { id: conversation.id },
          data: identityPatch,
        })
        conversation = { ...conversation, ...identityPatch }
      }
    }

    // Create or update Lead for this social contact — routed through the
    // single lead-creation orchestration entry point (Part K).
    // Acknowledgement is skipped: the AI agent already replies to this same
    // DM in real time through the normal pipeline.
    const source = channel // 'FACEBOOK' | 'INSTAGRAM'
    const nonPatientEnquiry = classifyNonPatientEnquiry(text)
    if (!nonPatientEnquiry) {
      await findOrCreateLeadForChannel({
        where:      { phone: senderId, status: { notIn: ['CONVERTED', 'LOST'] } },
        createData: { name: resolvedName || undefined, phone: senderId, source, status: 'NEW', stage: 'NEW', lastMessage: text },
        onExistingMessage: text,
        intakeOptions: { skipAcknowledgement: true },
        contactEvidence: { channel: 'WHATSAPP', source: 'INBOUND_MESSAGE' },
      })
    }

    if (!existingInbound) {
      await prisma.aiMessage.create({
        data: {
          conversationId: conversation.id, role: 'USER', content: text,
          metadata: inboundMarker,
        },
      })
    }

    // Creating a message does NOT bump the parent conversation's updatedAt —
    // touch it explicitly so reused threads sort by real last-activity.
    if (!isNew) {
      await prisma.aiConversation.update({
        where: { id: conversation.id },
        data:  { updatedAt: new Date() },
      })
    }

    // Notify staff of new or unattended conversations (fire-and-forget)
    if (!existingInbound) {
      maybeNotifyStaff(conversation.id, senderId, resolvedName || senderId, channel, isNew)
    }

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

    const reply = nonPatientEnquiry === 'JOB' ? JOB_ENQUIRY_REPLY
      : nonPatientEnquiry === 'SUPPLIER' ? SUPPLIER_ENQUIRY_REPLY
      : await getAgentReplyV2OpenAI(conversation.id, senderId, text, channel)

    // Persist an AGENT reply only after Meta confirms the outbound delivery.
    await sendSocialReply(senderId, reply, channel)
    await prisma.aiMessage.create({
      data: { conversationId: conversation.id, role: 'AGENT', content: reply, metadata: replyMarker },
    })
  } catch (err) {
    console.error(`[${channel}] processSocialMessage error:`, err)
    throw err
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
    throw new Error(`[${channel}] No page access token configured — reply not sent`)
  }

  // Instagram Business Login tokens belong on graph.instagram.com. Facebook
  // Messenger continues to use graph.facebook.com with the Page token.
  const sendUrl = channel === 'INSTAGRAM'
    ? `https://graph.instagram.com/${GRAPH_VERSION}/me/messages`
    : `https://graph.facebook.com/${GRAPH_VERSION}/me/messages`

  let res: Response
  try {
    res = await fetch(sendUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message:   { text },
      }),
    })
  
  } catch (error) {
    throw new Error(`META_DM_DELIVERY_UNCERTAIN [${channel}] Network error: ${String(error).slice(0, 300)}`)
  }
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`META_DM_DELIVERY_UNCERTAIN [${channel}] HTTP ${res.status}: ${detail.slice(0, 500)}`)
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
