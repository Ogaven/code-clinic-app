import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.setConfig({ testTimeout: 20000 })

// sendSMS() used to be an unconditional WhatsApp passthrough. It can now send
// real carrier SMS via Africa's Talking, but only when BOTH AT_API_KEY/
// AT_USERNAME are configured AND SMS_CHANNEL_ACTIVE='true' — SMS is not
// currently an active Code Clinic channel (WhatsApp/Instagram/Facebook/
// Website Chat are), so credentials alone must never be enough to trigger a
// real send; every workflow falls back to WhatsApp until SMS is explicitly
// switched on. The 'africastalking' SDK uses its own axios client, not
// global fetch, so the global no-real-sends fetch guard does NOT catch a
// real send here — this file mocks the SDK module directly instead.

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
  delete process.env.SMS_CHANNEL_ACTIVE
})

describe('sms.service — real Africa\'s Talking wiring requires BOTH credentials AND SMS_CHANNEL_ACTIVE', () => {
  it('sends via Africa\'s Talking when credentials are configured AND SMS_CHANNEL_ACTIVE=true', async () => {
    process.env.AT_API_KEY       = 'test-key'
    process.env.AT_USERNAME      = 'test-user'
    process.env.SMS_CHANNEL_ACTIVE = 'true'
    const { sendSMS, isRealSmsProviderConfigured, isSmsChannelActive } = await import('../../ai-suite/sms/sms.service')

    expect(isRealSmsProviderConfigured()).toBe(true)
    expect(isSmsChannelActive()).toBe(true)
    await sendSMS('+256700000001', 'hello')

    expect(atInitMock).toHaveBeenCalledWith({ apiKey: 'test-key', username: 'test-user' })
    expect(atSendMock).toHaveBeenCalledWith({ to: ['+256700000001'], message: 'hello' })
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('includes AT_SENDER_ID as `from` when configured', async () => {
    process.env.AT_API_KEY       = 'test-key'
    process.env.AT_USERNAME      = 'test-user'
    process.env.AT_SENDER_ID     = 'CODECLINIC'
    process.env.SMS_CHANNEL_ACTIVE = 'true'
    const { sendSMS } = await import('../../ai-suite/sms/sms.service')

    await sendSMS('+256700000001', 'hello')

    expect(atSendMock).toHaveBeenCalledWith({ to: ['+256700000001'], message: 'hello', from: 'CODECLINIC' })
  })

  it('falls back to WhatsApp when credentials are configured but SMS_CHANNEL_ACTIVE is NOT set — SMS is not an active Code Clinic channel today', async () => {
    process.env.AT_API_KEY  = 'test-key' // credentials present...
    process.env.AT_USERNAME = 'test-user'
    // ...but SMS_CHANNEL_ACTIVE deliberately left unset — this is production's actual current state.
    const { sendSMS, isRealSmsProviderConfigured, isSmsChannelActive } = await import('../../ai-suite/sms/sms.service')

    expect(isRealSmsProviderConfigured()).toBe(true)
    expect(isSmsChannelActive()).toBe(false)
    await sendSMS('+256700000001', 'hello')

    expect(atSendMock).not.toHaveBeenCalled()
    expect(atInitMock).not.toHaveBeenCalled()
    expect(sendWhatsAppMessage).toHaveBeenCalledWith('+256700000001', 'hello')
  })

  it('falls back to the WhatsApp passthrough when AT credentials are absent, even if SMS_CHANNEL_ACTIVE=true', async () => {
    process.env.SMS_CHANNEL_ACTIVE = 'true'
    const { sendSMS, isRealSmsProviderConfigured } = await import('../../ai-suite/sms/sms.service')

    expect(isRealSmsProviderConfigured()).toBe(false)
    await sendSMS('+256700000001', 'hello')

    expect(atSendMock).not.toHaveBeenCalled()
    expect(sendWhatsAppMessage).toHaveBeenCalledWith('+256700000001', 'hello')
  })

  it('falls back when only one of the two required credential env vars is set', async () => {
    process.env.AT_API_KEY = 'test-key' // AT_USERNAME deliberately left unset
    process.env.SMS_CHANNEL_ACTIVE = 'true'
    const { sendSMS, isRealSmsProviderConfigured } = await import('../../ai-suite/sms/sms.service')

    expect(isRealSmsProviderConfigured()).toBe(false)
    await sendSMS('+256700000001', 'hello')

    expect(atSendMock).not.toHaveBeenCalled()
    expect(sendWhatsAppMessage).toHaveBeenCalledWith('+256700000001', 'hello')
  })
})
