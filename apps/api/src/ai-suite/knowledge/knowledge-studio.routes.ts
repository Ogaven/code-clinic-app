import { Router, Request, Response } from 'express'
import Anthropic from '@anthropic-ai/sdk'
import { requireAuth } from '../../middleware/auth'
import { clinicalStaff } from '../../middleware/rbac'
import { prisma } from '../../lib/prisma'
import { retrieveSharedClinicKnowledge } from './shared-retrieval'

const router = Router()

// PROVIDER ARCHITECTURE — audited before writing this: there is no shared
// Anthropic/provider wrapper anywhere in this codebase to reuse. `new
// Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })` is instantiated
// independently in 16 different files (agent.service.ts x5, unified-agent.ts,
// website.agent.ts, staff-relay.service.ts, followup.service.ts,
// whatsapp.routes.ts, routes/agent.ts, routes/assistant.ts,
// routes/campaigns.ts, routes/clinical.ts, services/knowledge/rag.ts) — every
// AI feature in this app builds its own client the same way this file does.
// That IS the actual "provider architecture." The alternative — reusing one
// of getAgentReplyV2/getCommentReplyOpenAI/runAgent directly — was rejected:
// those are tightly coupled to patient/conversation records, channel-specific
// persona rules and booking tools, and forcing an internal staff tool through
// that pipeline (or modifying it to add a "training mode") would risk the
// production patient agent, which this task explicitly must not touch.
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ─────────────────────────────────────────────────────────────────────────────
// AI KNOWLEDGE TRAINING STUDIO
//
// This is a STAFF-ONLY, INTERNAL surface for testing and improving the clinic
// AI's shared knowledge. It deliberately does NOT create AiConversation/
// AiMessage rows — training chats must never inflate Conversations Today,
// channel counts, or AI/Human handling stats. Its own history lives in the
// dedicated KnowledgeStudioConversation/KnowledgeStudioMessage tables
// instead — a completely separate table family, invisible to every
// analytics query that reads AiConversation/AiMessage.
//
// Conversation history is server-authoritative: the client sends only
// { conversationId?, message } (or { retryOf } — see the /chat handler
// below) and the server loads the actual persisted transcript from the DB
// for LLM context. A client can no longer inject fake historical assistant
// turns by tampering with a browser-held transcript.
//
// Retrieval uses retrieveSharedClinicKnowledge() (./shared-retrieval.ts),
// re-implementing getAgentReplyV2's real production algorithm rather than
// pgvector similarity search — see that file for why it's a re-implementation
// rather than a shared import from agent.service.ts.
// ─────────────────────────────────────────────────────────────────────────────

// Detects imperative "teach the AI" phrasing in the STAFF message only (never
// the AI's reply). This only ever produces a client-side suggestion banner —
// nothing becomes durable knowledge without the explicit Save-as-Knowledge
// approval flow (see /save below — nothing saves silently).
const TEACH_PATTERNS = [
  /^(teach|remind|note|fyi|please note|remember)\b[:,]?\s*(the ai|sarah|the clinic ai)?/i,
  /^(our|the clinic'?s?)\b.+(is|are|closes?|opens?|costs?|charges?)\b/i,
]

function detectTeachIntent(message: string): { suggestSave: boolean; suggestedContent: string } {
  const trimmed = message.trim()
  const matched = TEACH_PATTERNS.some(p => p.test(trimmed))
  if (!matched) return { suggestSave: false, suggestedContent: '' }
  // Strip a leading "Teach the AI:" / "Remember:" style prefix for the composer prefill
  const suggestedContent = trimmed.replace(/^(teach|remind|note|fyi|please note|remember)\b[:,]?\s*(the ai|sarah|the clinic ai)?[:,]?\s*/i, '').trim()
  return { suggestSave: true, suggestedContent: suggestedContent || trimmed }
}

const MAX_MESSAGE_CHARS  = 4000
const MAX_HISTORY_ITEMS  = 20   // bounded recent-turns window loaded for LLM context
const MAX_TITLE_CHARS    = 200
const MAX_CATEGORY_CHARS = 40
const MAX_CONTENT_CHARS  = 4000
const MAX_NOTES_CHARS    = 1000
const ALLOWED_FEEDBACK   = ['CORRECT', 'NEEDS_CORRECTION'] as const

function short60(text: string): string {
  const trimmed = text.trim()
  return trimmed.length > 60 ? `${trimmed.slice(0, 60).trim()}…` : trimmed
}

// ── GET /ai-suite/knowledge-studio/conversations ──────────────────────────────
// Owner-scoped, newest-updated-first, cursor-paginated.
router.get('/conversations', requireAuth, clinicalStaff, async (req: Request, res: Response) => {
  try {
    const limitRaw = parseInt(String(req.query.limit ?? '20'), 10)
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 20
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined
    const includeArchived = req.query.includeArchived === 'true'

    const rows = await prisma.knowledgeStudioConversation.findMany({
      where: { createdBy: req.user!.id, ...(includeArchived ? {} : { archivedAt: null }) },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, title: true, createdAt: true, updatedAt: true, archivedAt: true },
    })

    const hasMore = rows.length > limit
    const conversations = hasMore ? rows.slice(0, limit) : rows
    res.json({ conversations, nextCursor: hasMore ? conversations[conversations.length - 1].id : null })
  } catch (err: any) {
    console.error('[Knowledge Studio] list conversations error:', err.message)
    res.status(500).json({ error: 'Failed to load conversations' })
  }
})

// ── POST /ai-suite/knowledge-studio/conversations ─────────────────────────────
router.post('/conversations', requireAuth, clinicalStaff, async (req: Request, res: Response) => {
  try {
    const rawTitle = req.body?.title
    let title: string | undefined
    if (rawTitle !== undefined && rawTitle !== null) {
      if (typeof rawTitle !== 'string') return res.status(400).json({ error: 'title must be a string' })
      if (rawTitle.length > MAX_TITLE_CHARS) return res.status(400).json({ error: `title is too long (${MAX_TITLE_CHARS} char max)` })
      title = rawTitle.trim()
    }

    const convo = await prisma.knowledgeStudioConversation.create({
      data: { createdBy: req.user!.id, ...(title ? { title } : {}) },
    })
    res.status(201).json({ id: convo.id, title: convo.title, createdAt: convo.createdAt, updatedAt: convo.updatedAt, archivedAt: convo.archivedAt })
  } catch (err: any) {
    console.error('[Knowledge Studio] create conversation error:', err.message)
    res.status(500).json({ error: 'Failed to create conversation' })
  }
})

// ── GET /ai-suite/knowledge-studio/conversations/:id ──────────────────────────
// Returns 404 (never 403) for a non-owned id — existence is not revealed to
// non-owners.
router.get('/conversations/:id', requireAuth, clinicalStaff, async (req: Request, res: Response) => {
  try {
    const convo = await prisma.knowledgeStudioConversation.findUnique({ where: { id: req.params.id } })
    if (!convo || convo.createdBy !== req.user!.id) return res.status(404).json({ error: 'Conversation not found' })

    const messages = await prisma.knowledgeStudioMessage.findMany({
      where: { conversationId: convo.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, role: true, content: true, feedback: true, createdAt: true },
    })

    res.json({ id: convo.id, title: convo.title, createdAt: convo.createdAt, updatedAt: convo.updatedAt, archivedAt: convo.archivedAt, messages })
  } catch (err: any) {
    console.error('[Knowledge Studio] get conversation error:', err.message)
    res.status(500).json({ error: 'Failed to load conversation' })
  }
})

// ── PATCH /ai-suite/knowledge-studio/conversations/:id ────────────────────────
// Only title and archivedAt are mutable — no createdBy reassignment, no
// message mutation via this route.
router.patch('/conversations/:id', requireAuth, clinicalStaff, async (req: Request, res: Response) => {
  try {
    const convo = await prisma.knowledgeStudioConversation.findUnique({ where: { id: req.params.id } })
    if (!convo || convo.createdBy !== req.user!.id) return res.status(404).json({ error: 'Conversation not found' })

    const data: { title?: string; archivedAt?: Date | null } = {}

    if ('title' in (req.body || {})) {
      const t = req.body.title
      if (typeof t !== 'string' || !t.trim()) return res.status(400).json({ error: 'title must be a non-empty string' })
      if (t.length > MAX_TITLE_CHARS) return res.status(400).json({ error: `title is too long (${MAX_TITLE_CHARS} char max)` })
      data.title = t.trim()
    }

    if ('archivedAt' in (req.body || {})) {
      const a = req.body.archivedAt
      if (a === null) {
        data.archivedAt = null
      } else if (typeof a === 'string' && !isNaN(Date.parse(a))) {
        data.archivedAt = new Date(a)
      } else {
        return res.status(400).json({ error: 'archivedAt must be an ISO date string or null' })
      }
    }

    if (Object.keys(data).length === 0) return res.status(400).json({ error: 'No valid fields to update (only title, archivedAt are allowed)' })

    const updated = await prisma.knowledgeStudioConversation.update({ where: { id: convo.id }, data })
    res.json({ id: updated.id, title: updated.title, createdAt: updated.createdAt, updatedAt: updated.updatedAt, archivedAt: updated.archivedAt })
  } catch (err: any) {
    console.error('[Knowledge Studio] update conversation error:', err.message)
    res.status(500).json({ error: 'Failed to update conversation' })
  }
})

// ── DELETE /ai-suite/knowledge-studio/conversations/:id ───────────────────────
// Permanent delete, intended to run only after explicit frontend
// confirmation — this is a "New Chat" history list, not a recycle bin.
// Cascades to messages via the schema's onDelete: Cascade.
router.delete('/conversations/:id', requireAuth, clinicalStaff, async (req: Request, res: Response) => {
  try {
    const convo = await prisma.knowledgeStudioConversation.findUnique({ where: { id: req.params.id } })
    if (!convo || convo.createdBy !== req.user!.id) return res.status(404).json({ error: 'Conversation not found' })

    await prisma.knowledgeStudioConversation.delete({ where: { id: convo.id } })
    res.json({ success: true })
  } catch (err: any) {
    console.error('[Knowledge Studio] delete conversation error:', err.message)
    res.status(500).json({ error: 'Failed to delete conversation' })
  }
})

// ── POST /ai-suite/knowledge-studio/chat ──────────────────────────────────────
// body: { conversationId?: string, message: string } to send a new turn, OR
//       { retryOf: string } to regenerate a reply for an existing, still-
//       unanswered USER message (see the retry branch below for why this
//       reuses the row instead of creating a duplicate).
router.post('/chat', requireAuth, clinicalStaff, async (req: Request, res: Response) => {
  try {
    const body = req.body || {}
    let conversationId: string
    let userMessageId: string
    let messageContent: string

    if (body.retryOf !== undefined) {
      if (typeof body.retryOf !== 'string') return res.status(400).json({ error: 'retryOf must be a string' })

      const existing = await prisma.knowledgeStudioMessage.findUnique({
        where: { id: body.retryOf },
        include: { conversation: true },
      })
      if (!existing || existing.conversation.createdBy !== req.user!.id) return res.status(404).json({ error: 'Message not found' })
      if (existing.role !== 'user') return res.status(400).json({ error: 'Only a user message can be retried' })

      // Only the most recent turn may be retried — if anything already
      // followed it, that's a real assistant reply to a real question, and
      // retrying here must never orphan or duplicate it.
      const later = await prisma.knowledgeStudioMessage.findFirst({
        where: { conversationId: existing.conversationId, createdAt: { gt: existing.createdAt } },
      })
      if (later) return res.status(409).json({ error: 'This message already has a response — only the most recent turn can be retried' })

      conversationId = existing.conversationId
      userMessageId = existing.id
      messageContent = existing.content
    } else {
      const message = String(body.message ?? '').trim()
      if (!message) return res.status(400).json({ error: 'message is required' })
      if (message.length > MAX_MESSAGE_CHARS) return res.status(400).json({ error: `message is too long (${MAX_MESSAGE_CHARS} char max)` })

      if (body.conversationId !== undefined) {
        if (typeof body.conversationId !== 'string') return res.status(400).json({ error: 'conversationId must be a string' })
        const convo = await prisma.knowledgeStudioConversation.findUnique({ where: { id: body.conversationId } })
        if (!convo || convo.createdBy !== req.user!.id) return res.status(404).json({ error: 'Conversation not found' })
        conversationId = convo.id
      } else {
        const created = await prisma.knowledgeStudioConversation.create({ data: { createdBy: req.user!.id } })
        conversationId = created.id
      }

      // Persisted before the provider call — if the provider fails below,
      // this row survives so the honest record is preserved and Retry has
      // something to retry (see the failure branch further down).
      const userMsg = await prisma.knowledgeStudioMessage.create({
        data: { conversationId, role: 'user', content: message },
      })
      userMessageId = userMsg.id
      messageContent = message
    }

    // Server-authoritative, bounded context — freshly loaded from the DB,
    // ending with the current turn's own persisted row. The current message
    // is therefore included exactly once: it is never separately re-appended
    // to this array.
    const recent = await prisma.knowledgeStudioMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: MAX_HISTORY_ITEMS + 1,
    })
    const ordered = recent.slice().reverse()
    const providerMessages = ordered.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))
    const isFirstTurn = ordered.length === 1

    const hits = await retrieveSharedClinicKnowledge(messageContent)
    const contextBlock = hits.length > 0
      ? hits.map(h => `${h.title}: ${h.content}`).join('\n\n')
      : null

    const systemPrompt = [
      'You are the Code Clinic Knowledge Trainer — an internal tool used by clinic staff to TEST and IMPROVE what the clinic AI ("Sarah") knows.',
      'You are NOT talking to a patient. You are talking to clinic staff.',
      'Answer the staff member\'s question using ONLY the CLINIC KNOWLEDGE BASE context below, the same shared knowledge base Sarah uses for real patients on WhatsApp, the website, Facebook and Instagram.',
      'If the answer is not contained in the context, say so plainly — e.g. "I don\'t have that in the knowledge base yet." Do not guess, invent, or use general world knowledge to fill the gap.',
      'Keep answers concise and factual. This is a training/testing tool, not a sales or persuasion conversation.',
      '',
      contextBlock ? `CLINIC KNOWLEDGE BASE (grounding context for this answer):\n${contextBlock}` : 'CLINIC KNOWLEDGE BASE: (no matching entries found for this question)',
    ].join('\n')

    let reply: string
    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-5',
        max_tokens: 1024,
        system: systemPrompt,
        messages: providerMessages,
      })
      const block = response.content.find(b => b.type === 'text') as { type: 'text'; text: string } | undefined
      reply = block?.text || "Sorry, I couldn't generate a response."
    } catch (err: any) {
      console.error('[Knowledge Studio] chat error:', err.message)
      // The USER turn (new or retried) stays persisted exactly as it was —
      // no fabricated assistant response, no duplicate row created here.
      return res.status(500).json({ error: 'Failed to get a response from the clinic AI', conversationId, userMessageId })
    }

    const assistantMsg = body.retryOf !== undefined
      ? await prisma.$transaction(async (tx) => {
          // Serialize commits for this retry target across every API instance.
          // A duplicate request may still reach the provider, but only one
          // assistant response can be committed for the unanswered user row.
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${userMessageId}))`
          const target = await tx.knowledgeStudioMessage.findUnique({ where: { id: userMessageId } })
          if (!target) return null
          const answered = await tx.knowledgeStudioMessage.findFirst({
            where: { conversationId, createdAt: { gt: target.createdAt } },
          })
          if (answered) return null
          return tx.knowledgeStudioMessage.create({
            data: { conversationId, role: 'assistant', content: reply },
          })
        }, { timeout: 15_000 })
      : await prisma.knowledgeStudioMessage.create({
          data: { conversationId, role: 'assistant', content: reply },
        })

    if (!assistantMsg) {
      return res.status(409).json({ error: 'This message already has a response' })
    }

    if (isFirstTurn) {
      // Deterministic title from the first real message — no extra LLM call
      // spent just to name a conversation.
      await prisma.knowledgeStudioConversation.update({ where: { id: conversationId }, data: { title: short60(messageContent) } })
    } else {
      await prisma.knowledgeStudioConversation.update({ where: { id: conversationId }, data: {} })
    }

    const teach = detectTeachIntent(messageContent)

    res.json({
      conversationId,
      userMessageId,
      messageId: assistantMsg.id,
      reply,
      sources: hits.map(h => ({ id: h.id, title: h.title, sourceUrl: h.sourceUrl })),
      grounded: hits.length > 0,
      suggestSave: teach.suggestSave,
      suggestedContent: teach.suggestedContent,
    })
  } catch (err: any) {
    console.error('[Knowledge Studio] chat error:', err.message)
    res.status(500).json({ error: 'Failed to get a response from the clinic AI' })
  }
})

// ── PATCH /ai-suite/knowledge-studio/messages/:id/feedback ────────────────────
// Records staff feedback only — never writes to AiKnowledgeBase. Saving a
// correction remains a separate, explicit Save-as-Knowledge action (see
// /save below).
router.patch('/messages/:id/feedback', requireAuth, clinicalStaff, async (req: Request, res: Response) => {
  try {
    const feedback = req.body?.feedback ?? null
    if (feedback !== null && !ALLOWED_FEEDBACK.includes(feedback)) {
      return res.status(400).json({ error: `feedback must be one of ${ALLOWED_FEEDBACK.join(', ')}, or null` })
    }

    const msg = await prisma.knowledgeStudioMessage.findUnique({
      where: { id: req.params.id },
      include: { conversation: true },
    })
    if (!msg || msg.conversation.createdBy !== req.user!.id) return res.status(404).json({ error: 'Message not found' })
    if (msg.role !== 'assistant') return res.status(400).json({ error: 'Only assistant messages can receive feedback' })

    const updated = await prisma.knowledgeStudioMessage.update({ where: { id: msg.id }, data: { feedback } })
    res.json({ id: updated.id, feedback: updated.feedback })
  } catch (err: any) {
    console.error('[Knowledge Studio] feedback error:', err.message)
    res.status(500).json({ error: 'Failed to record feedback' })
  }
})

// ── POST /ai-suite/knowledge-studio/save ──────────────────────────────────────
// Explicit staff approval → durable AiKnowledgeBase entry, immediately part of
// the SAME corpus retrieveKnowledge() (and getAgentReplyV2) read from — no
// separate "training knowledge" silo. type='STAFF_TRAINING' requires no schema
// change (AiKnowledgeBase.type is a free-form String). Category has no
// dedicated column either, so it's folded into the title as "[Category] ..."
// — searchable, zero schema change, documented here so it isn't a mystery.
// Deliberately NEVER auto-triggered by feedback, teach-intent detection, or
// conversation activity — this is the only path that writes to
// AiKnowledgeBase from this file.
router.post('/save', requireAuth, clinicalStaff, async (req: Request, res: Response) => {
  try {
    const { title, category, content, notes } = req.body || {}
    if (!title || typeof title !== 'string' || !title.trim()) return res.status(400).json({ error: 'title is required' })
    if (!content || typeof content !== 'string' || !content.trim()) return res.status(400).json({ error: 'content is required' })
    if (title.length > MAX_TITLE_CHARS) return res.status(400).json({ error: `title is too long (${MAX_TITLE_CHARS} char max)` })
    if (content.length > MAX_CONTENT_CHARS) return res.status(400).json({ error: `content is too long (${MAX_CONTENT_CHARS} char max)` })
    if (category !== undefined && category !== null) {
      if (typeof category !== 'string') return res.status(400).json({ error: 'category must be a string' })
      if (category.length > MAX_CATEGORY_CHARS) return res.status(400).json({ error: `category is too long (${MAX_CATEGORY_CHARS} char max)` })
    }
    if (notes !== undefined && notes !== null) {
      if (typeof notes !== 'string') return res.status(400).json({ error: 'notes must be a string' })
      if (notes.length > MAX_NOTES_CHARS) return res.status(400).json({ error: `notes is too long (${MAX_NOTES_CHARS} char max)` })
    }

    const fullTitle = category && String(category).trim() ? `[${String(category).trim()}] ${title.trim()}` : title.trim()
    const fullContent = notes && String(notes).trim() ? `${content.trim()}\n\n(Staff note: ${String(notes).trim()})` : content.trim()

    const entry = await prisma.aiKnowledgeBase.create({
      data: {
        title:   fullTitle,
        type:    'STAFF_TRAINING',
        content: fullContent,
        // Provenance, zero schema change: sourceUrl is unused by retrieval
        // matching (only title/content are searched), so it's a safe place
        // to record who approved this and when without touching the text
        // that actually gets embedded/matched/shown to patients.
        sourceUrl: `staff-training://${req.user!.id}`,
      },
    })

    res.status(201).json({
      success: true,
      entry: { id: entry.id, title: entry.title, type: entry.type, createdAt: entry.createdAt },
    })
  } catch (err: any) {
    console.error('[Knowledge Studio] save error:', err.message)
    res.status(500).json({ error: 'Failed to save knowledge entry' })
  }
})

export default router
