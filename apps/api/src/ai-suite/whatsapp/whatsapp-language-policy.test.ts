import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const source = readFileSync(require.resolve('./whatsapp.routes.ts'), 'utf8')
const audioStart = source.indexOf("if (msg.type === 'audio' && msg.audio?.id)")
const imageStart = source.indexOf("// ── Image → OpenAI vision", audioStart)
const audioHandler = source.slice(audioStart, imageStart)

describe('WhatsApp local-language voice-note safeguards', () => {
  it('uses transcription, not translation, without forcing Swahili or English', () => {
    expect(audioStart).toBeGreaterThan(-1)
    expect(imageStart).toBeGreaterThan(audioStart)
    expect(audioHandler).toContain('/v1/audio/transcriptions')
    expect(audioHandler).toContain("formData.append('model', 'whisper-1')")
    expect(audioHandler).not.toMatch(/\/v1\/audio\/translations/)
    expect(audioHandler).not.toMatch(/formData\.append\(['"]language['"]/)
    expect(audioHandler).not.toMatch(/formData\.append\(['"]prompt['"]/)
  })

  it('retains original private audio metadata and never logs transcript content', () => {
    expect(audioHandler).toContain('uploadFile(Buffer.from(media.buffer)')
    expect(audioHandler).toContain('voiceNote: { storageKey: key')
    expect(audioHandler).toContain('undefined, voiceMetadata)')
    expect(audioHandler).not.toMatch(/console\.(?:log|info|warn|error)\([^\n]*transcription\.slice/)
  })
})
