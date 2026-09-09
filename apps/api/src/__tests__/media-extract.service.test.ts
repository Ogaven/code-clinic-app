import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { sanitizedProviderError, extractFromImage, transcribeAudio } from '../ai-suite/knowledge/media-extract.service'

describe('sanitizedProviderError (never leaks provider internals to the client)', () => {
  it('maps 429 to a safe "temporarily busy" message', () => {
    const err = sanitizedProviderError({ status: 429, message: 'sk-super-secret-leaked-key rate limited' }, 'transcribe this audio')
    expect(err.message).toBe('The AI provider is temporarily busy — please retry transcribe this audio in a moment.')
    expect(err.message).not.toContain('sk-')
    expect(err.message).not.toContain('secret')
  })

  it('maps 401 to a safe "not configured correctly" message (invalid provider authentication)', () => {
    const err = sanitizedProviderError({ status: 401, message: 'Incorrect API key provided: sk-abc123XYZ' }, 'read this image')
    expect(err.message).toBe('The AI provider is not configured correctly. Contact an administrator.')
    expect(err.message).not.toContain('sk-abc123XYZ')
  })

  it('maps 403 the same way as 401', () => {
    const err = sanitizedProviderError({ status: 403, message: 'forbidden: org does not have access to model' }, 'read this image')
    expect(err.message).toBe('The AI provider is not configured correctly. Contact an administrator.')
  })

  it('maps 413 to a safe "too large" message', () => {
    const err = sanitizedProviderError({ status: 413, message: 'payload too large' }, 'transcribe this audio')
    expect(err.message).toBe('File is too large for the AI provider to process.')
  })

  it('falls back to a generic safe message for a timeout / unknown error shape, never echoing the raw error', () => {
    const err = sanitizedProviderError(new Error('ETIMEDOUT connect to api.openai.com internal-trace-id=xyz'), 'read this image')
    expect(err.message).toBe('Failed to read this image. Please try again.')
    expect(err.message).not.toContain('ETIMEDOUT')
    expect(err.message).not.toContain('internal-trace-id')
  })

  it('handles a completely malformed error object without throwing', () => {
    expect(() => sanitizedProviderError(undefined, 'transcribe this audio')).not.toThrow()
    expect(() => sanitizedProviderError('a plain string error', 'transcribe this audio')).not.toThrow()
  })
})

describe('missing OPENAI_API_KEY (no network call attempted)', () => {
  const originalKey = process.env.OPENAI_API_KEY

  beforeEach(() => { delete process.env.OPENAI_API_KEY })
  afterEach(() => { if (originalKey !== undefined) process.env.OPENAI_API_KEY = originalKey })

  it('extractFromImage fails clearly and safely without a key', async () => {
    await expect(extractFromImage(Buffer.from('fake'), 'image/png'))
      .rejects.toThrow('OPENAI_API_KEY is not configured')
  })

  it('transcribeAudio fails clearly and safely without a key', async () => {
    await expect(transcribeAudio(Buffer.from('fake'), 'note.mp3'))
      .rejects.toThrow('OPENAI_API_KEY is not configured')
  })
})
