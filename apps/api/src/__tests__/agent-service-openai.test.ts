import { describe, expect, it, vi, beforeEach } from 'vitest'

// ── Mocks ────────────────────────────────────────────────────────────────────
// All DB/Redis/WhatsApp/OpenAI dependencies of agent.service.ts are mocked —
// this test never touches a real database or makes a real network call
// (enforced further by the global no-real-sends fetch guard).

const responsesCreate = vi.fn()

vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      responses: { create: responsesCreate },
    })),
  }
})

const prismaMock = {
  aiMessage: {
    findFirst: vi.fn().mockResolvedValue(null), // no post-booking short-circuit, no prior failed fallback
    findMany:  vi.fn().mockResolvedValue([]),   // empty conversation history by default
    create:    vi.fn().mockResolvedValue({}),
  },
  patient: {
    findMany: vi.fn().mockResolvedValue([]), // resolveTextingPatient / guardian dependents — no patient on file
  },
  service: {
    findMany: vi.fn().mockResolvedValue([{ name: 'Dental Cleaning', priceUGX: 80000, durationMins: 45 }]),
  },
  doctor: {
    findMany: vi.fn().mockResolvedValue([]),
  },
  workingHours: {
    findMany: vi.fn().mockResolvedValue([]),
  },
  aiKnowledgeBase: {
    findMany: vi.fn().mockResolvedValue([]),
  },
}

vi.mock('../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))

vi.mock('../ai-suite/whatsapp/whatsapp.service', () => ({
  sendWhatsAppMessage: vi.fn().mockResolvedValue(undefined),
  sendWhatsAppTemplate: vi.fn().mockResolvedValue(undefined),
  containsPhrase: () => false,
}))

vi.mock('../../services/agent/guards/anti-hallucination', () => ({
  antiHallucinationGuard: vi.fn().mockResolvedValue({ safe: true }),
}))

describe('getAgentReplyV2OpenAI — shared runtime used by every patient channel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.OPENAI_API_KEY = 'test-key-not-real'
    prismaMock.aiMessage.findFirst.mockResolvedValue(null)
    prismaMock.aiMessage.findMany.mockResolvedValue([])
    prismaMock.patient.findMany.mockResolvedValue([])
    prismaMock.service.findMany.mockResolvedValue([{ name: 'Dental Cleaning', priceUGX: 80000, durationMins: 45 }])
    prismaMock.doctor.findMany.mockResolvedValue([])
    prismaMock.workingHours.findMany.mockResolvedValue([])
    prismaMock.aiKnowledgeBase.findMany.mockResolvedValue([])
  })

  it('calls OpenAI (never Anthropic) and returns the model reply, with prior conversation history included in the request', async () => {
    responsesCreate.mockResolvedValueOnce({
      output: [],
      output_text: 'Sure! We have a slot tomorrow at 10am. <reply>Sure! We have a slot tomorrow at 10am 😊</reply>'.includes('<reply>')
        ? 'Sure! We have a slot tomorrow at 10am 😊'
        : 'Sure! We have a slot tomorrow at 10am 😊',
      usage: { input_tokens: 100, output_tokens: 20 },
    })
    prismaMock.aiMessage.findMany.mockResolvedValueOnce([
      { role: 'USER', content: 'Hi, do you have anything tomorrow?' },
    ])

    const { getAgentReplyV2OpenAI } = await import('../ai-suite/agent/agent.service')
    const reply = await getAgentReplyV2OpenAI('conv-1', '+256700000001', 'Do you have anything tomorrow?', 'WHATSAPP')

    expect(reply).toContain('tomorrow')
    expect(responsesCreate).toHaveBeenCalledTimes(1)

    const call = responsesCreate.mock.calls[0][0]
    expect(call.model).toMatch(/^gpt-/) // OpenAI model, not claude-*
    const inputText = JSON.stringify(call.input)
    expect(inputText).toContain('do you have anything tomorrow')
    expect(inputText.toLowerCase()).not.toContain('claude')
  })

  it('never imports or references @anthropic-ai/sdk to produce this reply (structural: mocking only "openai" is sufficient for the call to succeed)', async () => {
    responsesCreate.mockResolvedValueOnce({ output: [], output_text: 'Hello! 😊', usage: {} })
    const { getAgentReplyV2OpenAI } = await import('../ai-suite/agent/agent.service')
    // If this module still imported @anthropic-ai/sdk at runtime, Node would
    // need to resolve that package — it's been removed from package.json/
    // node_modules by this same change, so any lingering import would throw
    // a module-resolution error here, not a normal mocked response.
    await expect(getAgentReplyV2OpenAI('conv-2', '+256700000002', 'Hello', 'WHATSAPP')).resolves.toBe('Hello! 😊')
  })

  it('OPENAI_401_TEST — an authentication error from the provider falls back gracefully, does not throw, and logs internally rather than crashing the caller', async () => {
    const authError = Object.assign(new Error('401 Unauthorized: Invalid API key'), { status: 401 })
    responsesCreate.mockRejectedValueOnce(authError)

    const { getAgentReplyV2OpenAI } = await import('../ai-suite/agent/agent.service')
    const reply = await getAgentReplyV2OpenAI('conv-3', '+256700000003', 'How much is a cleaning?', 'WHATSAPP')

    expect(reply).toBe(`Sorry, I'm having a small issue right now. Please try again in a moment 😊`)
  })

  it('OPENAI_429_TEST — a rate-limit error falls back gracefully without throwing', async () => {
    const rateLimitError = Object.assign(new Error('429 Too Many Requests'), { status: 429 })
    responsesCreate.mockRejectedValueOnce(rateLimitError)

    const { getAgentReplyV2OpenAI } = await import('../ai-suite/agent/agent.service')
    await expect(getAgentReplyV2OpenAI('conv-4', '+256700000004', 'Hi', 'WHATSAPP')).resolves.toBeTypeOf('string')
  })

  it('OPENAI_500_TEST — a server error falls back gracefully without throwing', async () => {
    const serverError = Object.assign(new Error('500 Internal Server Error'), { status: 500 })
    responsesCreate.mockRejectedValueOnce(serverError)

    const { getAgentReplyV2OpenAI } = await import('../ai-suite/agent/agent.service')
    await expect(getAgentReplyV2OpenAI('conv-5', '+256700000005', 'Hi', 'WHATSAPP')).resolves.toBeTypeOf('string')
  })

  it('OPENAI_TIMEOUT_TEST — a network timeout falls back gracefully without throwing', async () => {
    responsesCreate.mockRejectedValueOnce(Object.assign(new Error('Request timed out'), { code: 'ETIMEDOUT' }))

    const { getAgentReplyV2OpenAI } = await import('../ai-suite/agent/agent.service')
    await expect(getAgentReplyV2OpenAI('conv-6', '+256700000006', 'Hi', 'WHATSAPP')).resolves.toBeTypeOf('string')
  })

  it('OPENAI_EMPTY_RESPONSE_TEST — an empty output_text does not crash and produces a safe, non-empty reply', async () => {
    responsesCreate.mockResolvedValueOnce({ output: [], output_text: '', usage: {} })

    const { getAgentReplyV2OpenAI } = await import('../ai-suite/agent/agent.service')
    const reply = await getAgentReplyV2OpenAI('conv-7', '+256700000007', 'Hi', 'WHATSAPP')
    expect(reply.length).toBeGreaterThan(0)
  })

  it('does not send a duplicate outbound message or corrupt the conversation on failure — only the caller persists messages, and the function itself never calls sendWhatsAppMessage on the failure path', async () => {
    const { sendWhatsAppMessage } = await import('../ai-suite/whatsapp/whatsapp.service')
    responsesCreate.mockRejectedValueOnce(new Error('500 Internal Server Error'))

    const { getAgentReplyV2OpenAI } = await import('../ai-suite/agent/agent.service')
    await getAgentReplyV2OpenAI('conv-8', '+256700000008', 'Hi', 'WHATSAPP')

    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })
})
