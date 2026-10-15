import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const page = readFileSync(require.resolve('../app/(receptionist)/receptionist/ai-suite/inbox/page.tsx'), 'utf8')
const start = page.indexOf('function VoiceNotePlayer(')
const end = page.indexOf('function MsgStatus(', start)
const player = page.slice(start, end)

describe('Staff WhatsApp voice note playback contract', () => {
  it('requests a short-lived voice note URL with staff authorization', () => {
    expect(start).toBeGreaterThan(-1)
    expect(player).toContain('/ai-suite/conversations/')
    expect(player).toContain('/voice-note')
    expect(player).toContain('headers: authH()')
    expect(player).toContain('encodeURIComponent(conversationId)')
    expect(player).toContain('encodeURIComponent(messageId)')
  })

  it('offers inline playback and link refresh after audio errors', () => {
    expect(player).toContain('<audio controls')
    expect(player).toContain('onError={() => { setError(true); setUrl(null) }}')
    expect(player).toContain('onClick={loadAudio}')
    expect(player).toContain('Refresh voice note link')
  })

  it('labels the AI transcript as potentially inaccurate', () => {
    expect(player).toContain('AI transcript (may contain errors):')
  })

  it('only renders the player for stored WhatsApp audio', () => {
    expect(page).toContain("msg.metadata?.includes('voiceNoteAvailable')")
    expect(page).toContain("conv.channel === 'WHATSAPP'")
  })
})
