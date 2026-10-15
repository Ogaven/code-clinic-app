import type { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { markBudgetOutcomeUnknown, reserveBudgetAtomic, settleBudgetAtomic } from '../agent/ai-budget-postgres'

/**
 * Opt-in transcription billing boundary. The caller must determine audio
 * duration from trusted media metadata before invoking this function.
 * Never derive duration from compressed file size or assume a fixed length.
 * No patient audio, transcription, or identifying details are logged.
 */
export async function transcribeWhisperMetered(
  db: PrismaClient,
  args: {
    audio: Blob
    durationSeconds: number
    verifiedUsdPerMinute: number
    maxDurationSeconds: number
    apiKey: string
    fetchImpl?: typeof fetch
  },
): Promise<string> {
  const { audio, durationSeconds, verifiedUsdPerMinute, maxDurationSeconds, apiKey } = args
  if (!apiKey || !Number.isFinite(durationSeconds) || durationSeconds <= 0 ||
      !Number.isFinite(maxDurationSeconds) || maxDurationSeconds <= 0 ||
      durationSeconds > maxDurationSeconds ||
      !Number.isFinite(verifiedUsdPerMinute) || verifiedUsdPerMinute <= 0) {
    throw new Error('Whisper requires verified audio duration, pricing and limits')
  }
  // Reserve whole minutes conservatively. The actual billed duration must
  // be reconciled against provider invoices, not inferred from response text.
  const reservedUsd = Math.ceil(durationSeconds / 60) * verifiedUsdPerMinute
  const requestId = randomUUID()
  const reservation = await reserveBudgetAtomic(db, {
    requestId, provider: 'openai', estimatedUsd: reservedUsd,
  })
  try {
    const form = new FormData()
    form.append('file', audio, 'voice.ogg')
    form.append('model', 'whisper-1')
    const response = await (args.fetchImpl ?? fetch)('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    })
    if (!response.ok) throw new Error('Whisper provider request failed')
    const payload = await response.json() as { text?: unknown }
    if (typeof payload.text !== 'string') throw new Error('Whisper response missing transcription')
    // Whisper's plain JSON response has no authoritative billable duration.
    // Conservatively settle the whole-minute reservation and reconcile later.
    await settleBudgetAtomic(db, {
      requestId, month: reservation.month, actualUsd: reservedUsd,
    })
    return payload.text.trim()
  } catch (error) {
    await markBudgetOutcomeUnknown(db, { requestId, month: reservation.month }).catch(() => {})
    throw error
  }
}
