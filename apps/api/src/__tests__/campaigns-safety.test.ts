import { describe, expect, it, vi, beforeEach } from 'vitest'

// Milestone: CRM operational functionality closure — Issue Three (Campaigns).
// campaigns.ts's broadcast send previously had ZERO safety net: no consent
// gate, no 24h-window/template fail-closed gate, no duplicate-send
// protection, and it bypasses crm-automation/dry-run.ts's CrmFeature gate
// entirely (deliberately — that master switch is OFF in production, so
// wiring through it would have silently disabled real campaign sending).
// This file proves the new gates this milestone adds, using the same
// "mock the send functions directly" pattern every other test in this
// codebase relies on for NO REAL PATIENT COMMUNICATION.

const { prismaMock, sendWhatsAppMessage, sendWhatsAppTemplate, getChannelConsentStatus } = vi.hoisted(() => ({
  prismaMock: {
    patient: { findMany: vi.fn() },
    nurtureLog: { findMany: vi.fn().mockResolvedValue([]), createMany: vi.fn() },
    campaign: { update: vi.fn().mockResolvedValue({}) },
    aiMessage: { findFirst: vi.fn().mockResolvedValue(null) },
  },
  sendWhatsAppMessage: vi.fn().mockResolvedValue('wamid-1'),
  sendWhatsAppTemplate: vi.fn().mockResolvedValue('wamid-template-1'),
  getChannelConsentStatus: vi.fn().mockResolvedValue(true),
}))

vi.mock('../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('openai', () => ({ default: vi.fn().mockImplementation(() => ({})) }))
vi.mock('../ai-suite/whatsapp/whatsapp.service', () => ({
  sendWhatsAppMessage, sendWhatsAppTemplate, sendWhatsAppMessageDirect: vi.fn(),
}))
vi.mock('../services/patient-analytics.service', () => ({ getPatientsSeen: vi.fn(), splitNewAndReturning: vi.fn() }))
vi.mock('../crm-automation/consent-log.service', () => ({ getChannelConsentStatus }))

import { runBroadcast, resolveRegisteredRange, segmentWhere, encodeTargetSegment } from '../routes/campaigns'

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.nurtureLog.findMany.mockResolvedValue([])
  prismaMock.aiMessage.findFirst.mockResolvedValue(null)
  getChannelConsentStatus.mockResolvedValue(true)
  delete process.env.WA_TEMPLATE_CAMPAIGN_BROADCAST_NAME
})

function patient(overrides: Record<string, any> = {}) {
  return { id: 'p-1', phone: '+256700000001', ...overrides }
}

describe('resolveRegisteredRange / segmentWhere — date-added filter combinable with ANY segment', () => {
  it('returns null when no registeredPreset is given — no filter applied', () => {
    expect(resolveRegisteredRange({ segment: 'ALL' })).toBeNull()
    expect(segmentWhere('ALL', null)).toEqual({ phone: { not: '' } })
  })

  it('applies a createdAt range to the ALL segment (previously impossible — date filter was NEW-only)', () => {
    const range = resolveRegisteredRange({ segment: 'ALL', registeredPreset: 'month' })
    expect(range).not.toBeNull()
    expect(segmentWhere('ALL', range)).toEqual({ phone: { not: '' }, createdAt: { gte: range!.start, lt: range!.end } })
  })

  it('applies a createdAt range to the ACTIVE segment too, combined with its existing status filter', () => {
    const range = resolveRegisteredRange({ segment: 'ACTIVE', registeredPreset: 'week' })
    expect(segmentWhere('ACTIVE', range)).toEqual({ phone: { not: '' }, status: 'ACTIVE', createdAt: { gte: range!.start, lt: range!.end } })
  })

  it('resolves the new "year" preset (previously only today/week/month/custom existed)', () => {
    const yearRange = resolveRegisteredRange({ segment: 'ALL', registeredPreset: 'year' })
    const monthRange = resolveRegisteredRange({ segment: 'ALL', registeredPreset: 'month' })
    expect(yearRange!.start.getTime()).toBeLessThanOrEqual(monthRange!.start.getTime())
  })

  it('resolves a custom registered range from registeredFrom/registeredTo', () => {
    const range = resolveRegisteredRange({ segment: 'ALL', registeredPreset: 'custom', registeredFrom: '2026-01-01', registeredTo: '2026-01-31' })
    expect(range!.start.toISOString()).toBe('2025-12-31T21:00:00.000Z') // 2026-01-01 00:00 Kampala (UTC+3)
    expect(range!.end.toISOString()).toBe('2026-01-31T21:00:00.000Z')  // 2026-02-01 00:00 Kampala
  })
})

describe('encodeTargetSegment — registered-date filter survives a scheduled campaign round trip', () => {
  it('JSON-encodes ALL/ACTIVE once a registeredPreset is set, so a scheduled send does not lose the filter', () => {
    const encoded = encodeTargetSegment({ segment: 'ACTIVE', registeredPreset: 'month' })
    expect(JSON.parse(encoded)).toEqual({ segment: 'ACTIVE', registeredPreset: 'month' })
  })

  it('still encodes as a bare string when no registered filter is set (unchanged legacy behavior)', () => {
    expect(encodeTargetSegment({ segment: 'ACTIVE' })).toBe('ACTIVE')
  })
})

describe('runBroadcast — consent gate (previously NONE existed on the campaign send path)', () => {
  it('never sends to a patient without consent, and logs the skip', async () => {
    prismaMock.patient.findMany.mockResolvedValueOnce([patient()])
    getChannelConsentStatus.mockResolvedValueOnce(false)

    await runBroadcast('camp-1', 'ALL', 'Hello!')

    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
    expect(sendWhatsAppTemplate).not.toHaveBeenCalled()
    expect(prismaMock.nurtureLog.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ patientId: 'p-1', status: 'SKIPPED_CONSENT' })],
    })
  })

  it('sends when consent is present', async () => {
    prismaMock.patient.findMany.mockResolvedValueOnce([patient()])
    prismaMock.aiMessage.findFirst.mockResolvedValueOnce({ createdAt: new Date() }) // within window

    await runBroadcast('camp-1', 'ALL', 'Hello!')

    expect(sendWhatsAppMessage).toHaveBeenCalledWith('+256700000001', 'Hello!')
  })
})

describe('runBroadcast — Meta 24h window + template fail-closed gate (previously NONE existed)', () => {
  it('blocks (no send attempted on any path) when outside the window and no template configured', async () => {
    prismaMock.patient.findMany.mockResolvedValueOnce([patient()])
    prismaMock.aiMessage.findFirst.mockResolvedValueOnce(null) // no inbound ever -> outside window

    await runBroadcast('camp-1', 'ALL', 'Hello!')

    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
    expect(sendWhatsAppTemplate).not.toHaveBeenCalled()
    expect(prismaMock.nurtureLog.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ patientId: 'p-1', status: 'SKIPPED_TEMPLATE_REQUIRED' })],
    })
  })

  it('sends free-text within the 24h session window', async () => {
    prismaMock.patient.findMany.mockResolvedValueOnce([patient()])
    prismaMock.aiMessage.findFirst.mockResolvedValueOnce({ createdAt: new Date(Date.now() - 60 * 60 * 1000) }) // 1h ago

    await runBroadcast('camp-1', 'ALL', 'Hello!')

    expect(sendWhatsAppMessage).toHaveBeenCalledTimes(1)
    expect(sendWhatsAppTemplate).not.toHaveBeenCalled()
  })

  it('outside the window WITH an approved template configured -> sends via template, never free text', async () => {
    process.env.WA_TEMPLATE_CAMPAIGN_BROADCAST_NAME = 'cc_campaign_broadcast'
    prismaMock.patient.findMany.mockResolvedValueOnce([patient()])
    prismaMock.aiMessage.findFirst.mockResolvedValueOnce(null)

    await runBroadcast('camp-1', 'ALL', 'Hello!')

    expect(sendWhatsAppTemplate).toHaveBeenCalledWith('+256700000001', 'cc_campaign_broadcast', ['Hello!'], false)
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('never falls back to free text when the template send itself fails outside the window', async () => {
    process.env.WA_TEMPLATE_CAMPAIGN_BROADCAST_NAME = 'cc_campaign_broadcast'
    prismaMock.patient.findMany.mockResolvedValueOnce([patient()])
    prismaMock.aiMessage.findFirst.mockResolvedValueOnce(null)
    sendWhatsAppTemplate.mockRejectedValueOnce(new Error('#131047 rejected'))

    await runBroadcast('camp-1', 'ALL', 'Hello!')

    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
    expect(prismaMock.nurtureLog.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ patientId: 'p-1', status: expect.stringContaining('FAILED') })],
    })
  })
})

describe('runBroadcast — duplicate-send prevention (previously NONE existed)', () => {
  it('never re-sends to a patient NurtureLog already has a row for on this campaign', async () => {
    prismaMock.patient.findMany.mockResolvedValueOnce([patient({ id: 'p-1' }), patient({ id: 'p-2', phone: '+256700000002' })])
    prismaMock.nurtureLog.findMany.mockResolvedValueOnce([{ patientId: 'p-1' }]) // p-1 already logged for this campaign
    prismaMock.aiMessage.findFirst.mockResolvedValue({ createdAt: new Date() })

    await runBroadcast('camp-1', 'ALL', 'Hello!')

    expect(sendWhatsAppMessage).toHaveBeenCalledTimes(1)
    expect(sendWhatsAppMessage).toHaveBeenCalledWith('+256700000002', 'Hello!')
    expect(prismaMock.nurtureLog.findMany).toHaveBeenCalledWith({
      where:  { campaignId: 'camp-1', patientId: { in: ['p-1', 'p-2'] } },
      select: { patientId: true },
    })
  })

  it('sends to nobody and writes no logs when every matched patient was already sent to', async () => {
    prismaMock.patient.findMany.mockResolvedValueOnce([patient({ id: 'p-1' })])
    prismaMock.nurtureLog.findMany.mockResolvedValueOnce([{ patientId: 'p-1' }])

    await runBroadcast('camp-1', 'ALL', 'Hello!')

    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
    expect(prismaMock.nurtureLog.createMany).not.toHaveBeenCalled()
  })
})

describe('runBroadcast — never sends a real message under test (NO REAL PATIENT COMMUNICATION)', () => {
  it('every send in this entire file only ever reaches the mocked functions, never a real network call', async () => {
    prismaMock.patient.findMany.mockResolvedValueOnce([patient()])
    prismaMock.aiMessage.findFirst.mockResolvedValueOnce({ createdAt: new Date() })
    await runBroadcast('camp-1', 'ALL', 'Hello!')
    // sendWhatsAppMessage/sendWhatsAppTemplate are vi.fn() mocks for this
    // entire file (see vi.mock above) — there is no code path by which this
    // test (or any other in this file) could reach the real Meta Graph API.
    expect(sendWhatsAppMessage).toHaveBeenCalledTimes(1)
    expect(vi.isMockFunction(sendWhatsAppMessage)).toBe(true)
  })
})
