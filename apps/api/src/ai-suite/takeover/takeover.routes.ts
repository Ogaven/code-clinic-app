import { Router } from 'express'
import { takeoverConversation, handbackConversation } from './takeover.service'
import { prisma } from '../../lib/prisma'
import { fetchPostThumbnail } from '../facebook/facebook.routes'

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
// Ordered by most recently updated conversation first.
router.get('/conversations', async (req, res) => {
  try {
    const channelParam = (req.query.channel as string | undefined)?.toUpperCase()
    const where = channelParam ? { channel: channelParam } : {}
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
          patientName:      c.patient
            ? `${c.patient.firstName} ${c.patient.lastName}`
            : null,
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
      const entry = postMap.get(postId)
      if (!entry) {
        postMap.set(postId, { postId, caption, latestAt: conv.updatedAt, convs: [conv] })
      } else {
        entry.convs.push(conv)
        if (conv.updatedAt > entry.latestAt) entry.latestAt = conv.updatedAt
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

    await prisma.aiMessage.create({
      data: {
        conversationId: req.params.conversationId,
        role:    'AGENT',
        content: text.trim(),
      },
    })

    if (conversation.channel === 'WHATSAPP') {
      const { sendWhatsAppMessage } = await import('../whatsapp/whatsapp.service')
      await sendWhatsAppMessage(conversation.phoneNumber, text.trim())
    } else if (conversation.channel === 'SMS') {
      const { sendWhatsAppMessage } = await import('../whatsapp/whatsapp.service')
      await sendWhatsAppMessage(conversation.phoneNumber, text.trim())
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

export default router
