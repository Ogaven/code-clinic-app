import { runAgent } from '../unified-agent'
import { sendMissedCallWhatsApp } from './whatsapp-channel'
import { uploadFile } from '../../storage/r2'
import { transcribeAudio } from '../../knowledge/rag'
import { prisma } from '../../../lib/prisma'
import { makeOutboundCall, startBidirectionalVoiceCall, isSipConnected } from '../../../ai-suite/voice/sip.service'

// ── TTS: Generate voice response ───────────────────────────────

export async function generateTTS(text: string): Promise<Buffer | null> {
  // Primary: ElevenLabs
  const apiKey  = process.env.ELEVENLABS_API_KEY
  const voiceId = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL' // default Bella

  if (apiKey && apiKey !== 'your-key') {
    try {
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text,
            model_id: 'eleven_multilingual_v2',
            voice_settings: { stability: 0.5, similarity_boost: 0.75 },
          }),
        }
      )
      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer()
        return Buffer.from(arrayBuffer)
      }
    } catch (err: any) {
      console.warn('[TTS] ElevenLabs failed, falling back to AT TTS:', err.message)
    }
  }

  // Fallback: Africa's Talking TTS (returns URL, not audio buffer)
  // In production, AT TTS plays directly via their call infrastructure
  console.log('[TTS FALLBACK] Would use Africa\'s Talking TTS for:', text.slice(0, 60))
  return null
}

// ── Handle inbound call ────────────────────────────────────────

export async function handleInboundCall(phoneNumber: string): Promise<string> {
  console.log(`[VOICE] Inbound call from ${phoneNumber}`)

  // Create AgentLog for this call
  const patient = await prisma.patient.findFirst({ where: { phone: phoneNumber } })
  const agentLog = await prisma.agentLog.create({
    data: {
      patientId: patient?.id,
      type: 'INBOUND_CALL',
      channel: 'VOICE',
      outcome: 'IN_PROGRESS',
    },
  })

  try {
    const result = await runAgent({
      phoneNumber,
      channel: 'VOICE',
      direction: 'INBOUND',
      incomingMessage: '[Call started]',
    })

    await prisma.agentLog.update({
      where: { id: agentLog.id },
      data: {
        outcome: result.escalated ? 'ESCALATED' : 'COMPLETED',
        escalated: result.escalated,
      },
    })

    return result.text
  } catch (err: any) {
    console.error('[VOICE] Inbound call error:', err.message)
    await prisma.agentLog.update({
      where: { id: agentLog.id },
      data: { outcome: 'ERROR', escalated: true },
    })
    return "Hello, thank you for calling Code Clinic. We're experiencing a brief technical issue. Please hold while we connect you with our receptionist."
  }
}

// ── Trigger outbound call ─────────────────────────────────────

export async function triggerOutboundCall(queueItemId: string): Promise<void> {
  // ── Master calling-agents guard ───────────────────────────────────────────
  const callingEnabled = await prisma.appSetting.findUnique({ where: { key: 'calling_agents_enabled' } })
  if (callingEnabled?.value === 'false') {
    console.log(`[VOICE] Calling agents disabled — skipping queue item ${queueItemId}`)
    return
  }

  const queueItem = await prisma.outboundQueue.findUnique({
    where: { id: queueItemId },
    include: { patient: true },
  })
  if (!queueItem) throw new Error(`Queue item not found: ${queueItemId}`)

  // ── Per-mode agent guard ──────────────────────────────────────────────────
  const modeAgentKey = `agent_${queueItem.agentMode.toLowerCase()}-caller_enabled`
  const modeEnabled  = await prisma.appSetting.findUnique({ where: { key: modeAgentKey } })
  if (modeEnabled?.value === 'false') {
    console.log(`[VOICE] ${queueItem.agentMode} caller disabled — skipping ${queueItem.patient.phone}`)
    return
  }

  // Increment attempts and mark as CALLING
  await prisma.outboundQueue.update({
    where: { id: queueItemId },
    data: {
      status: 'CALLING',
      attempts: queueItem.attempts + 1,
      lastAttempted: new Date(),
    },
  })

  // ── SIP not available → stub ──────────────────────────────────────────────
  if (!isSipConnected()) {
    console.log(`[VOICE STUB] SIP not connected — skipping call to ${queueItem.patient.phone} for ${queueItem.agentMode}`)
    await prisma.outboundQueue.update({
      where: { id: queueItemId },
      data: { status: 'COMPLETED', outcome: 'STUB_NO_SIP' },
    })
    return
  }

  const callId = `outbound-${queueItemId}-${Date.now()}`
  const phone  = queueItem.patient.phone
  const maxAttempts = 3

  // ── Build callMeta for ElevenLabs ConvAI ─────────────────────────────────
  const callMeta: Record<string, string> = {
    agent_mode:    queueItem.agentMode,
    queue_item_id: queueItemId,
    patient_name:  `${queueItem.patient.firstName} ${queueItem.patient.lastName}`,
  }

  if (queueItem.appointmentId) {
    const appt = await prisma.appointment.findUnique({
      where: { id: queueItem.appointmentId },
      include: {
        doctor:  { include: { user: { select: { firstName: true, lastName: true } } } },
        service: { select: { name: true } },
      },
    })
    if (appt) {
      const timeStr = appt.startAt.toLocaleTimeString('en-UG', { timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit' })
      callMeta.doctor_name  = `Dr. ${appt.doctor.user.firstName} ${appt.doctor.user.lastName}`
      callMeta.service_name = appt.service.name
      if (queueItem.agentMode === 'REMINDER') {
        callMeta.appointment_date = appt.startAt.toLocaleDateString('en-UG', { weekday: 'long', day: 'numeric', month: 'long' })
        callMeta.appointment_time = timeStr
      } else if (queueItem.agentMode === 'FOLLOWUP') {
        callMeta.visit_date = appt.startAt.toLocaleDateString('en-UG')
      }
    }
  }

  let callConnected = false

  console.log(`[VOICE] Initiating ${queueItem.agentMode} SIP call to ${phone} (queue: ${queueItemId})`)

  await makeOutboundCall(
    phone,
    async (dialog) => {
      callConnected = true
      await prisma.agentLog.create({
        data: {
          patientId: queueItem.patientId,
          type:      `OUTBOUND_${queueItem.agentMode}`,
          channel:   'VOICE',
          outcome:   'IN_PROGRESS',
          callSid:   callId,
        },
      }).catch(() => null)

      await startBidirectionalVoiceCall(dialog, callId, phone, callMeta)

      await prisma.outboundQueue.update({
        where: { id: queueItemId },
        data:  { status: 'COMPLETED', outcome: 'ANSWERED' },
      }).catch(() => null)
    },
    async () => {
      if (callConnected) return   // normal hangup after conversation — already marked COMPLETED

      // No answer path
      if (queueItem.attempts + 1 >= maxAttempts) {
        await prisma.outboundQueue.update({
          where: { id: queueItemId },
          data:  { status: 'FAILED', outcome: 'MAX_ATTEMPTS_REACHED' },
        }).catch(() => null)

        if (queueItem.appointmentId) {
          const appt = await prisma.appointment.findUnique({
            where: { id: queueItem.appointmentId },
            include: {
              doctor:  { include: { user: { select: { firstName: true, lastName: true } } } },
              service: { select: { name: true } },
            },
          }).catch(() => null)
          if (appt) {
            await sendMissedCallWhatsApp(
              phone,
              `${queueItem.patient.firstName} ${queueItem.patient.lastName}`,
              `Dr. ${appt.doctor.user.firstName} ${appt.doctor.user.lastName}`,
              appt.startAt.toLocaleTimeString('en-UG', { timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit' }),
              appt.id,
            ).catch(() => null)
          }
        }
      } else {
        const retryAt = new Date(Date.now() + 4 * 60 * 60 * 1000)
        await prisma.outboundQueue.update({
          where: { id: queueItemId },
          data:  { status: 'PENDING', scheduledFor: retryAt, outcome: `Attempt ${queueItem.attempts + 1}: no answer` },
        }).catch(() => null)
      }

      await prisma.agentMemory.create({
        data: {
          patientId:       queueItem.patientId,
          channel:         'VOICE',
          phoneNumber:     phone,
          interactionType: queueItem.agentMode as any,
          summary:         `Outbound call attempted for ${queueItem.reason}. No answer.`,
          outcome:         'NO_ANSWER',
          agentMode:       queueItem.agentMode,
        },
      }).catch(() => null)
    },
  ).catch(async (err: any) => {
    console.error(`[VOICE] triggerOutboundCall SIP error for ${queueItemId}:`, err.message)
    const retryAt = new Date(Date.now() + 4 * 60 * 60 * 1000)
    await prisma.outboundQueue.update({
      where: { id: queueItemId },
      data:  { status: 'PENDING', scheduledFor: retryAt, outcome: `SIP error: ${err.message.slice(0, 100)}` },
    }).catch(() => null)
  })
}

// ── Handle call recording complete webhook ────────────────────

export async function handleRecordingComplete(
  recordingUrl: string,
  callSid: string,
  durationSec?: number
): Promise<void> {
  console.log(`[VOICE] Recording complete: ${callSid}`)

  // Find the AgentLog for this call
  const agentLog = await prisma.agentLog.findFirst({
    where: { callSid },
    orderBy: { createdAt: 'desc' },
  })

  try {
    // Download recording from AT
    const response = await fetch(recordingUrl)
    if (!response.ok) throw new Error(`Failed to download recording: ${response.status}`)
    const buffer = Buffer.from(await response.arrayBuffer())

    // Upload to Cloudflare R2
    const r2Key = `recordings/${callSid}-${Date.now()}.mp3`
    await uploadFile(buffer, 'audio/mpeg', r2Key)

    // Transcribe with Whisper
    let transcriptText: string | undefined
    try {
      transcriptText = await transcribeAudio(buffer)
    } catch (e: any) {
      console.warn('[VOICE] Transcription failed:', e.message)
    }

    // Save CallRecording
    if (agentLog) {
      await prisma.callRecording.create({
        data: {
          agentLogId: agentLog.id,
          r2Key,
          durationSec,
          transcriptText,
        },
      })

      // Update AgentLog with transcript
      if (transcriptText) {
        await prisma.agentLog.update({
          where: { id: agentLog.id },
          data: { transcript: transcriptText },
        })
      }
    }

    console.log(`[VOICE] Recording processed: ${r2Key}`)
  } catch (err: any) {
    console.error('[VOICE] Recording processing failed:', err.message)
  }
}

// ── Africa's Talking DTMF (keypad) handler ────────────────────

export async function handleDTMF(
  sessionId: string,
  dtmfDigits: string,
  callerNumber: string
): Promise<string> {
  // For now, route to agent with DTMF context
  // In future: implement IVR menu with DTMF routing
  return `<Response><Say>Thank you. Connecting you with our assistant now.</Say></Response>`
}
