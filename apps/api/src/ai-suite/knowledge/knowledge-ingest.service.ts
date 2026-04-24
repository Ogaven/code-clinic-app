import { PrismaClient } from '@prisma/client'
import { uploadFile } from '../../services/storage/r2'

const prisma = new PrismaClient()

// ── Chunking ──────────────────────────────────────────────────────────────────
// Breaks at the last sentence boundary within maxChars, falling back to a hard
// cut if no sentence boundary is found in the window.

function chunkAtSentenceBoundary(text: string, maxChars = 1000): string[] {
  const chunks: string[] = []
  let remaining = text.trim()

  while (remaining.length > maxChars) {
    const window = remaining.slice(0, maxChars)
    const lastBreak = Math.max(
      window.lastIndexOf('. '),
      window.lastIndexOf('.\n'),
      window.lastIndexOf('! '),
      window.lastIndexOf('? '),
    )
    const cutAt = lastBreak > 0 ? lastBreak + 2 : maxChars
    chunks.push(remaining.slice(0, cutAt).trim())
    remaining = remaining.slice(cutAt).trim()
  }

  if (remaining.length > 0) chunks.push(remaining)
  return chunks.filter(c => c.length > 0)
}

// ── ingestText ────────────────────────────────────────────────────────────────

export async function ingestText(title: string, content: string): Promise<void> {
  const chunks = chunkAtSentenceBoundary(content)

  for (const chunk of chunks) {
    await prisma.aiKnowledgeBase.create({
      data: { title, type: 'TEXT', content: chunk },
    })
  }

  console.log(`[AI-KB] Ingested "${title}" — ${chunks.length} chunk(s)`)
}

// ── ingestUrl ─────────────────────────────────────────────────────────────────

export async function ingestUrl(url: string): Promise<void> {
  const response = await fetch(url)
  const html = await response.text()

  const text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  const pageTitle = titleMatch ? titleMatch[1].trim() : url

  const chunks = chunkAtSentenceBoundary(text)

  for (let i = 0; i < chunks.length; i++) {
    await prisma.aiKnowledgeBase.create({
      data: {
        title:     pageTitle,
        type:      'URL',
        content:   chunks[i],
        sourceUrl: i === 0 ? url : undefined,
      },
    })
  }

  console.log(`[AI-KB] Ingested URL "${url}" — ${chunks.length} chunk(s)`)
}

// ── ingestFile ────────────────────────────────────────────────────────────────

export async function ingestFile(
  filename: string,
  mimeType: string,
  buffer: Buffer,
): Promise<void> {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''

  // Plain text — convert and chunk
  if (mimeType === 'text/plain' || ext === 'txt' || ext === 'md') {
    return ingestText(filename, buffer.toString('utf-8'))
  }

  // PDF — extract text with pdf-parse, then chunk
  if (mimeType === 'application/pdf' || ext === 'pdf') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParseModule = require('pdf-parse')
    const pdfParse = pdfParseModule.default || pdfParseModule
    const data = await pdfParse(buffer)
    return ingestText(filename, data.text)
  }

  // Media files — upload to R2, save a single descriptive row
  const r2Key = `ai-knowledge/${Date.now()}-${filename.replace(/\s+/g, '-')}`
  await uploadFile(buffer, mimeType, r2Key)

  let type: string
  let content: string

  if (mimeType.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) {
    type    = 'IMAGE'
    content = `Image: ${filename}`
  } else if (mimeType.startsWith('audio/') || ['mp3', 'wav', 'm4a', 'ogg'].includes(ext)) {
    type    = 'AUDIO'
    content = `Audio file: ${filename}`
  } else if (mimeType.startsWith('video/') || ext === 'mp4') {
    type    = 'VIDEO'
    content = `Video: ${filename}`
  } else {
    // Unknown — try reading as text
    return ingestText(filename, buffer.toString('utf-8'))
  }

  await prisma.aiKnowledgeBase.create({
    data: { title: filename, type, content, sourceUrl: r2Key },
  })

  console.log(`[AI-KB] Ingested ${type} file "${filename}"`)
}
