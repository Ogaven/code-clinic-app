import { prisma } from '../../lib/prisma'

// ─────────────────────────────────────────────────────────────────────────────
// SHARED CLINIC KNOWLEDGE RETRIEVAL
//
// Extracted so any NEW internal surface (currently: the Knowledge Training
// Studio) can query AiKnowledgeBase with the exact same algorithm production
// patient-facing AI uses, instead of drifting from it over time.
//
// This is intentionally a re-implementation, not an import from
// apps/api/src/ai-suite/agent/agent.service.ts. That file already contains
// this same keyword-match-and-rescore logic duplicated TWICE inline
// (getAgentReplyV2 ~line 2628-2762, getAgentReplyV2OpenAI ~line 3010-3150),
// tightly interleaved with WhatsApp/Website/Facebook-specific context
// (patient records, guardian context, working hours, channel-specific system
// prompt branches, a hardcoded DEFAULT_KB fallback). Extracting a function
// those call sites both import would mean refactoring live, patient-facing
// reply generation — exactly what this hardening pass was told NOT to risk.
// The two production call sites are left untouched and still duplicated;
// this module exists so the Knowledge Studio at least stops being a THIRD
// copy of untracked logic and instead has one clearly-owned, tested copy of
// the algorithm, ready to be adopted by agent.service.ts later if desired.
// ─────────────────────────────────────────────────────────────────────────────

export interface KnowledgeHit {
  id: string
  title: string
  content: string
  sourceUrl: string | null
  score: number
}

export interface RetrieveOptions {
  /** Max DB rows fetched by the keyword OR-match before rescoring (default 15). */
  fetchLimit?: number
  /** Max results returned after rescoring (default 5). */
  topK?: number
}

// Same two-stage approach as production: (1) a broad DB-level OR match across
// up to 5 keywords (words >= 4 chars) against title/content, (2) a stricter
// client-side rescore counting how many distinct query words (>3 chars)
// actually appear in each candidate, keeping only positive-score rows.
export async function retrieveSharedClinicKnowledge(
  query: string,
  options: RetrieveOptions = {},
): Promise<KnowledgeHit[]> {
  const { fetchLimit = 15, topK = 5 } = options

  const keywords = query.split(/\s+/).map(w => w.replace(/[^\w]/g, '')).filter(w => w.length >= 4).slice(0, 5)
  if (keywords.length === 0) return []

  const rows = await prisma.aiKnowledgeBase.findMany({
    where: { OR: keywords.flatMap(kw => [
      { title:   { contains: kw, mode: 'insensitive' as const } },
      { content: { contains: kw, mode: 'insensitive' as const } },
    ]) },
    take: fetchLimit,
    select: { id: true, title: true, content: true, sourceUrl: true },
  })

  const words = query.toLowerCase().split(/\W+/).filter(w => w.length > 3)
  return rows
    .map(r => {
      const text = `${r.title} ${r.content}`.toLowerCase()
      const score = words.filter(w => text.includes(w)).length
      return { ...r, score }
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}
