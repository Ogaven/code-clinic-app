import { Router, Request, Response } from 'express'
import multer from 'multer'
import { requireAuth } from '../../middleware/auth'
import { clinicalStaff } from '../../middleware/rbac'
import { prisma } from '../../lib/prisma'
import { uploadFile, downloadFile, deleteFile } from '../../services/storage/r2'
import { validateUpload, sanitizeFilename, buildStorageKey, sha256Hex, UploadCategory } from './upload-validation'
import { extractFromImage, transcribeAudio, extractFromVideo, extractFromDocx, extractFromPdf } from './media-extract.service'
import { ingestExtractedText } from './knowledge-ingest.service'

const router = Router()

// Largest allowed category (VIDEO, see upload-validation.ts) sets the multer
// ceiling; validateUpload() enforces the real per-category limit afterwards.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 250 * 1024 * 1024 } })

// multer errors (e.g. LIMIT_FILE_SIZE) throw before the route handler runs —
// without this they'd fall through to main.ts's generic 500 handler as an
// unhelpful "Internal server error" instead of a clear, specific message.
function handleUpload(req: Request, res: Response, next: (err?: any) => void) {
  upload.single('file')(req, res, (err: any) => {
    if (!err) return next()
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File is too large (250MB max)' })
    console.error('[Knowledge Ingest] multer error:', err.message)
    res.status(400).json({ error: 'Upload failed — the file could not be read' })
  })
}

// ─────────────────────────────────────────────────────────────────────────
// MULTIMEDIA KNOWLEDGE INGESTION
//
// FILE -> validate -> secure upload -> extract/transcribe -> preview ->
// staff confirms -> chunk/index/save to AiKnowledgeBase.
//
// Visibility matches the AiKnowledgeBase model this feeds into: shared,
// clinic-wide, gated by requireAuth + clinicalStaff only (see the schema
// comment on AiKnowledgeIngestion for why — not per-uploader like Knowledge
// Studio's own conversations). Never exposed to anyone who isn't clinical
// staff; unauthenticated or non-staff requests never reach these handlers.
// ─────────────────────────────────────────────────────────────────────────
router.use(requireAuth, clinicalStaff)

const MAX_TITLE_CHARS = 200
const MAX_CONTENT_CHARS = 200_000 // generous ceiling for edited preview text — well below anything that would produce an unreasonable number of chunks

function kbTypeFor(category: UploadCategory, ext: string): string {
  if (category === 'DOCUMENT') return ext === 'docx' ? 'DOCX' : ext === 'pdf' ? 'PDF' : 'TEXT'
  return category // IMAGE | AUDIO | VIDEO
}

const IMAGE_MIME_BY_EXT: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }

async function runExtraction(id: string, category: UploadCategory, ext: string, mimeType: string, buffer: Buffer, filename: string) {
  try {
    let text: string
    if (category === 'DOCUMENT') {
      if (ext === 'pdf') {
        text = await extractFromPdf(buffer)
      } else if (ext === 'docx') {
        text = await extractFromDocx(buffer)
      } else {
        text = buffer.toString('utf-8')
      }
    } else if (category === 'IMAGE') {
      text = await extractFromImage(buffer, IMAGE_MIME_BY_EXT[ext] || mimeType)
    } else if (category === 'AUDIO') {
      text = await transcribeAudio(buffer, filename)
    } else {
      text = await extractFromVideo(buffer, filename)
    }

    text = (text || '').trim()
    if (!text) throw new Error('No usable text could be extracted from this file.')
    if (text.length > MAX_CONTENT_CHARS) text = text.slice(0, MAX_CONTENT_CHARS)

    await prisma.aiKnowledgeIngestion.update({
      where: { id },
      data: { status: 'EXTRACTED', extractedTitle: filename, extractedText: text, errorMessage: null },
    })
  } catch (err: any) {
    console.error('[Knowledge Ingest] extraction failed:', err.message)
    await prisma.aiKnowledgeIngestion.update({
      where: { id },
      data: { status: 'FAILED', errorMessage: String(err.message || 'Extraction failed').slice(0, 500) },
    })
  }
}

// ── POST /ai-suite/knowledge/ingest/upload ─────────────────────────────────
// Validates, uploads to storage, then extracts SYNCHRONOUSLY before
// responding — simplest correct implementation given no background job
// queue exists in this codebase today. This is fine for documents/images/
// audio; a large video's ffmpeg + Whisper round trip can take a while and a
// reverse proxy with an aggressive timeout could cut the request short
// before extraction finishes (the upload and DB row are still safely
// persisted either way — see PROCESSING status below — so nothing is lost,
// but the client wouldn't get the EXTRACTED result in that one response).
// Flagged in the final report as a scaling follow-up, not fixed here.
router.post('/upload', handleUpload, async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
    const file = req.file

    const check = validateUpload(file.originalname, file.mimetype, file.size)
    if (!check.ok) return res.status(400).json({ error: check.error })
    const category = check.category!
    const ext = check.extension!

    const sanitized = sanitizeFilename(file.originalname)
    const hash = sha256Hex(file.buffer)

    // Duplicate protection — informational, not blocking (a genuine
    // updated re-upload of the same source file is legitimate).
    const existingConfirmed = await prisma.aiKnowledgeIngestion.findFirst({
      where: { sha256: hash, status: 'CONFIRMED' },
      orderBy: { confirmedAt: 'desc' },
      select: { extractedTitle: true, confirmedAt: true },
    })

    const r2Key = buildStorageKey(category, sanitized)
    await uploadFile(file.buffer, file.mimetype, r2Key)

    const row = await prisma.aiKnowledgeIngestion.create({
      data: {
        createdBy: req.user!.id,
        originalFilename: file.originalname.slice(0, 300),
        sanitizedFilename: sanitized,
        mimeType: file.mimetype || 'application/octet-stream',
        category,
        sizeBytes: file.size,
        sha256: hash,
        r2Key,
        status: 'PROCESSING',
      },
    })

    await runExtraction(row.id, category, ext, file.mimetype, file.buffer, file.originalname)
    const final = await prisma.aiKnowledgeIngestion.findUnique({ where: { id: row.id } })

    res.status(201).json({
      ingestion: final,
      duplicateOf: existingConfirmed
        ? { title: existingConfirmed.extractedTitle, confirmedAt: existingConfirmed.confirmedAt }
        : null,
    })
  } catch (err: any) {
    console.error('[Knowledge Ingest] upload error:', err.message)
    res.status(500).json({ error: 'Upload failed. Please try again.' })
  }
})

// ── GET /ai-suite/knowledge/ingest ─────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined
    const rows = await prisma.aiKnowledgeIngestion.findMany({
      where: status ? { status } : { status: { not: 'CONFIRMED' } }, // confirmed rows are audit trail, not an active queue — hidden by default
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    res.json({ ingestions: rows })
  } catch (err: any) {
    console.error('[Knowledge Ingest] list error:', err.message)
    res.status(500).json({ error: 'Failed to load uploads' })
  }
})

// ── GET /ai-suite/knowledge/ingest/:id ─────────────────────────────────────
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const row = await prisma.aiKnowledgeIngestion.findUnique({ where: { id: req.params.id } })
    if (!row) return res.status(404).json({ error: 'Upload not found' })
    res.json({ ingestion: row })
  } catch (err: any) {
    console.error('[Knowledge Ingest] get error:', err.message)
    res.status(500).json({ error: 'Failed to load upload' })
  }
})

// ── PATCH /ai-suite/knowledge/ingest/:id ───────────────────────────────────
// Staff can edit the extracted title/text before confirming — the preview
// is a draft, not a fait accompli.
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const row = await prisma.aiKnowledgeIngestion.findUnique({ where: { id: req.params.id } })
    if (!row) return res.status(404).json({ error: 'Upload not found' })
    if (row.status !== 'EXTRACTED') return res.status(400).json({ error: 'Only an extracted preview can be edited' })

    const data: { extractedTitle?: string; extractedText?: string } = {}
    if ('extractedTitle' in (req.body || {})) {
      const t = req.body.extractedTitle
      if (typeof t !== 'string' || !t.trim()) return res.status(400).json({ error: 'extractedTitle must be a non-empty string' })
      if (t.length > MAX_TITLE_CHARS) return res.status(400).json({ error: `Title is too long (${MAX_TITLE_CHARS} char max)` })
      data.extractedTitle = t.trim()
    }
    if ('extractedText' in (req.body || {})) {
      const c = req.body.extractedText
      if (typeof c !== 'string' || !c.trim()) return res.status(400).json({ error: 'extractedText must be a non-empty string' })
      if (c.length > MAX_CONTENT_CHARS) return res.status(400).json({ error: 'Content is too long' })
      data.extractedText = c.trim()
    }
    if (Object.keys(data).length === 0) return res.status(400).json({ error: 'No valid fields to update' })

    const updated = await prisma.aiKnowledgeIngestion.update({ where: { id: row.id }, data })
    res.json({ ingestion: updated })
  } catch (err: any) {
    console.error('[Knowledge Ingest] update error:', err.message)
    res.status(500).json({ error: 'Failed to update preview' })
  }
})

// ── POST /ai-suite/knowledge/ingest/:id/retry ──────────────────────────────
// Re-runs extraction on the ALREADY-UPLOADED file — no re-upload needed.
// Only valid from FAILED (retrying an EXTRACTED or CONFIRMED row would be
// meaningless / could duplicate confirmed knowledge).
router.post('/:id/retry', async (req: Request, res: Response) => {
  try {
    const row = await prisma.aiKnowledgeIngestion.findUnique({ where: { id: req.params.id } })
    if (!row) return res.status(404).json({ error: 'Upload not found' })
    if (row.status !== 'FAILED') return res.status(400).json({ error: 'Only a failed upload can be retried' })

    await prisma.aiKnowledgeIngestion.update({ where: { id: row.id }, data: { status: 'PROCESSING', errorMessage: null } })

    const buffer = await downloadFile(row.r2Key)
    const ext = row.originalFilename.split('.').pop()?.toLowerCase() || ''
    await runExtraction(row.id, row.category as UploadCategory, ext, row.mimeType, buffer, row.originalFilename)

    const final = await prisma.aiKnowledgeIngestion.findUnique({ where: { id: row.id } })
    res.json({ ingestion: final })
  } catch (err: any) {
    console.error('[Knowledge Ingest] retry error:', err.message)
    await prisma.aiKnowledgeIngestion.update({ where: { id: req.params.id }, data: { status: 'FAILED', errorMessage: 'Retry failed. Please try again.' } }).catch(() => {})
    res.status(500).json({ error: 'Retry failed. Please try again.' })
  }
})

// ── POST /ai-suite/knowledge/ingest/:id/confirm ────────────────────────────
// The ONLY path by which anything from this staging table ever becomes real,
// retrievable AiKnowledgeBase content. Nothing saves silently.
router.post('/:id/confirm', async (req: Request, res: Response) => {
  try {
    const row = await prisma.aiKnowledgeIngestion.findUnique({ where: { id: req.params.id } })
    if (!row) return res.status(404).json({ error: 'Upload not found' })
    if (row.status !== 'EXTRACTED') return res.status(400).json({ error: 'Only an extracted preview can be confirmed' })
    if (!row.extractedText || !row.extractedTitle) return res.status(400).json({ error: 'Nothing to confirm — extraction produced no content' })

    const ext = row.originalFilename.split('.').pop()?.toLowerCase() || ''
    const kbType = kbTypeFor(row.category as UploadCategory, ext)

    const chunkCount = await ingestExtractedText(row.extractedTitle, row.extractedText, kbType, row.r2Key)

    const updated = await prisma.aiKnowledgeIngestion.update({
      where: { id: row.id },
      data: { status: 'CONFIRMED', confirmedAt: new Date() },
    })

    res.json({ ingestion: updated, chunkCount })
  } catch (err: any) {
    console.error('[Knowledge Ingest] confirm error:', err.message)
    res.status(500).json({ error: 'Failed to save to the knowledge base' })
  }
})

// ── DELETE /ai-suite/knowledge/ingest/:id ──────────────────────────────────
// Discards a pending/extracted/failed upload (never a CONFIRMED one — that's
// real knowledge now and is deleted via DELETE /ai-suite/knowledge/:id like
// any other source instead). Also removes the underlying stored file.
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const row = await prisma.aiKnowledgeIngestion.findUnique({ where: { id: req.params.id } })
    if (!row) return res.status(404).json({ error: 'Upload not found' })
    if (row.status === 'CONFIRMED') return res.status(400).json({ error: 'This has already been saved to the knowledge base — delete it from the knowledge base list instead' })

    await prisma.aiKnowledgeIngestion.delete({ where: { id: row.id } })
    await deleteFile(row.r2Key).catch(() => {}) // best-effort — a dangling R2 object is not worth failing the request over

    res.json({ success: true })
  } catch (err: any) {
    console.error('[Knowledge Ingest] delete error:', err.message)
    res.status(500).json({ error: 'Failed to delete upload' })
  }
})

export default router
