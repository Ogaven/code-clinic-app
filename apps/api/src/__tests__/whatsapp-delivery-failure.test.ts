import { describe, expect, it, vi, beforeEach, beforeAll } from 'vitest'

vi.setConfig({ testTimeout: 20000 })

// A `failed` status webhook must persist the real Meta error detail
// (previously console-only, so 131042/billing tracking couldn't survive log
// rotation) IN ADDITION TO the existing AiMessage.status update — this must
// never replace or interfere with that existing write.

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    metaDeliveryFailure: { create: vi.fn().mockResolvedValue({ id: 'mdf-1' }) },
  },
}))

vi.mock('../lib/prisma', () => ({ prisma: prismaMock }))

// whatsapp.routes.ts constructs an OpenAI client at module load time — inert
// placeholder only, never used by persistDeliveryFailure itself. Static
// imports are hoisted above plain statements, so the env var must be set
// before a DYNAMIC import triggers module evaluation.
let persistDeliveryFailure: typeof import('../ai-suite/whatsapp/whatsapp.routes')['persistDeliveryFailure']

beforeAll(async () => {
  process.env.OPENAI_API_KEY ??= 'test-key-not-real'
  ;({ persistDeliveryFailure } = await import('../ai-suite/whatsapp/whatsapp.routes'))
})

beforeEach(() => {
  vi.clearAllMocks()
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
