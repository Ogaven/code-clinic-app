import { afterEach, describe, expect, it } from 'vitest'
import { createHmac } from 'crypto'
import type { Request } from 'express'
import { checkMetaWebhookSignature } from '../lib/webhook-signature'

const originalInstagram = process.env.INSTAGRAM_APP_SECRET
const originalFacebook = process.env.FACEBOOK_APP_SECRET
const originalMeta = process.env.META_APP_SECRET

afterEach(() => {
  for (const [key, value] of [
    ['INSTAGRAM_APP_SECRET', originalInstagram],
    ['FACEBOOK_APP_SECRET', originalFacebook],
    ['META_APP_SECRET', originalMeta],
  ] as const) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

function signedRequest(secret: string, body = '{"object":"instagram","entry":[]}'): Request {
  const rawBody = Buffer.from(body)
  const signature = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex')
  return { rawBody, get: (name: string) => name.toLowerCase() === 'x-hub-signature-256' ? signature : undefined } as unknown as Request
}

const names = ['INSTAGRAM_APP_SECRET', 'FACEBOOK_APP_SECRET', 'META_APP_SECRET']

describe('Meta webhook signature secret selection', () => {
  it('accepts a valid signature from the second configured app secret', () => {
    process.env.INSTAGRAM_APP_SECRET = 'test-instagram-secret'
    process.env.FACEBOOK_APP_SECRET = 'test-facebook-secret'
    delete process.env.META_APP_SECRET
    expect(checkMetaWebhookSignature(signedRequest('test-facebook-secret'), names, 'Test')).toBe('OK')
  })

  it('accepts a valid signature from the first configured app secret', () => {
    process.env.INSTAGRAM_APP_SECRET = 'test-instagram-secret'
    process.env.FACEBOOK_APP_SECRET = 'test-facebook-secret'
    expect(checkMetaWebhookSignature(signedRequest('test-instagram-secret'), names, 'Test')).toBe('OK')
  })

  it('rejects a signature that matches none of the trusted secrets', () => {
    process.env.INSTAGRAM_APP_SECRET = 'test-instagram-secret'
    process.env.FACEBOOK_APP_SECRET = 'test-facebook-secret'
    delete process.env.META_APP_SECRET
    expect(checkMetaWebhookSignature(signedRequest('untrusted-secret'), names, 'Test')).toBe('REJECTED')
  })

  it('does not authenticate a request if no app secret is configured', () => {
    delete process.env.INSTAGRAM_APP_SECRET
    delete process.env.FACEBOOK_APP_SECRET
    delete process.env.META_APP_SECRET
    expect(checkMetaWebhookSignature(signedRequest('untrusted-secret'), names, 'Test')).toBe('UNVERIFIED')
  })
})
