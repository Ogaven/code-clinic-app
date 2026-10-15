import { describe, expect, it } from 'vitest'
import { transcribeWhisperMetered } from './whisper-metered'

const audio = new Blob(['test'], { type: 'audio/ogg' })

describe('Whisper metering validation', () => {
  const valid = {
    audio,
    durationSeconds: 45,
    verifiedUsdPerMinute: 0.01,
    maxDurationSeconds: 180,
    apiKey: 'test-only',
  }

  it.each([
    { durationSeconds: 0 },
    { durationSeconds: Number.NaN },
    { durationSeconds: Number.POSITIVE_INFINITY },
    { durationSeconds: 181 },
    { maxDurationSeconds: 0 },
    { verifiedUsdPerMinute: 0 },
    { verifiedUsdPerMinute: Number.NaN },
    { apiKey: '' },
  ])('rejects unsafe duration, pricing, or credentials before billing: %j', async override => {
    const fetchImpl = (() => { throw new Error('Upstream must never be called') }) as typeof fetch
    await expect(transcribeWhisperMetered({} as never, {
      ...valid, ...override, fetchImpl,
    })).rejects.toThrow('Whisper requires verified audio duration, pricing and limits')
  })
})
