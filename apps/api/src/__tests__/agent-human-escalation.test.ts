import { describe, expect, it, vi, beforeEach } from 'vitest'

// 2026-09-22 fix, two parts:
//
// 1. The "talk to a human" / "speak to Julian" keyword path used to fire a
//    bare freeform WhatsApp send with no Escalation record, no in-app
//    Notification, no push, and no template-preferred/24h-window handling
//    (unlike every other staff alert in this file). It now routes through
//    the same alertStaffOfConcern() used for clinical-concern escalations.
// 2. alertStaffOfConcern() created an in-app Notification row but never
//    called sendPushToUser — every other staff-alert path in the codebase
//    (maybeNotifyStaff, lead-intake, lead-sla, previsit,
//    treatment-followup-alerts) pairs the two; this one was missing the
//    pairing, so escalations never actually reached a staff member's device
//    via push, only the in-app bell (if they had the tab open).
//
// This suite proves both are fixed, using the same OpenAI-reject-then-
// FALLBACK_TEXT pattern already established in
// agent-service-failure-escalation.test.ts (the human-escalation alert is
// fire-and-forget and fires before the OpenAI call, so it's independent of
// what the OpenAI call itself does afterward).

const responsesCreate = vi.fn()

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({ responses: { create: responsesCreate } })),
}))

const sendWhatsAppMessage  = vi.fn().mockResolvedValue('wamid-staff-alert')
const sendWhatsAppTemplate = vi.fn().mockResolvedValue('wamid-template')

vi.mock('../ai-suite/whatsapp/whatsapp.service', () => ({
  sendWhatsAppMessage,
  sendWhatsAppTemplate,
  containsPhrase: () => false,
}))

const sendPushToUser = vi.fn().mockResolvedValue(undefined)
vi.mock('../services/push.service', () => ({ sendPushToUser }))
vi.mock('../../services/push.service', () => ({ sendPushToUser }))

vi.mock('../../services/agent/guards/anti-hallucination', () => ({
  antiHallucinationGuard: vi.fn().mockResolvedValue({ safe: true }),
}))

vi.mock('../sms/sms.service', () => ({ sendStaffSMS: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../ai-suite/sms/sms.service', () => ({ sendStaffSMS: vi.fn().mockResolvedValue(undefined) }))

const FALLBACK_TEXT = `Sorry, I'm having a small issue right now. Please try again in a moment 😊`

const prismaMock = {
  aiMessage:      { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({}) },
  patient:        { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null) },
  service:        { findMany: vi.fn().mockResolvedValue([]) },
  doctor:         { findMany: vi.fn().mockResolvedValue([]) },
  workingHours:   { findMany: vi.fn().mockResolvedValue([]) },
  aiKnowledgeBase:{ findMany: vi.fn().mockResolvedValue([]) },
  user:           { findMany: vi.fn().mockResolvedValue([{ id: 'staff-1', role: 'RECEPTIONIST' }, { id: 'staff-2', role: 'ADMIN' }]) },
  notification:   { create: vi.fn().mockResolvedValue({}) },
  escalation:     { create: vi.fn().mockResolvedValue({}) },
}

vi.mock('../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))

describe('"talk to a human" keyword path — routes through the real escalation machinery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.OPENAI_API_KEY = 'test-key-not-real'
    delete process.env.WA_TEMPLATE_STAFF_ALERT_NAME
    prismaMock.service.findMany.mockResolvedValue([])
    prismaMock.doctor.findMany.mockResolvedValue([])
    prismaMock.workingHours.findMany.mockResolvedValue([])
    prismaMock.aiKnowledgeBase.findMany.mockResolvedValue([])
    prismaMock.patient.findMany.mockResolvedValue([])
    prismaMock.patient.findFirst.mockResolvedValue(null)
    prismaMock.user.findMany.mockResolvedValue([{ id: 'staff-1', role: 'RECEPTIONIST' }, { id: 'staff-2', role: 'ADMIN' }])
    prismaMock.aiMessage.findMany.mockResolvedValue([])
    prismaMock.notification.create.mockResolvedValue({})
    prismaMock.escalation.create.mockResolvedValue({})
  })

  it('creates an Escalation record, an in-app Notification, AND a push for every staff member — not just a bare WhatsApp send', async () => {
    // Call 1: post-booking short-circuit check — no shortcut.
    prismaMock.aiMessage.findFirst.mockResolvedValueOnce(null)
    // Call 2: escalateOnRepeatedProviderFailure's check — no prior fallback, isolated failure.
    prismaMock.aiMessage.findFirst.mockResolvedValueOnce(null)
    // Call 3: alertStaffOfConcern's own STAFF_ALERTED dedup check — nothing recent, proceed.
    prismaMock.aiMessage.findFirst.mockResolvedValueOnce(null)
    responsesCreate.mockRejectedValueOnce(new Error('irrelevant to this test'))

    const { getAgentReplyV2OpenAI } = await import('../ai-suite/agent/agent.service')
    const reply = await getAgentReplyV2OpenAI('conv-human-1', '+256700000020', 'Can I talk to a human please', 'WHATSAPP')
    expect(reply).toBe(FALLBACK_TEXT)

    // Fire-and-forget — give the detached promise a tick to settle.
    await new Promise(r => setTimeout(r, 0))

    // Real Escalation row created (was previously never created for this path).
    expect(prismaMock.escalation.create).toHaveBeenCalledTimes(1)
    expect(prismaMock.escalation.create.mock.calls[0][0].data).toMatchObject({
      phoneNumber: '+256700000020',
      status:      'PENDING',
    })

    // In-app notification for every active staff member.
    expect(prismaMock.notification.create).toHaveBeenCalledTimes(2)

    // Push for every active staff member too (was previously missing entirely).
    expect(sendPushToUser).toHaveBeenCalledTimes(2)
    expect(sendPushToUser).toHaveBeenCalledWith('staff-1', expect.objectContaining({ title: expect.any(String), body: expect.any(String) }))
    expect(sendPushToUser).toHaveBeenCalledWith('staff-2', expect.objectContaining({ title: expect.any(String), body: expect.any(String) }))

    // Push body must never leak patient PII (same convention as maybeNotifyStaff).
    const pushCallBody = sendPushToUser.mock.calls[0][1].body as string
    expect(pushCallBody).not.toContain('+256700000020')
  })

  it('prefers the approved staff-alert template when WA_TEMPLATE_STAFF_ALERT_NAME is configured, freeform only as fallback', async () => {
    process.env.WA_TEMPLATE_STAFF_ALERT_NAME = 'cc_staff_concern'
    prismaMock.aiMessage.findFirst.mockResolvedValueOnce(null)
    prismaMock.aiMessage.findFirst.mockResolvedValueOnce(null)
    prismaMock.aiMessage.findFirst.mockResolvedValueOnce(null)
    responsesCreate.mockRejectedValueOnce(new Error('irrelevant to this test'))

    const { getAgentReplyV2OpenAI } = await import('../ai-suite/agent/agent.service')
    await getAgentReplyV2OpenAI('conv-human-2', '+256700000021', 'I want to speak to Julian', 'WHATSAPP')
    await new Promise(r => setTimeout(r, 0))

    expect(sendWhatsAppTemplate).toHaveBeenCalledWith('+256394836298', 'cc_staff_concern', expect.any(Array))
    expect(sendWhatsAppMessage).not.toHaveBeenCalled() // template succeeded — no freeform fallback needed
  })

  it('does not fire the human-escalation alert for a message with no matching keyword', async () => {
    prismaMock.aiMessage.findFirst.mockResolvedValueOnce(null)
    prismaMock.aiMessage.findFirst.mockResolvedValueOnce(null)
    responsesCreate.mockRejectedValueOnce(new Error('irrelevant to this test'))

    const { getAgentReplyV2OpenAI } = await import('../ai-suite/agent/agent.service')
    await getAgentReplyV2OpenAI('conv-no-keyword', '+256700000022', 'What time do you open tomorrow?', 'WHATSAPP')
    await new Promise(r => setTimeout(r, 0))

    expect(prismaMock.escalation.create).not.toHaveBeenCalled()
    expect(sendPushToUser).not.toHaveBeenCalled()
  })
})
