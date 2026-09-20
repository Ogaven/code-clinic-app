import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    lead: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    routingRule: { findFirst: vi.fn() },
    routingState: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn(), create: vi.fn() },
  },
}))
vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))

import { buildOwnershipAudit } from '../../crm-automation/ownership-audit.service'

const ACTIVE_A = { id: 'u-a', firstName: 'Ada', lastName: 'A', isActive: true }
const ACTIVE_B = { id: 'u-b', firstName: 'Bo', lastName: 'B', isActive: true }
const INACTIVE_C = { id: 'u-c', firstName: 'Cy', lastName: 'C', isActive: false }

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.user.findMany.mockResolvedValue([ACTIVE_A, ACTIVE_B, INACTIVE_C])
  prismaMock.routingRule.findFirst.mockResolvedValue(null)
  prismaMock.routingState.findUnique.mockResolvedValue(null)
})

describe('buildOwnershipAudit — never mutates the database', () => {
  it('makes zero write calls (update/upsert/create) even when a ROUND_ROBIN rule is active', async () => {
    prismaMock.lead.findMany.mockResolvedValue([
      { id: 'l1', name: 'Lead 1', phone: null, source: 'WHATSAPP', assignedTo: null, status: 'NEW', createdAt: new Date('2026-01-01') },
      { id: 'l2', name: 'Lead 2', phone: null, source: 'WHATSAPP', assignedTo: null, status: 'NEW', createdAt: new Date('2026-01-02') },
    ])
    prismaMock.routingRule.findFirst.mockResolvedValue({ id: 'rule-1', name: 'RR', mode: 'ROUND_ROBIN', eligibleUserIds: JSON.stringify(['u-a', 'u-b']), sourceMap: null })
    prismaMock.routingState.findUnique.mockResolvedValue({ routingRuleId: 'rule-1', lastAssignedUserId: 'u-a' })

    await buildOwnershipAudit()

    expect(prismaMock.routingState.upsert).not.toHaveBeenCalled()
    expect(prismaMock.routingState.update).not.toHaveBeenCalled()
    expect(prismaMock.routingState.create).not.toHaveBeenCalled()
    expect(prismaMock.lead.findMany).toHaveBeenCalledTimes(1) // no per-lead write loop
  })

  it('simulates round-robin assignment starting from the CURRENT persisted cursor, without advancing it', async () => {
    prismaMock.lead.findMany.mockResolvedValue([
      { id: 'l1', name: 'Lead 1', phone: null, source: 'WHATSAPP', assignedTo: null, status: 'NEW', createdAt: new Date('2026-01-01') },
      { id: 'l2', name: 'Lead 2', phone: null, source: 'WHATSAPP', assignedTo: null, status: 'NEW', createdAt: new Date('2026-01-02') },
      { id: 'l3', name: 'Lead 3', phone: null, source: 'WHATSAPP', assignedTo: null, status: 'NEW', createdAt: new Date('2026-01-03') },
    ])
    prismaMock.routingRule.findFirst.mockResolvedValue({ id: 'rule-1', name: 'RR', mode: 'ROUND_ROBIN', eligibleUserIds: JSON.stringify(['u-a', 'u-b']), sourceMap: null })
    prismaMock.routingState.findUnique.mockResolvedValue({ routingRuleId: 'rule-1', lastAssignedUserId: 'u-a' })

    const result = await buildOwnershipAudit()

    // last assigned was u-a (index 0) -> next should be u-b, then u-a, then u-b
    expect(result.backfillPreview.map(p => p.wouldAssignTo)).toEqual(['u-b', 'u-a', 'u-b'])
  })

  it('excludes an inactive eligible user from the round-robin preview', async () => {
    prismaMock.lead.findMany.mockResolvedValue([
      { id: 'l1', name: 'Lead 1', phone: null, source: 'WHATSAPP', assignedTo: null, status: 'NEW', createdAt: new Date('2026-01-01') },
    ])
    prismaMock.routingRule.findFirst.mockResolvedValue({ id: 'rule-1', name: 'RR', mode: 'ROUND_ROBIN', eligibleUserIds: JSON.stringify(['u-a', 'u-c']), sourceMap: null })
    prismaMock.routingState.findUnique.mockResolvedValue(null)

    const result = await buildOwnershipAudit()
    expect(result.backfillPreview[0].wouldAssignTo).toBe('u-a')
  })

  it('previews SOURCE_BASED assignment by reading sourceMap directly, never falling back to round-robin logic', async () => {
    prismaMock.lead.findMany.mockResolvedValue([
      { id: 'l1', name: 'Lead 1', phone: null, source: 'FACEBOOK', assignedTo: null, status: 'NEW', createdAt: new Date() },
      { id: 'l2', name: 'Lead 2', phone: null, source: 'WEBSITE', assignedTo: null, status: 'NEW', createdAt: new Date() },
    ])
    prismaMock.routingRule.findFirst.mockResolvedValue({ id: 'rule-2', name: 'SB', mode: 'SOURCE_BASED', sourceMap: JSON.stringify({ FACEBOOK: 'u-a' }), eligibleUserIds: null })

    const result = await buildOwnershipAudit()
    expect(result.backfillPreview.find(p => p.id === 'l1')!.wouldAssignTo).toBe('u-a')
    expect(result.backfillPreview.find(p => p.id === 'l2')!.wouldAssignTo).toBeNull() // no map entry for WEBSITE
  })

  it('reports leads assigned to a user id that no longer exists, separately from unassigned leads', async () => {
    prismaMock.lead.findMany.mockResolvedValue([
      { id: 'l1', name: null, phone: null, source: 'WHATSAPP', assignedTo: 'ghost-user', status: 'NEW', createdAt: new Date() },
      { id: 'l2', name: null, phone: null, source: 'WHATSAPP', assignedTo: null, status: 'NEW', createdAt: new Date() },
    ])

    const result = await buildOwnershipAudit()
    expect(result.totals.assignedToInactiveOrDeletedUser).toBe(1)
    expect(result.totals.unassignedOpenLeads).toBe(1)
  })

  it('excludes CONVERTED/LOST leads from the unassigned count and backfill preview', async () => {
    prismaMock.lead.findMany.mockResolvedValue([
      { id: 'l1', name: null, phone: null, source: 'WHATSAPP', assignedTo: null, status: 'LOST', createdAt: new Date() },
      { id: 'l2', name: null, phone: null, source: 'WHATSAPP', assignedTo: null, status: 'CONVERTED', createdAt: new Date() },
      { id: 'l3', name: null, phone: null, source: 'WHATSAPP', assignedTo: null, status: 'NEW', createdAt: new Date() },
    ])

    const result = await buildOwnershipAudit()
    expect(result.totals.unassignedOpenLeads).toBe(1)
    expect(result.backfillPreview.map(p => p.id)).toEqual(['l3'])
  })

  it('builds distribution counts per current owner, including inactive owners', async () => {
    prismaMock.lead.findMany.mockResolvedValue([
      { id: 'l1', name: null, phone: null, source: 'WHATSAPP', assignedTo: 'u-a', status: 'NEW', createdAt: new Date() },
      { id: 'l2', name: null, phone: null, source: 'WHATSAPP', assignedTo: 'u-a', status: 'CONTACTED', createdAt: new Date() },
      { id: 'l3', name: null, phone: null, source: 'WHATSAPP', assignedTo: 'u-c', status: 'NEW', createdAt: new Date() },
    ])

    const result = await buildOwnershipAudit()
    expect(result.distributionByOwner).toEqual([
      { ownerId: 'u-a', ownerName: 'Ada A', isActive: true, count: 2 },
      { ownerId: 'u-c', ownerName: 'Cy C', isActive: false, count: 1 },
    ])
  })
})
