import { describe, expect, it, vi } from 'vitest'
import {
  runExtraction, updatePreview, retryIngestion, confirmIngestion, discardIngestion,
  type Extractors,
} from '../ai-suite/knowledge/knowledge-ingestion.service'

// Minimal fake AiKnowledgeIngestion table — enough to exercise every code
// path in the service without a live Postgres connection. updateMany()
// deliberately mirrors real Postgres semantics for this use case: an UPDATE
// with a WHERE clause on the row's OWN current state only matches (and
// mutates) if that state still holds, which is exactly what makes the
// confirm-idempotency guarantee testable here.
function makeFakePrisma(seed: any[] = []) {
  const rows = seed.map(r => ({ ...r }))
  const prisma = {
    aiKnowledgeIngestion: {
      findUnique: vi.fn(async ({ where: { id } }: any) => rows.find(r => r.id === id) ?? null),
      findMany: vi.fn(async () => rows),
      create: vi.fn(async ({ data }: any) => { const row = { id: `ing-${rows.length + 1}`, ...data }; rows.push(row); return row }),
      update: vi.fn(async ({ where: { id }, data }: any) => {
        const row = rows.find(r => r.id === id)
        if (!row) throw new Error('Record not found')
        Object.assign(row, data)
        return { ...row }
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const matches = rows.filter(r => r.id === where.id && (where.status === undefined || r.status === where.status))
        for (const r of matches) Object.assign(r, data)
        return { count: matches.length }
      }),
      delete: vi.fn(async ({ where: { id } }: any) => {
        const idx = rows.findIndex(r => r.id === id)
        if (idx < 0) throw new Error('Record not found')
        return rows.splice(idx, 1)[0]
      }),
    },
  }
  return { prisma: prisma as any, rows }
}

const okExtractors: Extractors = {
  extractFromPdf: vi.fn(async () => 'extracted pdf text'),
  extractFromDocx: vi.fn(async () => 'extracted docx text'),
  extractFromImage: vi.fn(async () => 'extracted image text'),
  transcribeAudio: vi.fn(async () => 'extracted audio transcript'),
  extractFromVideo: vi.fn(async () => 'extracted video transcript'),
}

// ── State machine: extraction ───────────────────────────────────────────────
describe('runExtraction', () => {
  it('PROCESSING -> EXTRACTED on successful extraction', async () => {
    const { prisma, rows } = makeFakePrisma([{ id: 'a', status: 'PROCESSING' }])
    await runExtraction(prisma, 'a', 'DOCUMENT', 'pdf', 'application/pdf', Buffer.from(''), 'x.pdf', okExtractors)
    expect(rows[0].status).toBe('EXTRACTED')
    expect(rows[0].extractedText).toBe('extracted pdf text')
  })

  it('PROCESSING -> FAILED when the extractor throws, with a specific safe error message', async () => {
    const { prisma, rows } = makeFakePrisma([{ id: 'a', status: 'PROCESSING' }])
    const badExtractors: Extractors = { ...okExtractors, extractFromPdf: vi.fn(async () => { throw new Error('Failed to read this image. Please try again.') }) }
    await runExtraction(prisma, 'a', 'DOCUMENT', 'pdf', 'application/pdf', Buffer.from(''), 'x.pdf', badExtractors)
    expect(rows[0].status).toBe('FAILED')
    expect(rows[0].errorMessage).toContain('Failed to read this image')
  })

  it('empty transcription never becomes fake "successful" knowledge — status is FAILED, not EXTRACTED', async () => {
    const { prisma, rows } = makeFakePrisma([{ id: 'a', status: 'PROCESSING' }])
    const emptyAudio: Extractors = { ...okExtractors, transcribeAudio: vi.fn(async () => '') }
    await runExtraction(prisma, 'a', 'AUDIO', 'mp3', 'audio/mpeg', Buffer.from(''), 'x.mp3', emptyAudio)
    expect(rows[0].status).toBe('FAILED')
    expect(rows[0].extractedText).toBeUndefined()
  })

  it('empty vision response never becomes fake "successful" knowledge — status is FAILED, not EXTRACTED', async () => {
    const { prisma, rows } = makeFakePrisma([{ id: 'a', status: 'PROCESSING' }])
    const emptyVision: Extractors = { ...okExtractors, extractFromImage: vi.fn(async () => '   ') }
    await runExtraction(prisma, 'a', 'IMAGE', 'png', 'image/png', Buffer.from(''), 'x.png', emptyVision)
    expect(rows[0].status).toBe('FAILED')
  })

  it('a provider timeout/429/401 surfaces as FAILED with the sanitized message, not a stack trace or raw error', async () => {
    const { prisma, rows } = makeFakePrisma([{ id: 'a', status: 'PROCESSING' }])
    const rateLimited: Extractors = { ...okExtractors, transcribeAudio: vi.fn(async () => { throw new Error('The AI provider is temporarily busy — please retry transcribe this audio in a moment.') }) }
    await runExtraction(prisma, 'a', 'AUDIO', 'mp3', 'audio/mpeg', Buffer.from(''), 'x.mp3', rateLimited)
    expect(rows[0].status).toBe('FAILED')
    expect(rows[0].errorMessage).toBe('The AI provider is temporarily busy — please retry transcribe this audio in a moment.')
  })

  it('a video/audio extraction that never resolves is forced to FAILED by the 90s server-side timeout backstop, not left hanging', async () => {
    vi.useFakeTimers()
    try {
      const { prisma, rows } = makeFakePrisma([{ id: 'a', status: 'PROCESSING' }])
      const neverResolves: Extractors = { ...okExtractors, extractFromVideo: vi.fn(() => new Promise(() => {})) }

      const promise = runExtraction(prisma, 'a', 'VIDEO', 'mp4', 'video/mp4', Buffer.from(''), 'x.mp4', neverResolves)
      await vi.advanceTimersByTimeAsync(90_001)
      await promise

      expect(rows[0].status).toBe('FAILED')
      expect(rows[0].errorMessage).toContain('timed out')
    } finally {
      vi.useRealTimers()
    }
  })
})

// ── State machine: retry ────────────────────────────────────────────────────
describe('retryIngestion', () => {
  it('returns 404 for a nonexistent id', async () => {
    const { prisma } = makeFakePrisma([])
    const result = await retryIngestion(prisma, 'missing')
    expect(result).toEqual({ ok: false, status: 404, error: 'Upload not found' })
  })

  it('rejects retry from EXTRACTED (only FAILED can be retried)', async () => {
    const { prisma } = makeFakePrisma([{ id: 'a', status: 'EXTRACTED' }])
    const result = await retryIngestion(prisma, 'a')
    expect(result).toEqual({ ok: false, status: 400, error: 'Only a failed upload can be retried' })
  })

  it('rejects retry from CONFIRMED — cannot re-extract and cannot duplicate confirmed KB entries', async () => {
    const { prisma } = makeFakePrisma([{ id: 'a', status: 'CONFIRMED' }])
    const result = await retryIngestion(prisma, 'a')
    expect(result).toEqual({ ok: false, status: 400, error: 'Only a failed upload can be retried' })
  })

  it('FAILED -> PROCESSING -> EXTRACTED on a successful retry, re-downloading the already-uploaded file (no re-upload)', async () => {
    const { prisma, rows } = makeFakePrisma([{ id: 'a', status: 'FAILED', category: 'DOCUMENT', mimeType: 'application/pdf', r2Key: 'ai-knowledge/document/x.pdf', originalFilename: 'x.pdf' }])
    const downloadFn = vi.fn(async () => Buffer.from('pdf bytes'))
    const result = await retryIngestion(prisma, 'a', downloadFn, okExtractors)
    expect(downloadFn).toHaveBeenCalledWith('ai-knowledge/document/x.pdf')
    expect(result.ok).toBe(true)
    expect(rows[0].status).toBe('EXTRACTED')
  })

  it('FAILED -> PROCESSING -> FAILED again if the retry also fails', async () => {
    const { prisma, rows } = makeFakePrisma([{ id: 'a', status: 'FAILED', category: 'AUDIO', mimeType: 'audio/mpeg', r2Key: 'k', originalFilename: 'x.mp3' }])
    const downloadFn = vi.fn(async () => Buffer.from('audio bytes'))
    const stillBad: Extractors = { ...okExtractors, transcribeAudio: vi.fn(async () => { throw new Error('still busy') }) }
    const result = await retryIngestion(prisma, 'a', downloadFn, stillBad)
    expect(result.ok).toBe(true) // the retry REQUEST succeeded (it ran); the resulting state is FAILED
    expect(rows[0].status).toBe('FAILED')
  })
})

// ── State machine: confirm + idempotency (critical) ─────────────────────────
describe('confirmIngestion', () => {
  it('returns 404 for a nonexistent id', async () => {
    const { prisma } = makeFakePrisma([])
    const result = await confirmIngestion(prisma, 'missing')
    expect(result).toEqual({ ok: false, status: 404, error: 'Upload not found' })
  })

  it('rejects confirm from PROCESSING', async () => {
    const { prisma } = makeFakePrisma([{ id: 'a', status: 'PROCESSING' }])
    const result = await confirmIngestion(prisma, 'a')
    expect(result).toEqual({ ok: false, status: 400, error: 'Only an extracted preview can be confirmed' })
  })

  it('rejects confirm from FAILED', async () => {
    const { prisma } = makeFakePrisma([{ id: 'a', status: 'FAILED' }])
    const result = await confirmIngestion(prisma, 'a')
    expect(result).toEqual({ ok: false, status: 400, error: 'Only an extracted preview can be confirmed' })
  })

  it('a failed extraction never appears as successful knowledge — FAILED cannot be confirmed', async () => {
    const { prisma } = makeFakePrisma([{ id: 'a', status: 'FAILED', errorMessage: 'boom' }])
    const ingestFn = vi.fn()
    const result = await confirmIngestion(prisma, 'a', ingestFn)
    expect(result.ok).toBe(false)
    expect(ingestFn).not.toHaveBeenCalled()
  })

  it('EXTRACTED -> CONFIRMED on success, writing exactly one AiKnowledgeBase batch', async () => {
    const { prisma, rows } = makeFakePrisma([{ id: 'a', status: 'EXTRACTED', extractedTitle: 'T', extractedText: 'body text', category: 'DOCUMENT', originalFilename: 'x.pdf', r2Key: 'k' }])
    const ingestFn = vi.fn(async () => 3)
    const result = await confirmIngestion(prisma, 'a', ingestFn)
    expect(result).toEqual({ ok: true, ingestion: expect.objectContaining({ status: 'CONFIRMED' }), chunkCount: 3 })
    expect(ingestFn).toHaveBeenCalledTimes(1)
    expect(ingestFn).toHaveBeenCalledWith('T', 'body text', 'PDF', 'k')
    expect(rows[0].status).toBe('CONFIRMED')
    expect(rows[0].confirmedAt).toBeInstanceOf(Date)
  })

  it('CRITICAL: repeated Confirm requests on an already-CONFIRMED row cannot create duplicate AiKnowledgeBase entries', async () => {
    const { prisma, rows } = makeFakePrisma([{ id: 'a', status: 'EXTRACTED', extractedTitle: 'T', extractedText: 'body', category: 'DOCUMENT', originalFilename: 'x.pdf', r2Key: 'k' }])
    const ingestFn = vi.fn(async () => 2)

    const first = await confirmIngestion(prisma, 'a', ingestFn)
    const second = await confirmIngestion(prisma, 'a', ingestFn) // repeated call, e.g. a double-click or client retry
    const third = await confirmIngestion(prisma, 'a', ingestFn)

    expect(first.ok).toBe(true)
    expect(second).toEqual({ ok: false, status: 409, error: 'This upload has already been saved to the knowledge base' })
    expect(third).toEqual({ ok: false, status: 409, error: 'This upload has already been saved to the knowledge base' })
    expect(ingestFn).toHaveBeenCalledTimes(1) // the actual KB write only ever happened once
    expect(rows.filter(r => r.status === 'CONFIRMED')).toHaveLength(1)
  })

  it('CRITICAL: two racing Confirm calls (both pass the pre-check before either writes) still only commit once — the atomic claim decides the winner', async () => {
    // Simulates the real race: both requests read status === 'EXTRACTED'
    // before either has updated it. The atomic updateMany (WHERE status =
    // 'EXTRACTED') is what actually prevents the duplicate — proven here by
    // running two confirmIngestion calls whose findUnique pre-checks both
    // see the pristine EXTRACTED row (they're awaited sequentially because
    // this is a single-threaded JS test, but the claim step itself is the
    // real guard, not call ordering).
    const { prisma, rows } = makeFakePrisma([{ id: 'a', status: 'EXTRACTED', extractedTitle: 'T', extractedText: 'body', category: 'IMAGE', originalFilename: 'x.png', r2Key: 'k' }])
    const ingestFn = vi.fn(async () => 1)

    const [a, b] = await Promise.all([
      confirmIngestion(prisma, 'a', ingestFn),
      confirmIngestion(prisma, 'a', ingestFn),
    ])

    const results = [a, b]
    expect(results.filter(r => r.ok)).toHaveLength(1)
    expect(results.filter(r => !r.ok)).toHaveLength(1)
    expect(ingestFn).toHaveBeenCalledTimes(1)
    expect(rows.filter(r => r.status === 'CONFIRMED')).toHaveLength(1)
  })

  it('if the KB write fails AFTER the status claim, the row reverts to EXTRACTED (retryable) instead of being stuck CONFIRMED-with-nothing', async () => {
    const { prisma, rows } = makeFakePrisma([{ id: 'a', status: 'EXTRACTED', extractedTitle: 'T', extractedText: 'body', category: 'DOCUMENT', originalFilename: 'x.pdf', r2Key: 'k' }])
    const failingIngestFn = vi.fn(async () => { throw new Error('DB write failed') })

    const result = await confirmIngestion(prisma, 'a', failingIngestFn)

    expect(result.ok).toBe(false)
    expect(rows[0].status).toBe('EXTRACTED') // reverted, not stuck as CONFIRMED
    expect(rows[0].confirmedAt).toBeNull()

    // and it's genuinely retryable afterwards
    const workingIngestFn = vi.fn(async () => 1)
    const retryResult = await confirmIngestion(prisma, 'a', workingIngestFn)
    expect(retryResult.ok).toBe(true)
    expect(workingIngestFn).toHaveBeenCalledTimes(1)
  })

  it('never confirms with empty extracted content', async () => {
    const { prisma, rows } = makeFakePrisma([{ id: 'a', status: 'EXTRACTED', extractedTitle: '', extractedText: '', category: 'DOCUMENT', originalFilename: 'x.pdf', r2Key: 'k' }])
    const ingestFn = vi.fn()
    const result = await confirmIngestion(prisma, 'a', ingestFn)
    expect(result.ok).toBe(false)
    expect(ingestFn).not.toHaveBeenCalled()
  })
})

// ── State machine: discard ──────────────────────────────────────────────────
describe('discardIngestion', () => {
  it('returns 404 for a nonexistent id', async () => {
    const { prisma } = makeFakePrisma([])
    const result = await discardIngestion(prisma, 'missing')
    expect(result).toEqual({ ok: false, status: 404, error: 'Upload not found' })
  })

  it('blocks discarding a CONFIRMED row (real knowledge now — must go through the knowledge-base delete route instead)', async () => {
    const { prisma, rows } = makeFakePrisma([{ id: 'a', status: 'CONFIRMED', r2Key: 'k' }])
    const deleteFn = vi.fn(async () => {})
    const result = await discardIngestion(prisma, 'a', deleteFn)
    expect(result.ok).toBe(false)
    expect(deleteFn).not.toHaveBeenCalled()
    expect(rows).toHaveLength(1) // row untouched
  })

  it('discards a PROCESSING/EXTRACTED/FAILED row and deletes its storage object', async () => {
    for (const status of ['PROCESSING', 'EXTRACTED', 'FAILED']) {
      const { prisma, rows } = makeFakePrisma([{ id: 'a', status, r2Key: 'ai-knowledge/document/x.pdf' }])
      const deleteFn = vi.fn(async () => {})
      const result = await discardIngestion(prisma, 'a', deleteFn)
      expect(result).toEqual({ ok: true })
      expect(deleteFn).toHaveBeenCalledWith('ai-knowledge/document/x.pdf')
      expect(rows).toHaveLength(0)
    }
  })

  it('storage-delete failure does not fail the discard (best-effort — DB row is still gone, no dangling DB state)', async () => {
    const { prisma, rows } = makeFakePrisma([{ id: 'a', status: 'FAILED', r2Key: 'k' }])
    const deleteFn = vi.fn(async () => { throw new Error('R2 unreachable') })
    const result = await discardIngestion(prisma, 'a', deleteFn)
    expect(result).toEqual({ ok: true })
    expect(rows).toHaveLength(0)
  })
})

// ── Preview editing ──────────────────────────────────────────────────────────
describe('updatePreview', () => {
  it('only allowed while EXTRACTED', async () => {
    const { prisma } = makeFakePrisma([{ id: 'a', status: 'PROCESSING' }])
    const result = await updatePreview(prisma, 'a', { extractedTitle: 'New title' })
    expect(result).toEqual({ ok: false, status: 400, error: 'Only an extracted preview can be edited' })
  })

  it('rejects an empty title/text', async () => {
    const { prisma } = makeFakePrisma([{ id: 'a', status: 'EXTRACTED' }])
    const result = await updatePreview(prisma, 'a', { extractedTitle: '   ' })
    expect(result.ok).toBe(false)
  })

  it('applies a valid edit', async () => {
    const { prisma, rows } = makeFakePrisma([{ id: 'a', status: 'EXTRACTED', extractedTitle: 'Old', extractedText: 'old body' }])
    const result = await updatePreview(prisma, 'a', { extractedTitle: 'New title', extractedText: 'new body' })
    expect(result.ok).toBe(true)
    expect(rows[0].extractedTitle).toBe('New title')
    expect(rows[0].extractedText).toBe('new body')
  })
})
