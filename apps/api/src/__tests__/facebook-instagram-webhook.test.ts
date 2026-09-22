import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Fixture-based coverage for the Facebook/Instagram DM + comment ingestion
// path (facebook.routes.ts) — built during the 2026-09-20 Meta integration
// closure to cover exactly what section G of that audit required:
// parsing, idempotency (Meta redelivers webhooks at-least-once), self-
// account/echo guards, channel-correct persistence, and outbound routing.
// No live Meta call is ever made — global.fetch is mocked throughout, and
// no real patient/customer message or comment is sent.

const { prismaMock, findOrCreateLeadForChannel, getAgentReplyV2OpenAI, getCommentReplyOpenAI, isAgentEnabled, maybeNotifyStaff } = vi.hoisted(() => ({
  prismaMock: {
    aiAgentConfig: { findFirst: vi.fn() },
    aiConversation: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    aiMessage: { findFirst: vi.fn(), create: vi.fn() },
  },
  findOrCreateLeadForChannel: vi.fn().mockResolvedValue({ lead: { id: 'lead-1' }, isNew: true }),
  getAgentReplyV2OpenAI: vi.fn().mockResolvedValue('AI reply text'),
  getCommentReplyOpenAI: vi.fn().mockResolvedValue('AI comment reply'),
  isAgentEnabled: vi.fn().mockResolvedValue(true),
  maybeNotifyStaff: vi.fn(),
}))

vi.mock('../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../ai-suite/agent/agent.service', () => ({ getAgentReplyV2OpenAI, getCommentReplyOpenAI }))
vi.mock('../ai-suite/takeover/takeover.service', () => ({ isAgentEnabled }))
vi.mock('../ai-suite/whatsapp/whatsapp.service', () => ({ maybeNotifyStaff }))
vi.mock('../crm-automation/lead-intake.service', () => ({ findOrCreateLeadForChannel }))

import { processSocialMessage, processComment, sendSocialReply, sendCommentReply } from '../ai-suite/facebook/facebook.routes'

const FB_PAGE_ID = '532091973485208'
const IG_ACCOUNT_ID = '17841404690443540'

const originalFetch = global.fetch
beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.aiAgentConfig.findFirst.mockResolvedValue(null)
  prismaMock.aiConversation.findFirst.mockResolvedValue(null)
  prismaMock.aiConversation.create.mockImplementation(async ({ data }: any) => ({ id: 'conv-1', ...data }))
  prismaMock.aiConversation.update.mockResolvedValue({})
  prismaMock.aiMessage.findFirst.mockResolvedValue(null)
  prismaMock.aiMessage.create.mockResolvedValue({})
  isAgentEnabled.mockResolvedValue(true)
  findOrCreateLeadForChannel.mockResolvedValue({ lead: { id: 'lead-1' }, isNew: true })
  process.env.FACEBOOK_PAGE_ACCESS_TOKEN = 'test-fb-page-token'
  process.env.INSTAGRAM_ACCESS_TOKEN = 'test-ig-token'
  process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID = IG_ACCOUNT_ID
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}), text: async () => '' }) as any
})
afterEach(() => { global.fetch = originalFetch })

// ── Realistic Meta webhook fixtures ────────────────────────────────────────
// Shapes mirror actual Graph API v24.0 payloads (entry[].messaging[] for
// DMs, entry[].changes[] with field:"comments"/"feed" for comments) as
// confirmed live during the 2026-09-20 investigation. These constants exist
// so the test bodies read like "given this real Meta payload shape, what do
// we extract and pass to the processor" even though the route's own
// extraction loop is exercised in the route files, not re-implemented here.
const fbDmFixture = {
  object: 'page',
  entry: [{
    id: FB_PAGE_ID,
    messaging: [{
      sender: { id: '28540242905567428' },
      recipient: { id: FB_PAGE_ID },
      timestamp: 1758000000000,
      message: { mid: 'mid.FB123', text: 'How much for a cleaning?' },
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

describe('processSocialMessage — DM ingestion', () => {
  it('persists an inbound FACEBOOK DM, notifies staff, and sends an AI reply', async () => {
    const event = fbDmFixture.entry[0].messaging[0]
    await processSocialMessage(event.sender.id, event.message.text, 'FACEBOOK', event.message.mid)

    expect(prismaMock.aiConversation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ channel: 'FACEBOOK', phoneNumber: event.sender.id }),
    }))
    expect(prismaMock.aiMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ role: 'USER', content: event.message.text }),
    }))
    expect(maybeNotifyStaff).toHaveBeenCalled()
    expect(getAgentReplyV2OpenAI).toHaveBeenCalledWith('conv-1', event.sender.id, event.message.text, 'FACEBOOK')
  })

  it('never processes a message whose sender is our own Page ID — self-reply loop guard', async () => {
    await processSocialMessage(FB_PAGE_ID, 'echoed text', 'FACEBOOK', 'mid.echo')
    expect(prismaMock.aiConversation.create).not.toHaveBeenCalled()
    expect(prismaMock.aiMessage.create).not.toHaveBeenCalled()
    expect(getAgentReplyV2OpenAI).not.toHaveBeenCalled()
  })

  it('never processes a message whose sender is our own Instagram account ID', async () => {
    await processSocialMessage(IG_ACCOUNT_ID, 'echoed text', 'INSTAGRAM', 'mid.echo')
    expect(prismaMock.aiConversation.create).not.toHaveBeenCalled()
  })

  it('idempotency: a redelivered webhook for the same messageId is skipped entirely (no duplicate message/reply/notify)', async () => {
    prismaMock.aiMessage.findFirst.mockResolvedValue({ id: 'existing-msg' }) // marker already recorded

    await processSocialMessage('sender-1', 'hello', 'FACEBOOK', 'mid.duplicate')

    expect(prismaMock.aiMessage.findFirst).toHaveBeenCalledWith({ where: { metadata: { contains: '"messageId":"mid.duplicate"' } } })
    expect(prismaMock.aiConversation.create).not.toHaveBeenCalled()
    expect(prismaMock.aiConversation.findFirst).not.toHaveBeenCalled()
    expect(maybeNotifyStaff).not.toHaveBeenCalled()
    expect(getAgentReplyV2OpenAI).not.toHaveBeenCalled()
  })

  it('stores the real Meta message ID in metadata so a later redelivery can be recognized', async () => {
    await processSocialMessage('sender-1', 'hi', 'INSTAGRAM', 'mid.IG456')
    expect(prismaMock.aiMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ metadata: JSON.stringify({ messageId: 'mid.IG456' }) }),
    }))
  })

  it('does not fail or skip processing when no messageId is available (idempotency is best-effort, not a hard requirement)', async () => {
    await processSocialMessage('sender-1', 'hi', 'FACEBOOK', undefined)
    expect(prismaMock.aiConversation.create).toHaveBeenCalled()
  })

  it('skips the AI reply (but still stores the message) when the channel is human-takeover', async () => {
    isAgentEnabled.mockResolvedValue(false)
    await processSocialMessage('sender-1', 'hi', 'FACEBOOK', 'mid.1')
    expect(prismaMock.aiMessage.create).toHaveBeenCalledTimes(1) // USER message only, no AGENT reply
    expect(getAgentReplyV2OpenAI).not.toHaveBeenCalled()
  })

  it('skips the AI reply when the FB DM channel kill-switch (fbDmsEnabled) is off', async () => {
    prismaMock.aiAgentConfig.findFirst.mockResolvedValue({ fbDmsEnabled: false })
    await processSocialMessage('sender-1', 'hi', 'FACEBOOK', 'mid.1')
    expect(getAgentReplyV2OpenAI).not.toHaveBeenCalled()
  })
})

describe('processComment — comment ingestion', () => {
  it('persists an inbound INSTAGRAM_COMMENT, notifies staff, and sends an AI reply via the comment-reply endpoint', async () => {
    const c = igCommentFixture.entry[0].changes[0].value
    await processComment(c.id, c.media.id, c.from.id, c.from.username, c.text, 'INSTAGRAM_COMMENT')

    expect(prismaMock.aiConversation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ channel: 'INSTAGRAM_COMMENT', phoneNumber: c.from.id }),
    }))
    expect(maybeNotifyStaff).toHaveBeenCalled()
    expect(getCommentReplyOpenAI).toHaveBeenCalled()
    // sendCommentReply must hit Instagram's /replies path, never /comments (that's the Facebook path)
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(`/${c.id}/replies`),
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('never processes a comment authored by our own Page — self-reply loop guard', async () => {
    await processComment('c1', 'post1', FB_PAGE_ID, 'Code Clinic', 'own comment', 'FACEBOOK_COMMENT')
    expect(prismaMock.aiConversation.create).not.toHaveBeenCalled()
  })

  it('never processes a comment authored by our own Instagram account', async () => {
    await processComment('c1', 'media1', IG_ACCOUNT_ID, 'code_clinic', 'own comment', 'INSTAGRAM_COMMENT')
    expect(prismaMock.aiConversation.create).not.toHaveBeenCalled()
  })

  it('idempotency: a redelivered webhook for the same commentId is skipped entirely', async () => {
    prismaMock.aiMessage.findFirst.mockResolvedValue({ id: 'existing' })
    await processComment('c-dup', 'post1', 'user-1', 'Jane', 'text', 'FACEBOOK_COMMENT')
    expect(prismaMock.aiConversation.create).not.toHaveBeenCalled()
    expect(getCommentReplyOpenAI).not.toHaveBeenCalled()
  })

  it('skips a nested reply with no known parent and no clinic-relevant keywords (spam/off-topic thread noise)', async () => {
    // parentId !== postId (not top-level) and parent not found in DB and text has no dental keywords
    prismaMock.aiMessage.findFirst.mockResolvedValue(null)
    await processComment('c2', 'post1', 'user-1', 'Jane', 'lol nice', 'FACEBOOK_COMMENT', 'some-other-comment-id')
    expect(prismaMock.aiConversation.create).not.toHaveBeenCalled()
  })

  it('processes a nested reply when the text is directed at the clinic even with no known parent', async () => {
    prismaMock.aiMessage.findFirst.mockResolvedValue(null)
    await processComment('c3', 'post1', 'user-1', 'Jane', 'how much for braces?', 'FACEBOOK_COMMENT', 'some-other-comment-id')
    expect(prismaMock.aiConversation.create).toHaveBeenCalled()
  })
})

describe('outbound routing — never crosses channels, mocked fetch only, no real sends', () => {
  it('sendSocialReply uses the Instagram token (not the Facebook token) for an INSTAGRAM recipient', async () => {
    prismaMock.aiAgentConfig.findFirst.mockResolvedValue({ facebookPageAccessToken: null, instagramAccessToken: null })
    process.env.FACEBOOK_PAGE_ACCESS_TOKEN = 'FB-TOKEN'
    process.env.INSTAGRAM_ACCESS_TOKEN = 'IG-TOKEN'

    await sendSocialReply('recipient-1', 'hello', 'INSTAGRAM')

    const call = (global.fetch as any).mock.calls[0]
    expect(call[1].headers.Authorization).toBe('Bearer IG-TOKEN')
  })

  it('sendSocialReply uses the Facebook token (not the Instagram token) for a FACEBOOK recipient', async () => {
    prismaMock.aiAgentConfig.findFirst.mockResolvedValue({ facebookPageAccessToken: null, instagramAccessToken: null })
    process.env.FACEBOOK_PAGE_ACCESS_TOKEN = 'FB-TOKEN'
    process.env.INSTAGRAM_ACCESS_TOKEN = 'IG-TOKEN'

    await sendSocialReply('recipient-1', 'hello', 'FACEBOOK')

    const call = (global.fetch as any).mock.calls[0]
    expect(call[1].headers.Authorization).toBe('Bearer FB-TOKEN')
  })

  it('does not send anything when no token is configured for the channel', async () => {
    prismaMock.aiAgentConfig.findFirst.mockResolvedValue(null)
    delete process.env.FACEBOOK_PAGE_ACCESS_TOKEN
    await sendSocialReply('recipient-1', 'hello', 'FACEBOOK')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('sendCommentReply posts a Facebook comment reply to /{commentId}/comments (never /replies, the Instagram path)', async () => {
    prismaMock.aiAgentConfig.findFirst.mockResolvedValue(null)
    await sendCommentReply('comment-1', 'reply text', 'FACEBOOK_COMMENT')
    const call = (global.fetch as any).mock.calls[0]
    expect(call[0]).toContain('/comment-1/comments')
    expect(call[0]).not.toContain('/replies')
  })

  it('sendCommentReply posts an Instagram reply to /{commentId}/replies (never /comments, the Facebook path)', async () => {
    prismaMock.aiAgentConfig.findFirst.mockResolvedValue(null)
    await sendCommentReply('comment-1', 'reply text', 'INSTAGRAM_COMMENT')
    const call = (global.fetch as any).mock.calls[0]
    expect(call[0]).toContain('/comment-1/replies')
  })
})
