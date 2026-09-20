import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Coverage for processLeadAdSubmission (facebook.routes.ts) — the receiving
// half of Meta's native Lead Ads (leadgen) webhook, built during the
// 2026-09-16 lead-engine audit after confirming zero prior implementation
// (no "leadgen" references anywhere in the repo, and Meta's own
// /{app-id}/subscriptions endpoint showed the page object subscribed only
// to messages/feed). A read-only check against the live FACEBOOK_PAGE_
// ACCESS_TOKEN during that audit returned Meta error #200 "Requires
// pages_manage_ads permission" — so the fetch below is expected to keep
// failing in production until that permission is granted; this suite
// covers the code path assuming a token that DOES have it.

const { prismaMock, findOrCreateLeadForChannel } = vi.hoisted(() => ({
  prismaMock: { aiAgentConfig: { findFirst: vi.fn() }, lead: { findFirst: vi.fn() } },
  findOrCreateLeadForChannel: vi.fn(),
}))
vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../../ai-suite/agent/agent.service', () => ({ getAgentReplyV2OpenAI: vi.fn(), getCommentReplyOpenAI: vi.fn() }))
vi.mock('../../ai-suite/takeover/takeover.service', () => ({ isAgentEnabled: vi.fn().mockResolvedValue(false) }))
vi.mock('../../ai-suite/whatsapp/whatsapp.service', () => ({ maybeNotifyStaff: vi.fn() }))
vi.mock('../../crm-automation/lead-intake.service', () => ({ findOrCreateLeadForChannel }))

import { processLeadAdSubmission } from '../../ai-suite/facebook/facebook.routes'

const originalFetch = global.fetch
beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.aiAgentConfig.findFirst.mockResolvedValue(null)
  prismaMock.lead.findFirst.mockResolvedValue(null)
  process.env.FACEBOOK_PAGE_ACCESS_TOKEN = 'test-page-token'
})
afterEach(() => { global.fetch = originalFetch })

describe('processLeadAdSubmission', () => {
  it('fetches the full lead via Graph API and creates a lead with source FACEBOOK_LEAD_AD', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ad_id: 'ad-1', form_id: 'form-1',
        field_data: [
          { name: 'full_name', values: ['Jane Doe'] },
          { name: 'phone_number', values: ['+256700000000'] },
          { name: 'email', values: ['jane@example.com'] },
        ],
      }),
    }) as any
    findOrCreateLeadForChannel.mockResolvedValue({ lead: { id: 'lead-1' }, isNew: true })

    await processLeadAdSubmission('leadgen-123')

    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('leadgen-123'))
    expect(findOrCreateLeadForChannel).toHaveBeenCalledTimes(1)
    const call = findOrCreateLeadForChannel.mock.calls[0][0]
    expect(call.createData.source).toBe('FACEBOOK_LEAD_AD')
    expect(call.createData.name).toBe('Jane Doe')
    expect(call.createData.phone).toBe('+256700000000')
    expect(call.createData.notes).toContain('form-1')
    expect(call.createData.provider).toBe('META_LEAD_ADS')
    expect(call.createData.formId).toBe('form-1')
    expect(call.createData.adId).toBe('ad-1')
    expect(call.createData.externalSubmissionId).toBe('leadgen-123')
  })

  it('skips processing when this exact leadgen_id was already processed (Meta redelivers webhooks at-least-once)', async () => {
    prismaMock.lead.findFirst.mockResolvedValue({ id: 'existing-lead' })
    global.fetch = vi.fn() as any // must never even be called — dedupe happens before the Graph API fetch

    await processLeadAdSubmission('leadgen-123')

    expect(prismaMock.lead.findFirst).toHaveBeenCalledWith({ where: { source: 'FACEBOOK_LEAD_AD', externalSubmissionId: 'leadgen-123' } })
    expect(global.fetch).not.toHaveBeenCalled()
    expect(findOrCreateLeadForChannel).not.toHaveBeenCalled()
  })

  it('never creates a lead when the Graph API call fails (e.g. missing leads_retrieval permission)', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, text: async () => '{"error":{"code":200}}' }) as any

    await processLeadAdSubmission('leadgen-123')

    expect(findOrCreateLeadForChannel).not.toHaveBeenCalled()
  })

  it('never creates a lead when field_data has neither phone nor email', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ form_id: 'form-1', field_data: [{ name: 'full_name', values: ['Jane Doe'] }] }),
    }) as any

    await processLeadAdSubmission('leadgen-123')

    expect(findOrCreateLeadForChannel).not.toHaveBeenCalled()
  })
})
