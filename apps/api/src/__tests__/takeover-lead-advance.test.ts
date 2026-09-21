import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import type { Server } from 'node:http'

// Milestone: CRM operational functionality closure — regression coverage for
// the root-cause fix of "345 leads stuck in New". POST
// /ai-suite/conversations/:conversationId/send is the REAL path staff use to
// reply to a lead (human-takeover send) — it previously never called
// logHumanReply at all, so a lead's NEW -> CONTACTED transition depended
// entirely on a separate, easy-to-miss "Log Reply" button. This proves the
// real send route now calls advanceLeadOnHumanReply after a successful send,
// and never lets a lead-advance failure break the send response.

const { prismaMock, sendWhatsAppMessage, advanceLeadOnHumanReply } = vi.hoisted(() => ({
  prismaMock: {
    aiConversation: { findUnique: vi.fn() },
    aiMessage: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
  },
  sendWhatsAppMessage: vi.fn().mockResolvedValue('wamid-1'),
  advanceLeadOnHumanReply: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = { id: 'staff-1', role: 'RECEPTIONIST' }; next() },
}))
vi.mock('../middleware/rbac', () => ({ adminAndReceptionist: (_req: any, _res: any, next: any) => next() }))
vi.mock('../ai-suite/takeover/takeover.service', () => ({ takeoverConversation: vi.fn(), handbackConversation: vi.fn() }))
vi.mock('../lib/doctor-access', () => ({ authenticatedDoctorId: vi.fn() }))
vi.mock('../ai-suite/facebook/facebook.routes', () => ({
  fetchPostThumbnail: vi.fn(),
  sendSocialReply: vi.fn().mockResolvedValue(undefined),
  sendCommentReply: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../ai-suite/whatsapp/whatsapp.service', () => ({ sendWhatsAppMessage }))
vi.mock('../crm-automation/lead-stage.service', () => ({ advanceLeadOnHumanReply }))

import router from '../ai-suite/takeover/takeover.routes'

let server: Server
let origin: string
beforeAll(async () => {
  const app = express()
  app.use(express.json(), router)
  await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', resolve) })
  origin = `http://127.0.0.1:${(server.address() as any).port}`
})
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())) })
beforeEach(() => { vi.clearAllMocks() })

async function send(conversationId: string, text: string) {
  return fetch(`${origin}/conversations/${conversationId}/send`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
  })
}

describe('POST /ai-suite/conversations/:conversationId/send — wires the real reply to lead-stage advancement', () => {
  it('calls advanceLeadOnHumanReply with the conversation phone and the sending staff id after a successful WhatsApp send', async () => {
    prismaMock.aiConversation.findUnique.mockResolvedValue({ id: 'conv-1', channel: 'WHATSAPP', phoneNumber: '+256700000001' })
    prismaMock.aiMessage.create.mockResolvedValue({ id: 'msg-1' })

    const res = await send('conv-1', 'Hi, thanks for reaching out!')

    expect(res.status).toBe(200)
    expect(advanceLeadOnHumanReply).toHaveBeenCalledWith('+256700000001', 'staff-1')
  })

  it('still returns success even if advanceLeadOnHumanReply unexpectedly rejects — the real message already sent, so this must not become a false failure', async () => {
    prismaMock.aiConversation.findUnique.mockResolvedValue({ id: 'conv-1', channel: 'WHATSAPP', phoneNumber: '+256700000001' })
    prismaMock.aiMessage.create.mockResolvedValue({ id: 'msg-1' })
    advanceLeadOnHumanReply.mockRejectedValueOnce(new Error('should never happen — advanceLeadOnHumanReply has its own internal try/catch — but the route must not depend on that alone'))

    const res = await send('conv-1', 'Hi there')

    expect(res.status).toBe(200)
    expect((await res.json())).toEqual({ success: true })
    expect(sendWhatsAppMessage).toHaveBeenCalled() // the real send happened before the (failed) advance step
  })

  it('calls advanceLeadOnHumanReply for FACEBOOK/INSTAGRAM sends too, not just WhatsApp', async () => {
    prismaMock.aiConversation.findUnique.mockResolvedValue({ id: 'conv-2', channel: 'FACEBOOK', phoneNumber: 'fb:12345' })
    prismaMock.aiMessage.create.mockResolvedValue({ id: 'msg-2' })

    const res = await send('conv-2', 'Thanks for your message!')

    expect(res.status).toBe(200)
    expect(advanceLeadOnHumanReply).toHaveBeenCalledWith('fb:12345', 'staff-1')
  })

  it('does not call advanceLeadOnHumanReply when the conversation does not exist', async () => {
    prismaMock.aiConversation.findUnique.mockResolvedValue(null)

    const res = await send('missing-conv', 'Hello')

    expect(res.status).toBe(404)
    expect(advanceLeadOnHumanReply).not.toHaveBeenCalled()
  })
})
