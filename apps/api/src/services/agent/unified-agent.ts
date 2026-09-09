import OpenAI from 'openai'
import { routeAgentContext } from './agent-router'
import { buildSystemPrompt } from './agent-prompt'
import { AGENT_TOOLS, executeAgentTool, ToolContext } from './agent-tools'
import { antiHallucinationGuard, ToolRecord } from './guards/anti-hallucination'
import { shouldEscalate, getEscalationUrgency, createEscalation, getSafeEscalationResponse } from './guards/escalation'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// Model choice mirrors the DM/comment-reply cutover: this path drives real
// bookings/cancellations over voice and WhatsApp test calls, so it gets the
// flagship tier rather than the cost-optimized one used for comment replies.
const MODEL = 'gpt-5.6-sol'

// ── Agent run params ──────────────────────────────────────────

export interface AgentMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AgentRunParams {
  phoneNumber: string
  channel: 'VOICE' | 'WHATSAPP'
  direction: 'INBOUND' | 'OUTBOUND'
  incomingMessage?: string
  outboundQueueId?: string
  conversationHistory?: AgentMessage[]
}

export interface AgentRunResult {
  text: string
  escalated: boolean
}

// ── Main agent runner ─────────────────────────────────────────

export async function runAgent(params: AgentRunParams): Promise<AgentRunResult> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return {
      text: "Hello! I'm Sarah from Code Clinic. Our AI system is currently being configured. Please call us directly at 0205477000 and our team will be happy to help you!",
      escalated: false,
    }
  }

  // 1. Pre-screen for emergency keywords (immediate escalation)
  if (params.incomingMessage && shouldEscalate(params.incomingMessage)) {
    const urgency = getEscalationUrgency(params.incomingMessage)
    await createEscalation({
      phoneNumber: params.phoneNumber,
      channel: params.channel,
      reason: `Auto-escalated: emergency/distress keywords detected in message: "${params.incomingMessage.slice(0, 100)}"`,
      transcript: params.incomingMessage,
    })
    return {
      text: getSafeEscalationResponse(params.channel),
      escalated: true,
    }
  }

  // 2. Load context and build system prompt
  const context = await routeAgentContext(
    params.phoneNumber,
    params.channel,
    params.direction,
    params.outboundQueueId
  )
  const systemPrompt = buildSystemPrompt(context)

  // 3. Build tool context (passed to tool handlers)
  const toolCtx: ToolContext = {
    phoneNumber: params.phoneNumber,
    channel: params.channel,
  }

  // 4. Build initial input — system prompt + history + the incoming message
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let input: any[] = [
    { role: 'system', content: systemPrompt },
    ...(params.conversationHistory || []),
  ]
  if (!params.conversationHistory?.length) {
    input.push({ role: 'user', content: params.incomingMessage || '[Call started — begin the conversation]' })
  }

  // 5. Multi-round tool-use loop (max 5 rounds)
  const allToolRecords: ToolRecord[] = []
  let finalText = ''
  const MAX_ROUNDS = 5

  for (let round = 0; round < MAX_ROUNDS; round++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response: any = await openai.responses.create({
      model: MODEL,
      input,
      tools: AGENT_TOOLS,
      max_output_tokens: 1024,
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolCalls: any[] = (response.output ?? []).filter((o: any) => o.type === 'function_call')

    if (toolCalls.length === 0) {
      finalText = (response.output_text ?? '').trim()
      break
    }

    input = [...input, ...response.output]

    // Process all tool calls in this round
    for (const call of toolCalls) {
      let args: any = {}
      try { args = JSON.parse(call.arguments || '{}') } catch { /* leave empty on parse failure */ }

      const result = await executeAgentTool(call.name, args, toolCtx, {
        transcript: params.conversationHistory
          ?.filter(m => m.role === 'user')
          .map(m => m.content)
          .join('\n'),
      })

      allToolRecords.push({ tool: call.name, result })
      input.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result) })
    }

    // If last round and still calling tools, force a final answer
    if (round === MAX_ROUNDS - 1) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const finalResponse: any = await openai.responses.create({
        model: MODEL,
        input: [
          ...input,
          { role: 'system', content: 'IMPORTANT: You have reached the tool call limit. Give your final response to the patient now.' },
        ],
        tools: AGENT_TOOLS,
        tool_choice: 'none',
        max_output_tokens: 512,
      })
      finalText = (finalResponse.output_text ?? '').trim()
    }
  }

  // 6. Anti-hallucination guard on final response
  if (finalText && allToolRecords.length > 0) {
    const guard = await antiHallucinationGuard(finalText, allToolRecords)
    if (!guard.safe) {
      console.warn('[AGENT GUARD] Unsafe response detected:', guard.reason)
      await createEscalation({
        phoneNumber: params.phoneNumber,
        channel: params.channel,
        reason: `Anti-hallucination guard triggered: ${guard.reason}`,
      })
      return {
        text: getSafeEscalationResponse(params.channel),
        escalated: true,
      }
    }
  }

  // 7. Fallback if no text was extracted
  if (!finalText) {
    finalText = params.channel === 'WHATSAPP'
      ? "I'm sorry, I had trouble processing that. Could you please try again? Or call us at 0205477000 😊"
      : "I'm sorry, I had a moment of difficulty there. Could you please repeat that?"
  }

  return { text: finalText, escalated: false }
}

// ── Continue agent with updated conversation history ──────────
// Used by WhatsApp channel for multi-turn conversations

export async function continueAgent(
  params: AgentRunParams & { conversationHistory: AgentMessage[] }
): Promise<AgentRunResult> {
  return runAgent(params)
}
