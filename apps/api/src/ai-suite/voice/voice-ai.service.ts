import { PrismaClient } from '@prisma/client'
import { uploadFile } from '../../services/storage/r2'

const prisma = new PrismaClient()

// ── generateSpeech ────────────────────────────────────────────────────────────
// Calls ElevenLabs REST API to synthesise speech.
// Returns null (silently) if ELEVENLABS_API_KEY is not set.

export async function generateSpeech(
  text:     string,
  voiceId?: string,
): Promise<Buffer | null> {
  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) {
    console.log('[VoiceAI] ELEVENLABS_API_KEY not set — skipping TTS synthesis')
    return null
  }

  // Default to the "Rachel" voice (a calm, professional female voice).
  // Override with ELEVENLABS_VOICE_ID env var or per-call voiceId param.
  const vid = voiceId || process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${vid}`,
      {
        method:  'POST',
        headers: {
          'xi-api-key':   apiKey,
          'Content-Type': 'application/json',
          'Accept':       'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_monolingual_v1',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      },
    )

    if (!response.ok) {
      console.error('[VoiceAI] ElevenLabs error:', response.status, await response.text())
      return null
    }

    const arrayBuffer = await response.arrayBuffer()
    return Buffer.from(arrayBuffer)
  } catch (err: any) {
    console.error('[VoiceAI] generateSpeech error:', err.message)
    return null
  }
}

// ── startVoiceConversation ────────────────────────────────────────────────────
// Called by sip.service.ts as soon as a call connects (inbound or outbound).
//
// What it does:
//  1. Finds or creates the patient and a VOICE AiConversation
//  2. Builds a greeting string
//  3. Saves the greeting as an AiMessage (visible in staff inbox)
//  4. Creates an AgentLog record for the call
//  5. Optionally generates speech audio via ElevenLabs and saves to R2 + CallRecording

export async function startVoiceConversation(
  callId:       string,
  patientPhone: string,
  direction:    'inbound' | 'outbound',
): Promise<{ greeting: string; audioBuffer: Buffer | null }> {
  // ── 1. Resolve patient ─────────────────────────────────────────────────────
  const patient = await prisma.patient.findUnique({ where: { phone: patientPhone } })

  // ── 2. Find or create VOICE conversation ──────────────────────────────────
  let conversation = await prisma.aiConversation.findFirst({
    where:   { phoneNumber: patientPhone, channel: 'VOICE', status: 'ACTIVE' },
    orderBy: { createdAt: 'desc' },
  })
  if (!conversation) {
    conversation = await prisma.aiConversation.create({
      data: {
        patientId:    patient?.id ?? null,
        channel:      'VOICE',
        phoneNumber:  patientPhone,
        status:       'ACTIVE',
        agentEnabled: true,
      },
    })
  }

  // ── 3. Build greeting ─────────────────────────────────────────────────────
  const firstName = patient?.firstName ?? 'there'
  const greeting  = direction === 'inbound'
    ? `Hi ${firstName}! Welcome to Code Clinic. I'm Sarah, your AI assistant. How can I help you today?`
    : `Hi ${firstName}! This is Sarah calling from Code Clinic. I hope this is a good time — how are you doing today?`

  // ── 4. Save greeting as AiMessage (shows in staff inbox) ─────────────────
  await prisma.aiMessage.create({
    data: { conversationId: conversation.id, role: 'AGENT', content: greeting },
  })

  // ── 5. Create AgentLog for the call ──────────────────────────────────────
  const agentLog = await prisma.agentLog.create({
    data: {
      patientId:   patient?.id ?? null,
      callSid:     callId,
      type:        direction === 'inbound' ? 'INBOUND_CALL' : 'OUTBOUND_CALL',
      channel:     'VOICE',
      transcript:  greeting,
      outcome:     'CONNECTED',
      escalated:   false,
    },
  })

  // ── 6. Generate speech audio and persist to R2 + CallRecording ────────────
  const audioBuffer = await generateSpeech(greeting)

  if (audioBuffer) {
    try {
      const r2Key = `voice-calls/${agentLog.id}-greeting.mp3`
      await uploadFile(audioBuffer, 'audio/mpeg', r2Key)

      await prisma.callRecording.create({
        data: {
          agentLogId:     agentLog.id,
          r2Key,
          transcriptText: greeting,
        },
      })

      console.log(`[VoiceAI] Greeting audio saved → ${r2Key}`)
    } catch (err: any) {
      console.error('[VoiceAI] Failed to save audio to R2:', err.message)
    }
  } else {
    console.log('[VoiceAI] No ElevenLabs key — greeting persisted as text only')
  }

  console.log(`[VoiceAI] ${direction} voice conversation started with ${patientPhone}`)
  return { greeting, audioBuffer }
}
