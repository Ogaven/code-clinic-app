import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import * as http from 'node:http'
import type { Server } from 'node:http'

// Regression coverage for the 2026-09-19 follow-up finding: POST
// /agent/whatsapp/webhook (the Africa's Talking WhatsApp gateway) had no
// authentication at all and logged the full raw payload (patient message
// content, phone numbers, names) to application logs. This proves the route
// now (a) rejects with 403 before doing any processing when
// checkAfricasTalkingWebhookAuth reports REJECTED, and (b) still processes
// normally when it reports UNVERIFIED (AT_WEBHOOK_SECRET unset) — the
// unconfigured, migration-safe state must never break live patient traffic.

const {
  checkAfricasTalkingWebhookAuth, enqueueMessage, prismaMock,
} = vi.hoisted(() => ({
  checkAfricasTalkingWebhookAuth: vi.fn(),
  enqueueMessage: vi.fn(),
  prismaMock: {
    aiScheduledMessage: { findFirst: vi.fn(), update: vi.fn() },
    botMessageLog: { findFirst: vi.fn(), update: vi.fn() },
    aiMessage: { findMany: vi.fn(), update: vi.fn() },
  },
}))

// routes/agent.ts constructs `new OpenAI(...)` at module load (never called
// in this test) — the real constructor throws without a credential.
vi.mock('openai', () => ({ default: vi.fn().mockImplementation(() => ({})) }))
vi.mock('../lib/at-webhook-auth', () => ({ checkAfricasTalkingWebhookAuth }))
vi.mock('../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../ai-suite/whatsapp/message-buffer', () => ({ enqueueMessage }))
vi.mock('../ai-suite/whatsapp/whatsapp.service', () => ({ sendWhatsAppMessage: vi.fn() }))
vi.mock('../ai-suite/whatsapp/staff-relay.service', () => ({ handleStaffReply: vi.fn(), STAFF_NUMBER: '+256700000001' }))
vi.mock('../services/agent/channels/voice-channel', () => ({
  handleInboundCall: vi.fn(), triggerOutboundCall: vi.fn(), handleRecordingComplete: vi.fn(),
}))
vi.mock('../services/agent/unified-agent', () => ({ runAgent: vi.fn() }))
vi.mock('../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = { id: 'staff-1', role: 'ADMIN' }; next() },
}))

import router from '../routes/agent'

let server: Server
beforeAll(async () => {
  const app = express()
  app.use(express.json(), router)
  await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', resolve) })
})
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())) })
beforeEach(() => { vi.clearAllMocks() })

// The global test-guard patches `fetch` to block any URL containing
// "whatsapp" (a real-provider safety net) — which would also catch our own
// local test server's /whatsapp/webhook path. Node's http module is
// unpatched, so it's used directly here instead of fetch.
function postWebhook(body: object): Promise<{ status: number }> {
  const port = (server.address() as any).port
  const data = JSON.stringify(body)
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/whatsapp/webhook', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      res => { res.resume(); res.on('end', () => resolve({ status: res.statusCode ?? 0 })) }
    )
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

describe('POST /agent/whatsapp/webhook — auth gate wiring', () => {
  it('REJECTED (configured + invalid secret): responds 403 and never enqueues the message', async () => {
    checkAfricasTalkingWebhookAuth.mockReturnValue('REJECTED')

    const res = await postWebhook({ from: '+256700000009', text: 'hello' })

    expect(res.status).toBe(403)
    expect(enqueueMessage).not.toHaveBeenCalled()
  })

  it('UNVERIFIED (unconfigured — migration-safe): still acknowledges and processes the message, so live patient traffic is never broken before AT_WEBHOOK_SECRET is set', async () => {
    checkAfricasTalkingWebhookAuth.mockReturnValue('UNVERIFIED')

    const res = await postWebhook({ from: '+256700000009', text: 'hello' })

    expect(res.status).toBe(200)
    await vi.waitFor(() => expect(enqueueMessage).toHaveBeenCalledWith('+256700000009', 'hello', ''))
  })

  it('OK (configured + valid secret): processes the message normally', async () => {
    checkAfricasTalkingWebhookAuth.mockReturnValue('OK')

    const res = await postWebhook({ from: '+256700000009', text: 'hello' })

    expect(res.status).toBe(200)
    await vi.waitFor(() => expect(enqueueMessage).toHaveBeenCalledWith('+256700000009', 'hello', ''))
  })
})
