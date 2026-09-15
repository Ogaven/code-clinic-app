import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.setConfig({ testTimeout: 20000 })

// getWhatsAppDeliveryHealth() must never conflate "API accepted the message"
// with "delivered" — that exact conflation is what let a real billing outage
// (Meta error 131042) go unnoticed for weeks. These tests exercise the real
// aggregation/classification logic against mocked Prisma responses.

const { prismaMock, staleLeadsByOwnerMock } = vi.hoisted(() => ({
  prismaMock: {
    aiMessage: {
      groupBy:  vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    metaDeliveryFailure: {
      findFirst: vi.fn().mockResolvedValue(null),
      groupBy:   vi.fn().mockResolvedValue([]),
    },
    routingRule: { count: vi.fn().mockResolvedValue(0) },
    sequenceDefinition: { count: vi.fn().mockResolvedValue(0) },
    reviewRequestConfig: { findFirst: vi.fn().mockResolvedValue(null) },
  },
  staleLeadsByOwnerMock: vi.fn().mockResolvedValue([]),
}))

vi.mock('../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../crm-automation/reporting.service', () => ({ staleLeadsByOwner: staleLeadsByOwnerMock }))

import { getWhatsAppDeliveryHealth, getCrmReadinessSummary } from '../services/provider-health.service'

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.aiMessage.groupBy.mockResolvedValue([])
  prismaMock.aiMessage.findFirst.mockResolvedValue(null)
  prismaMock.metaDeliveryFailure.findFirst.mockResolvedValue(null)
  prismaMock.metaDeliveryFailure.groupBy.mockResolvedValue([])
  prismaMock.routingRule.count.mockResolvedValue(0)
  prismaMock.sequenceDefinition.count.mockResolvedValue(0)
  prismaMock.reviewRequestConfig.findFirst.mockResolvedValue(null)
  staleLeadsByOwnerMock.mockResolvedValue([])
})

describe('getWhatsAppDeliveryHealth — sent is never counted as delivered', () => {
  it('computes delivery/failure rates from real status groupings, not just attempt count', async () => {
    // Every call to groupBy in this service uses the same shape regardless of
    // window — return the same distribution for all of them (today/month/30d/24h).
    prismaMock.aiMessage.groupBy.mockResolvedValue([
      { status: 'delivered', _count: { _all: 2 } },
      { status: 'read',      _count: { _all: 3 } },
      { status: 'failed',    _count: { _all: 5 } },
      { status: 'sent',      _count: { _all: 1 } }, // accepted by Meta, no final status yet — must NOT count as delivered
    ])

    const health = await getWhatsAppDeliveryHealth()

    expect(health.today.attempted).toBe(11)
    expect(health.today.delivered).toBe(2)
    expect(health.today.read).toBe(3)
    expect(health.today.failed).toBe(5)
    expect(health.today.pending).toBe(1)
    // deliveryRate must only count delivered+read, never "sent"/pending
    expect(health.today.deliveryRate).toBeCloseTo((5 / 11) * 100, 1)
    expect(health.today.failureRate).toBeCloseTo((5 / 11) * 100, 1)
  })

  it('classifies DOWN when recent failure rate is at or above 90% with a meaningful sample', async () => {
    prismaMock.aiMessage.groupBy.mockResolvedValue([
      { status: 'failed', _count: { _all: 38 } },
    ])
    const health = await getWhatsAppDeliveryHealth()
    expect(health.status).toBe('DOWN')
  })

  it('classifies HEALTHY when the sample size is too small to judge, even with 100% failure', async () => {
    prismaMock.aiMessage.groupBy.mockResolvedValue([
      { status: 'failed', _count: { _all: 1 } },
    ])
    const health = await getWhatsAppDeliveryHealth()
    expect(health.status).toBe('HEALTHY')
  })

  it('classifies DEGRADED at an elevated but not near-total failure rate', async () => {
    prismaMock.aiMessage.groupBy.mockResolvedValue([
      { status: 'delivered', _count: { _all: 6 } },
      { status: 'failed',    _count: { _all: 4 } },
    ])
    const health = await getWhatsAppDeliveryHealth()
    expect(health.status).toBe('DEGRADED')
  })

  it('surfaces the latest persisted MetaDeliveryFailure as the latest error, with real code/title/details', async () => {
    prismaMock.metaDeliveryFailure.findFirst.mockResolvedValue({
      code: 131042,
      title: 'Business eligibility payment issue',
      message: 'Business eligibility payment issue',
      details: 'Message failed to send because your WhatsApp Business account has unsettled payments.',
      occurredAt: new Date('2026-09-15T07:26:08.000Z'),
    })
    const health = await getWhatsAppDeliveryHealth()
    expect(health.latestError).toMatchObject({ code: 131042, title: 'Business eligibility payment issue' })
  })

  it('reports failureCountByCode from real grouped MetaDeliveryFailure rows, distinguishing billing from non-billing codes', async () => {
    prismaMock.metaDeliveryFailure.groupBy.mockResolvedValue([
      { code: 131042, _count: { _all: 1057 } },
      { code: 131047, _count: { _all: 4115 } },
      { code: 131026, _count: { _all: 358 } },
    ])
    const health = await getWhatsAppDeliveryHealth()
    expect(health.failureCountByCode['131042']).toBe(1057)
    expect(health.failureCountByCode['131047']).toBe(4115)
    expect(health.failureCountByCode['131026']).toBe(358)
  })
})

describe('getCrmReadinessSummary — real configuration counts, not hardcoded', () => {
  it('reflects real mocked counts for routing rules, sequences, stale leads, and review config', async () => {
    prismaMock.routingRule.count.mockResolvedValueOnce(3).mockResolvedValueOnce(1)
    prismaMock.sequenceDefinition.count.mockResolvedValueOnce(5).mockResolvedValueOnce(2)
    staleLeadsByOwnerMock.mockResolvedValue([{ ownerId: 'a', count: 10, leads: [] }, { ownerId: 'unassigned', count: 328, leads: [] }])
    prismaMock.reviewRequestConfig.findFirst.mockResolvedValue({ id: 'cfg-1' })

    const readiness = await getCrmReadinessSummary()

    expect(readiness.routingRuleCount).toBe(3)
    expect(readiness.activeRoutingRuleCount).toBe(1)
    expect(readiness.sequenceDefinitionCount).toBe(5)
    expect(readiness.activeSequenceDefinitionCount).toBe(2)
    expect(readiness.staleUnassignedLeadCount).toBe(338)
    expect(readiness.reviewRequestConfigured).toBe(true)
  })

  it('reports reviewRequestConfigured:false when no config row exists', async () => {
    prismaMock.reviewRequestConfig.findFirst.mockResolvedValue(null)
    const readiness = await getCrmReadinessSummary()
    expect(readiness.reviewRequestConfigured).toBe(false)
  })
})
