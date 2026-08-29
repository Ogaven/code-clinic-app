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
// AiMessage rows (see report §13 "Analytics Isolation") — training chats must
// never inflate Conversations Today, channel counts, or AI/Human handling
// stats. Conversation *history* is therefore not yet durably persisted; see
// the proposed schema in the final report. Each chat turn here is stateless
// server-side — the client resends the recent transcript on every call.
//
// Retrieval uses retrieveSharedClinicKnowledge() (./shared-retrieval.ts),
// re-implementing getAgentReplyV2's real production algorithm rather than
// pgvector similarity search — see that file for why it's a re-implementation
// rather than a shared import from agent.service.ts.
// ─────────────────────────────────────────────────────────────────────────────

// Detects imperative "teach the AI" phrasing in the STAFF message only (never
// the AI's reply). This only ever produces a client-side suggestion banner —
// nothing becomes durable knowledge without the explicit Save-as-Knowledge
// approval flow (§7 "Direct Teach Mode" — nothing saves silently).
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
const MAX_HISTORY_ITEMS  = 20
const MAX_TITLE_CHARS    = 200
const MAX_CATEGORY_CHARS = 40
const MAX_CONTENT_CHARS  = 4000
const MAX_NOTES_CHARS    = 1000

type HistoryTurn = { role: 'user' | 'assistant'; content: string }

// Rejects the request outright on malformed history rather than silently
// dropping bad entries — a client sending garbage should see a 400, not have
// its request quietly reinterpreted.
function validateHistory(raw: unknown): { ok: true; history: HistoryTurn[] } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, history: [] }
  if (!Array.isArray(raw)) return { ok: false, error: 'history must be an array' }
  if (raw.length > MAX_HISTORY_ITEMS) return { ok: false, error: `history is too long (${MAX_HISTORY_ITEMS} message max)` }

  const history: HistoryTurn[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') return { ok: false, error: 'history contains a malformed entry' }
    const { role, content } = item as any
    if (role !== 'user' && role !== 'assistant') return { ok: false, error: `history contains an invalid role: ${String(role)}` }
    if (typeof content !== 'string' || !content.trim()) return { ok: false, error: 'history contains an empty or non-string message' }
    if (content.length > MAX_MESSAGE_CHARS) return { ok: false, error: `a history message exceeds ${MAX_MESSAGE_CHARS} characters` }
    history.push({ role, content })
  }
  return { ok: true, history }
}

// ── POST /ai-suite/knowledge-studio/chat ──────────────────────────────────────
// body: { message: string, history?: { role: 'user'|'assistant', content: string }[] }
router.post('/chat', requireAuth, clinicalStaff, async (req: Request, res: Response) => {
  try {
    const message = String(req.body?.message ?? '').trim()
    if (!message) return res.status(400).json({ error: 'message is required' })
    if (message.length > MAX_MESSAGE_CHARS) return res.status(400).json({ error: `message is too long (${MAX_MESSAGE_CHARS} char max)` })

    const historyResult = validateHistory(req.body?.history)
    if (!historyResult.ok) return res.status(400).json({ error: historyResult.error })
    const history = historyResult.history

    const hits = await retrieveSharedClinicKnowledge(message)
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

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [...history, { role: 'user', content: message }],
    })

    const block = response.content.find(b => b.type === 'text') as { type: 'text'; text: string } | undefined
    const reply = block?.text || "Sorry, I couldn't generate a response."

    const teach = detectTeachIntent(message)

    res.json({
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

// ── POST /ai-suite/knowledge-studio/save ──────────────────────────────────────
// Explicit staff approval → durable AiKnowledgeBase entry, immediately part of
// the SAME corpus retrieveKnowledge() (and getAgentReplyV2) read from — no
// separate "training knowledge" silo. type='STAFF_TRAINING' requires no schema
// change (AiKnowledgeBase.type is a free-form String). Category has no
// dedicated column either, so it's folded into the title as "[Category] ..."
// — searchable, zero schema change, documented here so it isn't a mystery.
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
