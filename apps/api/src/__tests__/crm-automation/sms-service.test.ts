import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.setConfig({ testTimeout: 20000 })

// SMS is a currently-dormant Code Clinic patient channel. sendSMS() must
// NEVER silently become a WhatsApp send — a caller that asked for SMS and
// can't get it needs SMS_NOT_CONFIGURED back, not a different channel's
// message going out under an SMS label. Real carrier credentials being
// present (as they genuinely are in production today) is NOT sufficient on
// its own — SMS_CHANNEL_ACTIVE must also be explicitly 'true'. The
// 'africastalking' SDK uses its own axios client, not global fetch, so the
// global no-real-sends fetch guard does NOT catch a real send here — this
// file mocks the SDK module directly instead.

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

describe('sms.service — SMS channel dormancy + no silent WhatsApp fallback', () => {
  it('sends via Africa\'s Talking when the channel is explicitly active AND credentials are configured', async () => {
    process.env.AT_API_KEY         = 'test-key'
    process.env.AT_USERNAME        = 'test-user'
    process.env.SMS_CHANNEL_ACTIVE = 'true'
    const { sendSMS, isSmsChannelActive } = await import('../../ai-suite/sms/sms.service')

    expect(isSmsChannelActive()).toBe(true)
    const result = await sendSMS('+256700000001', 'hello')

    expect(result).toBe('SENT')
    expect(atInitMock).toHaveBeenCalledWith({ apiKey: 'test-key', username: 'test-user' })
    expect(atSendMock).toHaveBeenCalledWith({ to: ['+256700000001'], message: 'hello' })
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('includes AT_SENDER_ID as `from` when configured', async () => {
    process.env.AT_API_KEY         = 'test-key'
    process.env.AT_USERNAME        = 'test-user'
    process.env.AT_SENDER_ID       = 'CODECLINIC'
    process.env.SMS_CHANNEL_ACTIVE = 'true'
    const { sendSMS } = await import('../../ai-suite/sms/sms.service')

    await sendSMS('+256700000001', 'hello')

    expect(atSendMock).toHaveBeenCalledWith({ to: ['+256700000001'], message: 'hello', from: 'CODECLINIC' })
  })

  it('real credentials present but SMS_CHANNEL_ACTIVE not set -> SMS_NOT_CONFIGURED, no send on any channel (the exact production condition today)', async () => {
    process.env.AT_API_KEY  = 'test-key'
    process.env.AT_USERNAME = 'test-user'
    // SMS_CHANNEL_ACTIVE deliberately left unset — mirrors production, which
    // genuinely has AT_API_KEY/AT_USERNAME configured but the channel not
    // yet turned on.
    const { sendSMS, isSmsChannelActive, isRealSmsProviderConfigured } = await import('../../ai-suite/sms/sms.service')

    expect(isRealSmsProviderConfigured()).toBe(true)
    expect(isSmsChannelActive()).toBe(false)
    const result = await sendSMS('+256700000001', 'hello')

    expect(result).toBe('SMS_NOT_CONFIGURED')
    expect(atSendMock).not.toHaveBeenCalled()
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('SMS_CHANNEL_ACTIVE=true but credentials absent -> SMS_NOT_CONFIGURED, no send on any channel', async () => {
    process.env.SMS_CHANNEL_ACTIVE = 'true'
    const { sendSMS, isSmsChannelActive } = await import('../../ai-suite/sms/sms.service')

    expect(isSmsChannelActive()).toBe(false)
    const result = await sendSMS('+256700000001', 'hello')

    expect(result).toBe('SMS_NOT_CONFIGURED')
    expect(atSendMock).not.toHaveBeenCalled()
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('neither configured -> SMS_NOT_CONFIGURED, no send on any channel', async () => {
    const { sendSMS, isSmsChannelActive } = await import('../../ai-suite/sms/sms.service')

    expect(isSmsChannelActive()).toBe(false)
    const result = await sendSMS('+256700000001', 'hello')

    expect(result).toBe('SMS_NOT_CONFIGURED')
    expect(atSendMock).not.toHaveBeenCalled()
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('only one of the two required credential env vars set (channel active) -> SMS_NOT_CONFIGURED', async () => {
    process.env.AT_API_KEY         = 'test-key' // AT_USERNAME deliberately left unset
    process.env.SMS_CHANNEL_ACTIVE = 'true'
    const { sendSMS, isSmsChannelActive } = await import('../../ai-suite/sms/sms.service')

    expect(isSmsChannelActive()).toBe(false)
    const result = await sendSMS('+256700000001', 'hello')

    expect(result).toBe('SMS_NOT_CONFIGURED')
    expect(atSendMock).not.toHaveBeenCalled()
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })
})

describe('sms.service — sendStaffSMS (internal alerts, independent of the patient-channel gate)', () => {
  it('sends via Africa\'s Talking whenever credentials exist, regardless of SMS_CHANNEL_ACTIVE', async () => {
    process.env.AT_API_KEY  = 'test-key'
    process.env.AT_USERNAME = 'test-user'
    // SMS_CHANNEL_ACTIVE deliberately left unset — staff alerts are not
    // gated on "has SMS been turned on as a patient channel".
    const { sendStaffSMS } = await import('../../ai-suite/sms/sms.service')

    await sendStaffSMS('+256700000099', 'staff alert')

    expect(atSendMock).toHaveBeenCalledWith({ to: ['+256700000099'], message: 'staff alert' })
  })

  it('throws (no WhatsApp fallback) when Africa\'s Talking credentials are absent', async () => {
    const { sendStaffSMS } = await import('../../ai-suite/sms/sms.service')

    await expect(sendStaffSMS('+256700000099', 'staff alert')).rejects.toThrow(/Africa's Talking not configured/)
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })
})
