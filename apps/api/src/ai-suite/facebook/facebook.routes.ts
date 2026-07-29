import { Router } from 'express'
import { getAgentReplyV2, getCommentReply } from '../agent/agent.service'
import { isAgentEnabled } from '../takeover/takeover.service'
import { prisma } from '../../lib/prisma'
import { maybeNotifyStaff } from '../whatsapp/whatsapp.service'

const router = Router()

const GRAPH_VERSION = 'v24.0'

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
    if (!res.ok) return { name: null, pictureUrl: null }
    const data = await res.json() as any
    return { name: data.name ?? null, pictureUrl: data.profile_pic ?? null }
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

  if (mode === 'subscribe' && token === (process.env.FACEBOOK_VERIFY_TOKEN ?? 'codeclinic-facebook-2026')) {
    console.log('[Facebook] Webhook verified')
    return res.status(200).send(challenge)
  }
  res.status(403).json({ error: 'Verification failed' })
})

// POST /ai-suite/facebook/webhook — receive Messenger messages
router.post('/facebook/webhook', async (req, res) => {
  res.sendStatus(200) // Acknowledge immediately so Meta doesn't retry

  try {
    const body = req.body as any
    if (body.object !== 'page') return

    for (const entry of body.entry ?? []) {
      for (const event of entry.messaging ?? []) {
        if (!event.message?.text) continue
        await processSocialMessage(
          String(event.sender.id),
          String(event.message.text),
          'FACEBOOK',
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
  res.sendStatus(200)

  try {
    const body = req.body as any
    if (body.object !== 'instagram') return

    for (const entry of body.entry ?? []) {
      // DMs
      for (const event of entry.messaging ?? []) {
        if (!event.message?.text) continue
        await processSocialMessage(
          String(event.sender.id),
          String(event.message.text),
          'INSTAGRAM',
        )
      }
      // Post comments
      for (const change of entry.changes ?? []) {
        if (change.field !== 'comments') continue
        const v = change.value
        if (!v?.text || !v?.id) continue
        // Never process comments authored by our own IG account (prevents self-reply loops)
        const igAccountId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID ?? '17841404690443540'
        if (String(v.from?.id ?? '') === igAccountId) continue
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
    const FB_PAGE_ID = '532091973485208'
    const IG_ACCOUNT_ID = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID ?? '17841404690443540'
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
    const existingLead = await prisma.lead.findFirst({
      where:   { phone: fromId, status: { notIn: ['CONVERTED', 'LOST'] } },
      orderBy: { createdAt: 'desc' },
    })
    if (!existingLead) {
      await prisma.lead.create({
        data: { name: fromName || undefined, phone: fromId, source: baseChannel, status: 'NEW', stage: 'NEW', lastMessage: text },
      })
    } else {
      await prisma.lead.update({ where: { id: existingLead.id }, data: { lastMessage: text } })
    }

    // Store user message with commentId + postCaption in metadata
    await prisma.aiMessage.create({
      data: {
        conversationId: conversation.id,
        role:     'USER',
        content:  text,
        metadata: JSON.stringify({ commentId, postId, fromName, parentId, postCaption: postCaption?.slice(0, 200) ?? null }),
      },
    })

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

    const reply = await getCommentReply(conversation.id, text, channel, postCaption ?? undefined)

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
  senderId: string,
  text:     string,
  channel:  'FACEBOOK' | 'INSTAGRAM',
): Promise<void> {
  try {
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

    // Create or update Lead for this social contact
    const source = channel // 'FACEBOOK' | 'INSTAGRAM'
    const existingLead = await prisma.lead.findFirst({
      where:   { phone: senderId, status: { notIn: ['CONVERTED', 'LOST'] } },
      orderBy: { createdAt: 'desc' },
    })
    if (!existingLead) {
      await prisma.lead.create({
        data: { phone: senderId, source, status: 'NEW', stage: 'NEW', lastMessage: text },
      })
    } else {
      await prisma.lead.update({
        where: { id: existingLead.id },
        data:  { lastMessage: text },
      })
    }

    await prisma.aiMessage.create({
      data: { conversationId: conversation.id, role: 'USER', content: text },
    })

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

    const reply = await getAgentReplyV2(conversation.id, senderId, text, channel)

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

export default router
