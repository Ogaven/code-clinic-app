// ── elevenlabs-conv-ai.service.ts ─────────────────────────────────────────────
// Manages a single WebSocket session with ElevenLabs Conversational AI.
//
// ElevenLabs ConvAI handles:
//   caller audio → STT → LLM (our custom endpoint) → TTS → response audio
//
// Audio contract:
//   sendCallerAudio() — accepts raw PCM 16kHz 16-bit LE Buffer
//   onAgentAudio     — receives raw PCM 16kHz 16-bit LE Buffer
//
// Protocol reference: https://elevenlabs.io/docs/conversational-ai/api-reference/websocket

import WebSocket from 'ws'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ConvAIOptions {
  agentId:     string
  apiKey:      string
  /** Called with raw PCM 16kHz LE bytes each time EL sends agent audio */
  onAgentAudio: (pcm16kLE: Buffer) => void
  /** Called when the conversation ends (WS closed by EL) */
  onClose?:    () => void
  /** Called on WebSocket or protocol error */
  onError?:    (err: Error) => void
  /** Optional per-call metadata forwarded to our custom LLM as extra_body */
  callMeta?:   Record<string, string>
}

export interface ConvAISession {
  /** Send a chunk of caller audio (PCM 16kHz 16-bit LE) to ElevenLabs */
  sendCallerAudio: (pcm16kLE: Buffer) => void
  /** Gracefully close the session */
  close:           () => void
  /** Conversation ID assigned by ElevenLabs (available after open) */
  conversationId:  string | null
}

// ── Factory ───────────────────────────────────────────────────────────────────

const ELEVENLABS_WSS = 'wss://api.elevenlabs.io/v1/convai/conversation'

export function createConvAISession(opts: ConvAIOptions): ConvAISession {
  const { agentId, apiKey, onAgentAudio, onClose, onError, callMeta } = opts

  const url = `${ELEVENLABS_WSS}?agent_id=${encodeURIComponent(agentId)}`
  const ws  = new WebSocket(url, { headers: { 'xi-api-key': apiKey } })

  let conversationId: string | null = null
  let initSent = false

  const session: ConvAISession = {
    conversationId: null,
    sendCallerAudio(pcm16kLE: Buffer) {
      if (ws.readyState !== WebSocket.OPEN) return
      ws.send(JSON.stringify({ user_audio_chunk: pcm16kLE.toString('base64') }))
    },
    close() {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(1000)
      }
    },
  }

  ws.on('open', () => {
    console.log('[ConvAI] WebSocket open — sending session config')
    // Send per-call overrides immediately after open:
    //  - Request pcm_16000 output so we get raw PCM (no MP3 decode needed)
    //  - Inject caller metadata into custom_llm_extra_body for patient lookup
    const initMsg: Record<string, unknown> = {
      type: 'conversation_initiation_client_data',
      conversation_initiation_client_data: {
        conversation_config_override: {
          tts: {
            optimize_streaming_latency:  4,           // max latency optimisation for telephony
            agent_output_audio_format:   'pcm_16000', // raw PCM so we can resample to 8kHz for RTP
          },
          asr: {
            user_input_audio_format: 'pcm_16000',     // we send PCM 16kHz LE after upsampling
          },
        },
        ...(callMeta ? { custom_llm_extra_body: callMeta } : {}),
      },
    }
    try { ws.send(JSON.stringify(initMsg)) } catch { /* ignore race */ }
    initSent = true
  })

  ws.on('message', (raw: WebSocket.RawData) => {
    let msg: any
    try { msg = JSON.parse(raw.toString()) } catch { return }

    switch (msg.type) {
      case 'conversation_initiation_metadata_event': {
        conversationId = msg.conversation_initiation_metadata_event?.conversation_id ?? null
        session.conversationId = conversationId
        console.log(`[ConvAI] Session started — conversation_id=${conversationId}`)
        break
      }

      case 'audio': {
        // audio_base_64 is raw PCM 16kHz 16-bit LE when agent is configured for pcm_16000
        const b64 = msg.audio_event?.audio_base_64
        if (b64) {
          const audioBuf = Buffer.from(b64, 'base64')
          onAgentAudio(audioBuf)
        }
        break
      }

      case 'agent_response': {
        const text = msg.agent_response_event?.agent_response
        if (text) console.log('[ConvAI] Agent:', String(text).slice(0, 120))
        break
      }

      case 'user_transcript': {
        const text = msg.user_transcription_event?.user_transcript
        if (text) console.log('[ConvAI] Caller:', String(text).slice(0, 120))
        break
      }

      case 'interruption':
        console.log('[ConvAI] Interrupted by caller')
        break

      case 'ping': {
        const eventId = msg.ping_event?.event_id
        if (ws.readyState === WebSocket.OPEN) {
          try { ws.send(JSON.stringify({ type: 'pong', event_id: eventId })) } catch { /* ignore */ }
        }
        break
      }

      case 'error': {
        const errMsg = msg.error?.message ?? JSON.stringify(msg)
        console.error('[ConvAI] Protocol error:', errMsg)
        onError?.(new Error(errMsg))
        break
      }

      default:
        // Ignore unknown message types (EL may add new ones)
        break
    }
  })

  ws.on('error', (err: Error) => {
    console.error('[ConvAI] WebSocket error:', err.message)
    onError?.(err)
  })

  ws.on('close', (code: number, reason: Buffer) => {
    console.log(`[ConvAI] Closed (${code}: ${reason.toString().slice(0, 80)})`)
    onClose?.()
  })

  return session
}

// ── Agent provisioning ────────────────────────────────────────────────────────
// Creates an ElevenLabs ConvAI agent configured for Code Clinic, pointing the
// LLM at our custom endpoint so Claude + all 16 tools run the conversation.

export async function provisionCodeClinicAgent(
  apiKey:      string,
  voiceId:     string,
  llmEndpoint: string,     // e.g. https://api.codeclinic.ug/ai-suite/voice/llm
): Promise<string> {       // returns agent_id

  const systemPrompt = `You are Sarah, the AI receptionist for Code Clinic, a dental and medical clinic in Kampala, Uganda.

Your role: Help patients over the phone — answer questions about the clinic, assist with appointment-related needs, and provide a warm, professional experience.

Guidelines:
- Speak naturally and concisely. This is a phone call, so keep responses to 1-3 sentences unless the caller needs more detail.
- You have access to the clinic's patient database and appointment system via the conversation system. Use it to look up patient records, available slots, and clinic information.
- Always greet warmly and listen carefully before responding.
- If a caller has a medical emergency, tell them to call 999 or go to the nearest emergency room immediately.
- Don't make up clinic hours, doctors, or services — use your tools to look them up.
- When you can't help, offer to connect the caller with a staff member.

Clinic details:
- Name: Code Clinic
- Location: Kampala, Uganda
- Phone: +256 205 477 000`

  const body = {
    name: 'Code Clinic Voice Agent',
    conversation_config: {
      agent: {
        prompt: {
          prompt:     systemPrompt,
          // 'custom-llm' routes conversation through our OpenAI-compatible endpoint
          // so Claude + all 16 tools handle the intelligence.
          llm:        'custom-llm',
          custom_llm: { url: llmEndpoint },
          temperature: 0.7,
          max_tokens:  300,   // Keep responses short for phone calls
        },
        first_message: 'Hello! You\'ve reached Code Clinic. I\'m Sarah, your AI assistant. How can I help you today?',
        language: 'en',
      },
      tts: {
        voice_id:                   voiceId,
        model_id:                   'eleven_turbo_v2_5',  // fastest/cheapest model (replaces eleven_turbo_v2)
        optimize_streaming_latency: 4,
      },
      turn: {
        turn_timeout:             5,   // seconds of silence → agent speaks
        silence_end_call_timeout: 30,
      },
    },
  }

  const resp = await fetch('https://api.elevenlabs.io/v1/convai/agents/create', {
    method:  'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })

  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`ElevenLabs create agent failed (${resp.status}): ${text}`)
  }

  const data = await resp.json() as { agent_id: string }
  console.log(`[ConvAI] Agent provisioned: agent_id=${data.agent_id}`)
  return data.agent_id
}

/** Fetch the agent_id from DB settings, falling back to env var */
export async function getOrCreateAgentId(
  prisma:   any,
  apiKey:   string,
  voiceId:  string,
  apiUrl:   string,
): Promise<string | null> {
  const envId = process.env.ELEVENLABS_AGENT_ID
  if (envId) return envId

  try {
    const row = await prisma.appSetting.findUnique({ where: { key: 'voice_elevenlabs_agent_id' } })
    if (row?.value) return row.value

    // Provision a new agent and cache it
    const llmUrl  = `${apiUrl}/ai-suite/voice/llm`
    const agentId = await provisionCodeClinicAgent(apiKey, voiceId, llmUrl)

    await prisma.appSetting.upsert({
      where:  { key: 'voice_elevenlabs_agent_id' },
      update: { value: agentId },
      create: { key: 'voice_elevenlabs_agent_id', value: agentId },
    })

    return agentId
  } catch (err: any) {
    console.error('[ConvAI] Failed to get/create agent ID:', err.message)
    return null
  }
}
