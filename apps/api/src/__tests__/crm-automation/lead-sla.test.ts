import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.setConfig({ testTimeout: 20000 })

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    lead: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
    leadSlaEvent: { create: vi.fn() },
    notification: { create: vi.fn() },
    user: { findMany: vi.fn().mockResolvedValue([]) },
    leadConsentLog: { findFirst: vi.fn() },
  },
}))

vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../../services/push.service', () => ({ sendPushToUser: vi.fn().mockResolvedValue(undefined) }))
const sendWhatsAppMessage = vi.hoisted(() => vi.fn().mockResolvedValue('wamid-1'))
vi.mock('../../ai-suite/whatsapp/whatsapp.service', () => ({ sendWhatsAppMessage }))

import { checkLeadSlas, cancelSlaOnHumanReply } from '../../crm-automation/lead-sla.service'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NODE_ENV = 'test'
  delete process.env.CRM_AUTOMATION_LIVE
  prismaMock.lead.findMany.mockResolvedValue([])
  prismaMock.user.findMany.mockResolvedValue([])
  prismaMock.leadConsentLog.findFirst.mockResolvedValue(null)
})

describe('checkLeadSlas', () => {
  it('escalates to owner + team lead at 15 minutes with no human reply', async () => {
    prismaMock.lead.findMany
      .mockResolvedValueOnce([{ id: 'lead-1', assignedTo: 'owner-1', name: 'Jane', phone: '+256700000001' }]) // 15-min query
      .mockResolvedValueOnce([]) // 30-min query
      .mockResolvedValueOnce([]) // 24h query
    prismaMock.user.findMany.mockResolvedValue([{ id: 'admin-1' }])

    const result = await checkLeadSlas()

    expect(result.escalated15).toBe(1)
    expect(prismaMock.lead.update).toHaveBeenCalledWith({ where: { id: 'lead-1' }, data: { slaState: 'ESCALATED_15' } })
    expect(prismaMock.leadSlaEvent.create).toHaveBeenCalledWith({ data: { leadId: 'lead-1', type: 'ESCALATION_15' } })
    // Notified both the assigned owner and the team lead(s)
    expect(prismaMock.notification.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: 'owner-1' }) }))
    expect(prismaMock.notification.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: 'admin-1' }) }))
  })

  it('BLOCKS the 30-minute warm message when there is no inbound-origin evidence — never messages a lead with no proof they reached out', async () => {
    prismaMock.lead.findMany
      .mockResolvedValueOnce([]) // 15-min
      .mockResolvedValueOnce([{ id: 'lead-2', name: 'Jane', phone: '+256700000002' }]) // 30-min
      .mockResolvedValueOnce([]) // 24h
    prismaMock.leadConsentLog.findFirst.mockResolvedValue(null) // no operational evidence at all
    const result = await checkLeadSlas()
    expect(result.warm30).toBe(1)
    expect(prismaMock.lead.update).toHaveBeenCalledWith({ where: { id: 'lead-2' }, data: { slaState: 'ESCALATED_30' } })
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
    expect(prismaMock.leadSlaEvent.create).toHaveBeenCalledWith({
      data: { leadId: 'lead-2', type: 'WARM_MESSAGE_30', metadata: JSON.stringify({ dryRun: true, hadPhone: true, blockedReason: 'no_contact_origin_evidence' }) },
    })
  })

  it('sends a real dry-run-gated second warm message at 30 minutes when inbound-origin evidence exists within the window', async () => {
    prismaMock.lead.findMany
      .mockResolvedValueOnce([]) // 15-min
      .mockResolvedValueOnce([{ id: 'lead-2', name: 'Jane', phone: '+256700000002' }]) // 30-min
      .mockResolvedValueOnce([]) // 24h
    prismaMock.leadConsentLog.findFirst
      .mockResolvedValueOnce(null) // opt-out check
      .mockResolvedValueOnce({ channel: 'WHATSAPP', purpose: 'OPERATIONAL', status: 'OPT_IN', recordedAt: new Date() }) // recent inbound evidence
    const result = await checkLeadSlas()
    expect(result.warm30).toBe(1)
    expect(sendWhatsAppMessage).not.toHaveBeenCalled() // still dry-run gated (Part W)
    expect(prismaMock.leadSlaEvent.create).toHaveBeenCalledWith({
      data: { leadId: 'lead-2', type: 'WARM_MESSAGE_30', metadata: JSON.stringify({ dryRun: true, hadPhone: true, blockedReason: null }) },
    })
  })

  it('30-minute warm message records hadPhone:false and never queries consent when the lead has no phone', async () => {
    prismaMock.lead.findMany
      .mockResolvedValueOnce([]) // 15-min
      .mockResolvedValueOnce([{ id: 'lead-2b', name: 'No Phone', phone: null }]) // 30-min
      .mockResolvedValueOnce([]) // 24h
    await checkLeadSlas()
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
    expect(prismaMock.leadConsentLog.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.leadSlaEvent.create).toHaveBeenCalledWith({
      data: { leadId: 'lead-2b', type: 'WARM_MESSAGE_30', metadata: JSON.stringify({ dryRun: true, hadPhone: false, blockedReason: null }) },
    })
  })

  it('flags a lead stale and escalates to Admin at 24 hours', async () => {
    prismaMock.lead.findMany
      .mockResolvedValueOnce([]) // 15-min
      .mockResolvedValueOnce([]) // 30-min
      .mockResolvedValueOnce([{ id: 'lead-3', name: 'Old Lead' }]) // 24h
    prismaMock.user.findMany.mockResolvedValue([{ id: 'admin-1' }])

    const result = await checkLeadSlas()

    expect(result.stale24).toBe(1)
    expect(prismaMock.lead.update).toHaveBeenCalledWith({ where: { id: 'lead-3' }, data: { slaState: 'STALE_24H' } })
  })

  it('never queries/escalates leads that already have firstHumanReplyAt set (enforced via the where clause)', async () => {
    await checkLeadSlas()
    for (const call of prismaMock.lead.findMany.mock.calls) {
      expect(call[0].where.firstHumanReplyAt).toEqual(null)
    }
  })
})

describe('cancelSlaOnHumanReply', () => {
  it('sets slaState to REPLIED so no future sweep can escalate this lead again', async () => {
    await cancelSlaOnHumanReply('lead-1')
    expect(prismaMock.lead.update).toHaveBeenCalledWith({ where: { id: 'lead-1' }, data: { slaState: 'REPLIED' } })
    expect(prismaMock.leadSlaEvent.create).toHaveBeenCalledWith({ data: { leadId: 'lead-1', type: 'SLA_CANCELLED' } })
  })
})