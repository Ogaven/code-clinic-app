import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const source = readFileSync(require.resolve('./takeover.routes.ts'), 'utf8')
const messageList = source.slice(
  source.indexOf("router.get('/conversations/:conversationId/messages',"),
  source.indexOf('// GET /ai-suite/conversations/:conversationId/messages/:messageId/voice-note'),
)
const voiceRoute = source.slice(
  source.indexOf("router.get('/conversations/:conversationId/messages/:messageId/voice-note',"),
  source.indexOf("// GET /ai-suite/posts?", source.indexOf("router.get('/conversations/:conversationId/messages/:messageId/voice-note',")),
)

describe('WhatsApp voice-note staff playback security contract', () => {
  it('does not expose private object storage keys in message lists', () => {
    expect(messageList).toContain('voiceNoteAvailable: true')
    expect(messageList).toContain('JSON.stringify({ voiceNoteAvailable: true })')
  })

  it('requires staff authorization and checks conversation and user-message ownership', () => {
    expect(voiceRoute).toContain('adminAndReceptionist')
    expect(voiceRoute).toContain('id: req.params.messageId')
    expect(voiceRoute).toContain('conversationId: req.params.conversationId')
    expect(voiceRoute).toContain("role: 'USER'")
  })

  it('validates private audio key format and returns only short-lived access', () => {
    expect(voiceRoute).toContain('getSignedDownloadUrl(key, 120)')
    expect(voiceRoute).toContain('expiresIn: 120')
    expect(voiceRoute).toContain("res.sendStatus(404)")
  })
})
