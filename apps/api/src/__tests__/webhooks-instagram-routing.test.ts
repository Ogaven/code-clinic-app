import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import type { Server } from 'node:http'

const { enqueueMetaEvent } = vi.hoisted(() => ({ enqueueMetaEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../services/meta-inbound-inbox', () => ({ enqueueMetaEvent }))
import router from '../routes/webhooks'

let server: Server
let origin: string
beforeAll(async () => {
  const app = express()
  app.use(express.json({ verify: (req: any, _res, buf) => { req.rawBody = buf } }))
  app.use('/webhooks', router)
  await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', resolve) })
  origin = `http://127.0.0.1:${(server.address() as any).port}`
})
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())) })
beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.FACEBOOK_APP_SECRET
  delete process.env.META_APP_SECRET
})
const post = (body: object) => fetch(`${origin}/webhooks/facebook`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

describe('Meta webhook durable acknowledgment', () => {
  for (const object of ['page', 'instagram']) {
    it(`persists ${object} payload before returning 200`, async () => {
      const body = { object, entry: [{ messaging: [{ sender: { id: 'sender' }, message: { mid: 'm1', text: 'Hello' } }] }] }
      const res = await post(body)
      expect(res.status).toBe(200)
      expect(enqueueMetaEvent).toHaveBeenCalledWith(body)
    })
  }
  it('returns 503 to request Meta retry when persistence fails', async () => {
    enqueueMetaEvent.mockRejectedValueOnce(new Error('database unavailable'))
    const res = await post({ object: 'instagram', entry: [] })
    expect(res.status).toBe(503)
  })
})
