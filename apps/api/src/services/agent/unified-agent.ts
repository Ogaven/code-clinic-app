import Anthropic from '@anthropic-ai/sdk'
import { routeAgentContext } from './agent-router'
import { buildSystemPrompt } from './agent-prompt'
import { AGENT_TOOLS, executeAgentTool, ToolContext } from './agent-tools'
import { antiHallucinationGuard, ToolRecord } from './guards/anti-hallucination'
import { shouldEscalate, getEscalationUrgency, createEscalation, getSafeEscalationResponse } from './guards/escalation'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ── Agent run params ──────────────────────────────────────────

export interface AgentRunParams {
  phoneNumber: string
  channel: 'VOICE' | 'WHATSAPP'
  direction: 'INBOUND' | 'OUTBOUND'
  incomingMessage?: string
  outboundQueueId?: string
  conversationHistory?: Anthropic.MessageParam[]
}

export interface AgentRunResult {
  text: string
  escalated: boolean
}

// ── Extract text from Claude response ─────────────────────────

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim()
}

// ── Main agent runner ─────────────────────────────────────────

export async function runAgent(params: AgentRunParams): Promise<AgentRunResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey || apiKey.startsWith('sk-ant-...') || apiKey === '') {
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

  // 4. Build initial messages
  const initialMessage: Anthropic.MessageParam = {
    role: 'user',
    content: params.incomingMessage || '[Call started — begin the conversation]',
  }

  let messages: Anthropic.MessageParam[] = [
    ...(params.conversationHistory || []),
    ...(params.conversationHistory?.length ? [] : [initialMessage]),
  ]
  if (!params.conversationHistory?.length) {
    messages = [initialMessage]
  }

  // 5. Multi-round tool-use loop (max 5 rounds)
  const allToolRecords: ToolRecord[] = []
  let finalText = ''
  const MAX_ROUNDS = 5

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      tools: AGENT_TOOLS,
      messages,
    })

    if (response.stop_reason !== 'tool_use') {
      // Done — extract final response
      finalText = extractText(response.content)
      break
    }

    // Process all tool calls in this round
    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    )

    const toolResultContents: Anthropic.ToolResultBlockParam[] = await Promise.all(
      toolUseBlocks.map(async (block) => {
        const result = await executeAgentTool(block.name, block.input, toolCtx, {
          transcript: params.conversationHistory
            ?.filter(m => m.role === 'user')
            .map(m => typeof m.content === 'string' ? m.content : '')
            .join('\n'),
        })

        allToolRecords.push({ tool: block.name, result })

        return {
          type: 'tool_result' as const,
          tool_use_id: block.id,
          content: JSON.stringify(result),
        }
      })
    )

    // Anti-hallucination check after tool execution (skip on intermediate rounds)
    // We check the final response, not intermediate tool calls

    // Append assistant response + tool results to message history
    messages = [
      ...messages,
      { role: 'assistant', content: response.content },
      { role: 'user', content: toolResultContents },
    ]

    // If last round and still tool_use, force a final answer
    if (round === MAX_ROUNDS - 1) {
      const finalResponse = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 512,
        system: systemPrompt + '\n\nIMPORTANT: You have reached the tool call limit. Give your final response to the patient now.',
        tools: AGENT_TOOLS,
        tool_choice: { type: 'none' } as any,
        messages,
      })
      finalText = extractText(finalResponse.content)
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
  params: AgentRunParams & { conversationHistory: Anthropic.MessageParam[] }
): Promise<AgentRunResult> {
  return runAgent(params)
}
