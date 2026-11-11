import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test'
process.env.JWT_SECRET ??= 'test-jwt-secret-not-real-'.padEnd(32, '0')
process.env.JWT_REFRESH_SECRET ??= 'test-jwt-refresh-not-real-'.padEnd(32, '0')

const findMany = vi.hoisted(() => vi.fn().mockResolvedValue([]))
const sendWhatsAppMessage = vi.hoisted(() => vi.fn())
vi.mock('../lib/prisma', () => ({ prisma: { appointment: { findMany } } }))
vi.mock('../ai-suite/whatsapp/whatsapp.service', () => ({
  sendWhatsAppMessage, sendWhatsAppTemplate: vi.fn(), notifyReceptionistUnreachable: vi.fn(),
}))
vi.mock('../ai-suite/scheduler/guardian-routing.service', () => ({
  hasOutboundConsent: vi.fn(), resolveOutboundRecipient: vi.fn(), alertStaffMinorNoGuardian: vi.fn(),
}))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.clearAllMocks()
  findMany.mockResolvedValue([])
})
afterEach(() => { vi.useRealTimers() })

describe('patient WhatsApp follow-up quiet hours', () => {
  it.each(['2026-11-11T00:30:00+03:00', '2026-11-11T08:59:00+03:00', '2026-11-11T18:00:00+03:00'])(
    'does not query or send outside 9 AM–6 PM EAT (%s)', async (when) => {
      vi.setSystemTime(new Date(when))
      const { checkAndSendFollowups, withinPatientFollowupHours } = await import('../ai-suite/scheduler/followup.service')
      expect(withinPatientFollowupHours()).toBe(false)
      await checkAndSendFollowups()
      expect(findMany).not.toHaveBeenCalled()
      expect(sendWhatsAppMessage).not.toHaveBeenCalled()
    },
  )

  it('checks the retained overnight backlog at 9 AM EAT', async () => {
    vi.setSystemTime(new Date('2026-11-11T09:00:00+03:00'))
    const { checkAndSendFollowups, withinPatientFollowupHours } = await import('../ai-suite/scheduler/followup.service')
    expect(withinPatientFollowupHours()).toBe(true)
    await checkAndSendFollowups()
    expect(findMany).toHaveBeenCalledTimes(1)
    const query = findMany.mock.calls[0][0]
    const now = Date.now()
    expect(query.where.startAt.gte.getTime()).toBe(now - 48 * 60 * 60 * 1000)
    expect(query.where.startAt.lte.getTime()).toBe(now - 23 * 60 * 60 * 1000)
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('still permits the last minute before 6 PM', async () => {
    const { withinPatientFollowupHours } = await import('../ai-suite/scheduler/followup.service')
    expect(withinPatientFollowupHours(new Date('2026-11-11T17:59:00+03:00'))).toBe(true)
  })
})
