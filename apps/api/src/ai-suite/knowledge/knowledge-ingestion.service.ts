import type { PrismaClient } from '@prisma/client'
import { downloadFile, deleteFile } from '../../services/storage/r2'
import { UploadCategory } from './upload-validation'
import { extractFromImage, transcribeAudio, extractFromVideo, extractFromDocx, extractFromPdf } from './media-extract.service'
import { ingestExtractedText } from './knowledge-ingest.service'

// ─────────────────────────────────────────────────────────────────────────
// STATE-MACHINE LOGIC for AiKnowledgeIngestion, extracted out of
// knowledge-ingestion.routes.ts so it can be unit tested with a mocked
// PrismaClient (matching this codebase's existing pattern — see
// __tests__/doctor-access.test.ts) instead of requiring a live DB or a full
// Express app + supertest.
//
// Valid transitions:
//   PROCESSING -> EXTRACTED   (extraction succeeded)
//   PROCESSING -> FAILED      (extraction threw)
//   FAILED     -> PROCESSING -> EXTRACTED | FAILED   (retry)
//   EXTRACTED  -> CONFIRMED   (confirm — the ONLY path into AiKnowledgeBase)
//   EXTRACTED  -> (deleted)   (discard)
//   FAILED     -> (deleted)   (discard)
//   PROCESSING -> (deleted)   (discard — e.g. abandoned)
// CONFIRMED is a terminal state: never re-enters PROCESSING/EXTRACTED/FAILED,
// and is never deleted via discardIngestion (see discardIngestion below).
// ─────────────────────────────────────────────────────────────────────────

type PrismaLike = Pick<PrismaClient, 'aiKnowledgeIngestion'>

const MAX_TITLE_CHARS = 200
const MAX_CONTENT_CHARS = 200_000

export function kbTypeFor(category: UploadCategory, ext: string): string {
  if (category === 'DOCUMENT') return ext === 'docx' ? 'DOCX' : ext === 'pdf' ? 'PDF' : 'TEXT'
  return category // IMAGE | AUDIO | VIDEO
}

const IMAGE_MIME_BY_EXT: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }

// Explicit backstop for the two extraction paths that can genuinely run
// long (ffmpeg + Whisper for video, Whisper alone for audio) — this whole
// pipeline runs synchronously inside one HTTP request (no job queue exists
// yet), so a slow provider response or an unexpectedly long file must fail
// cleanly with a clear message rather than hang until a reverse proxy kills
// the connection with an opaque 502/504. The upload size limits
// (upload-validation.ts) are chosen to make 90s comfortable for the real
// clinic-length clips this feature targets; this is the hard stop for
// whatever gets through anyway (a slow provider, an edge-case file).
const EXTRACTION_TIMEOUT_MS = 90_000

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Processing timed out after ${Math.round(ms / 1000)}s — please try a shorter ${label}.`)), ms)),
  ])
}

// Injectable so tests can swap in fakes without ever calling OpenAI/ffmpeg.
export interface Extractors {
  extractFromPdf: typeof extractFromPdf
  extractFromDocx: typeof extractFromDocx
  extractFromImage: typeof extractFromImage
  transcribeAudio: typeof transcribeAudio
  extractFromVideo: typeof extractFromVideo
}
export const defaultExtractors: Extractors = { extractFromPdf, extractFromDocx, extractFromImage, transcribeAudio, extractFromVideo }

export async function runExtraction(
  prisma: PrismaLike,
  id: string,
  category: UploadCategory,
  ext: string,
  mimeType: string,
  buffer: Buffer,
  filename: string,
  extractors: Extractors = defaultExtractors,
): Promise<void> {
  try {
    let text: string
    if (category === 'DOCUMENT') {
      if (ext === 'pdf') text = await extractors.extractFromPdf(buffer)
      else if (ext === 'docx') text = await extractors.extractFromDocx(buffer)
      else text = buffer.toString('utf-8')
    } else if (category === 'IMAGE') {
      text = await extractors.extractFromImage(buffer, IMAGE_MIME_BY_EXT[ext] || mimeType)
    } else if (category === 'AUDIO') {
      text = await withTimeout(extractors.transcribeAudio(buffer, filename), EXTRACTION_TIMEOUT_MS, 'audio clip')
    } else {
      text = await withTimeout(extractors.extractFromVideo(buffer, filename), EXTRACTION_TIMEOUT_MS, 'video')
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

export type PatchResult =
  | { ok: true; ingestion: any }
  | { ok: false; status: 404 | 400; error: string }

export async function updatePreview(prisma: PrismaLike, id: string, body: any): Promise<PatchResult> {
  const row = await prisma.aiKnowledgeIngestion.findUnique({ where: { id } })
  if (!row) return { ok: false, status: 404, error: 'Upload not found' }
  if (row.status !== 'EXTRACTED') return { ok: false, status: 400, error: 'Only an extracted preview can be edited' }

  const data: { extractedTitle?: string; extractedText?: string } = {}
  if ('extractedTitle' in (body || {})) {
    const t = body.extractedTitle
    if (typeof t !== 'string' || !t.trim()) return { ok: false, status: 400, error: 'extractedTitle must be a non-empty string' }
    if (t.length > MAX_TITLE_CHARS) return { ok: false, status: 400, error: `Title is too long (${MAX_TITLE_CHARS} char max)` }
    data.extractedTitle = t.trim()
  }
  if ('extractedText' in (body || {})) {
    const c = body.extractedText
    if (typeof c !== 'string' || !c.trim()) return { ok: false, status: 400, error: 'extractedText must be a non-empty string' }
    if (c.length > MAX_CONTENT_CHARS) return { ok: false, status: 400, error: 'Content is too long' }
    data.extractedText = c.trim()
  }
  if (Object.keys(data).length === 0) return { ok: false, status: 400, error: 'No valid fields to update' }

  const updated = await prisma.aiKnowledgeIngestion.update({ where: { id }, data })
  return { ok: true, ingestion: updated }
}

export type RetryResult =
  | { ok: true; ingestion: any }
  | { ok: false; status: 404 | 400 | 500; error: string }

export async function retryIngestion(
  prisma: PrismaLike,
  id: string,
  downloadFn: typeof downloadFile = downloadFile,
  extractors: Extractors = defaultExtractors,
): Promise<RetryResult> {
  const row = await prisma.aiKnowledgeIngestion.findUnique({ where: { id } })
  if (!row) return { ok: false, status: 404, error: 'Upload not found' }
  if (row.status !== 'FAILED') return { ok: false, status: 400, error: 'Only a failed upload can be retried' }

  await prisma.aiKnowledgeIngestion.update({ where: { id }, data: { status: 'PROCESSING', errorMessage: null } })

  try {
    const buffer = await downloadFn(row.r2Key)
    const ext = row.originalFilename.split('.').pop()?.toLowerCase() || ''
    await runExtraction(prisma, id, row.category as UploadCategory, ext, row.mimeType, buffer, row.originalFilename, extractors)
    const final = await prisma.aiKnowledgeIngestion.findUnique({ where: { id } })
    return { ok: true, ingestion: final }
  } catch (err: any) {
    console.error('[Knowledge Ingest] retry error:', err.message)
    await prisma.aiKnowledgeIngestion.update({ where: { id }, data: { status: 'FAILED', errorMessage: 'Retry failed. Please try again.' } }).catch(() => {})
    return { ok: false, status: 500, error: 'Retry failed. Please try again.' }
  }
}

export type ConfirmResult =
  | { ok: true; ingestion: any; chunkCount: number }
  | { ok: false; status: 404 | 400 | 409 | 500; error: string }

// IDEMPOTENCY: two concurrent Confirm requests for the same row must never
// both write to AiKnowledgeBase. The claim step is a single atomic
// UPDATE ... WHERE id = ? AND status = 'EXTRACTED' — Postgres serializes
// concurrent UPDATEs to the same row (the second one blocks until the first
// commits, then re-evaluates the WHERE clause against the now-committed
// status), so at most ONE concurrent request can ever see count === 1. No
// advisory lock or schema change needed — this is the same guarantee a
// unique-constraint-based idempotency key would give, expressed as a
// conditional update on the row's own status column.
export async function confirmIngestion(prisma: PrismaLike, id: string, ingestFn: typeof ingestExtractedText = ingestExtractedText): Promise<ConfirmResult> {
  const preCheck = await prisma.aiKnowledgeIngestion.findUnique({ where: { id } })
  if (!preCheck) return { ok: false, status: 404, error: 'Upload not found' }
  if (preCheck.status === 'CONFIRMED') return { ok: false, status: 409, error: 'This upload has already been saved to the knowledge base' }
  if (preCheck.status !== 'EXTRACTED') return { ok: false, status: 400, error: 'Only an extracted preview can be confirmed' }

  const claim = await prisma.aiKnowledgeIngestion.updateMany({
    where: { id, status: 'EXTRACTED' },
    data: { status: 'CONFIRMED', confirmedAt: new Date() },
  })
  if (claim.count === 0) {
    // Lost the race to a concurrent Confirm (or state changed underneath us
    // between the pre-check and the claim) — NOT an error to the caller
    // that lost the race, since the content genuinely IS saved by now.
    const current = await prisma.aiKnowledgeIngestion.findUnique({ where: { id } })
    if (current?.status === 'CONFIRMED') return { ok: false, status: 409, error: 'This upload has already been saved to the knowledge base' }
    return { ok: false, status: 400, error: 'Only an extracted preview can be confirmed' }
  }

  // From here on, THIS request is the exclusive owner of the CONFIRMED
  // transition — read the row fresh (picks up any edit that landed between
  // the pre-check and the claim; PATCH itself is blocked from touching it
  // further now that status is no longer 'EXTRACTED').
  const claimed = await prisma.aiKnowledgeIngestion.findUnique({ where: { id } })
  if (!claimed?.extractedText || !claimed?.extractedTitle) {
    // Shouldn't happen (PATCH requires non-empty values), but never write
    // empty "knowledge" — revert so the row is retryable instead of stuck
    // as a confirmed-but-empty ghost.
    await prisma.aiKnowledgeIngestion.update({ where: { id }, data: { status: 'EXTRACTED' } }).catch(() => {})
    return { ok: false, status: 400, error: 'Nothing to confirm — extraction produced no content' }
  }

  try {
    const ext = claimed.originalFilename.split('.').pop()?.toLowerCase() || ''
    const kbType = kbTypeFor(claimed.category as UploadCategory, ext)
    const chunkCount = await ingestFn(claimed.extractedTitle, claimed.extractedText, kbType, claimed.r2Key)
    return { ok: true, ingestion: claimed, chunkCount }
  } catch (err: any) {
    // The status flip already committed but the KB write failed — revert to
    // EXTRACTED (with a visible error) rather than leaving a CONFIRMED row
    // with no matching AiKnowledgeBase rows, so staff can simply try Confirm
    // again instead of the upload silently vanishing into a broken state.
    console.error('[Knowledge Ingest] confirm KB write failed, reverting:', err.message)
    await prisma.aiKnowledgeIngestion.update({
      where: { id },
      data: { status: 'EXTRACTED', confirmedAt: null, errorMessage: 'Failed to save to the knowledge base — please try Confirm again.' },
    }).catch(() => {})
    return { ok: false, status: 500, error: 'Failed to save to the knowledge base. Please try Confirm again.' }
  }
}

export type DiscardResult =
  | { ok: true }
  | { ok: false; status: 404 | 400; error: string }

export async function discardIngestion(prisma: PrismaLike, id: string, deleteFn: typeof deleteFile = deleteFile): Promise<DiscardResult> {
  const row = await prisma.aiKnowledgeIngestion.findUnique({ where: { id } })
  if (!row) return { ok: false, status: 404, error: 'Upload not found' }
  if (row.status === 'CONFIRMED') {
    return { ok: false, status: 400, error: 'This has already been saved to the knowledge base — delete it from the knowledge base list instead' }
  }

  // Delete the DB row FIRST, storage second — if storage deletion fails we
  // end up with an orphaned R2 object (harmless, invisible, cleanable
  // later) rather than a DB row pointing at nothing with no way to retry
  // the discard (the row is already gone, so a retry would 404 anyway; the
  // R2 object is the only thing that could dangle, and best-effort cleanup
  // here still fires).
  await prisma.aiKnowledgeIngestion.delete({ where: { id } })
  await deleteFn(row.r2Key).catch((err: any) => {
    console.error('[Knowledge Ingest] failed to delete storage object (orphaned, non-fatal):', row.r2Key, err.message)
  })
  return { ok: true }
}
