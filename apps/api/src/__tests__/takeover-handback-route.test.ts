// Covers the takeover/handback route changes in this milestone
// (apps/api/src/ai-suite/takeover/takeover.routes.ts):
// - staffId is now derived from the authenticated session (req.user.id),
//   never a client-supplied body field, on BOTH takeover and handback
//   (handback previously captured no staffId at all — asymmetric with
//   takeover).
// - handback accepts an optional free-text `summary`, trimmed and capped.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import type { Server } from 'node:http'

const { takeoverConversation, handbackConversation } = vi.hoisted(() => ({
  takeoverConversation: vi.fn().mockResolvedValue(undefined),
  handbackConversation: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../lib/prisma', () => ({ prisma: { aiConversation: { findMany: vi.fn() } } }))
vi.mock('../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = { id: 'staff-42', role: 'RECEPTIONIST', firstName: 'Julian', lastName: 'K' }; next() },
}))
vi.mock('../middleware/rbac', () => ({ adminAndReceptionist: (_req: any, _res: any, next: any) => next() }))
vi.mock('../ai-suite/takeover/takeover.service', () => ({ takeoverConversation, handbackConversation }))
vi.mock('../lib/doctor-access', () => ({ authenticatedDoctorId: vi.fn() }))
vi.mock('../ai-suite/facebook/facebook.routes', () => ({
  fetchPostThumbnail: vi.fn(), sendSocialReply: vi.fn(), sendCommentReply: vi.fn(),
}))
vi.mock('../ai-suite/whatsapp/whatsapp.service', () => ({ sendWhatsAppMessage: vi.fn() }))
vi.mock('../crm-automation/lead-stage.service', () => ({ advanceLeadOnHumanReply: vi.fn() }))

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

describe('POST /ai-suite/takeover/:conversationId', () => {
  it('derives staffId from the authenticated session, ignoring any client-supplied body field', async () => {
    const res = await fetch(`${origin}/takeover/conv-1`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ staffId: 'spoofed-staff-id' }),
    })
    expect(res.status).toBe(200)
    expect(takeoverConversation).toHaveBeenCalledWith('conv-1', 'staff-42')
  })
})

describe('POST /ai-suite/handback/:conversationId', () => {
  it('derives staffId from the authenticated session and passes no summary when the body is empty', async () => {
    const res = await fetch(`${origin}/handback/conv-1`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    expect(res.status).toBe(200)
    expect(handbackConversation).toHaveBeenCalledWith('conv-1', 'staff-42', undefined)
  })

  it('passes a trimmed optional summary through to handbackConversation', async () => {
    await fetch(`${origin}/handback/conv-1`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary: '  Patient wanted a filling, booked Tuesday 8am.  ' }),
    })
    expect(handbackConversation).toHaveBeenCalledWith('conv-1', 'staff-42', 'Patient wanted a filling, booked Tuesday 8am.')
  })

  it('caps an excessively long summary at 1000 characters rather than storing it unbounded', async () => {
    const huge = 'x'.repeat(5000)
    await fetch(`${origin}/handback/conv-1`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary: huge }),
    })
    const passedSummary = handbackConversation.mock.calls[0][2]
    expect(passedSummary.length).toBe(1000)
  })

  it('a whitespace-only summary is treated as no summary', async () => {
    await fetch(`${origin}/handback/conv-1`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary: '   ' }),
    })
    expect(handbackConversation).toHaveBeenCalledWith('conv-1', 'staff-42', undefined)
  })
})
