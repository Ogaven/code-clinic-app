import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.setConfig({ testTimeout: 20000 })

// Verifies the Phase-9 safe-failure behavior added alongside the OpenAI
// cutover: a single provider failure just returns the fallback text (as
// before), but two CONSECUTIVE failures for the same conversation trigger an
// internal staff alert so a human picks it up — without changing what the
// patient receives.

const responsesCreate = vi.fn()

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({ responses: { create: responsesCreate } })),
}))

const sendWhatsAppMessage = vi.fn().mockResolvedValue('wamid-staff-alert')

vi.mock('../ai-suite/whatsapp/whatsapp.service', () => ({
  sendWhatsAppMessage,
  sendWhatsAppTemplate: vi.fn().mockRejectedValue(new Error('no template configured')),
  containsPhrase: () => false,
}))

vi.mock('../../services/agent/guards/anti-hallucination', () => ({
  antiHallucinationGuard: vi.fn().mockResolvedValue({ safe: true }),
}))

// This suite exercises provider-failure escalation, not handback context.
// Isolate the independent handback reader so its conversation queries do not
// consume the sequential Prisma mocks used to model failure history.
vi.mock('../ai-suite/agent/patient-context.service', () => ({
  buildPatientContextSummary: vi.fn().mockResolvedValue(''),
  getPendingHandoffNote: vi.fn().mockResolvedValue(null),
}))

const FALLBACK_TEXT = `Thank you for your message. Our reception team will assist you shortly.`

const prismaMock = {
  aiConversation: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  aiMessage:      { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({}) },
  patient:        { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null) },
  service:        { findMany: vi.fn().mockResolvedValue([]) },
  doctor:         { findMany: vi.fn().mockResolvedValue([]) },
  workingHours:   { findMany: vi.fn().mockResolvedValue([]) },
  aiKnowledgeBase:{ findMany: vi.fn().mockResolvedValue([]) },
  user:           { findMany: vi.fn().mockResolvedValue([]) },
  notification:   { create: vi.fn().mockResolvedValue({}) },
}

vi.mock('../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))

describe('safe failure behavior — no silent repeat-fallback loop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.OPENAI_API_KEY = 'test-key-not-real'
    prismaMock.service.findMany.mockResolvedValue([])
    prismaMock.doctor.findMany.mockResolvedValue([])
    prismaMock.workingHours.findMany.mockResolvedValue([])
    prismaMock.aiKnowledgeBase.findMany.mockResolvedValue([])
    prismaMock.patient.findMany.mockResolvedValue([])
    prismaMock.patient.findFirst.mockResolvedValue(null)
    prismaMock.user.findMany.mockResolvedValue([])
    prismaMock.aiMessage.findMany.mockResolvedValue([])
    prismaMock.aiConversation.updateMany.mockResolvedValue({ count: 1 })
  })

  it('a first, isolated failure returns the fallback but does NOT alert staff', async () => {
    // Call 1: post-booking short-circuit check inside the try block — no shortcut.
    prismaMock.aiMessage.findFirst.mockResolvedValueOnce(null)
    // Call 2: escalateOnRepeatedProviderFailure's own check — last agent turn was NOT the fallback.
    prismaMock.aiMessage.findFirst.mockResolvedValueOnce({ content: 'Hi! How can I help? 😊' })
    responsesCreate.mockRejectedValueOnce(new Error('500 Internal Server Error'))

    const { getAgentReplyV2OpenAI } = await import('../ai-suite/agent/agent.service')
    const reply = await getAgentReplyV2OpenAI('conv-solo-fail', '+256700000010', 'Hi', 'WHATSAPP')

    expect(reply).toBe(FALLBACK_TEXT)
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('two consecutive failures for the same conversation trigger a staff alert, without changing the patient-facing reply', async () => {
    // Call 1: post-booking short-circuit check — no shortcut.
    prismaMock.aiMessage.findFirst.mockResolvedValueOnce(null)
    // Call 2: escalateOnRepeatedProviderFailure's check — last agent turn WAS the exact fallback (prior failure).
    prismaMock.aiMessage.findFirst.mockResolvedValueOnce({ content: FALLBACK_TEXT })
    // Call 3: alertStaffOfConcern's own STAFF_ALERTED dedup check — nothing recent, proceed.
    prismaMock.aiMessage.findFirst.mockResolvedValueOnce(null)
    responsesCreate.mockRejectedValueOnce(new Error('500 Internal Server Error'))

    const { getAgentReplyV2OpenAI } = await import('../ai-suite/agent/agent.service')
    const reply = await getAgentReplyV2OpenAI('conv-repeat-fail', '+256700000011', 'Hi', 'WHATSAPP')

    // Patient still gets the same, unchanged fallback text — this is a background-only alert.
    expect(reply).toBe(FALLBACK_TEXT)
    // Staff WAS notified this time.
    expect(prismaMock.aiConversation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'conv-repeat-fail' }),
      data: expect.objectContaining({ agentEnabled: false, status: 'HUMAN_TAKEOVER' }),
    }))
    expect(prismaMock.aiMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ content: expect.stringContaining('AI_PROVIDER_FAILURE') }),
    }))
  })
})
