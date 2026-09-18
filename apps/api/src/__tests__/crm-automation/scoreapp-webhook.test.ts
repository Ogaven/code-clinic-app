import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import type { Server } from 'node:http'

// Coverage for the new ScoreApp (third-party quiz tool) webhook receiver,
// built during the 2026-09-16 lead-engine audit — this integration had zero
// prior wiring in production. Must fail closed without a configured secret
// (same "credential presence != feature live" principle used elsewhere in
// this codebase) and must never accept a request with the wrong secret.

const { findOrCreateLeadForChannel } = vi.hoisted(() => ({ findOrCreateLeadForChannel: vi.fn() }))
vi.mock('../../crm-automation/lead-intake.service', () => ({ findOrCreateLeadForChannel }))

import router from '../../routes/scoreapp-webhook'

let server: Server
let origin: string
beforeAll(async () => {
  const app = express()
  app.use(express.json(), router)
  await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', resolve) })
  origin = `http://127.0.0.1:${(server.address() as any).port}`
})
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())) })

const ORIGINAL_SECRET = process.env.SCOREAPP_WEBHOOK_SECRET
beforeEach(() => { vi.clearAllMocks(); findOrCreateLeadForChannel.mockResolvedValue({ lead: { id: 'lead-1' }, isNew: true }) })
afterEach(() => { process.env.SCOREAPP_WEBHOOK_SECRET = ORIGINAL_SECRET })

async function post(body: object, secretHeader?: string) {
  return fetch(`${origin}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(secretHeader ? { 'x-scoreapp-secret': secretHeader } : {}) },
    body: JSON.stringify(body),
  })
}

describe('POST /webhooks/scoreapp — fails closed', () => {
  it('rejects with 501 when SCOREAPP_WEBHOOK_SECRET is not configured, even with a real-looking payload', async () => {
    delete process.env.SCOREAPP_WEBHOOK_SECRET
    const res = await post({ contact: { phone: '+256700000000', email: 'a@b.com' } }, 'anything')
    expect(res.status).toBe(501)
    expect(findOrCreateLeadForChannel).not.toHaveBeenCalled()
  })

  it('rejects with 403 when configured but the provided secret does not match', async () => {
    process.env.SCOREAPP_WEBHOOK_SECRET = 'correct-secret'
    const res = await post({ contact: { phone: '+256700000000' } }, 'wrong-secret')
    expect(res.status).toBe(403)
    expect(findOrCreateLeadForChannel).not.toHaveBeenCalled()
  })
})

describe('POST /webhooks/scoreapp — accepted submissions', () => {
  beforeEach(() => { process.env.SCOREAPP_WEBHOOK_SECRET = 'correct-secret' })

  it('creates a lead with source SCOREAPP from a standard contact/result payload', async () => {
    const res = await post({
      contact: { phone: '0700000000', email: 'jane@example.com', first_name: 'Jane', last_name: 'Doe' },
      result:  { title: 'High Risk', score: 87 },
      quiz:    { name: 'Smile Assessment' },
    }, 'correct-secret')

    expect(res.status).toBe(200)
    await vi.waitFor(() => expect(findOrCreateLeadForChannel).toHaveBeenCalled())
    const call = findOrCreateLeadForChannel.mock.calls[0][0]
    expect(call.createData.source).toBe('SCOREAPP')
    expect(call.createData.name).toBe('Jane Doe')
    expect(call.createData.score).toBe(87)
    expect(call.createData.notes).toContain('Smile Assessment')
    expect(call.createData.notes).toContain('High Risk')
  })

  it('does not create a lead when neither phone nor email is present anywhere in the payload', async () => {
    const res = await post({ result: { score: 10 } }, 'correct-secret')
    expect(res.status).toBe(200) // still acknowledges (2xx) so ScoreApp doesn't retry forever
    await new Promise(r => setTimeout(r, 20))
    expect(findOrCreateLeadForChannel).not.toHaveBeenCalled()
  })
})
