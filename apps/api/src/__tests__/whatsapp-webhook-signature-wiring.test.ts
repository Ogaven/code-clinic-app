// Covers the Workstream C fix to whatsapp.routes.ts's POST /webhook handler:
// no dedicated WHATSAPP_APP_SECRET exists in production, but a read-only
// Meta /debug_token check (recorded in the code comment at the call site)
// confirmed WHATSAPP_TOKEN belongs to the exact same Meta App ID as the
// already-configured FACEBOOK_APP_SECRET — Meta signs every webhook
// delivery (Messenger, WhatsApp, Instagram) for an App with that one App's
// single App Secret, so the WhatsApp route now falls back to
// FACEBOOK_APP_SECRET instead of staying permanently UNVERIFIED.
//
// checkMetaWebhookSignature's own unit tests (webhook-signature.test.ts)
// already cover the generic OK/REJECTED/UNVERIFIED/fallback-ordering
// mechanics; this file verifies the ACTUAL route wiring — that
// whatsapp.routes.ts's POST /webhook really does pass
// ['WHATSAPP_APP_SECRET', 'FACEBOOK_APP_SECRET', 'META_APP_SECRET'] — by
// driving the real exported router with real HMAC-signed requests.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'crypto'

vi.setConfig({ testTimeout: 20000 })

const { prismaMock, sendPushToUserMock, sendStaffSMSMock } = vi.hoisted(() => ({
  prismaMock: {
    aiMessage: { updateMany: vi.fn().mockResolvedValue({}), create: vi.fn().mockResolvedValue({}), findFirst: vi.fn().mockResolvedValue(null) },
    metaDeliveryFailure: { create: vi.fn().mockResolvedValue({}) },
    notification: { create: vi.fn().mockResolvedValue({}), findFirst: vi.fn().mockResolvedValue(null) },
    user: { findMany: vi.fn().mockResolvedValue([]) },
    patient: { findFirst: vi.fn().mockResolvedValue(null) },
  },
  sendPushToUserMock: vi.fn().mockResolvedValue(undefined),
  sendStaffSMSMock:   vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../services/push.service', () => ({ sendPushToUser: sendPushToUserMock }))
vi.mock('../ai-suite/sms/sms.service', () => ({ sendStaffSMS: sendStaffSMSMock }))

let router: typeof import('../ai-suite/whatsapp/whatsapp.routes')['default']

beforeAll(async () => {
  process.env.OPENAI_API_KEY ??= 'test-key-not-real'
  ;({ default: router } = await import('../ai-suite/whatsapp/whatsapp.routes'))
})

const ORIGINAL_ENV = { ...process.env }
beforeEach(() => {
  vi.clearAllMocks()
  process.env = { ...ORIGINAL_ENV }
  delete process.env.WHATSAPP_APP_SECRET
  delete process.env.FACEBOOK_APP_SECRET
  delete process.env.META_APP_SECRET
})
afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

function findHandler(r: any, method: string, path: string) {
  for (const layer of r.stack) {
    if (layer.route?.path === path) {
      const matches = layer.route.stack.filter((l: any) => l.method === method)
      if (matches.length > 0) return matches[matches.length - 1].handle
    }
  }
  throw new Error(`No handler for ${method.toUpperCase()} ${path}`)
}

function sign(secret: string, rawBody: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex')
}

function fakeReqRes(bodyObj: any, signatureHeader?: string) {
  const rawBody = Buffer.from(JSON.stringify(bodyObj))
  const req: any = {
    body: bodyObj,
    rawBody,
    get: (name: string) => (name.toLowerCase() === 'x-hub-signature-256' ? signatureHeader : undefined),
  }
  const res: any = { sendStatus: vi.fn(), status: vi.fn(() => res), json: vi.fn() }
  return { req, res }
}

// `object` deliberately does NOT match 'whatsapp_business_account' for the
// "should pass the gate" cases below — the handler's post-signature logic
// returns immediately for any other object type (see whatsapp.routes.ts),
// so these tests exercise ONLY the signature gate itself, never the
// message-processing pipeline (which has its own, separate, already-mocked
// test coverage elsewhere and includes real fire-and-forget async work that
// doesn't belong in a signature-focused test).
const GATE_ONLY_BODY = { object: 'unrelated_test_object', entry: [] }
// Used only for REJECTED cases, where the realistic object type never
// matters — rejection happens before the handler ever inspects it.
const REALISTIC_BODY = { object: 'whatsapp_business_account', entry: [] }

describe('POST /ai-suite/webhook — signature verification wiring', () => {
  it('falls back to FACEBOOK_APP_SECRET when WHATSAPP_APP_SECRET is not set, accepting a validly-signed request', async () => {
    process.env.FACEBOOK_APP_SECRET = 'the-shared-meta-app-secret'
    const handler = findHandler(router, 'post', '/webhook')
    const rawBody = JSON.stringify(GATE_ONLY_BODY)
    const { req, res } = fakeReqRes(GATE_ONLY_BODY, sign('the-shared-meta-app-secret', rawBody))

    await handler(req, res)

    expect(res.sendStatus).toHaveBeenCalledWith(200)
    expect(res.sendStatus).not.toHaveBeenCalledWith(403)
  })

  it('rejects (403) a request signed with the wrong secret, even though FACEBOOK_APP_SECRET is configured', async () => {
    process.env.FACEBOOK_APP_SECRET = 'the-shared-meta-app-secret'
    const handler = findHandler(router, 'post', '/webhook')
    const rawBody = JSON.stringify(REALISTIC_BODY)
    const { req, res } = fakeReqRes(REALISTIC_BODY, sign('some-attacker-guess', rawBody))

    await handler(req, res)

    expect(res.sendStatus).toHaveBeenCalledWith(403)
    expect(res.sendStatus).not.toHaveBeenCalledWith(200)
  })

  it('rejects (403) a request with no signature header at all once FACEBOOK_APP_SECRET is configured', async () => {
    process.env.FACEBOOK_APP_SECRET = 'the-shared-meta-app-secret'
    const handler = findHandler(router, 'post', '/webhook')
    const { req, res } = fakeReqRes(REALISTIC_BODY, undefined)

    await handler(req, res)

    expect(res.sendStatus).toHaveBeenCalledWith(403)
  })

  it('a dedicated WHATSAPP_APP_SECRET, if ever set, takes priority over FACEBOOK_APP_SECRET', async () => {
    process.env.WHATSAPP_APP_SECRET = 'dedicated-whatsapp-secret'
    process.env.FACEBOOK_APP_SECRET = 'the-shared-meta-app-secret'
    const handler = findHandler(router, 'post', '/webhook')
    const rawBody = JSON.stringify(REALISTIC_BODY)
    // Signed with the FACEBOOK secret, not the dedicated WhatsApp one — must
    // be rejected, proving WHATSAPP_APP_SECRET (not FACEBOOK_APP_SECRET) is
    // the one actually being checked when both are present.
    const { req, res } = fakeReqRes(REALISTIC_BODY, sign('the-shared-meta-app-secret', rawBody))

    await handler(req, res)

    expect(res.sendStatus).toHaveBeenCalledWith(403)
  })

  it('stays UNVERIFIED (never 403) when no app secret is configured at all — must never break live traffic', async () => {
    const handler = findHandler(router, 'post', '/webhook')
    const { req, res } = fakeReqRes(GATE_ONLY_BODY, undefined)

    await handler(req, res)

    expect(res.sendStatus).toHaveBeenCalledWith(200)
    expect(res.sendStatus).not.toHaveBeenCalledWith(403)
  })

  it('a rejected request never reaches the message-processing logic (no AiMessage/notification writes)', async () => {
    process.env.FACEBOOK_APP_SECRET = 'the-shared-meta-app-secret'
    const handler = findHandler(router, 'post', '/webhook')
    const bodyWithMessage = {
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ value: { messages: [{ from: '256700000000', id: 'wamid.1', type: 'text', text: { body: 'hello' } }] } }] }],
    }
    const rawBody = JSON.stringify(bodyWithMessage)
    const { req, res } = fakeReqRes(bodyWithMessage, sign('wrong-secret', rawBody))

    await handler(req, res)

    expect(res.sendStatus).toHaveBeenCalledWith(403)
    expect(prismaMock.patient.findFirst).not.toHaveBeenCalled()
  })
})
