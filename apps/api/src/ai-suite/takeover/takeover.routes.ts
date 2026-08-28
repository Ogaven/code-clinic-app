import { Router } from 'express'
import { takeoverConversation, handbackConversation } from './takeover.service'
import { prisma } from '../../lib/prisma'
import { fetchPostThumbnail } from '../facebook/facebook.routes'
import { normalizePhone, phoneVariants } from '../../utils/phone'
import { requireAuth } from '../../middleware/auth'

const router = Router()

// POST /ai-suite/takeover/:conversationId
// Staff member takes over a conversation — Sarah goes silent.
router.post('/takeover/:conversationId', async (req, res) => {
  try {
    const staffId = (req.body.staffId as string | undefined) ?? 'unknown'
    await takeoverConversation(req.params.conversationId, staffId)
    res.json({ success: true })
  } catch (err: any) {
    console.error('[Takeover] takeover error:', err.message)
    res.status(500).json({ error: 'Failed to take over conversation' })
  }
})

// POST /ai-suite/handback/:conversationId
// Staff hands the conversation back to Sarah.
router.post('/handback/:conversationId', async (req, res) => {
  try {
    await handbackConversation(req.params.conversationId)
    res.json({ success: true })
  } catch (err: any) {
    console.error('[Takeover] handback error:', err.message)
    res.status(500).json({ error: 'Failed to hand back conversation' })
  }
})

// GET /ai-suite/conversations
// Returns conversations filtered by ?channel=whatsapp|instagram|facebook|website
// By default excludes archived conversations; ?archived=true returns only archived ones.
// Ordered by most recently updated conversation first.
router.get('/conversations', async (req, res) => {
  try {
    const channelParam  = (req.query.channel as string | undefined)?.toUpperCase()
    const wantsArchived = req.query.archived === 'true'
    const where: any = {
      ...(channelParam ? { channel: channelParam } : {}),
      archivedAt: wantsArchived ? { not: null } : null,
    }
    const conversations = await prisma.aiConversation.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        patient: {
          select: { firstName: true, lastName: true },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 2,
        },
      },
    })

    // Secondary patient lookup for unlinked conversations (phone-format mismatch
    // means patientId was never set even though a patient record exists).
    const unlinkedPhones = conversations
      .filter(c => !c.patientId && c.phoneNumber)
      .map(c => c.phoneNumber as string)

    const phoneVariants: string[] = []
    for (const p of unlinkedPhones) {
      phoneVariants.push(p)
      phoneVariants.push(p.startsWith('+') ? p.slice(1) : `+${p}`)
    }

    const secondaryPatients = phoneVariants.length
      ? await prisma.patient.findMany({
          where: {
            phone: { in: phoneVariants },
            NOT: [
              { lastName: '.' },
              { lastName: { contains: 'Patient' } },
              { firstName: { contains: '@' } },
            ],
          },
          select: { firstName: true, lastName: true, phone: true },
        })
      : []

    const phoneToPatientName = new Map<string, string>()
    for (const p of secondaryPatients) {
      const name = `${p.firstName} ${p.lastName}`.trim().replace(/\s+\.\s*$/, '').trim()
      if (!name) continue
      phoneToPatientName.set(p.phone, name)
      phoneToPatientName.set(p.phone.startsWith('+') ? p.phone.slice(1) : `+${p.phone}`, name)
    }

    function formatPatientName(firstName: string, lastName: string): string {
      return `${firstName} ${lastName}`.trim().replace(/\s+\.\s*$/, '').trim()
    }

    res.json(
      conversations.map(c => {
        let postCaption: string | null = null
        if (c.channel === 'FACEBOOK_COMMENT' || c.channel === 'INSTAGRAM_COMMENT') {
          for (const msg of c.messages) {
            try {
              const meta = msg.metadata ? JSON.parse(msg.metadata) : null
              if (meta?.postCaption) { postCaption = meta.postCaption; break }
            } catch {}
          }
        }
        const patientName = c.patient
          ? formatPatientName(c.patient.firstName, c.patient.lastName)
          : (c.phoneNumber ? (phoneToPatientName.get(c.phoneNumber) ?? null) : null)
        return {
          id:               c.id,
          channel:          c.channel,
          phoneNumber:      c.phoneNumber,
          waDisplayName:    c.waDisplayName ?? null,
          displayName:      (c as any).displayName ?? null,
          profilePictureUrl:(c as any).profilePictureUrl ?? null,
          postCaption,
          status:           c.status,
          agentEnabled:     c.agentEnabled,
          archivedAt:       (c as any).archivedAt ?? null,
          patientName:      patientName || null,
          lastMessage: c.messages[0] ?? null,
          createdAt:   c.createdAt,
          updatedAt:   c.updatedAt,
        }
      })
    )
  } catch (err: any) {
    console.error('[Takeover] conversations list error:', err.message)
    res.status(500).json({ error: 'Failed to fetch conversations' })
  }
})

// POST /ai-suite/conversations
// Staff starts a new outbound WhatsApp conversation to a number not yet in the system.
// Reuses an existing ACTIVE conversation for the number if one already exists (same
// dedup convention as the inbound webhook path) instead of creating a duplicate contact.
router.post('/conversations', async (req, res) => {
  try {
    const { phoneNumber, displayName } = req.body as { phoneNumber?: string; displayName?: string }
    if (!phoneNumber?.trim()) return res.status(400).json({ error: 'phoneNumber required' })

    const normalized = normalizePhone(phoneNumber.trim())
    if (!/^\+\d{9,15}$/.test(normalized)) {
      return res.status(400).json({ error: 'Could not parse a valid phone number' })
    }

    let conversation = await prisma.aiConversation.findFirst({
      where:   { phoneNumber: { in: phoneVariants(normalized) }, channel: 'WHATSAPP' },
      orderBy: { createdAt: 'desc' },
    })
    let isNew = false

    if (!conversation) {
      const patient = await prisma.patient.findFirst({ where: { phone: { in: phoneVariants(normalized) } } })
      conversation = await prisma.aiConversation.create({
        data: {
          patientId:    patient?.id ?? null,
          channel:      'WHATSAPP',
          phoneNumber:  normalized,
          status:       'ACTIVE',
          agentEnabled: false, // staff-initiated — stays in human takeover until they hand back
          displayName:  displayName?.trim() || undefined,
        } as any,
      })
      isNew = true
    } else if ((conversation as any).archivedAt) {
      // Reusing an archived thread — surface it again
      conversation = await prisma.aiConversation.update({
        where: { id: conversation.id },
        data:  { archivedAt: null, status: 'ACTIVE' } as any,
      })
    }

    res.json({ id: conversation.id, phoneNumber: conversation.phoneNumber, isNew })
  } catch (err: any) {
    console.error('[Takeover] create conversation error:', err.message)
    res.status(500).json({ error: 'Failed to start conversation' })
  }
})

// DELETE /ai-suite/conversations/:conversationId
// Permanently removes a conversation and its messages (cascade).
router.delete('/conversations/:conversationId', async (req, res) => {
  try {
    await prisma.aiConversation.delete({ where: { id: req.params.conversationId } })
    res.json({ success: true })
  } catch (err: any) {
    console.error('[Takeover] delete conversation error:', err.message)
    res.status(500).json({ error: 'Failed to delete conversation' })
  }
})

// PATCH /ai-suite/conversations/:conversationId/archive
router.patch('/conversations/:conversationId/archive', async (req, res) => {
  try {
    const conv = await prisma.aiConversation.update({
      where: { id: req.params.conversationId },
      data:  { archivedAt: new Date() } as any,
    })
    res.json({ success: true, archivedAt: (conv as any).archivedAt })
  } catch (err: any) {
    console.error('[Takeover] archive conversation error:', err.message)
    res.status(500).json({ error: 'Failed to archive conversation' })
  }
})

// PATCH /ai-suite/conversations/:conversationId/unarchive
router.patch('/conversations/:conversationId/unarchive', async (req, res) => {
  try {
    await prisma.aiConversation.update({
      where: { id: req.params.conversationId },
      data:  { archivedAt: null } as any,
    })
    res.json({ success: true })
  } catch (err: any) {
    console.error('[Takeover] unarchive conversation error:', err.message)
    res.status(500).json({ error: 'Failed to unarchive conversation' })
  }
})

// GET /ai-suite/channel-toggles
router.get('/channel-toggles', async (_req, res) => {
  try {
    const cfg = await prisma.aiAgentConfig.findFirst()
    res.json({
      fbDmsEnabled:      (cfg as any)?.fbDmsEnabled      ?? true,
      igDmsEnabled:      (cfg as any)?.igDmsEnabled      ?? true,
      fbCommentsEnabled: (cfg as any)?.fbCommentsEnabled ?? true,
      igCommentsEnabled: (cfg as any)?.igCommentsEnabled ?? true,
    })
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch channel toggles' })
  }
})

// PATCH /ai-suite/channel-toggles
router.patch('/channel-toggles', async (req, res) => {
  try {
    const { fbDmsEnabled, igDmsEnabled, fbCommentsEnabled, igCommentsEnabled } = req.body as Record<string, boolean>
    const cfg = await prisma.aiAgentConfig.findFirst()
    if (!cfg) return res.status(404).json({ error: 'No agent config found' })
    await prisma.aiAgentConfig.update({
      where: { id: cfg.id },
      data: {
        ...(fbDmsEnabled      !== undefined && { fbDmsEnabled      : Boolean(fbDmsEnabled)      }),
        ...(igDmsEnabled      !== undefined && { igDmsEnabled      : Boolean(igDmsEnabled)      }),
        ...(fbCommentsEnabled !== undefined && { fbCommentsEnabled : Boolean(fbCommentsEnabled) }),
        ...(igCommentsEnabled !== undefined && { igCommentsEnabled : Boolean(igCommentsEnabled) }),
      } as any,
    })
    res.json({ success: true })
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update channel toggles' })
  }
})

// GET /ai-suite/conversations/:conversationId/messages
// Returns all messages for a conversation in chronological order.
router.get('/conversations/:conversationId/messages', async (req, res) => {
  try {
    const messages = await prisma.aiMessage.findMany({
      where:   { conversationId: req.params.conversationId },
      orderBy: { createdAt: 'asc' },
    })
    res.json(messages)
  } catch (err: any) {
    console.error('[Takeover] messages fetch error:', err.message)
    res.status(500).json({ error: 'Failed to fetch messages' })
  }
})

// GET /ai-suite/posts?channel=facebook_comment|instagram_comment
// Returns conversations grouped by postId for the threaded comment view.
router.get('/posts', async (req, res) => {
  try {
    const channel = ((req.query.channel as string | undefined) ?? 'facebook_comment').toUpperCase()
    const convs = await prisma.aiConversation.findMany({
      where: { channel },
      orderBy: { updatedAt: 'desc' },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
      },
    })

    // Group by postId (from first USER message metadata)
    const postMap = new Map<string, {
      postId: string; caption: string | null; latestAt: Date
      convs: typeof convs
    }>()

    for (const conv of convs) {
      let postId: string | null = null
      let caption: string | null = null
      for (const msg of conv.messages) {
        if (msg.role === 'USER' && msg.metadata) {
          try {
            const m = JSON.parse(msg.metadata)
            if (m.postId) { postId = m.postId; caption = m.postCaption ?? null; break }
          } catch {}
        }
      }
      if (!postId) continue

      // Use the real last-message time, not conv.updatedAt — creating a
      // message doesn't bump the parent conversation row, so relying on
      // updatedAt buries fresh comments on reused threads under old ones.
      const lastMsgAt = conv.messages.length
        ? conv.messages[conv.messages.length - 1].createdAt
        : conv.updatedAt

      const entry = postMap.get(postId)
      if (!entry) {
        postMap.set(postId, { postId, caption, latestAt: lastMsgAt, convs: [conv] })
      } else {
        entry.convs.push(conv)
        if (lastMsgAt > entry.latestAt) entry.latestAt = lastMsgAt
        if (!entry.caption && caption) entry.caption = caption
      }
    }

    // Fetch thumbnails for each unique postId (cached)
    const cfg   = await prisma.aiAgentConfig.findFirst()
    const token = cfg?.facebookPageAccessToken || process.env.FACEBOOK_PAGE_ACCESS_TOKEN || null

    const sorted = Array.from(postMap.values())
      .sort((a, b) => b.latestAt.getTime() - a.latestAt.getTime())

    const posts = await Promise.all(sorted.map(async p => ({
      postId:       p.postId,
      caption:      p.caption,
      thumbnailUrl: token ? await fetchPostThumbnail(p.postId, token) : null,
      latestAt:     p.latestAt,
      commentCount: p.convs.length,
      conversations: p.convs.map(c => ({
        id:               c.id,
        displayName:      (c as any).displayName ?? null,
        profilePictureUrl:(c as any).profilePictureUrl ?? null,
        agentEnabled:     c.agentEnabled,
        updatedAt:        c.updatedAt,
        messages: c.messages.map(m => ({
          id: m.id, role: m.role, content: m.content,
          createdAt: m.createdAt, metadata: m.metadata ?? null,
        })),
      })),
    })))

    res.json(posts)
  } catch (err: any) {
    console.error('[Posts] error:', err.message)
    res.status(500).json({ error: 'Failed to fetch posts' })
  }
})

// POST /ai-suite/conversations/:conversationId/send
// Staff sends a message directly while in human-takeover mode.
router.post('/conversations/:conversationId/send', async (req, res) => {
  try {
    const { text } = req.body as { text?: string }
    if (!text?.trim()) return res.status(400).json({ error: 'text required' })

    const conversation = await prisma.aiConversation.findUnique({
      where: { id: req.params.conversationId },
    })
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' })

    const msgRecord = await prisma.aiMessage.create({
      data: {
        conversationId: req.params.conversationId,
        role:    'AGENT',
        content: text.trim(),
      },
    })

    if (conversation.channel === 'WHATSAPP') {
      const { sendWhatsAppMessage } = await import('../whatsapp/whatsapp.service')
      // logToConversation:false — message already created above; we just need the wamid back
      const wamid = await sendWhatsAppMessage(conversation.phoneNumber, text.trim(), undefined, false)
      if (wamid && wamid !== 'unknown') {
        await prisma.aiMessage.update({ where: { id: msgRecord.id }, data: { wamid, status: 'sent' } })
      }
    } else if (conversation.channel === 'SMS') {
      const { sendWhatsAppMessage } = await import('../whatsapp/whatsapp.service')
      await sendWhatsAppMessage(conversation.phoneNumber, text.trim(), undefined, false)
    } else if (conversation.channel === 'FACEBOOK' || conversation.channel === 'INSTAGRAM') {
      const { sendSocialReply } = await import('../facebook/facebook.routes')
      await sendSocialReply(conversation.phoneNumber, text.trim(), conversation.channel as 'FACEBOOK' | 'INSTAGRAM')
    } else if (conversation.channel === 'FACEBOOK_COMMENT' || conversation.channel === 'INSTAGRAM_COMMENT') {
      const { sendCommentReply } = await import('../facebook/facebook.routes')
      const lastUserMsg = await prisma.aiMessage.findFirst({
        where:   { conversationId: conversation.id, role: 'USER' },
        orderBy: { createdAt: 'desc' },
      })
      const meta = lastUserMsg?.metadata ? JSON.parse(lastUserMsg.metadata) : {}
      if (meta.commentId) {
        await sendCommentReply(meta.commentId, text.trim(), conversation.channel as 'FACEBOOK_COMMENT' | 'INSTAGRAM_COMMENT')
      } else {
        console.warn(`[Takeover] No commentId in metadata for ${conversation.channel} — message saved only`)
      }
    }
    // WEBSITE: no external delivery — message is visible in the widget on next poll

    res.json({ success: true })
  } catch (err: any) {
    console.error('[Takeover] send error:', err.message)
    res.status(500).json({ error: 'Failed to send message' })
  }
})

// GET /ai-suite/snapshot — small, read-only aggregate for the Admin dashboard's
// "Today's AI Activity" card. Deliberately NOT built on GET /conversations
// above: that endpoint returns every non-archived conversation ever (plus
// per-row patient-name enrichment), which is the wrong shape and far too much
// payload for a dashboard sneak-peek. This scans only today's AiMessage rows
// to find which conversations were active today, then reads just the fields
// the card needs for those conversations. Read-only — no writes, no Prisma
// schema changes, no message sends.
router.get('/snapshot', requireAuth, async (_req, res) => {
  try {
    // Africa/Kampala "today" — fixed UTC+3, no DST, computed explicitly
    // rather than relying on the API process's TZ env var.
    const KAMPALA_OFFSET_MS = 3 * 60 * 60 * 1000
    const shifted = new Date(Date.now() + KAMPALA_OFFSET_MS)
    const y = shifted.getUTCFullYear(), m = shifted.getUTCMonth(), day = shifted.getUTCDate()
    const start = new Date(Date.UTC(y, m, day, 0, 0, 0, 0) - KAMPALA_OFFSET_MS)
    const end   = new Date(Date.UTC(y, m, day + 1, 0, 0, 0, 0) - KAMPALA_OFFSET_MS)

    // Distinct conversations that had at least one message today.
    const activeToday = await prisma.aiMessage.findMany({
      where:    { createdAt: { gte: start, lt: end } },
      select:   { conversationId: true },
      distinct: ['conversationId'],
    })
    const convIds = activeToday.map(a => a.conversationId)

    if (convIds.length === 0) {
      res.json({
        period: { key: 'today', start: start.toISOString(), end: end.toISOString() },
        totalConversations: 0, customerLast: 0, clinicLast: 0, aiHandling: 0, humanHandling: 0, channels: {},
      })
      return
    }

    const conversations = await prisma.aiConversation.findMany({
      where:  { id: { in: convIds } },
      select: {
        channel:      true,
        agentEnabled: true,
        // Most recent CONVERSATIONAL message only (USER or AGENT) — SYSTEM
        // rows (e.g. takeover.service.ts's "Conversation taken over by staff
        // member…"/"Agent resumed by staff." audit notices, or agent.service.ts's
        // internal STAFF_ALERTED flags) are never shown to the customer and
        // are not a reply from anyone, so they must never count as "clinic
        // replied last" just for not being USER. Filtering role in the nested
        // relation query itself (not in JS) keeps this a single query, no N+1.
        messages: { where: { role: { in: ['USER', 'AGENT'] } }, orderBy: { createdAt: 'desc' }, take: 1, select: { role: true } },
      },
    })

    let customerLast = 0, clinicLast = 0, aiHandling = 0, humanHandling = 0
    const channels: Record<string, number> = {}
    for (const c of conversations) {
      // Same semantics already established in the inbox (see
      // apps/web/app/(receptionist)/receptionist/ai-suite/inbox/page.tsx):
      // USER last = customer is currently last in the thread; AGENT last =
      // clinic/agent replied last — AGENT covers both Sarah and a human on
      // takeover, since AiMessage.role never distinguishes them, so this
      // never claims Sarah specifically replied. A conversation whose only
      // message(s) today were SYSTEM notices (e.g. a takeover with no new
      // USER/AGENT message yet) has no real last-reply direction to report,
      // so it is deliberately left out of both buckets rather than guessed.
      const lastRole = c.messages[0]?.role
      if (lastRole === 'USER') customerLast++
      else if (lastRole === 'AGENT') clinicLast++

      // AI-vs-human handling is a SEPARATE signal from message direction —
      // agentEnabled describes who currently OWNS the conversation right now,
      // not who sent the last message or how many messages either side sent.
      // Same authoritative field the inbox's "🤖 AI handling / 👤 Human
      // handling" pill already reads.
      if (c.agentEnabled) aiHandling++
      else humanHandling++

      // Comment-thread channels folded into their parent platform — still
      // real Facebook/Instagram traffic, just via comments instead of DM.
      const group = c.channel === 'FACEBOOK_COMMENT' ? 'FACEBOOK'
                  : c.channel === 'INSTAGRAM_COMMENT' ? 'INSTAGRAM'
                  : c.channel
      channels[group] = (channels[group] ?? 0) + 1
    }

    res.json({
      period: { key: 'today', start: start.toISOString(), end: end.toISOString() },
      totalConversations: conversations.length,
      customerLast, clinicLast, aiHandling, humanHandling,
      channels,
    })
  } catch (e: any) {
    console.error('[AI Snapshot] error:', e.message)
    res.status(500).json({ error: 'Failed to fetch AI snapshot' })
  }
})

export default router
