import { Router } from 'express'
import multer from 'multer'
import { ingestText, ingestUrl, ingestFile } from './knowledge-ingest.service'
import { prisma } from '../../lib/prisma'

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } })

// ── GET /ai-suite/knowledge ───────────────────────────────────────────────────
// Returns all AiKnowledgeBase rows, grouped by title so multi-chunk documents
// appear as a single entry with aggregate chunkCount and tokenCount.

router.get('/', async (_req, res) => {
  try {
    const rows = await prisma.aiKnowledgeBase.findMany({ orderBy: { createdAt: 'asc' } })

    const docMap = new Map<string, {
      id:           string
      title:        string
      type:         string
      r2Key:        null
      sourceUrl:    string | null
      chunkCount:   number
      tokenCount:   number
      hasEmbedding: boolean
      createdAt:    Date
    }>()

    for (const row of rows) {
      if (docMap.has(row.title)) {
        const doc = docMap.get(row.title)!
        doc.chunkCount++
        doc.tokenCount += Math.ceil(row.content.length / 4)
      } else {
        docMap.set(row.title, {
          id:           row.id,
          title:        row.title,
          type:         row.type,
          r2Key:        null,
          sourceUrl:    row.sourceUrl ?? null,
          chunkCount:   1,
          tokenCount:   Math.ceil(row.content.length / 4),
          hasEmbedding: false,
          createdAt:    row.createdAt,
        })
      }
    }

    const documents = [...docMap.values()].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    )

    res.json({ documents, total: documents.length })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /ai-suite/knowledge/text ─────────────────────────────────────────────

router.post('/text', async (req, res) => {
  try {
    const { title, content } = req.body
    if (!title || !content) return res.status(400).json({ error: 'title and content required' })

    await ingestText(title as string, content as string)
    res.json({ success: true, message: `Ingested "${title}" into the knowledge base` })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /ai-suite/knowledge/url ──────────────────────────────────────────────

router.post('/url', async (req, res) => {
  try {
    const { url } = req.body
    if (!url) return res.status(400).json({ error: 'url required' })

    await ingestUrl(url as string)
    res.json({ success: true, message: `Crawled and ingested: ${url}` })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /ai-suite/knowledge/file (alias: /upload) ────────────────────────────

router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
    const file  = req.file
    const title = (req.body.title as string | undefined) || file.originalname
    await ingestFile(title, file.mimetype, file.buffer)
    res.json({ success: true, message: `Ingested file: ${file.originalname}` })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/file', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

    const file  = req.file
    const title = (req.body.title as string | undefined) || file.originalname

    await ingestFile(title, file.mimetype, file.buffer)
    res.json({ success: true, message: `Ingested file: ${file.originalname}` })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── DELETE /ai-suite/knowledge/:id ────────────────────────────────────────────
// Deletes the target row and every other row that shares the same title
// (i.e. all chunks belonging to the same document).

router.delete('/:id', async (req, res) => {
  try {
    const target = await prisma.aiKnowledgeBase.findUnique({ where: { id: req.params.id } })
    if (!target) return res.status(404).json({ error: 'Not found' })

    await prisma.aiKnowledgeBase.deleteMany({ where: { title: target.title } })
    res.json({ success: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router
