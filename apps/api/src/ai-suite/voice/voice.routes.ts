import { Router } from 'express'
import multer from 'multer'
import { makeOutboundCall, formatToE164, isSipConnected, streamAudioToCall, startBidirectionalVoiceCall } from './sip.service'
import { startVoiceConversation } from './voice-ai.service'
import { provisionCodeClinicAgent, getOrCreateAgentId } from './elevenlabs-conv-ai.service'
import { sendWhatsAppMessage } from '../whatsapp/whatsapp.service'

import { prisma } from '../../lib/prisma'

const router = Router()
const upload = multer({ storage: multer.memoryStorage() })

// ── POST /ai-suite/voice/call ─────────────────────────────────────────────────
// Trigger an outbound call.  Fire-and-forget — returns immediately while the
// SIP INVITE goes out asynchronously.
// Body: { toNumber, reason? }

router.post('/call', async (req, res) => {
  try {
    const { toNumber, reason } = req.body as { toNumber?: string; reason?: string }
    if (!toNumber) return res.status(400).json({ error: 'toNumber required' })

    if (!isSipConnected()) {
      return res.status(503).json({
        error: 'SIP not connected — ensure drachtio-server is running and DRACHTIO_HOST is set',
      })
    }

    const callId      = `call-${Date.now()}`
    const e164Number  = formatToE164(toNumber)

    // Fire and forget — route responds immediately
    makeOutboundCall(
      toNumber,
      async (dialog) => {
        // onConnected — start full bidirectional AI conversation via ElevenLabs ConvAI.
        // Falls back to one-way greeting if ConvAI is unavailable.
        await startBidirectionalVoiceCall(dialog, callId, e164Number)
          .catch(err => console.error('[Voice] startBidirectionalVoiceCall error:', err.message))
      },
      async () => {
        // onHangup — send SMS if call never connected (no-answer path)
        // We determine "no answer" by checking whether an AgentLog was created.
        // If not, the call never connected, so send the SMS fallback.
        const log = await prisma.agentLog.findFirst({
          where: { callSid: callId },
        }).catch(() => null)

        if (!log) {
          await sendWhatsAppMessage(
            toNumber,
            `Hello! I tried calling you from Code Clinic but couldn't reach you. Feel free to reply here and I'll help you out 😊`,
          ).catch((err: any) => console.error('[Voice] WA fallback error:', err.message))
        }
      },
    ).catch(err => console.error('[Voice] makeOutboundCall error:', err.message))

    res.json({
      success: true,
      callId,
      toNumber: e164Number,
      reason:   reason ?? null,
      message:  `Initiating call to ${e164Number}`,
    })
  } catch (err: any) {
    console.error('[Voice] /call error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── POST /ai-suite/voice/no-answer-sms ───────────────────────────────────────
// Manual trigger for the "I tried calling" SMS fallback.
// Can also be called from external systems (e.g., a missed-call webhook).
// Body: { toNumber, patientName? }

router.post('/no-answer-sms', async (req, res) => {
  try {
    const { toNumber, patientName } = req.body as {
      toNumber:     string
      patientName?: string
    }
    if (!toNumber) return res.status(400).json({ error: 'toNumber required' })

    const firstName = patientName ? patientName.trim().split(/\s+/)[0] : null
    const message   = firstName
      ? `Hello ${firstName} 😊 I tried calling you from Code Clinic but couldn't reach you. Feel free to reply here and I'll help you out.`
      : `Hello 😊 I tried calling you from Code Clinic but couldn't reach you. Feel free to reply here and I'll help you out.`

    await sendWhatsAppMessage(toNumber, message)

    res.json({ success: true, message: 'SMS fallback sent' })
  } catch (err: any) {
    console.error('[Voice] /no-answer-sms error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── GET /ai-suite/voice/calls ─────────────────────────────────────────────────
// Recent call history — 50 most recent VOICE agent logs with patient info and
// recording metadata.

router.get('/calls', async (_req, res) => {
  try {
    const logs = await prisma.agentLog.findMany({
      where:   { channel: 'VOICE' },
      orderBy: { createdAt: 'desc' },
      take:    50,
      include: {
        patient:   { select: { firstName: true, lastName: true, phone: true } },
        recording: { select: { r2Key: true, transcriptText: true, durationSec: true } },
      },
    })
    res.json(logs)
  } catch (err: any) {
    console.error('[Voice] /calls error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── GET /ai-suite/voice/settings ─────────────────────────────────────────────

router.get('/settings', async (_req, res) => {
  try {
    const keys = ['voice_persona_name', 'voice_elevenlabs_id', 'voice_stability', 'voice_similarity_boost']
    const rows = await prisma.appSetting.findMany({ where: { key: { in: keys } } })
    const map  = Object.fromEntries(rows.map(r => [r.key, r.value]))
    res.json({
      personaName:      map['voice_persona_name']        ?? 'Sarah',
      elevenLabsVoiceId: map['voice_elevenlabs_id']      ?? '',
      stability:        parseFloat(map['voice_stability'] ?? '0.5'),
      similarityBoost:  parseFloat(map['voice_similarity_boost'] ?? '0.75'),
      elevenLabsKeySet: !!process.env.ELEVENLABS_API_KEY,
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /ai-suite/voice/settings ────────────────────────────────────────────

router.post('/settings', async (req, res) => {
  try {
    const { personaName, elevenLabsVoiceId, stability, similarityBoost } =
      req.body as { personaName?: string; elevenLabsVoiceId?: string; stability?: number; similarityBoost?: number }

    const pairs = [
      { key: 'voice_persona_name',       value: String(personaName      ?? 'Sarah') },
      { key: 'voice_elevenlabs_id',      value: String(elevenLabsVoiceId ?? '') },
      { key: 'voice_stability',          value: String(stability         ?? 0.5) },
      { key: 'voice_similarity_boost',   value: String(similarityBoost   ?? 0.75) },
    ]

    await Promise.all(pairs.map(({ key, value }) =>
      prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } })
    ))
    res.json({ success: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── GET /ai-suite/voice/voices ───────────────────────────────────────────────

router.get('/voices', async (_req, res) => {
  try {
    const profiles = await prisma.voiceProfile.findMany({ orderBy: { createdAt: 'desc' } })
    res.json(profiles)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /ai-suite/voice/preview ─────────────────────────────────────────────
// Body: { text, voiceId? }  Returns audio/mpeg stream.

router.post('/preview', async (req, res) => {
  try {
    const { text, voiceId } = req.body as { text?: string; voiceId?: string }
    if (!text?.trim()) return res.status(400).json({ error: 'text required' })

    const apiKey = process.env.ELEVENLABS_API_KEY
    if (!apiKey) return res.status(503).json({ error: 'ELEVENLABS_API_KEY not set' })

    let vid = voiceId
    if (!vid) {
      const setting = await prisma.appSetting.findUnique({ where: { key: 'voice_elevenlabs_id' } })
      vid = setting?.value || 'EXAVITQu4vr4xnSDxMaL' // ElevenLabs Rachel
    }

    const stability       = parseFloat((await prisma.appSetting.findUnique({ where: { key: 'voice_stability' } }))?.value       ?? '0.5')
    const similarityBoost = parseFloat((await prisma.appSetting.findUnique({ where: { key: 'voice_similarity_boost' } }))?.value ?? '0.75')

    const upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${vid}`, {
      method:  'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: { stability, similarity_boost: similarityBoost },
      }),
    })

    if (!upstream.ok) return res.status(upstream.status).json({ error: await upstream.text() })

    res.setHeader('Content-Type', 'audio/mpeg')
    res.send(Buffer.from(await upstream.arrayBuffer()))
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /ai-suite/voice/train ───────────────────────────────────────────────
// Multipart: { name: string, file: audio file }

router.post('/train', upload.single('file'), async (req, res) => {
  try {
    const { name } = req.body as { name?: string }
    const file = req.file
    if (!name?.trim() || !file) return res.status(400).json({ error: 'name and file required' })

    const apiKey = process.env.ELEVENLABS_API_KEY
    if (!apiKey) return res.status(503).json({ error: 'ELEVENLABS_API_KEY not set' })

    const form = new FormData()
    form.append('name', name.trim())
    form.append('files', new Blob([file.buffer], { type: file.mimetype }), file.originalname)

    const upstream = await fetch('https://api.elevenlabs.io/v1/voices/add', {
      method:  'POST',
      headers: { 'xi-api-key': apiKey },
      body:    form,
    })

    if (!upstream.ok) return res.status(upstream.status).json({ error: await upstream.text() })

    const { voice_id } = await upstream.json() as { voice_id: string }

    const profile = await prisma.voiceProfile.create({
      data: { name: name.trim(), elevenLabsVoiceId: voice_id, isCloned: true, isDefault: false },
    })

    res.json(profile)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── PUT /ai-suite/voice/voices/:id/assign ────────────────────────────────────

router.put('/voices/:id/assign', async (req, res) => {
  try {
    const profile = await prisma.voiceProfile.findUnique({ where: { id: req.params.id } })
    if (!profile) return res.status(404).json({ error: 'Voice not found' })

    await prisma.$transaction([
      prisma.voiceProfile.updateMany({ data: { isDefault: false } }),
      prisma.voiceProfile.update({ where: { id: req.params.id }, data: { isDefault: true } }),
      prisma.appSetting.upsert({
        where:  { key: 'voice_elevenlabs_id' },
        update: { value: profile.elevenLabsVoiceId },
        create: { key: 'voice_elevenlabs_id', value: profile.elevenLabsVoiceId },
      }),
    ])

    res.json({ success: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── DELETE /ai-suite/voice/voices/:id ────────────────────────────────────────

router.delete('/voices/:id', async (req, res) => {
  try {
    const profile = await prisma.voiceProfile.findUnique({ where: { id: req.params.id } })
    if (!profile) return res.status(404).json({ error: 'Voice not found' })

    const apiKey = process.env.ELEVENLABS_API_KEY
    if (apiKey && profile.isCloned) {
      await fetch(`https://api.elevenlabs.io/v1/voices/${profile.elevenLabsVoiceId}`, {
        method:  'DELETE',
        headers: { 'xi-api-key': apiKey },
      }).catch(err => console.error('[Voice] ElevenLabs delete error:', err))
    }

    await prisma.voiceProfile.delete({ where: { id: req.params.id } })
    res.json({ success: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── GET /ai-suite/voice/agent ─────────────────────────────────────────────────
// Returns the current ElevenLabs ConvAI agent config (id + whether it exists).

router.get('/agent', async (_req, res) => {
  try {
    const apiKey  = process.env.ELEVENLABS_API_KEY
    const row     = await prisma.appSetting.findUnique({ where: { key: 'voice_elevenlabs_agent_id' } })
    const agentId = process.env.ELEVENLABS_AGENT_ID ?? row?.value ?? null

    let agentDetails: any = null
    if (agentId && apiKey) {
      const upstream = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${agentId}`, {
        headers: { 'xi-api-key': apiKey },
      }).catch(() => null)
      if (upstream?.ok) agentDetails = await upstream.json()
    }

    res.json({ agentId, agentDetails, apiKeySet: !!apiKey })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /ai-suite/voice/agent/provision ─────────────────────────────────────
// Creates (or re-creates) the ElevenLabs ConvAI agent for Code Clinic and
// stores the agent_id in AppSettings.  Idempotent — safe to call multiple times.
// Body: { apiUrl? }  — override the LLM endpoint URL

router.post('/agent/provision', async (req, res) => {
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY
    if (!apiKey) return res.status(503).json({ error: 'ELEVENLABS_API_KEY not set' })

    const voiceRow = await prisma.appSetting.findUnique({ where: { key: 'voice_elevenlabs_id' } })
    const voiceId  = voiceRow?.value ?? process.env.ELEVENLABS_VOICE_ID ?? '21m00Tcm4TlvDq8ikWAM'

    const apiUrl  = (req.body as any)?.apiUrl
                 ?? process.env.APP_URL?.split(',')[0]?.trim()
                 ?? 'https://api.codeclinic.ug'

    const agentId = await provisionCodeClinicAgent(apiKey, voiceId, `${apiUrl}/ai-suite/voice/llm`)

    await prisma.appSetting.upsert({
      where:  { key: 'voice_elevenlabs_agent_id' },
      update: { value: agentId },
      create: { key: 'voice_elevenlabs_agent_id', value: agentId },
    })

    res.json({ success: true, agentId, llmEndpoint: `${apiUrl}/ai-suite/voice/llm` })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router
