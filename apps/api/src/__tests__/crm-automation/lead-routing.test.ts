import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.setConfig({ testTimeout: 20000 })

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    routingRule: { findFirst: vi.fn() },
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    routingState: { findUnique: vi.fn(), upsert: vi.fn() },
  },
}))

vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))

import { pickOwnerForNewLead } from '../../crm-automation/lead-routing.service'

beforeEach(() => { vi.clearAllMocks() })

describe('pickOwnerForNewLead — Part L (admin-configurable, no hardcoded mapping)', () => {
  it('returns null when no active routing rule is configured', async () => {
    prismaMock.routingRule.findFirst.mockResolvedValue(null)
    expect(await pickOwnerForNewLead('WHATSAPP')).toBeNull()
  })

  it('SOURCE_BASED: routes strictly by the configured sourceMap, never a hardcoded mapping', async () => {
    prismaMock.routingRule.findFirst.mockResolvedValue({ id: 'rule-1', mode: 'SOURCE_BASED', sourceMap: JSON.stringify({ WHATSAPP: 'user-a', WEBSITE: 'user-b' }) })
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-a', isActive: true })

    expect(await pickOwnerForNewLead('WHATSAPP')).toBe('user-a')
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({ where: { id: 'user-a' } })
  })

  it('SOURCE_BASED: returns null for a source with no configured mapping', async () => {
    prismaMock.routingRule.findFirst.mockResolvedValue({ id: 'rule-1', mode: 'SOURCE_BASED', sourceMap: JSON.stringify({ WHATSAPP: 'user-a' }) })
    expect(await pickOwnerForNewLead('INSTAGRAM')).toBeNull()
  })

  it('SOURCE_BASED: never assigns an inactive staff member', async () => {
    prismaMock.routingRule.findFirst.mockResolvedValue({ id: 'rule-1', mode: 'SOURCE_BASED', sourceMap: JSON.stringify({ WHATSAPP: 'user-a' }) })
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-a', isActive: false })
    expect(await pickOwnerForNewLead('WHATSAPP')).toBeNull()
  })

  it('ROUND_ROBIN: cycles across active eligible owners in order, advancing state each call', async () => {
    prismaMock.routingRule.findFirst.mockResolvedValue({ id: 'rule-1', mode: 'ROUND_ROBIN', eligibleUserIds: JSON.stringify(['a', 'b', 'c']) })
    prismaMock.user.findMany.mockResolvedValue([{ id: 'a', isActive: true }, { id: 'b', isActive: true }, { id: 'c', isActive: true }])
    prismaMock.routingState.findUnique.mockResolvedValue({ routingRuleId: 'rule-1', lastAssignedUserId: 'a' })

    const next = await pickOwnerForNewLead('WEBSITE')

    expect(next).toBe('b')
    expect(prismaMock.routingState.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { lastAssignedUserId: 'b' },
    }))
  })

  it('ROUND_ROBIN: skips inactive staff — eligible list is filtered to isActive users only', async () => {
    prismaMock.routingRule.findFirst.mockResolvedValue({ id: 'rule-1', mode: 'ROUND_ROBIN', eligibleUserIds: JSON.stringify(['a', 'b']) })
    prismaMock.user.findMany.mockResolvedValue([{ id: 'b', isActive: true }]) // 'a' filtered out by the isActive:true query itself
    prismaMock.routingState.findUnique.mockResolvedValue(null)

    expect(await pickOwnerForNewLead('WEBSITE')).toBe('b')
  })
})