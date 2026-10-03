// Covers the routing bug in apps/api/src/routes/webhooks.ts's POST
// /webhooks/facebook handler: `if (body.object !== 'page') return` silently
// dropped every Instagram webhook payload, even though
// processSocialMessage/processComment already had full INSTAGRAM support
// (see facebook-instagram-webhook.test.ts) and INSTAGRAM_ACCESS_TOKEN/
// INSTAGRAM_BUSINESS_ACCOUNT_ID are configured in production. Confirmed via
// nginx access logs that Meta actually delivers to THIS URL (12 real
// POST /webhooks/facebook hits, 200 OK, over the retained log window) and
// NEVER to the separate, already-correct /ai-suite/instagram/webhook route
// in facebook.routes.ts — so this was the live, traffic-receiving bug, not
// dead code. Fixtures mirror the exact shape already confirmed against
// real Meta payloads in facebook-instagram-webhook.test.ts's igCommentFixture.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import type { Server } from 'node:http'

const { processSocialMessage, processComment, processLeadAdSubmission } = vi.hoisted(() => ({
  processSocialMessage: vi.fn().mockResolvedValue(undefined),
  processComment: vi.fn().mockResolvedValue(undefined),
  processLeadAdSubmission: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../ai-suite/facebook/facebook.routes', () => ({ processSocialMessage, processComment, processLeadAdSubmission }))

import router from '../routes/webhooks'

let server: Server
let origin: string
beforeAll(async () => {
  const app = express()
  // Mirrors main.ts's verify callback so checkMetaWebhookSignature has a
  // real rawBody to check against (falls through to UNVERIFIED here since
  // no app secret env var is set in this test — matching the existing
  // facebook-instagram-webhook.test.ts's approach of not exercising
  // signature enforcement in these fixture tests).
  app.use(express.json({ verify: (req: any, _res, buf) => { req.rawBody = buf } }))
  app.use('/webhooks', router)
  await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', resolve) })
  origin = `http://127.0.0.1:${(server.address() as any).port}`
})
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())) })
beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { delete process.env.FACEBOOK_APP_SECRET; delete process.env.META_APP_SECRET })

function post(body: any) {
  return fetch(`${origin}/webhooks/facebook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

const IG_ACCOUNT_ID = '17841404690443540'

const igDmFixture = {
  object: 'instagram',
  entry: [{
    id: IG_ACCOUNT_ID,
    messaging: [{
      sender: { id: '28540242905567428' },
      recipient: { id: IG_ACCOUNT_ID },
      message: { mid: 'mid.IG789', text: 'Do you do teeth whitening?' },
    }],
  }],
}

const igCommentFixture = {
  object: 'instagram',
  entry: [{
    id: IG_ACCOUNT_ID,
    changes: [{
      field: 'comments',
      value: { id: 'ig-comment-1', media: { id: 'media-1' }, from: { id: '1042520308397913', username: 'a_real_user' }, text: 'How much is a filling?' },
    }],
  }],
}

const fbDmFixture = {
  object: 'page',
  entry: [{
    id: '532091973485208',
    messaging: [{ sender: { id: 'fb-sender-1' }, message: { mid: 'mid.FB1', text: 'Hi' } }],
  }],
}

describe('POST /webhooks/facebook — Instagram payload dispatch (previously dropped)', () => {
  it('dispatches an Instagram DM to processSocialMessage with channel INSTAGRAM', async () => {
    const res = await post(igDmFixture)
    expect(res.status).toBe(200)
    await new Promise(r => setTimeout(r, 10)) // response is sent before async processing completes
    expect(processSocialMessage).toHaveBeenCalledWith('28540242905567428', 'Do you do teeth whitening?', 'INSTAGRAM', 'mid.IG789')
  })

  it('dispatches an Instagram comment to processComment with channel INSTAGRAM_COMMENT', async () => {
    const res = await post(igCommentFixture)
    expect(res.status).toBe(200)
    await new Promise(r => setTimeout(r, 10))
    expect(processComment).toHaveBeenCalledWith('ig-comment-1', 'media-1', '1042520308397913', 'a_real_user', 'How much is a filling?', 'INSTAGRAM_COMMENT', undefined)
  })

  it('never calls the Facebook-only processors for an Instagram payload', async () => {
    await post(igDmFixture)
    await new Promise(r => setTimeout(r, 10))
    expect(processSocialMessage).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), 'FACEBOOK', expect.anything())
  })
})

describe('POST /webhooks/facebook — Facebook payload still works (no regression)', () => {
  it('still dispatches a Facebook Page DM to processSocialMessage with channel FACEBOOK', async () => {
    const res = await post(fbDmFixture)
    expect(res.status).toBe(200)
    await new Promise(r => setTimeout(r, 10))
    expect(processSocialMessage).toHaveBeenCalledWith('fb-sender-1', 'Hi', 'FACEBOOK', 'mid.FB1')
  })
})

describe('POST /webhooks/facebook — unknown object types are ignored safely', () => {
  it('does not throw and calls no processor for an unrecognized object type', async () => {
    const res = await post({ object: 'whatsapp_business_account', entry: [] })
    expect(res.status).toBe(200)
    await new Promise(r => setTimeout(r, 10))
    expect(processSocialMessage).not.toHaveBeenCalled()
    expect(processComment).not.toHaveBeenCalled()
  })
})
