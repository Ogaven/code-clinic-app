// ── voice-llm.routes.ts ───────────────────────────────────────────────────────
// OpenAI-compatible chat completions endpoint consumed by ElevenLabs ConvAI
// as the custom LLM for voice calls.
//
// ElevenLabs sends:
//   POST /ai-suite/voice/llm
//   {
//     "model": "...",
//     "messages": [
//       { "role": "system", "content": "..." },
//       { "role": "user",   "content": "caller's transcribed speech" }
//     ],
//     "stream": false,
//     "custom_llm_extra_body": { "caller_phone": "256...", "call_id": "..." }
//   }
//
// We run our unified Claude agent (with all 16 tools) and return an
// OpenAI-format response.

import { Router }    from 'express'
import Anthropic     from '@anthropic-ai/sdk'
import { prisma }    from '../../lib/prisma'
import { runAgent }  from '../../services/agent/unified-agent'

const router = Router()

// ── POST /ai-suite/voice/llm ─────────────────────────────────────────────────

router.post('/llm', async (req, res) => {
  try {
    const body = req.body as {
      model?:                string
      messages?:             Array<{ role: string; content: string }>
      stream?:               boolean
      custom_llm_extra_body?: Record<string, string>
    }

    // ── Extract caller phone and call ID from per-session metadata ──────────
    const callerPhone = body.custom_llm_extra_body?.caller_phone ?? 'unknown'
    const callId      = body.custom_llm_extra_body?.call_id      ?? `voice-${Date.now()}`

    // ── Get the last user message (caller's speech) ─────────────────────────
    const messages  = body.messages ?? []
    const userMsg   = [...messages].reverse().find(m => m.role === 'user')
    const userText  = userMsg?.content?.trim() ?? ''

    if (!userText) {
      return res.json(openAiResponse('How can I help you today?', callId))
    }

    console.log(`[VoiceLLM] call=${callId} phone=${callerPhone} → "${userText.slice(0, 80)}"`)

    // ── Look up or create conversation in DB ────────────────────────────────
    let conversation = await prisma.aiConversation.findFirst({
      where:   { phoneNumber: callerPhone, channel: 'VOICE', status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    }).catch(() => null)

    if (!conversation) {
      const patient = await prisma.patient.findFirst({
        where: { phone: callerPhone },
      }).catch(() => null)

      conversation = await prisma.aiConversation.create({
        data: {
          patientId:    patient?.id ?? null,
          channel:      'VOICE',
          phoneNumber:  callerPhone,
          status:       'ACTIVE',
          agentEnabled: true,
        },
      }).catch(() => null)
    }

    // ── Run Claude agent ────────────────────────────────────────────────────
    const agentResponse = await runAgent({
      phoneNumber:     callerPhone,
      channel:         'VOICE',
      direction:       'INBOUND',
      incomingMessage: userText,
    })

    const replyText = agentResponse?.text ?? 'I\'m sorry, I didn\'t catch that. Could you repeat?'

    console.log(`[VoiceLLM] reply="${replyText.slice(0, 80)}"`)

    // ── Save to conversation log ────────────────────────────────────────────
    if (conversation) {
      await prisma.aiMessage.createMany({
        data: [
          { conversationId: conversation.id, role: 'USER',  content: userText },
          { conversationId: conversation.id, role: 'AGENT', content: replyText },
        ],
      }).catch(() => null)
    }

    return res.json(openAiResponse(replyText, callId))
  } catch (err: any) {
    console.error('[VoiceLLM] Error:', err.message)
    // Return a graceful fallback — ElevenLabs will speak this to the caller
    return res.json(openAiResponse(
      'I\'m sorry, I\'m having a technical issue. Please hold or call us back at 0205477000.',
      'error',
    ))
  }
})

// ── Helper: format OpenAI-compatible response ─────────────────────────────────

function openAiResponse(content: string, id: string) {
  return {
    id:      `chatcmpl-${id}`,
    object:  'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model:   'claude-sonnet-4-6',
    choices: [{
      index:         0,
      message:       { role: 'assistant', content },
      finish_reason: 'stop',
    }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  }
}

export default router
