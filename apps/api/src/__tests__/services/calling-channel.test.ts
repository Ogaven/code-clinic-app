import { describe, expect, it, vi, beforeEach } from 'vitest'

// isCallingChannelActive is the single source of truth for whether calling
// is live, shared by sip.service.ts (inbound answer/decline), voice-
// channel.ts (outbound trigger), and both channel-status display endpoints.
// Calling is a paused Code Clinic patient channel by business policy: it
// must default to PAUSED whenever the AppSetting row is missing or
// ambiguous, not just when it's explicitly 'false' — fail-closed.

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { appSetting: { findUnique: vi.fn() } },
}))

vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))

import { isCallingChannelActive } from '../../services/calling-channel.service'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('isCallingChannelActive — fail-closed default', () => {
  it('is false when the row does not exist', async () => {
    prismaMock.appSetting.findUnique.mockResolvedValue(null)
    expect(await isCallingChannelActive()).toBe(false)
  })

  it('is false when explicitly "false"', async () => {
    prismaMock.appSetting.findUnique.mockResolvedValue({ key: 'calling_agents_enabled', value: 'false' })
    expect(await isCallingChannelActive()).toBe(false)
  })

  it('is false for any ambiguous non-"true" value', async () => {
    prismaMock.appSetting.findUnique.mockResolvedValue({ key: 'calling_agents_enabled', value: '1' })
    expect(await isCallingChannelActive()).toBe(false)
  })

  it('is true only when explicitly "true"', async () => {
    prismaMock.appSetting.findUnique.mockResolvedValue({ key: 'calling_agents_enabled', value: 'true' })
    expect(await isCallingChannelActive()).toBe(true)
  })
})
