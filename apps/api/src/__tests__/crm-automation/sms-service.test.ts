import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.setConfig({ testTimeout: 20000 })

// sendSMS() used to be an unconditional WhatsApp passthrough. It now sends
// real carrier SMS via Africa's Talking when AT_API_KEY/AT_USERNAME are
// configured (as they are in production), falling back to WhatsApp only
// when they're absent. The 'africastalking' SDK uses its own axios client,
// not global fetch, so the global no-real-sends fetch guard does NOT catch
// a real send here — this file mocks the SDK module directly instead.

const { atSendMock, atInitMock, sendWhatsAppMessage } = vi.hoisted(() => {
  const atSendMock = vi.fn().mockResolvedValue({ SMSMessageData: { Recipients: [] } })
  const atInitMock = vi.fn(() => ({ SMS: { send: atSendMock } }))
  return { atSendMock, atInitMock, sendWhatsAppMessage: vi.fn().mockResolvedValue('wamid-1') }
})

vi.mock('africastalking', () => ({ default: atInitMock }))
vi.mock('../../ai-suite/whatsapp/whatsapp.service', () => ({ sendWhatsAppMessage }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  delete process.env.AT_API_KEY
  delete process.env.AT_USERNAME
  delete process.env.AT_SENDER_ID
})

describe('sms.service — real Africa\'s Talking wiring', () => {
  it('sends via Africa\'s Talking when AT_API_KEY/AT_USERNAME are configured', async () => {
    process.env.AT_API_KEY  = 'test-key'
    process.env.AT_USERNAME = 'test-user'
    const { sendSMS, isRealSmsProviderConfigured } = await import('../../ai-suite/sms/sms.service')

    expect(isRealSmsProviderConfigured()).toBe(true)
    await sendSMS('+256700000001', 'hello')

    expect(atInitMock).toHaveBeenCalledWith({ apiKey: 'test-key', username: 'test-user' })
    expect(atSendMock).toHaveBeenCalledWith({ to: ['+256700000001'], message: 'hello' })
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('includes AT_SENDER_ID as `from` when configured', async () => {
    process.env.AT_API_KEY   = 'test-key'
    process.env.AT_USERNAME  = 'test-user'
    process.env.AT_SENDER_ID = 'CODECLINIC'
    const { sendSMS } = await import('../../ai-suite/sms/sms.service')

    await sendSMS('+256700000001', 'hello')

    expect(atSendMock).toHaveBeenCalledWith({ to: ['+256700000001'], message: 'hello', from: 'CODECLINIC' })
  })

  it('falls back to the WhatsApp passthrough when AT credentials are absent', async () => {
    const { sendSMS, isRealSmsProviderConfigured } = await import('../../ai-suite/sms/sms.service')

    expect(isRealSmsProviderConfigured()).toBe(false)
    await sendSMS('+256700000001', 'hello')

    expect(atSendMock).not.toHaveBeenCalled()
    expect(sendWhatsAppMessage).toHaveBeenCalledWith('+256700000001', 'hello')
  })

  it('falls back when only one of the two required env vars is set', async () => {
    process.env.AT_API_KEY = 'test-key' // AT_USERNAME deliberately left unset
    const { sendSMS, isRealSmsProviderConfigured } = await import('../../ai-suite/sms/sms.service')

    expect(isRealSmsProviderConfigured()).toBe(false)
    await sendSMS('+256700000001', 'hello')

    expect(atSendMock).not.toHaveBeenCalled()
    expect(sendWhatsAppMessage).toHaveBeenCalledWith('+256700000001', 'hello')
  })
})
