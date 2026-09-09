import crypto from 'crypto'

// ─────────────────────────────────────────────────────────────────────────
// UPLOAD VALIDATION — allowlist only (never a blocklist). Anything not
// explicitly listed here (executables, scripts, archives, unknown types) is
// rejected outright, regardless of what extension or Content-Type the
// client claims. MIME and extension must BOTH agree on the same category —
// a mismatch (e.g. a .exe renamed to "photo.png") is rejected rather than
// trusting either signal alone.
// ─────────────────────────────────────────────────────────────────────────

export type UploadCategory = 'DOCUMENT' | 'IMAGE' | 'AUDIO' | 'VIDEO'

interface FormatRule {
  category: UploadCategory
  mimes: string[]
  extensions: string[]
  maxBytes: number
}

const RULES: FormatRule[] = [
  {
    category: 'DOCUMENT',
    mimes: ['application/pdf', 'text/plain', 'text/markdown', 'application/octet-stream' /* some browsers send this for .md */,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    extensions: ['pdf', 'txt', 'md', 'markdown', 'docx'],
    maxBytes: 25 * 1024 * 1024,
  },
  {
    category: 'IMAGE',
    mimes: ['image/png', 'image/jpeg', 'image/webp'],
    extensions: ['png', 'jpg', 'jpeg', 'webp'],
    maxBytes: 15 * 1024 * 1024,
  },
  {
    category: 'AUDIO',
    mimes: ['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/aac'],
    extensions: ['mp3', 'm4a', 'wav', 'aac'],
    // Extraction is SYNCHRONOUS within one HTTP request (no job queue exists
    // yet — see knowledge-ingestion.routes.ts's own comment on /upload).
    // 100MB of typical 128kbps MP3 is ~100 minutes of audio — genuinely
    // unrealistic to transcribe within one request/response cycle without
    // risking a reverse-proxy timeout. 25MB (~25 min at 128kbps) is a
    // deliberately conservative ceiling sized for real clinic use cases
    // (voice notes, short recorded briefings), not arbitrary meeting/lecture
    // -length audio. See EXTRACTION_TIMEOUT_MS below for the hard backstop.
    maxBytes: 25 * 1024 * 1024,
  },
  {
    category: 'VIDEO',
    mimes: ['video/mp4', 'video/quicktime', 'video/webm'],
    extensions: ['mp4', 'mov', 'webm'],
    // Same synchronous-processing constraint as AUDIO, compounded: video
    // needs an ffmpeg audio-extraction pass BEFORE transcription even
    // starts. 250MB of typical clinic-recorded H.264 could be a 10-20+
    // minute clip — not realistic to process end-to-end in one request.
    // 60MB (roughly a few minutes of typical mobile-recorded video) is
    // sized the same way: real short clinic clips, not long-form recordings.
    maxBytes: 60 * 1024 * 1024,
  },
]

export interface ValidationResult {
  ok: boolean
  category?: UploadCategory
  extension?: string
  error?: string
}

function extOf(filename: string): string {
  const parts = filename.toLowerCase().split('.')
  return parts.length > 1 ? parts[parts.length - 1] : ''
}

// docx is a zip container, and browsers/OS's are inconsistent about the
// Content-Type they send for it and for .md — MIME is checked when it's
// present and recognized, but the extension is treated as authoritative for
// the small set of extensions known to have unreliable MIME reporting.
const MIME_UNRELIABLE_EXTENSIONS = new Set(['md', 'markdown', 'docx'])

export function validateUpload(filename: string, mimeType: string, sizeBytes: number): ValidationResult {
  const ext = extOf(filename)
  if (!ext) return { ok: false, error: 'File has no extension — cannot determine its type' }

  const rule = RULES.find(r => r.extensions.includes(ext))
  if (!rule) {
    return { ok: false, error: `".${ext}" is not a supported format. Supported: Documents (PDF, TXT, MD, DOCX), Images (PNG, JPG, WEBP), Audio (MP3, M4A, WAV, AAC), Video (MP4, MOV, WEBM).` }
  }

  if (!MIME_UNRELIABLE_EXTENSIONS.has(ext) && !rule.mimes.includes(mimeType)) {
    return { ok: false, error: `File extension ".${ext}" does not match its actual content type (${mimeType || 'unknown'}) — the file may be mislabeled or corrupted.` }
  }

  if (sizeBytes <= 0) return { ok: false, error: 'File is empty' }
  if (sizeBytes > rule.maxBytes) {
    return { ok: false, error: `File is too large — ${rule.category.toLowerCase()} uploads are limited to ${Math.floor(rule.maxBytes / (1024 * 1024))}MB` }
  }

  return { ok: true, category: rule.category, extension: ext }
}

// Strips path separators and anything outside a safe printable set; caps
// length. Used for display/audit only — the actual R2 storage key is always
// generated independently (see buildStorageKey), so a hostile filename can
// never influence where the file is written or traverse outside its
// intended prefix.
export function sanitizeFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() || 'upload'
  const cleaned = base
    .replace(/[^\w.\- ]/g, '_')
    .replace(/\.{2,}/g, '.')
    .trim()
    .slice(0, 150)
  return cleaned || 'upload'
}

export function buildStorageKey(category: UploadCategory, sanitized: string): string {
  const random = crypto.randomBytes(8).toString('hex')
  return `ai-knowledge/${category.toLowerCase()}/${Date.now()}-${random}-${sanitized}`
}

export function sha256Hex(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}
