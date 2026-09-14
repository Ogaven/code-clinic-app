import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.setConfig({ testTimeout: 20000 })

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    lead: {
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    leadStageHistory: { create: vi.fn() },
    automationEvent: { create: vi.fn().mockResolvedValue({ id: 'evt' }), update: vi.fn() },
    sequenceDefinition: { findMany: vi.fn().mockResolvedValue([]) },
    sequenceEnrollment: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
    scheduledTouch: { updateMany: vi.fn() },
    leadSlaEvent: { create: vi.fn() },
  },
}))

vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))

import {
  transitionLeadStage,
  logHumanReply,
  recordInboundLeadMessage,
  applyQualifyingIntent,
  markLeadLostManually,
  convertLeadOnBooking,
  sweepStaleContactedLeads,
} from '../../crm-automation/lead-stage.service'

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.sequenceEnrollment.findMany.mockResolvedValue([])
})

describe('transitionLeadStage (Part P — stage history)', () => {
  it('writes a LeadStageHistory row on every real transition', async () => {
    prismaMock.lead.findUniqueOrThrow.mockResolvedValue({ id: 'lead-1', status: 'NEW', lossReason: null })
    prismaMock.lead.update.mockResolvedValue({ id: 'lead-1', status: 'CONTACTED' })

    await transitionLeadStage('lead-1', 'CONTACTED', { changedBy: 'user-1', trigger: 'MANUAL' })

    expect(prismaMock.leadStageHistory.create).toHaveBeenCalledWith({
      data: { leadId: 'lead-1', fromStage: 'NEW', toStage: 'CONTACTED', changedBy: 'user-1', trigger: 'MANUAL', reason: null },
    })
  })

  it('is a no-op (no history row) when the stage does not actually change', async () => {
    prismaMock.lead.findUniqueOrThrow.mockResolvedValue({ id: 'lead-1', status: 'CONTACTED', lossReason: null })
    await transitionLeadStage('lead-1', 'CONTACTED', { changedBy: 'user-1', trigger: 'MANUAL' })
    expect(prismaMock.lead.update).not.toHaveBeenCalled()
    expect(prismaMock.leadStageHistory.create).not.toHaveBeenCalled()
  })

  it('requires a loss reason for any transition to LOST', async () => {
    prismaMock.lead.findUniqueOrThrow.mockResolvedValue({ id: 'lead-1', status: 'CONTACTED', lossReason: null })
    await expect(transitionLeadStage('lead-1', 'LOST', { changedBy: 'user-1', trigger: 'MANUAL' })).rejects.toThrow(/loss reason/i)
  })
})

describe('logHumanReply — STAFF outbound reply, NEW -> CONTACTED (Part N)', () => {
  it('sets firstReplyAt/firstHumanReplyAt/lastOutboundAt — and NEVER lastInboundReplyAt', async () => {
    prismaMock.lead.findUniqueOrThrow
      .mockResolvedValueOnce({ id: 'lead-1', status: 'NEW', assignedTo: 'owner-1', firstReplyAt: null, firstHumanReplyAt: null, lossReason: null })
    prismaMock.lead.update.mockResolvedValueOnce({ id: 'lead-1', firstReplyAt: new Date(), firstHumanReplyAt: new Date(), lastOutboundAt: new Date() })
    // second findUniqueOrThrow call is inside transitionLeadStage
    prismaMock.lead.findUniqueOrThrow.mockResolvedValueOnce({ id: 'lead-1', status: 'NEW', lossReason: null })
    prismaMock.lead.update.mockResolvedValueOnce({ id: 'lead-1', status: 'CONTACTED' })

    await logHumanReply('lead-1', 'owner-1')

    const firstUpdateCall = prismaMock.lead.update.mock.calls[0][0]
    expect(firstUpdateCall.data).toEqual(
      expect.objectContaining({ firstReplyAt: expect.any(Date), firstHumanReplyAt: expect.any(Date), lastOutboundAt: expect.any(Date) })
    )
    expect(firstUpdateCall.data).not.toHaveProperty('lastInboundReplyAt')
  })

  it('transitions to CONTACTED only when the reply is logged by the ASSIGNED owner', async () => {
    prismaMock.lead.findUniqueOrThrow
      .mockResolvedValueOnce({ id: 'lead-1', status: 'NEW', assignedTo: 'owner-1', firstReplyAt: null, firstHumanReplyAt: null, lossReason: null })
    prismaMock.lead.update.mockResolvedValueOnce({ id: 'lead-1', firstReplyAt: new Date(), firstHumanReplyAt: new Date() })
    // second findUniqueOrThrow call is inside transitionLeadStage
    prismaMock.lead.findUniqueOrThrow.mockResolvedValueOnce({ id: 'lead-1', status: 'NEW', lossReason: null })
    prismaMock.lead.update.mockResolvedValueOnce({ id: 'lead-1', status: 'CONTACTED' })

    await logHumanReply('lead-1', 'owner-1')

    expect(prismaMock.leadStageHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ toStage: 'CONTACTED', reason: 'first_human_reply_by_assigned_owner' }) })
    )
  })

  it('does NOT transition when a different staff member (not the assigned owner) logs the reply', async () => {
    prismaMock.lead.findUniqueOrThrow.mockResolvedValueOnce({ id: 'lead-1', status: 'NEW', assignedTo: 'owner-1', firstReplyAt: null, firstHumanReplyAt: null, lossReason: null })
    prismaMock.lead.update.mockResolvedValueOnce({ id: 'lead-1' })

    await logHumanReply('lead-1', 'someone-else')

    expect(prismaMock.leadStageHistory.create).not.toHaveBeenCalled()
  })

  it('cancels the SLA clock and exits active sequence enrollments on any logged human reply', async () => {
    prismaMock.lead.findUniqueOrThrow.mockResolvedValueOnce({ id: 'lead-1', status: 'CONTACTED', assignedTo: 'owner-1', firstReplyAt: new Date(), firstHumanReplyAt: new Date(), lossReason: null })
    prismaMock.lead.update.mockResolvedValueOnce({ id: 'lead-1' })
    prismaMock.sequenceEnrollment.findMany.mockResolvedValueOnce([{ id: 'enr-1' }])

    await logHumanReply('lead-1', 'owner-1')

    expect(prismaMock.leadSlaEvent.create).toHaveBeenCalledWith({ data: { leadId: 'lead-1', type: 'SLA_CANCELLED' } })
    expect(prismaMock.sequenceEnrollment.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'enr-1' }, data: expect.objectContaining({ status: 'EXITED_REPLY' }) })
    )
  })
})

describe('recordInboundLeadMessage — the ONLY writer of lastInboundReplyAt', () => {
  it('writes lastInboundReplyAt and nothing else', async () => {
    await recordInboundLeadMessage('lead-1')
    expect(prismaMock.lead.update).toHaveBeenCalledWith({ where: { id: 'lead-1' }, data: { lastInboundReplyAt: expect.any(Date) } })
  })
})

describe('staff reply vs lead reply — the 48h qualification window must only count real lead replies', () => {
  it('a STAFF reply (logHumanReply) alone does NOT satisfy the "lead responded within 48h" condition', async () => {
    // Staff replies to a NEW lead by someone other than the assigned owner, so no
    // stage transition fires, and — per the fix — lastInboundReplyAt is never touched.
    prismaMock.lead.findUniqueOrThrow.mockResolvedValueOnce({ id: 'lead-1', status: 'CONTACTED', assignedTo: 'owner-1', firstReplyAt: null, firstHumanReplyAt: null, lossReason: null })
    prismaMock.lead.update.mockResolvedValueOnce({ id: 'lead-1' })
    await logHumanReply('lead-1', 'owner-1')

    // Now attempt to qualify: the lead itself never replied (lastInboundReplyAt is
    // still null), so this must be refused even though staff just messaged them.
    prismaMock.lead.findUniqueOrThrow.mockResolvedValueOnce({ id: 'lead-1', status: 'CONTACTED', lastInboundReplyAt: null })
    await expect(applyQualifyingIntent('lead-1', 'owner-1', 'asked_pricing')).rejects.toThrow(/48 hours/i)
  })

  it('a genuine LEAD inbound message (recordInboundLeadMessage) DOES satisfy the condition', async () => {
    await recordInboundLeadMessage('lead-1')
    const recent = new Date()
    prismaMock.lead.findUniqueOrThrow
      .mockResolvedValueOnce({ id: 'lead-1', status: 'CONTACTED', lastInboundReplyAt: recent })
      .mockResolvedValueOnce({ id: 'lead-1', status: 'CONTACTED', lossReason: null })
    prismaMock.lead.update.mockResolvedValueOnce({}).mockResolvedValueOnce({ id: 'lead-1', status: 'QUALIFIED' })

    await applyQualifyingIntent('lead-1', 'owner-1', 'asked_pricing')

    expect(prismaMock.leadStageHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ toStage: 'QUALIFIED' }) })
    )
  })
})

describe('applyQualifyingIntent — CONTACTED -> QUALIFIED (Part N)', () => {
  it('refuses to qualify a lead that has not replied within 48 hours, even with intent supplied', async () => {
    prismaMock.lead.findUniqueOrThrow.mockResolvedValueOnce({ id: 'lead-1', status: 'CONTACTED', lastInboundReplyAt: null })
    await expect(applyQualifyingIntent('lead-1', 'owner-1', 'asked_pricing')).rejects.toThrow(/48 hours/i)
  })

  it('refuses to qualify a lead that is not currently CONTACTED', async () => {
    prismaMock.lead.findUniqueOrThrow.mockResolvedValueOnce({ id: 'lead-1', status: 'NEW', lastInboundReplyAt: new Date() })
    await expect(applyQualifyingIntent('lead-1', 'owner-1', 'asked_pricing')).rejects.toThrow(/CONTACTED/)
  })

  it('qualifies when both conditions hold: recent reply AND an explicit intent', async () => {
    const recent = new Date()
    prismaMock.lead.findUniqueOrThrow
      .mockResolvedValueOnce({ id: 'lead-1', status: 'CONTACTED', lastInboundReplyAt: recent })
      .mockResolvedValueOnce({ id: 'lead-1', status: 'CONTACTED', lossReason: null })
    prismaMock.lead.update.mockResolvedValueOnce({}).mockResolvedValueOnce({ id: 'lead-1', status: 'QUALIFIED' })

    await applyQualifyingIntent('lead-1', 'owner-1', 'asked_pricing')

    expect(prismaMock.leadStageHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ toStage: 'QUALIFIED', reason: 'qualifying_intent:asked_pricing' }) })
    )
  })
})

describe('markLeadLostManually — ANY -> LOST (Part N)', () => {
  it('requires an explicit loss reason and records MANUAL trigger', async () => {
    prismaMock.lead.findUniqueOrThrow.mockResolvedValueOnce({ id: 'lead-1', status: 'QUALIFIED', lossReason: null })
    prismaMock.lead.update.mockResolvedValueOnce({ id: 'lead-1', status: 'LOST' })

    await markLeadLostManually('lead-1', 'owner-1', 'went with a competitor')

    expect(prismaMock.leadStageHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ toStage: 'LOST', trigger: 'MANUAL', reason: 'went with a competitor' }) })
    )
  })
})

describe('convertLeadOnBooking — QUALIFIED -> CONVERTED (Part N)', () => {
  it('exits active enrollments and transitions to CONVERTED with an AUTOMATION trigger', async () => {
    prismaMock.lead.findUniqueOrThrow.mockResolvedValueOnce({ id: 'lead-1', status: 'QUALIFIED', lossReason: null })
    prismaMock.lead.update.mockResolvedValueOnce({ id: 'lead-1', status: 'CONVERTED' })

    await convertLeadOnBooking('lead-1')

    expect(prismaMock.leadStageHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ toStage: 'CONVERTED', trigger: 'AUTOMATION' }) })
    )
  })
})

describe('sweepStaleContactedLeads — CONTACTED -> LOST after 48h silence (Part N)', () => {
  it('queries candidates using plain scalar filters only — no column-to-column comparison in the where clause', async () => {
    await sweepStaleContactedLeads()
    expect(prismaMock.lead.findMany).toHaveBeenCalledWith({
      where: {
        status: 'CONTACTED',
        lastOutboundAt: { not: null, lte: expect.any(Date) },
      },
    })
    // Every value passed to Prisma must be a plain scalar/Date — never a
    // Prisma.LeadScalarFieldEnum / raw field reference standing in for a
    // second column.
    const whereArg = prismaMock.lead.findMany.mock.calls[0][0].where
    for (const value of Object.values(whereArg)) {
      if (value && typeof value === 'object' && !(value instanceof Date)) {
        for (const inner of Object.values(value as object)) {
          expect(inner === null || inner instanceof Date).toBe(true)
        }
      }
    }
  })

  it('moves a lead to LOST with reason no_response when nothing was heard back since the last outbound message', async () => {
    const oldOutbound = new Date(Date.now() - 72 * 60 * 60 * 1000)
    prismaMock.lead.findMany.mockResolvedValueOnce([{ id: 'lead-1', status: 'CONTACTED', lastOutboundAt: oldOutbound, lastInboundReplyAt: null }])
    prismaMock.lead.findUniqueOrThrow.mockResolvedValueOnce({ id: 'lead-1', status: 'CONTACTED', lossReason: null })
    prismaMock.lead.update.mockResolvedValueOnce({ id: 'lead-1', status: 'LOST' })

    const count = await sweepStaleContactedLeads()

    expect(count).toBe(1)
    expect(prismaMock.leadStageHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ toStage: 'LOST', reason: 'no_response' }) })
    )
  })

  it('does NOT mark a lead stale if the lead replied after the last outbound message', async () => {
    const oldOutbound = new Date(Date.now() - 72 * 60 * 60 * 1000)
    const laterReply = new Date(Date.now() - 1 * 60 * 60 * 1000)
    prismaMock.lead.findMany.mockResolvedValueOnce([{ id: 'lead-1', status: 'CONTACTED', lastOutboundAt: oldOutbound, lastInboundReplyAt: laterReply }])

    const count = await sweepStaleContactedLeads()

    expect(count).toBe(0)
    expect(prismaMock.leadStageHistory.create).not.toHaveBeenCalled()
  })
})