import { Router, Request, Response } from 'express'
import Anthropic from '@anthropic-ai/sdk'
import { requireAuth } from '../../middleware/auth'
import { clinicalStaff } from '../../middleware/rbac'
import { prisma } from '../../lib/prisma'

const router = Router()
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
// Retrieval intentionally mirrors getAgentReplyV2's real production algorithm
// (apps/api/src/ai-suite/agent/agent.service.ts, ~line 2628-2762) rather than
// pgvector similarity search: AiKnowledgeBase.embedding is written by no
// ingestion path in this codebase and read by no retrieval path either — the
// real system (used by WhatsApp/SMS/Website/Facebook/Instagram) is a plain
// keyword `contains` match over title+content, re-scored by keyword overlap.
// Reusing that exact mechanism (same table, same algorithm) — rather than
// inventing a nicer vector-search path nobody else uses — is what makes an
// answer here a truthful preview of what a real patient would be told.
// ─────────────────────────────────────────────────────────────────────────────

interface KbHit { id: string; title: string; content: string; sourceUrl: string | null; score: number }

async function retrieveKnowledge(message: string): Promise<KbHit[]> {
  const keywords = message.split(/\s+/).map(w => w.replace(/[^\w]/g, '')).filter(w => w.length >= 4).slice(0, 5)
  if (keywords.length === 0) return []

  const rows = await prisma.aiKnowledgeBase.findMany({
    where: { OR: keywords.flatMap(kw => [
      { title:   { contains: kw, mode: 'insensitive' as const } },
      { content: { contains: kw, mode: 'insensitive' as const } },
    ]) },
    take: 15,
    select: { id: true, title: true, content: true, sourceUrl: true },
  })

  const words = message.toLowerCase().split(/\W+/).filter(w => w.length > 3)
  return rows
    .map(r => {
      const text = `${r.title} ${r.content}`.toLowerCase()
      const score = words.filter(w => text.includes(w)).length
      return { ...r, score }
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
}

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

// ── POST /ai-suite/knowledge-studio/chat ──────────────────────────────────────
// body: { message: string, history?: { role: 'user'|'assistant', content: string }[] }
router.post('/chat', requireAuth, clinicalStaff, async (req: Request, res: Response) => {
  try {
    const message = String(req.body?.message ?? '').trim()
    const history = Array.isArray(req.body?.history) ? req.body.history.slice(-10) : []
    if (!message) return res.status(400).json({ error: 'message is required' })
    if (message.length > 4000) return res.status(400).json({ error: 'message is too long (4000 char max)' })

    const hits = await retrieveKnowledge(message)
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
      messages: [
        ...history.filter((m: any) => m?.role === 'user' || m?.role === 'assistant').map((m: any) => ({ role: m.role, content: String(m.content ?? '').slice(0, 4000) })),
        { role: 'user', content: message },
      ],
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
    if (title.length > 200) return res.status(400).json({ error: 'title is too long (200 char max)' })
    if (content.length > 4000) return res.status(400).json({ error: 'content is too long (4000 char max)' })

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
