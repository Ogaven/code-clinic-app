import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.setConfig({ testTimeout: 20000 })

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    leadConsentLog: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
  },
}))

vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))

import { recordLeadConsent, decideLeadSend, isAllowed, getLeadConsentHistory } from '../../crm-automation/lead-consent.service'

beforeEach(() => { vi.clearAllMocks() })

describe('recordLeadConsent — append-only', () => {
  it('always creates a new row', async () => {
    await recordLeadConsent({ leadId: 'lead-1', channel: 'WHATSAPP', status: 'OPT_IN', purpose: 'OPERATIONAL', source: 'INBOUND_MESSAGE' })
    expect(prismaMock.leadConsentLog.create).toHaveBeenCalledWith({
      data: { leadId: 'lead-1', channel: 'WHATSAPP', status: 'OPT_IN', purpose: 'OPERATIONAL', source: 'INBOUND_MESSAGE', recordedByUserId: null, metadata: null },
    })
  })
})

describe('decideLeadSend — no "no record = opted in" default', () => {
  it('BLOCKS operational sends when the lead has never contacted this channel', async () => {
    prismaMock.leadConsentLog.findFirst.mockResolvedValue(null) // no evidence anywhere
    const result = await decideLeadSend('lead-1', 'WHATSAPP', 'OPERATIONAL')
    expect(result.decision).toBe('BLOCK_NO_CONSENT')
    expect(isAllowed(result)).toBe(false)
  })

  it('ALLOWS operational sends — inbound WhatsApp contact origin exists', async () => {
    prismaMock.leadConsentLog.findFirst
      .mockResolvedValueOnce(null) // opt-out check for this channel
      .mockResolvedValueOnce({ channel: 'WHATSAPP', purpose: 'OPERATIONAL', status: 'OPT_IN', recordedAt: new Date() })
    const result = await decideLeadSend('lead-1', 'WHATSAPP', 'OPERATIONAL')
    expect(result.decision).toBe('ALLOW_OPERATIONAL')
    expect(isAllowed(result)).toBe(true)
  })

  it('BLOCKS a manual/walk-in lead with zero contact-origin evidence at all', async () => {
    prismaMock.leadConsentLog.findFirst.mockResolvedValue(null)
    const result = await decideLeadSend('lead-manual', 'WHATSAPP', 'OPERATIONAL')
    expect(result.decision).toBe('BLOCK_NO_CONSENT')
    expect(result.reason).toBe('no_contact_origin_evidence')
  })

  it('BLOCK_WRONG_CHANNEL when evidence exists but on a different channel', async () => {
    prismaMock.leadConsentLog.findFirst
      .mockResolvedValueOnce(null) // opt-out check for SMS
      .mockResolvedValueOnce(null) // operational evidence for SMS — none
      .mockResolvedValueOnce({ channel: 'WHATSAPP', purpose: 'OPERATIONAL' }) // evidence exists, but for WhatsApp
    const result = await decideLeadSend('lead-1', 'SMS', 'OPERATIONAL')
    expect(result.decision).toBe('BLOCK_WRONG_CHANNEL')
    expect(result.reason).toContain('WHATSAPP')
  })

  it('MARKETING requires an explicit opt-in — BLOCKED without one, even with operational evidence present', async () => {
    prismaMock.leadConsentLog.findFirst
      .mockResolvedValueOnce(null) // opt-out check
      .mockResolvedValueOnce(null) // no MARKETING opt-in found
    const result = await decideLeadSend('lead-1', 'WHATSAPP', 'MARKETING')
    expect(result.decision).toBe('BLOCK_NO_CONSENT')
    expect(result.reason).toBe('no_marketing_opt_in_this_channel')
  })

  it('MARKETING is ALLOWED once an explicit opt-in is logged', async () => {
    prismaMock.leadConsentLog.findFirst
      .mockResolvedValueOnce(null) // opt-out check
      .mockResolvedValueOnce({ channel: 'WHATSAPP', purpose: 'MARKETING', status: 'OPT_IN' })
    const result = await decideLeadSend('lead-1', 'WHATSAPP', 'MARKETING')
    expect(result.decision).toBe('ALLOW_MARKETING')
  })

  it('an OPT_OUT on the channel blocks BOTH operational and marketing sends', async () => {
    prismaMock.leadConsentLog.findFirst.mockResolvedValue({ channel: 'WHATSAPP', status: 'OPT_OUT' })
    const operational = await decideLeadSend('lead-1', 'WHATSAPP', 'OPERATIONAL')
    expect(operational.decision).toBe('BLOCK_OPT_OUT')
    const marketing = await decideLeadSend('lead-1', 'WHATSAPP', 'MARKETING')
    expect(marketing.decision).toBe('BLOCK_OPT_OUT')
  })

  it('is channel-specific — an opt-out on SMS does not block WhatsApp', async () => {
    prismaMock.leadConsentLog.findFirst.mockImplementation(({ where }: any) => {
      if (where.channel === 'SMS') return Promise.resolve({ channel: 'SMS', status: 'OPT_OUT' })
      return Promise.resolve(null)
    })
    // WhatsApp check: opt-out lookup for WHATSAPP -> null (no opt-out there)
    const result = await decideLeadSend('lead-1', 'WHATSAPP', 'OPERATIONAL')
    expect(result.decision).not.toBe('BLOCK_OPT_OUT')
  })

  it('respects operationalWindowMs — evidence outside the active window is treated as no consent', async () => {
    const stale = new Date(Date.now() - 48 * 60 * 60 * 1000) // 48h old
    prismaMock.leadConsentLog.findFirst
      .mockResolvedValueOnce(null) // opt-out check
      .mockResolvedValueOnce({ channel: 'WHATSAPP', purpose: 'OPERATIONAL', status: 'OPT_IN', recordedAt: stale })
    const result = await decideLeadSend('lead-1', 'WHATSAPP', 'OPERATIONAL', { operationalWindowMs: 24 * 60 * 60 * 1000 })
    expect(result.decision).toBe('BLOCK_NO_CONSENT')
    expect(result.reason).toBe('operational_evidence_outside_active_window')
  })

  it('allows within the active window', async () => {
    const recent = new Date(Date.now() - 2 * 60 * 60 * 1000) // 2h old
    prismaMock.leadConsentLog.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ channel: 'WHATSAPP', purpose: 'OPERATIONAL', status: 'OPT_IN', recordedAt: recent })
    const result = await decideLeadSend('lead-1', 'WHATSAPP', 'OPERATIONAL', { operationalWindowMs: 24 * 60 * 60 * 1000 })
    expect(result.decision).toBe('ALLOW_OPERATIONAL')
  })
})

describe('getLeadConsentHistory', () => {
  it('returns the full append-only history, newest first', async () => {
    const rows = [{ id: '2' }, { id: '1' }]
    prismaMock.leadConsentLog.findMany.mockResolvedValue(rows)
    const result = await getLeadConsentHistory('lead-1')
    expect(result).toBe(rows)
    expect(prismaMock.leadConsentLog.findMany).toHaveBeenCalledWith({ where: { leadId: 'lead-1' }, orderBy: { recordedAt: 'desc' } })
  })
})
