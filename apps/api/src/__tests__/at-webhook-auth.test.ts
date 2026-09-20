import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { Request } from 'express'
import { checkAfricasTalkingWebhookAuth } from '../lib/at-webhook-auth'

function makeReq(opts: { header?: string; query?: string } = {}): Request {
  return {
    get: (name: string) => (name.toLowerCase() === 'x-at-webhook-secret' ? opts.header : undefined),
    query: opts.query !== undefined ? { secret: opts.query } : {},
  } as unknown as Request
}

describe('checkAfricasTalkingWebhookAuth', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let warnSpy: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let errorSpy: any

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    delete process.env.AT_WEBHOOK_SECRET
  })
  afterEach(() => {
    warnSpy.mockRestore()
    errorSpy.mockRestore()
    delete process.env.AT_WEBHOOK_SECRET
  })

  it('unconfigured migration-safe behavior: returns UNVERIFIED (never REJECTED) and only warns when AT_WEBHOOK_SECRET is unset — must never break live patient WhatsApp traffic before an operator sets a real secret', () => {
    const req = makeReq()
    expect(checkAfricasTalkingWebhookAuth(req)).toBe('UNVERIFIED')
    expect(warnSpy).toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('configured + valid: returns OK for the correct secret sent as a header', () => {
    process.env.AT_WEBHOOK_SECRET = 'correct-secret'
    const req = makeReq({ header: 'correct-secret' })
    expect(checkAfricasTalkingWebhookAuth(req)).toBe('OK')
  })

  it('configured + valid: returns OK for the correct secret sent as a ?secret= query param (AT has no custom-header support in its dashboard, so the callback URL itself carries the secret)', () => {
    process.env.AT_WEBHOOK_SECRET = 'correct-secret'
    const req = makeReq({ query: 'correct-secret' })
    expect(checkAfricasTalkingWebhookAuth(req)).toBe('OK')
  })

  it('configured + invalid: returns REJECTED and logs an error for a wrong header value', () => {
    process.env.AT_WEBHOOK_SECRET = 'correct-secret'
    const req = makeReq({ header: 'wrong-secret' })
    expect(checkAfricasTalkingWebhookAuth(req)).toBe('REJECTED')
    expect(errorSpy).toHaveBeenCalled()
  })

  it('configured + invalid: returns REJECTED when neither header nor query param is present', () => {
    process.env.AT_WEBHOOK_SECRET = 'correct-secret'
    const req = makeReq()
    expect(checkAfricasTalkingWebhookAuth(req)).toBe('REJECTED')
  })

  it('configured + invalid: a differently-sized provided secret never throws (safe length check before timingSafeEqual)', () => {
    process.env.AT_WEBHOOK_SECRET = 'correct-secret'
    const req = makeReq({ header: 'short' })
    expect(() => checkAfricasTalkingWebhookAuth(req)).not.toThrow()
    expect(checkAfricasTalkingWebhookAuth(req)).toBe('REJECTED')
  })
})
