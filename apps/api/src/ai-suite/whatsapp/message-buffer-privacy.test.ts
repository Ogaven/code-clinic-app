import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const source = readFileSync(require.resolve('./message-buffer.ts'), 'utf8')

describe('WhatsApp voice note buffer safeguards', () => {
  it('does not log inbound message content or transcript previews', () => {
    expect(source).not.toContain('combined.slice(0, 120)')
    expect(source).toContain('contents redacted')
  })

  it('processes recordings individually so metadata is not lost in a combined message', () => {
    expect(source).toContain('entry.messages.some(m => m.metadata)')
    expect(source).toContain('for (const m of entry.messages)')
    expect(source).toContain('processInbound(from, m.text, m.wamid, entry.phoneNumberId, m.metadata)')
  })
})
