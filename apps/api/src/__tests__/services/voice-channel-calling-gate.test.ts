import { describe, expect, it, vi, beforeEach } from 'vitest'

// Calling is a paused Code Clinic patient channel by business policy: the
// outbound trigger must stay closed by default, not just when explicitly
// disabled. Regression coverage for the fail-closed fix to
// triggerOutboundCall's calling_agents_enabled guard (previously
// `=== 'false'`, which dialed by default when the AppSetting row was
// missing/null — the exact state a fresh environment or a deleted row would
// produce).

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    appSetting:    { findUnique: vi.fn() },
    outboundQueue: { findUnique: vi.fn().mockResolvedValue(null) },
  },
}))

vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../../services/agent/unified-agent', () => ({ runAgent: vi.fn() }))
vi.mock('../../services/agent/channels/whatsapp-channel', () => ({ sendMissedCallWhatsApp: vi.fn() }))
vi.mock('../../services/storage/r2', () => ({ uploadFile: vi.fn() }))
vi.mock('../../services/knowledge/rag', () => ({ transcribeAudio: vi.fn() }))
vi.mock('../../ai-suite/voice/sip.service', () => ({
  makeOutboundCall: vi.fn(),
  startBidirectionalVoiceCall: vi.fn(),
  isSipConnected: vi.fn().mockReturnValue(false),
}))

import { triggerOutboundCall } from '../../services/agent/channels/voice-channel'

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.outboundQueue.findUnique.mockResolvedValue(null)
})

describe('triggerOutboundCall — calling_agents_enabled fail-closed gate', () => {
  it('skips (no queue lookup) when the AppSetting row is missing entirely', async () => {
    prismaMock.appSetting.findUnique.mockResolvedValue(null)

    await triggerOutboundCall('queue-1')

    expect(prismaMock.outboundQueue.findUnique).not.toHaveBeenCalled()
  })

  it('skips when the row exists but is explicitly false', async () => {
    prismaMock.appSetting.findUnique.mockResolvedValue({ key: 'calling_agents_enabled', value: 'false' })

    await triggerOutboundCall('queue-1')

    expect(prismaMock.outboundQueue.findUnique).not.toHaveBeenCalled()
  })

  it('skips on any ambiguous value other than the literal string "true"', async () => {
    prismaMock.appSetting.findUnique.mockResolvedValue({ key: 'calling_agents_enabled', value: 'yes' })

    await triggerOutboundCall('queue-1')

    expect(prismaMock.outboundQueue.findUnique).not.toHaveBeenCalled()
  })

  it('proceeds past the gate only when the row is explicitly "true"', async () => {
    prismaMock.appSetting.findUnique.mockResolvedValue({ key: 'calling_agents_enabled', value: 'true' })

    // No queue item mocked -> triggerOutboundCall throws past the gate; the
    // point of this test is that it got far enough to look, not what happens
    // after.
    await expect(triggerOutboundCall('queue-1')).rejects.toThrow('Queue item not found')

    expect(prismaMock.outboundQueue.findUnique).toHaveBeenCalledWith({
      where: { id: 'queue-1' },
      include: { patient: true },
    })
  })
})
