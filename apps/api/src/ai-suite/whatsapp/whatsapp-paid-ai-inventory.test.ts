import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = readFileSync(fileURLToPath(new URL('./whatsapp.routes.ts', import.meta.url)), 'utf8')

describe('WhatsApp paid AI callsite inventory', () => {
  it('tracks the two unmetered OpenAI Responses requests for patient media', () => {
    // Update this baseline only when each request is moved behind durable metering.
    expect(source.match(/openai\.responses\.create\s*\(/g) ?? []).toHaveLength(2)
  })

  it('tracks the unmetered Whisper transcription HTTP endpoint', () => {
    // Audio transcription is separately billable and must be included in the monthly budget.
    expect(source.match(/api\.openai\.com\/v1\/audio\/transcriptions/g) ?? []).toHaveLength(1)
  })
})
