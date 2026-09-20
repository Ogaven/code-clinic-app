import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'crypto'
import type { Request } from 'express'
import { verifyMetaSignature, checkMetaWebhookSignature } from '../lib/webhook-signature'

function makeReq(rawBody: string, signatureHeader?: string): Request {
  return {
    rawBody: Buffer.from(rawBody),
    get: (name: string) => (name.toLowerCase() === 'x-hub-signature-256' ? signatureHeader : undefined),
  } as unknown as Request
}

function sign(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
}

describe('verifyMetaSignature', () => {
  const secret = 'test-app-secret'
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] })

  it('accepts a signature computed correctly over the exact raw body', () => {
    const req = makeReq(body, sign(secret, body))
    expect(verifyMetaSignature(req, secret)).toBe(true)
  })

  it('rejects a signature computed with the wrong secret', () => {
    const req = makeReq(body, sign('wrong-secret', body))
    expect(verifyMetaSignature(req, secret)).toBe(false)
  })

  it('rejects when the raw body was tampered with after signing', () => {
    const req = makeReq(body + 'x', sign(secret, body))
    expect(verifyMetaSignature(req, secret)).toBe(false)
  })

  it('rejects a missing signature header', () => {
    const req = makeReq(body, undefined)
    expect(verifyMetaSignature(req, secret)).toBe(false)
  })

  it('rejects a header missing the sha256= prefix', () => {
    const req = makeReq(body, createHmac('sha256', secret).update(body).digest('hex'))
    expect(verifyMetaSignature(req, secret)).toBe(false)
  })

  it('rejects malformed hex without throwing', () => {
    const req = makeReq(body, 'sha256=not-valid-hex-zzzz')
    expect(() => verifyMetaSignature(req, secret)).not.toThrow()
    expect(verifyMetaSignature(req, secret)).toBe(false)
  })

  it('rejects when req.rawBody was never captured', () => {
    const req = { get: () => sign(secret, body) } as unknown as Request
    expect(verifyMetaSignature(req, secret)).toBe(false)
  })
})

describe('checkMetaWebhookSignature', () => {
  const secret = 'configured-secret'
  const body = JSON.stringify({ hello: 'world' })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let warnSpy: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let errorSpy: any

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    delete process.env.TEST_APP_SECRET
  })
  afterEach(() => {
    warnSpy.mockRestore()
    errorSpy.mockRestore()
    delete process.env.TEST_APP_SECRET
  })

  it('returns UNVERIFIED (never REJECTED) and only warns when no app secret env var is configured — must never break live traffic before an operator sets a real secret', () => {
    const req = makeReq(body, undefined)
    const result = checkMetaWebhookSignature(req, ['TEST_APP_SECRET'], 'Test')
    expect(result).toBe('UNVERIFIED')
    expect(warnSpy).toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('returns OK for a valid signature once the app secret env var is configured', () => {
    process.env.TEST_APP_SECRET = secret
    const req = makeReq(body, sign(secret, body))
    expect(checkMetaWebhookSignature(req, ['TEST_APP_SECRET'], 'Test')).toBe('OK')
  })

  it('returns REJECTED for an invalid signature once the app secret env var is configured', () => {
    process.env.TEST_APP_SECRET = secret
    const req = makeReq(body, sign('some-other-secret', body))
    const result = checkMetaWebhookSignature(req, ['TEST_APP_SECRET'], 'Test')
    expect(result).toBe('REJECTED')
    expect(errorSpy).toHaveBeenCalled()
  })

  it('falls back through multiple env var names in order, mirroring the existing verify-token convention', () => {
    process.env.TEST_APP_SECRET = secret
    const req = makeReq(body, sign(secret, body))
    expect(checkMetaWebhookSignature(req, ['FIRST_UNSET_VAR', 'TEST_APP_SECRET'], 'Test')).toBe('OK')
  })
})
