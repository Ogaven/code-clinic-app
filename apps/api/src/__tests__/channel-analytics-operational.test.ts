import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.setConfig({ testTimeout: 20000 })

// fetchOperationalVolume's two newest fields (2026-09-22, part of the
// Analytics & Costs redesign): humanHandovers and aiResolutionRatePct.
// Both are derived exclusively from real AiMessage rows — no hardcoded or
// invented figures. humanHandovers counts real takeover EVENTS
// (takeover.service.ts's SYSTEM "takenOverAt" marker) in the selected
// range, not a current-state snapshot. aiResolutionRatePct is
// (engaged conversations with zero takeover events) / (engaged
// conversations), where "engaged" means at least one real inbound USER
// message in the same range — never a guessed percentage, and never a
// misleading 0% when there's no real traffic to measure (null instead).

const prismaMock = {
  aiScheduledMessage: { count: vi.fn().mockResolvedValue(0) },
  escalation:         { count: vi.fn().mockResolvedValue(0) },
  callEvent:          { count: vi.fn().mockResolvedValue(0) },
  aiMessage:          { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
}

vi.mock('../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.aiScheduledMessage.count.mockResolvedValue(0)
  prismaMock.escalation.count.mockResolvedValue(0)
  prismaMock.callEvent.count.mockResolvedValue(0)
  prismaMock.aiMessage.count.mockResolvedValue(0)
  prismaMock.aiMessage.findMany.mockResolvedValue([])
})

const RANGE = { start: new Date('2026-09-01T00:00:00Z'), end: new Date('2026-10-01T00:00:00Z') }
const EMPTY_CHANNELS = {} as any

describe('fetchOperationalVolume — AI resolution rate & human handovers (real data only)', () => {
  it('aiResolutionRatePct is null (never a misleading 0%) when there is no engaged conversation in range', async () => {
    prismaMock.aiMessage.findMany.mockResolvedValue([]) // no USER messages, no takeover events

    const { fetchOperationalVolume } = await import('../ai-suite/meta/channel-analytics.routes')
    const result = await fetchOperationalVolume(RANGE, EMPTY_CHANNELS)

    expect(result.engagedConversations).toBe(0)
    expect(result.aiResolutionRatePct).toBeNull()
  })

  it('is 100% when every engaged conversation had zero takeover events', async () => {
    prismaMock.aiMessage.findMany
      .mockResolvedValueOnce([{ conversationId: 'c1' }, { conversationId: 'c2' }]) // engaged (USER messages)
      .mockResolvedValueOnce([]) // no takeovers at all

    const { fetchOperationalVolume } = await import('../ai-suite/meta/channel-analytics.routes')
    const result = await fetchOperationalVolume(RANGE, EMPTY_CHANNELS)

    expect(result.engagedConversations).toBe(2)
    expect(result.aiResolutionRatePct).toBe(100)
  })

  it('correctly excludes conversations that had a takeover event from the resolved count', async () => {
    prismaMock.aiMessage.findMany
      .mockResolvedValueOnce([{ conversationId: 'c1' }, { conversationId: 'c2' }, { conversationId: 'c3' }, { conversationId: 'c4' }]) // 4 engaged
      .mockResolvedValueOnce([{ conversationId: 'c2' }]) // 1 of them was taken over

    const { fetchOperationalVolume } = await import('../ai-suite/meta/channel-analytics.routes')
    const result = await fetchOperationalVolume(RANGE, EMPTY_CHANNELS)

    expect(result.engagedConversations).toBe(4)
    expect(result.aiResolutionRatePct).toBe(75) // 3 of 4 resolved without a human
  })

  it('humanHandovers counts real takeover EVENTS, which can exceed the number of conversations (repeat handovers)', async () => {
    prismaMock.aiMessage.count.mockResolvedValue(3) // e.g. 2 conversations, one handed over twice
    prismaMock.aiMessage.findMany
      .mockResolvedValueOnce([{ conversationId: 'c1' }, { conversationId: 'c2' }])
      .mockResolvedValueOnce([{ conversationId: 'c1' }])

    const { fetchOperationalVolume } = await import('../ai-suite/meta/channel-analytics.routes')
    const result = await fetchOperationalVolume(RANGE, EMPTY_CHANNELS)

    expect(result.humanHandovers).toBe(3)
    expect(prismaMock.aiMessage.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ role: 'SYSTEM', metadata: { contains: 'takenOverAt' } }),
    }))
  })

  it('rounds aiResolutionRatePct to one decimal place, never an invented whole-number approximation', async () => {
    // 1 of 3 taken over -> 2/3 = 66.666...% -> should round to 66.7
    prismaMock.aiMessage.findMany
      .mockResolvedValueOnce([{ conversationId: 'c1' }, { conversationId: 'c2' }, { conversationId: 'c3' }])
      .mockResolvedValueOnce([{ conversationId: 'c1' }])

    const { fetchOperationalVolume } = await import('../ai-suite/meta/channel-analytics.routes')
    const result = await fetchOperationalVolume(RANGE, EMPTY_CHANNELS)

    expect(result.aiResolutionRatePct).toBe(66.7)
  })
})
