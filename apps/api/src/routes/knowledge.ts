import { Router } from 'express'
import { PrismaClient } from '@prisma/client'
import multer from 'multer'
import { requireAuth } from '../middleware/auth'
import { uploadFile, getSignedDownloadUrl } from '../services/storage/r2'
import {
  ingestPDF,
  ingestURL,
  ingestAudioTranscript,
  ingestImage,
  ingestText,
  searchKnowledge,
  deleteKnowledgeDocument,
} from '../services/knowledge/rag'

const router  = Router()
const prisma  = new PrismaClient()
const upload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } })

// ── GET /knowledge — list all knowledge base documents ────────

router.get('/', requireAuth, async (req, res) => {
  try {
    // Return distinct documents (by parentId or id for single-chunk docs)
    const allChunks = await prisma.knowledgeBase.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
    })

    // Group by parentId (or id if no parent)
    const docMap = new Map<string, {
      id: string
      title: string
      type: string
      r2Key?: string | null
      sourceUrl?: string | null
      chunkCount: number
      tokenCount: number
      hasEmbedding: boolean
      createdAt: Date
    }>()

    for (const chunk of allChunks) {
      const docId = chunk.parentId || chunk.id
      if (docMap.has(docId)) {
        const doc = docMap.get(docId)!
        doc.chunkCount++
        doc.tokenCount += chunk.tokenCount
        if (chunk.embedding) doc.hasEmbedding = true
      } else {
        docMap.set(docId, {
          id:           docId,
          title:        chunk.title.replace(/ \(Part \d+\)$/, ''), // strip "(Part N)"
          type:         chunk.type,
          r2Key:        chunk.r2Key,
          sourceUrl:    chunk.sourceUrl,
          chunkCount:   1,
          tokenCount:   chunk.tokenCount,
          hasEmbedding: !!chunk.embedding,
          createdAt:    chunk.createdAt,
        })
      }
    }

    const documents = [...docMap.values()]
    res.json({ documents, total: documents.length })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /knowledge/upload — upload and ingest a file ─────────

router.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

    const { title } = req.body
    const file = req.file
    const docTitle = title || file.originalname
    const mimeType = file.mimetype
    const ext = file.originalname.split('.').pop()?.toLowerCase()

    // Upload raw file to R2
    const r2Key = `knowledge/${Date.now()}-${file.originalname.replace(/\s+/g, '-')}`
    await uploadFile(file.buffer, mimeType, r2Key)

    let parentId: string

    if (mimeType === 'application/pdf' || ext === 'pdf') {
      parentId = await ingestPDF(file.buffer, docTitle, r2Key)
    } else if (mimeType.startsWith('image/')) {
      parentId = await ingestImage(file.buffer, docTitle, r2Key)
    } else if (mimeType.startsWith('audio/') || ['mp3', 'wav', 'm4a', 'ogg'].includes(ext || '')) {
      parentId = await ingestAudioTranscript(file.buffer, docTitle, r2Key)
    } else if (mimeType.startsWith('video/')) {
      // Extract audio track and transcribe (simplified — treat as audio)
      parentId = await ingestAudioTranscript(file.buffer, docTitle, r2Key)
    } else if (mimeType === 'text/plain' || ext === 'txt') {
      const text = file.buffer.toString('utf-8')
      parentId = await ingestText(docTitle, text, 'TEXT', r2Key)
    } else {
      // Try to read as text
      const text = file.buffer.toString('utf-8')
      parentId = await ingestText(docTitle, text, 'DOCUMENT', r2Key)
    }

    // Count chunks created
    const chunks = await prisma.knowledgeBase.count({
      where: { OR: [{ id: parentId }, { parentId }] },
    })

    res.json({
      success:  true,
      document_id: parentId,
      title:    docTitle,
      type:     mimeType,
      chunks,
      message:  `Successfully ingested "${docTitle}" into ${chunks} knowledge chunk(s)`,
    })
  } catch (err: any) {
    console.error('[KNOWLEDGE UPLOAD]', err)
    res.status(500).json({ error: err.message })
  }
})

// ── POST /knowledge/url — ingest a URL ────────────────────────

router.post('/url', requireAuth, async (req, res) => {
  try {
    const { url, title } = req.body
    if (!url) return res.status(400).json({ error: 'url required' })

    const parentId = await ingestURL(url)

    const chunks = await prisma.knowledgeBase.count({
      where: { OR: [{ id: parentId }, { parentId }] },
    })

    res.json({
      success:     true,
      document_id: parentId,
      url,
      chunks,
      message:     `Successfully ingested URL into ${chunks} knowledge chunk(s)`,
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /knowledge/text — ingest raw text ────────────────────

router.post('/text', requireAuth, async (req, res) => {
  try {
    const { title, content } = req.body
    if (!title || !content) return res.status(400).json({ error: 'title and content required' })

    const parentId = await ingestText(title, content, 'TEXT')
    const chunks = await prisma.knowledgeBase.count({
      where: { OR: [{ id: parentId }, { parentId }] },
    })

    res.json({ success: true, document_id: parentId, chunks })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /knowledge/search — test a search query ──────────────

router.post('/search', requireAuth, async (req, res) => {
  try {
    const { query, top_k = 3, min_similarity = 0.75 } = req.body
    if (!query) return res.status(400).json({ error: 'query required' })

    const results = await searchKnowledge(query, top_k, min_similarity)
    res.json({
      query,
      results,
      found: results.length > 0,
      message: results.length === 0
        ? 'No results above confidence threshold. Agent would escalate this question.'
        : `Found ${results.length} relevant chunk(s)`,
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── DELETE /knowledge/:id — delete a document ─────────────────

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    if (!['ADMIN'].includes(req.user!.role)) {
      return res.status(403).json({ error: 'Admin access required' })
    }
    await deleteKnowledgeDocument(req.params.id)
    res.json({ success: true, message: 'Document and all its chunks deleted' })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── GET /knowledge/:id/preview — get raw text of a document ──

router.get('/:id/preview', requireAuth, async (req, res) => {
  try {
    const chunks = await prisma.knowledgeBase.findMany({
      where: { OR: [{ id: req.params.id }, { parentId: req.params.id }] },
      orderBy: { chunkIndex: 'asc' },
      select: { id: true, title: true, rawText: true, chunkIndex: true, tokenCount: true },
    })
    if (!chunks.length) return res.status(404).json({ error: 'Document not found' })
    res.json({ chunks })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router
