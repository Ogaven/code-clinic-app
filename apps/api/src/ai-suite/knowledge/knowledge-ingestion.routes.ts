import { Router, Request, Response } from 'express'
import multer from 'multer'
import { requireAuth } from '../../middleware/auth'
import { clinicalStaff } from '../../middleware/rbac'
import { prisma } from '../../lib/prisma'
import { uploadFile, deleteFile } from '../../services/storage/r2'
import { validateUpload, sanitizeFilename, buildStorageKey, sha256Hex } from './upload-validation'
import { runExtraction, updatePreview, retryIngestion, confirmIngestion, discardIngestion } from './knowledge-ingestion.service'

const router = Router()

// Largest allowed category (VIDEO, see upload-validation.ts) sets the multer
// ceiling; validateUpload() enforces the real per-category limit afterwards.
const MAX_UPLOAD_BYTES = 60 * 1024 * 1024
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } })

// multer errors (e.g. LIMIT_FILE_SIZE) throw before the route handler runs —
// without this they'd fall through to main.ts's generic 500 handler as an
// unhelpful "Internal server error" instead of a clear, specific message.
function handleUpload(req: Request, res: Response, next: (err?: any) => void) {
  upload.single('file')(req, res, (err: any) => {
    if (!err) return next()
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: `File is too large (${MAX_UPLOAD_BYTES / (1024 * 1024)}MB max)` })
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
// This router.use() applies to EVERY route below (Express middleware
// ordering — a router.use() with no path covers everything registered
// after it in the same router) — see
// __tests__/knowledge-ingestion.routes.test.ts's "router wiring" test for
// an explicit structural assertion of this.
//
// The state-machine logic (extraction dispatch, confirm/retry/discard, with
// the idempotency and error-recovery guarantees that need testing without a
// live DB) lives in knowledge-ingestion.service.ts — these handlers are
// thin: parse the request, call the service, map the result to HTTP.
// ─────────────────────────────────────────────────────────────────────────
router.use(requireAuth, clinicalStaff)

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

    // The row is persisted BEFORE extraction runs — if extraction crashes
    // unexpectedly (not caught inside runExtraction, e.g. a process-level
    // error), the row still exists as PROCESSING rather than being lost,
    // and is visible in the queue for staff to retry or discard.
    //
    // R2 and Postgres aren't in one transaction, so if the DB write below
    // fails AFTER the upload above already succeeded, the file would
    // otherwise be orphaned in storage forever with nothing in the DB ever
    // pointing at it (it can't even be discarded — there'd be no row to
    // discard). Compensating delete closes that gap: best-effort, and if
    // IT also fails we've lost nothing we didn't already lose (the DB
    // write failed either way, so the request fails and reports an error
    // regardless).
    let row
    try {
      row = await prisma.aiKnowledgeIngestion.create({
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
    } catch (createErr) {
      await deleteFile(r2Key).catch(err => console.error('[Knowledge Ingest] orphan cleanup failed for', r2Key, err.message))
      throw createErr
    }

    await runExtraction(prisma, row.id, category, ext, file.mimetype, file.buffer, file.originalname)
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
    const result = await updatePreview(prisma, req.params.id, req.body)
    if (!result.ok) return res.status(result.status).json({ error: result.error })
    res.json({ ingestion: result.ingestion })
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
    const result = await retryIngestion(prisma, req.params.id)
    if (!result.ok) return res.status(result.status).json({ error: result.error })
    res.json({ ingestion: result.ingestion })
  } catch (err: any) {
    console.error('[Knowledge Ingest] retry error:', err.message)
    res.status(500).json({ error: 'Retry failed. Please try again.' })
  }
})

// ── POST /ai-suite/knowledge/ingest/:id/confirm ────────────────────────────
// The ONLY path by which anything from this staging table ever becomes real,
// retrievable AiKnowledgeBase content. Nothing saves silently. See
// confirmIngestion() in knowledge-ingestion.service.ts for the atomic
// claim that makes this safe against concurrent double-confirm.
router.post('/:id/confirm', async (req: Request, res: Response) => {
  try {
    const result = await confirmIngestion(prisma, req.params.id)
    if (!result.ok) return res.status(result.status).json({ error: result.error })
    res.json({ ingestion: result.ingestion, chunkCount: result.chunkCount })
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
    const result = await discardIngestion(prisma, req.params.id)
    if (!result.ok) return res.status(result.status).json({ error: result.error })
    res.json({ success: true })
  } catch (err: any) {
    console.error('[Knowledge Ingest] delete error:', err.message)
    res.status(500).json({ error: 'Failed to delete upload' })
  }
})

export default router
