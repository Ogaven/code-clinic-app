import { describe, expect, it, vi, beforeEach } from 'vitest'

// [PRE-DEPLOY VERIFY] Fix for the reported "UGX 0" grounding bug:
//   Patient: "Hi, How much is cementing" → Sarah: "Is it a crown, bridge, or retainer?"
//   Patient: "retainer" → Sarah: "Retainer re-cementing is currently listed at UGX 0."
// Root cause: a real, active Service record ("RECEMETING RETAINER") has
// priceUGX: 0 in the database (a genuine data gap, not a bug in the data
// itself), and two code paths passed that raw 0 straight through with no
// validation: getCachedMenu()'s prompt-embedded services list, and the
// search_services tool result. These tests exercise the REAL tool layer
// (executeV2Tool via getAgentReplyV2OpenAI) and the REAL anti-hallucination
// guard — only the OpenAI network call and outbound sends are mocked — to
// prove the fix end to end, not just at the unit level.

const responsesCreate = vi.fn()

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({ responses: { create: responsesCreate } })),
}))

const sendWhatsAppMessage = vi.fn().mockResolvedValue(undefined)
vi.mock('../ai-suite/whatsapp/whatsapp.service', () => ({
  sendWhatsAppMessage,
  sendWhatsAppTemplate: vi.fn().mockResolvedValue(undefined),
  containsPhrase: () => false,
}))

// Deliberately NOT mocking anti-hallucination guard — this suite exists to
// prove the real guard + real tool layer combination is fail-closed.

const prismaMock = {
  aiMessage: {
    findFirst: vi.fn().mockResolvedValue(null),
    findMany:  vi.fn().mockResolvedValue([]),
    create:    vi.fn().mockResolvedValue({}),
  },
  patient: {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
  },
  service: {
    findMany: vi.fn().mockResolvedValue([]),
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
  user: { findMany: vi.fn().mockResolvedValue([]) },
  notification: { create: vi.fn().mockResolvedValue({}) },
}

vi.mock('../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))

const ZERO_PRICE_SERVICES = [
  { id: 'svc-retainer-recement', name: 'RECEMETING RETAINER', priceUGX: 0, durationMins: 30, isActive: true },
  { id: 'svc-crown-recement',    name: 'RECEMENTING CROWN',    priceUGX: 0, durationMins: 30, isActive: true },
  { id: 'svc-bridge-cement',     name: 'Bridge Fitting / Cementation', priceUGX: 0, durationMins: 30, isActive: true },
  { id: 'svc-crown-cement',      name: 'Crown Fitting / Cementation',  priceUGX: 0, durationMins: 30, isActive: true },
  { id: 'svc-crown-recementation', name: 'Crown Re-cementation', priceUGX: 100000, durationMins: 30, isActive: true },
  { id: 'svc-cleaning',          name: 'Dental Cleaning',        priceUGX: 80000, durationMins: 45, isActive: true },
  { id: 'svc-implant',           name: 'Dental Implant Placement (Surgical Phase)', priceUGX: 5640000, durationMins: 90, isActive: true },
]

function toolCallResponse(name: string, args: Record<string, unknown>, callId = 'call_1') {
  return {
    output: [{ type: 'function_call', name, call_id: callId, arguments: JSON.stringify(args) }],
    output_text: '',
    usage: {},
  }
}

function finalTextResponse(reply: string) {
  return { output: [], output_text: `<reply>${reply}</reply>`, usage: {} }
}

describe('Pricing grounding — search_services tool result shape', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.OPENAI_API_KEY = 'test-key-not-real'
    prismaMock.service.findMany.mockResolvedValue(ZERO_PRICE_SERVICES)
    prismaMock.doctor.findMany.mockResolvedValue([])
    prismaMock.workingHours.findMany.mockResolvedValue([])
    prismaMock.aiKnowledgeBase.findMany.mockResolvedValue([])
    prismaMock.patient.findMany.mockResolvedValue([])
    prismaMock.patient.findFirst.mockResolvedValue(null)
    prismaMock.aiMessage.findFirst.mockResolvedValue(null)
    prismaMock.aiMessage.findMany.mockResolvedValue([])
    prismaMock.user.findMany.mockResolvedValue([])
  })

  it('EDGE price=0: never sends the model a raw priceUGX:0 for the exact reported service ("retainer" re-cementing)', async () => {
    responsesCreate
      .mockResolvedValueOnce(toolCallResponse('search_services', { query: 'recemeting retainer' }))
      .mockResolvedValueOnce(finalTextResponse(`I don't have a confirmed price for retainer re-cementing at the moment — I'll have the team confirm that for you 😊`))

    const { getAgentReplyV2OpenAI } = await import('../ai-suite/agent/agent.service')
    const reply = await getAgentReplyV2OpenAI('conv-price0', '+256700000101', 'How much is retainer re-cementing?', 'WEBSITE')

    // Inspect what the tool actually returned to the model on round 2.
    const secondCallInput = responsesCreate.mock.calls[1][0].input
    const toolOutputItem = secondCallInput.find((m: any) => m.type === 'function_call_output')
    const toolOutput = JSON.parse(toolOutputItem.output)
    expect(toolOutput.priceConfirmed).toBe(false)
    expect(toolOutput.priceUGX).toBeUndefined()
    expect(JSON.stringify(toolOutput)).not.toContain('"priceUGX":0')

    expect(reply).not.toContain('UGX 0')
    expect(reply.toLowerCase()).not.toContain('database')
    expect(reply.toLowerCase()).not.toContain('null')
  })

  it('EDGE price=null: a service with a null priceUGX is also treated as unconfirmed, not free', async () => {
    prismaMock.service.findMany.mockResolvedValue([
      { id: 'svc-null-price', name: 'Orthodontic Review', priceUGX: null, durationMins: 20, isActive: true },
    ])
    responsesCreate
      .mockResolvedValueOnce(toolCallResponse('search_services', { query: 'orthodontic review' }))
      .mockResolvedValueOnce(finalTextResponse(`I don't have a confirmed price for that one yet — I'll get the team to confirm it 😊`))

    const { getAgentReplyV2OpenAI } = await import('../ai-suite/agent/agent.service')
    await getAgentReplyV2OpenAI('conv-pricenull', '+256700000102', 'How much is an orthodontic review?', 'WHATSAPP')

    const secondCallInput = responsesCreate.mock.calls[1][0].input
    const toolOutputItem = secondCallInput.find((m: any) => m.type === 'function_call_output')
    const toolOutput = JSON.parse(toolOutputItem.output)
    expect(toolOutput.priceConfirmed).toBe(false)
    expect(toolOutput.priceUGX).toBeUndefined()
  })

  it('a genuinely confirmed, positive price is still passed through and quoted normally (no regression)', async () => {
    responsesCreate
      .mockResolvedValueOnce(toolCallResponse('search_services', { query: 'Dental Cleaning' }))
      .mockResolvedValueOnce(finalTextResponse('Dental cleaning is UGX 80,000 😊'))

    const { getAgentReplyV2OpenAI } = await import('../ai-suite/agent/agent.service')
    const reply = await getAgentReplyV2OpenAI('conv-priceok', '+256700000103', 'How much is a filling? Actually, cleaning?', 'WHATSAPP')

    const secondCallInput = responsesCreate.mock.calls[1][0].input
    const toolOutputItem = secondCallInput.find((m: any) => m.type === 'function_call_output')
    const toolOutput = JSON.parse(toolOutputItem.output)
    expect(toolOutput.priceConfirmed).toBe(true)
    expect(toolOutput.priceUGX).toBe(80000)
    expect(reply).toContain('80,000')
  })

  it('EDGE missing/unmatched service: an unrecognised query returns found:false with no prices leaked in the fallback list', async () => {
    responsesCreate
      .mockResolvedValueOnce(toolCallResponse('search_services', { query: 'gold grill' }))
      .mockResolvedValueOnce(finalTextResponse(`We don't have that listed — would you like to see our services? 😊`))

    const { getAgentReplyV2OpenAI } = await import('../ai-suite/agent/agent.service')
    await getAgentReplyV2OpenAI('conv-missing', '+256700000104', 'Do you do gold grills?', 'WHATSAPP')

    const secondCallInput = responsesCreate.mock.calls[1][0].input
    const toolOutputItem = secondCallInput.find((m: any) => m.type === 'function_call_output')
    const toolOutput = JSON.parse(toolOutputItem.output)
    expect(toolOutput.found).toBe(false)
    expect(JSON.stringify(toolOutput)).not.toMatch(/priceUGX/)
  })

  it('EDGE inactive service: a service marked isActive:false is never matched or offered', async () => {
    prismaMock.service.findMany.mockResolvedValue([]) // getServices()/matchService() already filter isActive:true at the query level
    responsesCreate
      .mockResolvedValueOnce(toolCallResponse('search_services', { query: 'teeth whitening' }))
      .mockResolvedValueOnce(finalTextResponse(`We don't currently offer that — happy to help with something else 😊`))

    const { getAgentReplyV2OpenAI } = await import('../ai-suite/agent/agent.service')
    await getAgentReplyV2OpenAI('conv-inactive', '+256700000105', 'How much is teeth whitening?', 'WHATSAPP')

    const secondCallInput = responsesCreate.mock.calls[1][0].input
    const toolOutputItem = secondCallInput.find((m: any) => m.type === 'function_call_output')
    const toolOutput = JSON.parse(toolOutputItem.output)
    expect(toolOutput.found).toBe(false)
  })

  it('EDGE database error / tool timeout: a rejected service lookup fails closed rather than crashing or exposing internals', async () => {
    prismaMock.service.findMany.mockRejectedValueOnce(new Error('connection timeout'))
    responsesCreate
      .mockResolvedValueOnce(toolCallResponse('search_services', { query: 'root canal' }))
      .mockResolvedValueOnce(finalTextResponse(`Let me double-check that price for you and get one of our team to confirm — they'll be in touch shortly 😊`))

    const { getAgentReplyV2OpenAI } = await import('../ai-suite/agent/agent.service')
    const reply = await getAgentReplyV2OpenAI('conv-dberror', '+256700000106', 'How much is a root canal?', 'WHATSAPP')

    expect(typeof reply).toBe('string')
    expect(reply.length).toBeGreaterThan(0)
    const secondCallInput = responsesCreate.mock.calls[1][0].input
    const toolOutputItem = secondCallInput.find((m: any) => m.type === 'function_call_output')
    const toolOutput = JSON.parse(toolOutputItem.output)
    expect(toolOutput.error).toBeDefined()
  })

  it('EDGE OpenAI tool-call failure: malformed function-call JSON arguments for search_services do not crash and never surface a fabricated price', async () => {
    responsesCreate
      .mockResolvedValueOnce({
        output: [{ type: 'function_call', name: 'search_services', call_id: 'call_bad', arguments: '{this is not valid json' }],
        output_text: '',
        usage: {},
      })
      .mockResolvedValueOnce(finalTextResponse(`Could you tell me a bit more about what you're looking for? 😊`))

    const { getAgentReplyV2OpenAI } = await import('../ai-suite/agent/agent.service')
    const reply = await getAgentReplyV2OpenAI('conv-badjson', '+256700000107', 'how much', 'WHATSAPP')

    expect(typeof reply).toBe('string')
    expect(reply).not.toContain('UGX 0')
  })

  it('ADVERSARIAL: if the model states "UGX 0" anyway despite a fail-closed tool result, the real guard blocks it and a safe, non-robotic fallback is returned instead', async () => {
    responsesCreate
      .mockResolvedValueOnce(toolCallResponse('search_services', { query: 'recemeting retainer' }))
      .mockResolvedValueOnce(finalTextResponse('Retainer re-cementing is currently listed at UGX 0. By the way, what is your name? 😊'))

    const { getAgentReplyV2OpenAI } = await import('../ai-suite/agent/agent.service')
    const reply = await getAgentReplyV2OpenAI('conv-adversarial', '+256700000108', 'How much is retainer re-cementing?', 'WEBSITE')

    // The real guard must reject this and the caller must fall back to the
    // generic safe message — never the model's forbidden "UGX 0" text.
    expect(reply).not.toContain('UGX 0')
    expect(reply).not.toContain('currently listed at')
  })
})

describe('Pricing grounding — getCachedMenu() prompt content (AVAILABLE SERVICES block)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.OPENAI_API_KEY = 'test-key-not-real'
    prismaMock.service.findMany.mockResolvedValue(ZERO_PRICE_SERVICES)
    prismaMock.doctor.findMany.mockResolvedValue([])
    prismaMock.workingHours.findMany.mockResolvedValue([])
    prismaMock.aiKnowledgeBase.findMany.mockResolvedValue([])
    prismaMock.patient.findMany.mockResolvedValue([])
    prismaMock.patient.findFirst.mockResolvedValue(null)
    prismaMock.aiMessage.findFirst.mockResolvedValue(null)
    prismaMock.aiMessage.findMany.mockResolvedValue([])
  })

  it('never bakes a raw "UGX 0" line into the system prompt for a zero-priced service, and still shows real prices for priced services', async () => {
    responsesCreate.mockResolvedValueOnce(finalTextResponse('Hi! How can I help? 😊'))

    const { getAgentReplyV2OpenAI } = await import('../ai-suite/agent/agent.service')
    await getAgentReplyV2OpenAI('conv-menu', '+256700000109', 'What services do you offer?', 'WHATSAPP')

    const firstCallInput = responsesCreate.mock.calls[0][0].input
    const promptText = JSON.stringify(firstCallInput)

    expect(promptText).not.toContain('RECEMETING RETAINER: UGX 0')
    expect(promptText).toContain('price not yet confirmed')
    expect(promptText).toContain('Dental Cleaning: UGX 80,000')
    expect(promptText).toContain('Crown Re-cementation: UGX 100,000')
  })
})
