import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import { prisma } from '../../lib/prisma'

// Lazy-init OpenAI client — only if API key is set
function getOpenAI(): OpenAI {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured')
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
}

function getAnthropic(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

// ── Embedding ────────────────────────────────────────────────────

export async function generateEmbedding(text: string): Promise<number[]> {
  const openai = getOpenAI()
  const response = await openai.embeddings.create({
    model: 'text-embedding-ada-002',
    input: text.slice(0, 8000), // ada-002 token limit safety
  })
  return response.data[0].embedding
}

// ── Cosine similarity ───────────────────────────────────────────

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

// ── Text chunking ───────────────────────────────────────────────

function chunkText(text: string, chunkTokens = 500, overlapTokens = 50): string[] {
  // Approximate: 1 token ≈ 4 chars for English text
  const chunkSize = chunkTokens * 4
  const overlap = overlapTokens * 4
  const chunks: string[] = []

  let start = 0
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length)
    chunks.push(text.slice(start, end).trim())
    if (end === text.length) break
    start += chunkSize - overlap
  }
  return chunks.filter(c => c.length > 50) // skip tiny chunks
}

// ── Ingest text into KnowledgeBase ─────────────────────────────

export async function ingestText(
  title: string,
  text: string,
  type: string,
  r2Key?: string,
  sourceUrl?: string
): Promise<string> {
  const chunks = chunkText(text)
  const parentId = `${Date.now()}-${Math.random().toString(36).slice(2)}`

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    let embedding: string | undefined

    try {
      const vec = await generateEmbedding(chunk)
      embedding = JSON.stringify(vec)
    } catch {
      // If OpenAI not configured, store without embedding (search won't work)
      embedding = undefined
    }

    await prisma.knowledgeBase.create({
      data: {
        id: `${parentId}-${i}`,
        title: chunks.length === 1 ? title : `${title} (Part ${i + 1})`,
        type,
        r2Key: i === 0 ? r2Key : undefined,
        sourceUrl: i === 0 ? sourceUrl : undefined,
        rawText: chunk,
        chunkIndex: i,
        parentId: chunks.length > 1 ? parentId : undefined,
        embedding,
        tokenCount: Math.ceil(chunk.length / 4),
        isActive: true,
      },
    })
  }

  return parentId
}

// ── Ingest PDF ─────────────────────────────────────────────────

export async function ingestPDF(
  buffer: Buffer,
  title: string,
  r2Key: string
): Promise<string> {
  // Dynamic import to handle pdf-parse module variants
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParseModule = require('pdf-parse')
  const pdfParse = pdfParseModule.default || pdfParseModule
  const data = await pdfParse(buffer)
  return ingestText(title, data.text, 'PDF', r2Key)
}

// ── Ingest URL ─────────────────────────────────────────────────

export async function ingestURL(url: string): Promise<string> {
  const response = await fetch(url)
  const html = await response.text()

  // Strip HTML tags
  const text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  const pageTitle = titleMatch ? titleMatch[1].trim() : url

  return ingestText(pageTitle, text, 'URL', undefined, url)
}

// ── Ingest audio/video (via Whisper) ───────────────────────────

export async function ingestAudioTranscript(
  audioBuffer: Buffer,
  title: string,
  r2Key: string
): Promise<string> {
  const openai = getOpenAI()

  // Write to temp file (Whisper needs a file object)
  const tmpPath = `/tmp/audio-${Date.now()}.mp3`
  fs.writeFileSync(tmpPath, audioBuffer)

  try {
    const transcript = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpPath),
      model: 'whisper-1',
    })
    return ingestText(title, transcript.text, 'AUDIO', r2Key)
  } finally {
    try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
  }
}

// ── Ingest image (via Claude Vision) ───────────────────────────

export async function ingestImage(
  buffer: Buffer,
  title: string,
  r2Key: string
): Promise<string> {
  const anthropic = getAnthropic()
  const base64 = buffer.toString('base64')

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: base64 },
        },
        {
          type: 'text',
          text: 'Please extract and describe all text, information, and content from this image in detail. Include any prices, names, dates, procedures, or clinic information you can see.',
        },
      ],
    }],
  })

  const extracted = (response.content[0] as any).text || ''
  return ingestText(title, extracted, 'IMAGE', r2Key)
}

// ── Search knowledge base ───────────────────────────────────────

export interface KnowledgeResult {
  id: string
  title: string
  content: string
  similarity: number
  type: string
}

export async function searchKnowledge(
  query: string,
  topK = 3,
  minSimilarity = 0.75
): Promise<KnowledgeResult[]> {
  // Generate query embedding
  let queryVec: number[]
  try {
    queryVec = await generateEmbedding(query)
  } catch {
    // Fallback: keyword search if no OpenAI key
    return keywordSearch(query, topK)
  }

  // Load all active chunks with embeddings
  const chunks = await prisma.knowledgeBase.findMany({
    where: { isActive: true, embedding: { not: null } },
    select: { id: true, title: true, rawText: true, embedding: true, type: true },
  })

  // Score all chunks
  const scored = chunks
    .map(chunk => {
      try {
        const vec = JSON.parse(chunk.embedding!) as number[]
        const similarity = cosineSimilarity(queryVec, vec)
        return { id: chunk.id, title: chunk.title, content: chunk.rawText || '', similarity, type: chunk.type }
      } catch {
        return null
      }
    })
    .filter((r): r is KnowledgeResult => r !== null && r.similarity >= minSimilarity)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK)

  return scored
}

// ── Keyword fallback (no embeddings) ───────────────────────────

async function keywordSearch(query: string, topK: number): Promise<KnowledgeResult[]> {
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 3)
  if (words.length === 0) return []

  const chunks = await prisma.knowledgeBase.findMany({
    where: {
      isActive: true,
      rawText: { not: null },
    },
    select: { id: true, title: true, rawText: true, type: true },
    take: 100,
  })

  const scored = chunks
    .map(chunk => {
      const text = (chunk.rawText || '').toLowerCase()
      const hits = words.filter(w => text.includes(w)).length
      return { ...chunk, content: chunk.rawText || '', similarity: hits / words.length }
    })
    .filter(r => r.similarity > 0)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK)

  return scored
}

// ── Delete a knowledge base document (all its chunks) ──────────

export async function deleteKnowledgeDocument(documentId: string): Promise<void> {
  // Delete by id (single chunk) or by parentId (all chunks of a document)
  await prisma.knowledgeBase.deleteMany({
    where: {
      OR: [
        { id: documentId },
        { parentId: documentId },
      ],
    },
  })
}

// ── Transcribe audio (for call recordings) ─────────────────────

export async function transcribeAudio(audioBuffer: Buffer): Promise<string> {
  const openai = getOpenAI()
  const tmpPath = `/tmp/recording-${Date.now()}.mp3`
  fs.writeFileSync(tmpPath, audioBuffer)

  try {
    const result = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpPath),
      model: 'whisper-1',
    })
    return result.text
  } finally {
    try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
  }
}
