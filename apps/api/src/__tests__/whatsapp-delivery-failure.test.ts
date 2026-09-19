import { describe, expect, it, vi, beforeEach, beforeAll, afterAll } from 'vitest'

vi.setConfig({ testTimeout: 20000 })

// A `failed` status webhook must persist the real Meta error detail
// (previously console-only, so 131042/billing tracking couldn't survive log
// rotation) IN ADDITION TO the existing AiMessage.status update — this must
// never replace or interfere with that existing write.

const { prismaMock, sendPushToUserMock, sendStaffSMSMock } = vi.hoisted(() => ({
  prismaMock: {
    metaDeliveryFailure: { create: vi.fn().mockResolvedValue({ id: 'mdf-1' }) },
    notification: { create: vi.fn().mockResolvedValue({ id: 'n-1' }), findFirst: vi.fn().mockResolvedValue(null) },
    user: { findMany: vi.fn().mockResolvedValue([{ id: 'u-admin', role: 'ADMIN' }, { id: 'u-front', role: 'RECEPTIONIST' }]) },
  },
  sendPushToUserMock: vi.fn().mockResolvedValue(undefined),
  sendStaffSMSMock:   vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../services/push.service', () => ({ sendPushToUser: sendPushToUserMock }))
vi.mock('../ai-suite/sms/sms.service', () => ({ sendStaffSMS: sendStaffSMSMock }))

// whatsapp.routes.ts constructs an OpenAI client at module load time — inert
// placeholder only, never used by persistDeliveryFailure itself. Static
// imports are hoisted above plain statements, so the env var must be set
// before a DYNAMIC import triggers module evaluation.
let persistDeliveryFailure: typeof import('../ai-suite/whatsapp/whatsapp.routes')['persistDeliveryFailure']
let notifyStaffOfDeliveryFailure: typeof import('../ai-suite/whatsapp/whatsapp.routes')['notifyStaffOfDeliveryFailure']

beforeAll(async () => {
  process.env.OPENAI_API_KEY ??= 'test-key-not-real'
  ;({ persistDeliveryFailure, notifyStaffOfDeliveryFailure } = await import('../ai-suite/whatsapp/whatsapp.routes'))
})

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.notification.findFirst.mockResolvedValue(null)
  prismaMock.user.findMany.mockResolvedValue([{ id: 'u-admin', role: 'ADMIN' }])
})

describe('persistDeliveryFailure — real Meta error detail, additive to AiMessage.status', () => {
  it('persists the real code/title/message/details/timestamp exactly as Meta sent them', async () => {
    await persistDeliveryFailure({
      wamid: 'wamid.ABC', wabaId: '1754698499275270', phoneNumberId: '1131790783353557',
      recipientId: '256785703926', code: 131042, title: 'Business eligibility payment issue',
      message: 'Business eligibility payment issue',
      details: 'Message failed to send because your WhatsApp Business account has unsettled payments.',
      timestamp: '1789457168',
    })

    expect(prismaMock.metaDeliveryFailure.create).toHaveBeenCalledWith({
      data: {
        wamid: 'wamid.ABC', wabaId: '1754698499275270', phoneNumberId: '1131790783353557',
        recipientId: '256785703926', code: 131042, title: 'Business eligibility payment issue',
        message: 'Business eligibility payment issue',
        details: 'Message failed to send because your WhatsApp Business account has unsettled payments.',
        occurredAt: new Date(1789457168 * 1000),
      },
    })
  })

  it('falls back to now() when Meta sends no timestamp, never fabricating one from thin air beyond "recorded now"', async () => {
    const before = Date.now()
    await persistDeliveryFailure({
      wamid: null, wabaId: null, phoneNumberId: null, recipientId: null,
      code: 131047, title: 'Re-engagement message', message: null, details: null, timestamp: undefined,
    })
    const call = prismaMock.metaDeliveryFailure.create.mock.calls[0][0]
    expect(call.data.occurredAt.getTime()).toBeGreaterThanOrEqual(before)
  })

  it('distinguishes non-billing error codes (131047, 131026) from the billing code (131042) — never mislabels them', async () => {
    await persistDeliveryFailure({
      wamid: 'wamid.X', wabaId: null, phoneNumberId: null, recipientId: '256700000001',
      code: 131026, title: 'Message Undeliverable', message: null, details: null, timestamp: '1789000000',
    })
    expect(prismaMock.metaDeliveryFailure.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ code: 131026, title: 'Message Undeliverable' }) })
    )
  })
})

describe('notifyStaffOfDeliveryFailure — dedup survives a process restart', () => {
  // Each test gets a FRESH module instance (vi.resetModules + dynamic
  // re-import) so its module-level lastDeliveryFailureAlertAt always starts
  // at 0 — genuinely isolated per test, and for the "process restart"
  // scenarios below, exactly what a real process restart looks like (the
  // in-memory guard alone provides zero protection at that point; the DB
  // check is what must catch a still-open incident).
  async function freshNotify() {
    vi.resetModules()
    const mod = await import('../ai-suite/whatsapp/whatsapp.routes')
    return mod.notifyStaffOfDeliveryFailure
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-16T00:00:00.000Z'))
  })

  afterAll(() => {
    vi.useRealTimers()
  })

  it('creates a fresh notification for a genuinely new incident (no recent DB record), addressed to ADMIN only', async () => {
    prismaMock.notification.findFirst.mockResolvedValue(null)
    const notify = await freshNotify()
    await notify(131047, 'Re-engagement message', 'more than 24 hours have passed')
    expect(prismaMock.notification.create).toHaveBeenCalledTimes(1) // ADMIN only — reception's feed is no longer touched
    expect(prismaMock.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({
        userId: 'u-admin',
        type: 'PROVIDER_HEALTH',
        title: expect.stringContaining('Staff WhatsApp alerts are failing to deliver'),
        href: '/ai-suite/analytics',
      }) })
    )
  })

  it('does not create a duplicate when a DB notification already exists within the cooldown window, even right after a simulated process restart', async () => {
    // Simulate the SAME open incident already having been recorded by an
    // earlier process (before the restart wiped the in-memory timestamp).
    prismaMock.notification.findFirst.mockResolvedValue({ id: 'existing-notification' })
    const notify = await freshNotify()

    await notify(131047, 'Re-engagement message', 'more than 24 hours have passed')

    expect(prismaMock.notification.create).not.toHaveBeenCalled()
    expect(sendStaffSMSMock).not.toHaveBeenCalled()
  })

  it('a genuinely new incident after the cooldown window has fully elapsed creates a new notification', async () => {
    prismaMock.notification.findFirst.mockResolvedValue(null)
    const notify = await freshNotify()
    await notify(131047, 'Re-engagement message', 'first incident')
    expect(prismaMock.notification.create).toHaveBeenCalledTimes(1)

    vi.clearAllMocks()
    prismaMock.notification.findFirst.mockResolvedValue(null)
    vi.setSystemTime(new Date('2026-09-16T01:00:00.000Z')) // +60 min, past the 30-min cooldown

    await notify(131047, 'Re-engagement message', 'second, later incident')
    expect(prismaMock.notification.create).toHaveBeenCalledTimes(1)
  })

  it('does not repeat-notify for rapid-fire failures of the SAME code within the same cooldown window (in-memory fast path, no DB round trip)', async () => {
    prismaMock.notification.findFirst.mockResolvedValue(null)
    const notify = await freshNotify()
    await notify(131047, 'first', 'first')
    vi.clearAllMocks()
    prismaMock.notification.findFirst.mockResolvedValue(null)

    vi.setSystemTime(new Date('2026-09-16T00:05:00.000Z')) // +5 min, still within cooldown
    await notify(131047, 'second', 'second')

    expect(prismaMock.notification.create).not.toHaveBeenCalled()
    // The in-memory fast path should skip the DB round trip entirely for this case.
    expect(prismaMock.notification.findFirst).not.toHaveBeenCalled()
  })

  it('a DIFFERENT error code is never suppressed by another code\'s active cooldown — distinct incidents, distinct alerts', async () => {
    // Regression guard: the old single global cooldown collapsed a billing
    // error (131042) and a later, unrelated re-engagement-window error
    // (131047) into "the same incident," so the second one silently never
    // reached an admin if it arrived inside the first one's 30-minute window.
    prismaMock.notification.findFirst.mockResolvedValue(null)
    const notify = await freshNotify()
    await notify(131042, 'Business eligibility payment issue', 'unsettled payments')
    expect(prismaMock.notification.create).toHaveBeenCalledTimes(1)

    vi.clearAllMocks()
    prismaMock.notification.findFirst.mockResolvedValue(null)
    vi.setSystemTime(new Date('2026-09-16T00:05:00.000Z')) // +5 min — still inside 131042's cooldown

    await notify(131047, 'Re-engagement message', 'more than 24 hours have passed')
    expect(prismaMock.notification.create).toHaveBeenCalledTimes(1)
    expect(prismaMock.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ title: expect.stringContaining('#131047') }) })
    )
  })
})
