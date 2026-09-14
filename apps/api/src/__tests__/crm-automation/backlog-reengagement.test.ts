import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

vi.setConfig({ testTimeout: 20000 })

const { prismaMock, sendWhatsAppMessage } = vi.hoisted(() => ({
  prismaMock: {
    backlogCampaignRun: { findFirst: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    lead: { findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn(), findUniqueOrThrow: vi.fn(), count: vi.fn() },
    leadStageHistory: { create: vi.fn() },
    automationEvent: { create: vi.fn().mockResolvedValue({ id: 'evt' }), update: vi.fn() },
    sequenceDefinition: { findMany: vi.fn().mockResolvedValue([]) },
    sequenceEnrollment: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
    scheduledTouch: { updateMany: vi.fn() },
    leadConsentLog: { findFirst: vi.fn() },
  },
  sendWhatsAppMessage: vi.fn().mockResolvedValue('wamid-1'),
}))

vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../../ai-suite/whatsapp/whatsapp.service', () => ({ sendWhatsAppMessage }))

import { tagBacklogLeads, executeBacklogCampaign, sweepBacklogNoResponse, previewBacklogEligibility } from '../../crm-automation/backlog-reengagement.service'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NODE_ENV = 'test'
  delete process.env.CRM_AUTOMATION_LIVE
  prismaMock.leadConsentLog.findFirst.mockResolvedValue(null)
})

describe('tagBacklogLeads — step 1 (Part Q)', () => {
  it('refuses to start a second run while one is already in progress', async () => {
    prismaMock.backlogCampaignRun.findFirst.mockResolvedValue({ id: 'run-1', status: 'TAGGED' })
    await expect(tagBacklogLeads()).rejects.toThrow(/already in progress/i)
  })

  it('only tags — never sends anything — and bulk-tags legacy New leads', async () => {
    prismaMock.backlogCampaignRun.findFirst.mockResolvedValue(null)
    prismaMock.lead.findMany.mockResolvedValue([{ id: 'l-1' }, { id: 'l-2' }])
    prismaMock.backlogCampaignRun.create.mockResolvedValue({ id: 'run-1' })

    const result = await tagBacklogLeads()

    expect(result).toEqual({ leadCount: 2, runId: 'run-1' })
    expect(prismaMock.lead.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['l-1', 'l-2'] } }, data: { backlogTag: true } })
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })
})

describe('executeBacklogCampaign — step 2, requires explicit approval', () => {
  it('refuses to run against a run that is not in TAGGED status', async () => {
    prismaMock.backlogCampaignRun.findUniqueOrThrow.mockResolvedValue({ id: 'run-1', status: 'CAMPAIGN_SENT' })
    await expect(executeBacklogCampaign('run-1', 'admin-1')).rejects.toThrow(/expected TAGGED/i)
  })

  it('skips every lead with no explicit MARKETING opt-in — the safe default when nothing has ever captured one', async () => {
    prismaMock.backlogCampaignRun.findUniqueOrThrow.mockResolvedValue({ id: 'run-1', status: 'TAGGED' })
    prismaMock.lead.findMany.mockResolvedValue([{ id: 'l-1', phone: '+256700000001', name: 'Jo' }])
    prismaMock.leadConsentLog.findFirst.mockResolvedValue(null) // no opt-out, no marketing opt-in

    const result = await executeBacklogCampaign('run-1', 'admin-1')

    expect(prismaMock.backlogCampaignRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ approvedBy: 'admin-1' }) })
    )
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
    expect(result.sent).toBe(0)
    expect(result.skippedNoConsent).toBe(1)
  })

  it('sends (in dry-run mode) only to leads with an explicit MARKETING opt-in on that channel', async () => {
    prismaMock.backlogCampaignRun.findUniqueOrThrow.mockResolvedValue({ id: 'run-1', status: 'TAGGED' })
    prismaMock.lead.findMany.mockResolvedValue([{ id: 'l-1', phone: '+256700000001', name: 'Jo' }])
    prismaMock.leadConsentLog.findFirst
      .mockResolvedValueOnce(null) // opt-out check
      .mockResolvedValueOnce({ channel: 'WHATSAPP', purpose: 'MARKETING', status: 'OPT_IN' }) // explicit marketing opt-in

    const result = await executeBacklogCampaign('run-1', 'admin-1')

    expect(sendWhatsAppMessage).not.toHaveBeenCalled() // still dry-run gated
    expect(result.sent).toBe(1)
    expect(result.skippedNoConsent).toBe(0)
    expect(result.anyDryRun).toBe(true)
  })
})

describe('previewBacklogEligibility — dry-run count before activation', () => {
  it('reports zero eligible when no lead has an explicit marketing opt-in', async () => {
    prismaMock.lead.findMany.mockResolvedValue([{ id: 'l-1', phone: '+256700000001' }, { id: 'l-2', phone: '+256700000002' }])
    prismaMock.leadConsentLog.findFirst.mockResolvedValue(null)
    const result = await previewBacklogEligibility('run-1')
    expect(result.totalTagged).toBe(2)
    expect(result.eligibleToSend).toBe(0)
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })
})

describe('executeBacklogCampaign — CRM_BACKLOG_REENGAGEMENT_LIVE feature flag (release-blocker fix — per-feature gating)', () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV
  beforeEach(() => { process.env.NODE_ENV = 'production' })
  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV
    delete process.env.CRM_AUTOMATION_LIVE
    delete process.env.CRM_BACKLOG_REENGAGEMENT_LIVE
  })

  it('master+feature ON but NO marketing consent -> still blocked, never a real send', async () => {
    process.env.CRM_AUTOMATION_LIVE = 'true'
    process.env.CRM_BACKLOG_REENGAGEMENT_LIVE = 'true'
    prismaMock.backlogCampaignRun.findUniqueOrThrow.mockResolvedValue({ id: 'run-1', status: 'TAGGED' })
    prismaMock.lead.findMany.mockResolvedValue([{ id: 'l-1', phone: '+256700000001', name: 'Jo' }])
    prismaMock.leadConsentLog.findFirst.mockResolvedValue(null)

    const result = await executeBacklogCampaign('run-1', 'admin-1')

    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
    expect(result.sent).toBe(0)
    expect(result.skippedNoConsent).toBe(1)
  })

  it('master+feature ON WITH explicit marketing consent -> a real send is attempted', async () => {
    process.env.CRM_AUTOMATION_LIVE = 'true'
    process.env.CRM_BACKLOG_REENGAGEMENT_LIVE = 'true'
    prismaMock.backlogCampaignRun.findUniqueOrThrow.mockResolvedValue({ id: 'run-1', status: 'TAGGED' })
    prismaMock.lead.findMany.mockResolvedValue([{ id: 'l-1', phone: '+256700000001', name: 'Jo' }])
    prismaMock.leadConsentLog.findFirst
      .mockResolvedValueOnce(null) // opt-out check
      .mockResolvedValueOnce({ channel: 'WHATSAPP', purpose: 'MARKETING', status: 'OPT_IN' })

    const result = await executeBacklogCampaign('run-1', 'admin-1')

    expect(sendWhatsAppMessage).toHaveBeenCalledTimes(1)
    expect(result.sent).toBe(1)
    expect(result.anyDryRun).toBe(false)
  })

  it('master ON but BACKLOG feature flag OFF -> still dry-run even with explicit consent', async () => {
    process.env.CRM_AUTOMATION_LIVE = 'true' // BACKLOG flag deliberately not set
    prismaMock.backlogCampaignRun.findUniqueOrThrow.mockResolvedValue({ id: 'run-1', status: 'TAGGED' })
    prismaMock.lead.findMany.mockResolvedValue([{ id: 'l-1', phone: '+256700000001', name: 'Jo' }])
    prismaMock.leadConsentLog.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ channel: 'WHATSAPP', purpose: 'MARKETING', status: 'OPT_IN' })

    const result = await executeBacklogCampaign('run-1', 'admin-1')

    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
    expect(result.anyDryRun).toBe(true)
  })
})

describe('sweepBacklogNoResponse — step 3', () => {
  it('moves unresponsive backlog leads to LOST tagged backlog_no_response', async () => {
    prismaMock.lead.findMany.mockResolvedValue([{ id: 'l-1', status: 'NEW' }])
    prismaMock.lead.findUniqueOrThrow.mockResolvedValue({ id: 'l-1', status: 'NEW', lossReason: null })
    prismaMock.lead.update.mockResolvedValue({ id: 'l-1', status: 'LOST' })
    prismaMock.lead.count.mockResolvedValue(0)

    const count = await sweepBacklogNoResponse()

    expect(count).toBe(1)
    expect(prismaMock.leadStageHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ toStage: 'LOST', reason: 'backlog_no_response' }) })
    )
    expect(prismaMock.lead.update).toHaveBeenCalledWith({ where: { id: 'l-1' }, data: { backlogNoResponse: true } })
  })
})