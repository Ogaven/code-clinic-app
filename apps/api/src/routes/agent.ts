import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { processInbound } from '../ai-suite/whatsapp/whatsapp.service'
import { handleInboundCall, triggerOutboundCall, handleRecordingComplete } from '../services/agent/channels/voice-channel'
import { runAgent } from '../services/agent/unified-agent'
// import { runReminderJob, runFollowupJob, runDebtJob, processQueue } from '../services/agent/scheduler' // disabled
import { prisma } from '../lib/prisma'

const router = Router()

// ════════════════════════════════════════════
// WHATSAPP
// ════════════════════════════════════════════

// POST /agent/whatsapp/webhook — Africa's Talking webhook (no auth)
router.post('/whatsapp/webhook', async (req, res) => {
  try {
    res.status(200).json({ received: true })
    const body      = req.body
    const rawFrom   = body.from    || body.data?.from    || body.phoneNumber
    const rawText   = body.text    || body.data?.text    || body.body?.message || body.message
    const mediaType = body.messageType || body.data?.messageType || ''
    const msgId     = body.id      || body.messageId     || body.data?.id     || ''

    // Map media messages to a text description Sarah can handle
    const MEDIA_DESCRIPTIONS: Record<string, string> = {
      Image:    '[Patient sent an image — Sarah cannot view images, please acknowledge and ask them to describe it]',
      Audio:    '[Patient sent a voice note — Sarah cannot listen to audio, please acknowledge and ask them to type their message]',
      Video:    '[Patient sent a video — Sarah cannot view videos, please acknowledge and ask them to describe what they need]',
      Document: '[Patient sent a document — Sarah cannot read documents, please acknowledge and ask them to describe what they need]',
      Sticker:  '[Patient sent a sticker]',
    }
    let text = rawText || MEDIA_DESCRIPTIONS[mediaType] || ''

    // Whisper transcription for voice notes
    if ((mediaType === 'Audio' || mediaType === 'Voice') && process.env.OPENAI_API_KEY) {
      const audioUrl = body.mediaUrl || body.audioUrl || body.media?.url
      if (audioUrl) {
        try {
          const audioRes = await fetch(audioUrl)
          const audioBuffer = await audioRes.arrayBuffer()
          // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
          const FormData = require('form-data') as any
          const form = new FormData()
          form.append('file', Buffer.from(audioBuffer), {
            filename:    'voice.ogg',
            contentType: 'audio/ogg',
          })
          form.append('model', 'whisper-1')
          const formBuffer = await new Promise<Buffer>((resolve, reject) => {
            const chunks: Buffer[] = []
            form.on('data', (chunk: Buffer) => chunks.push(chunk))
            form.on('end',  () => resolve(Buffer.concat(chunks)))
            form.on('error', reject)
          })
          const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method:  'POST',
            headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, ...form.getHeaders() },
            body:    formBuffer,
          })
          const whisperData = await whisperRes.json() as { text?: string }
          if (whisperData.text) {
            text = `[Voice note]: ${whisperData.text}`
          }
        } catch (err: any) {
          console.warn('[WHISPER] AT transcription failed:', err.message)
        }
      }
    }

    if (!rawFrom || !text) {
      console.warn('[WHATSAPP WEBHOOK] Missing from or text:', body)
      return
    }
    // Normalise AT phone (e.g. "256741087667") to E.164 (+256741087667)
    const digits = String(rawFrom).replace(/\D/g, '')
    const from   = digits.startsWith('256')              ? `+${digits}`
                 : digits.startsWith('0') && digits.length === 10 ? `+256${digits.slice(1)}`
                 : digits.length === 9                   ? `+256${digits}`
                 : `+${digits}`
    await processInbound(from, text, msgId)
  } catch (err: any) {
    console.error('[WEBHOOK] WhatsApp error:', err.message)
  }
})

// ════════════════════════════════════════════
// VOICE
// ════════════════════════════════════════════

// POST /agent/voice/inbound — Africa's Talking voice webhook
router.post('/voice/inbound', async (req, res) => {
  try {
    const { callerNumber, sessionId, isActive } = req.body
    const phone = callerNumber || req.body.from || '+256000000000'

    if (isActive === '0') {
      // Call ended
      res.status(200).send('<Response></Response>')
      return
    }

    const text = await handleInboundCall(phone)
    // Return Africa's Talking call response XML
    res.set('Content-Type', 'text/xml')
    res.send(`<Response><Say voice="en-US" playBeep="false">${escapeXml(text)}</Say></Response>`)
  } catch (err: any) {
    console.error('[VOICE] Inbound error:', err.message)
    res.set('Content-Type', 'text/xml')
    res.send('<Response><Say>Thank you for calling Code Clinic. Please hold while we connect you with our team.</Say></Response>')
  }
})

// POST /agent/voice/outbound/trigger — manually trigger an outbound call
router.post('/voice/outbound/trigger', requireAuth, async (req, res) => {
  try {
    const { queue_id } = req.body
    if (!queue_id) return res.status(400).json({ error: 'queue_id required' })
    await triggerOutboundCall(queue_id)
    res.json({ success: true, message: 'Outbound call triggered' })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /agent/voice/recording-complete — Africa's Talking recording webhook
router.post('/voice/recording-complete', async (req, res) => {
  try {
    res.status(200).json({ received: true })
    const { recordingUrl, sessionId, durationInSeconds } = req.body
    if (recordingUrl && sessionId) {
      await handleRecordingComplete(recordingUrl, sessionId, durationInSeconds ? parseInt(durationInSeconds) : undefined)
    }
  } catch (err: any) {
    console.error('[VOICE] Recording webhook error:', err.message)
  }
})

// ════════════════════════════════════════════
// OUTBOUND QUEUE
// ════════════════════════════════════════════

// GET /agent/queue
router.get('/queue', requireAuth, async (req, res) => {
  try {
    const { status, mode, limit = '50', offset = '0' } = req.query
    const where: any = {}
    if (status) where.status = status
    if (mode) where.agentMode = mode

    const [items, total] = await Promise.all([
      prisma.outboundQueue.findMany({
        where,
        include: { patient: { select: { firstName: true, lastName: true, phone: true } } },
        orderBy: { scheduledFor: 'asc' },
        take: parseInt(limit as string),
        skip: parseInt(offset as string),
      }),
      prisma.outboundQueue.count({ where }),
    ])
    res.json({ items, total })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /agent/queue — add to queue manually
router.post('/queue', requireAuth, async (req, res) => {
  try {
    const { patient_id, phone_number, agent_mode, reason, appointment_id, scheduled_for } = req.body
    if (!patient_id || !phone_number || !agent_mode || !reason) {
      return res.status(400).json({ error: 'patient_id, phone_number, agent_mode, reason required' })
    }
    const item = await prisma.outboundQueue.create({
      data: {
        patientId:     patient_id,
        phoneNumber:   phone_number,
        agentMode:     agent_mode,
        reason,
        appointmentId: appointment_id,
        scheduledFor:  scheduled_for ? new Date(scheduled_for) : new Date(),
        status:        'PENDING',
      },
    })
    res.json({ success: true, item })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /agent/queue/:id/status
router.put('/queue/:id/status', requireAuth, async (req, res) => {
  try {
    const { status, outcome } = req.body
    const item = await prisma.outboundQueue.update({
      where: { id: req.params.id },
      data: { status, outcome },
    })
    res.json({ success: true, item })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ════════════════════════════════════════════
// AGENT MEMORY
// ════════════════════════════════════════════

// GET /agent/memory/:patient_id
router.get('/memory/:patient_id', requireAuth, async (req, res) => {
  try {
    const memory = await prisma.agentMemory.findMany({
      where: { patientId: req.params.patient_id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    res.json({ memory })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ════════════════════════════════════════════
// ESCALATIONS
// ════════════════════════════════════════════

// GET /agent/escalations
router.get('/escalations', requireAuth, async (req, res) => {
  try {
    const { status = 'PENDING' } = req.query
    const escalations = await prisma.escalation.findMany({
      where: { status: status as string },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    res.json({ escalations })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /agent/escalations/:id/resolve
router.put('/escalations/:id/resolve', requireAuth, async (req, res) => {
  try {
    const user = req.user!
    const escalation = await prisma.escalation.update({
      where: { id: req.params.id },
      data: {
        status:    'RESOLVED',
        handledBy: user.id,
        handledAt: new Date(),
      },
    })
    res.json({ success: true, escalation })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ════════════════════════════════════════════
// AGENT CONFIG
// ════════════════════════════════════════════

// GET /agent/config
router.get('/config', requireAuth, async (req, res) => {
  try {
    const configs = await prisma.agentConfig.findMany({
      orderBy: { responsibility: 'asc' },
    })
    res.json({ configs })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /agent/config/:responsibility
router.put('/config/:responsibility', requireAuth, async (req, res) => {
  try {
    const role = req.user!.role
    // Receptionists can only toggle isActive — full edit requires ADMIN
    if (!['ADMIN', 'RECEPTIONIST'].includes(role)) {
      return res.status(403).json({ error: 'Access denied' })
    }
    if (role === 'RECEPTIONIST' && (req.body.system_prompt || req.body.schedule_cron || req.body.max_attempts)) {
      return res.status(403).json({ error: 'Receptionists can only toggle agent active status' })
    }
    const { is_active, system_prompt, schedule_cron, max_attempts } = req.body
    const user = req.user!

    // Load current config (or create new)
    let config = await prisma.agentConfig.findUnique({
      where: { responsibility: req.params.responsibility },
    })

    const history = config ? JSON.parse(config.promptHistory) : []
    if (system_prompt && config?.systemPrompt !== system_prompt) {
      history.push({
        version:     (config?.promptVersion || 0) + 1,
        prompt:      config?.systemPrompt || '',
        activatedAt: new Date().toISOString(),
        activatedBy: `${user.firstName} ${user.lastName}`,
      })
    }

    config = await prisma.agentConfig.upsert({
      where: { responsibility: req.params.responsibility },
      create: {
        responsibility: req.params.responsibility,
        isActive:       is_active ?? false,
        systemPrompt:   system_prompt || '',
        promptHistory:  JSON.stringify(history),
        scheduleCron:   schedule_cron,
        maxAttempts:    max_attempts || 3,
        updatedBy:      user.id,
      },
      update: {
        isActive:      is_active !== undefined ? is_active : undefined,
        systemPrompt:  system_prompt || undefined,
        promptVersion: { increment: system_prompt ? 1 : 0 },
        promptHistory: JSON.stringify(history),
        scheduleCron:  schedule_cron || undefined,
        maxAttempts:   max_attempts || undefined,
        updatedBy:     user.id,
      },
    })

    res.json({ success: true, config })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /agent/config/:responsibility/test — test with a message
router.post('/config/:responsibility/test', requireAuth, async (req, res) => {
  try {
    if (!['ADMIN', 'RECEPTIONIST'].includes(req.user!.role)) {
      return res.status(403).json({ error: 'Admin or receptionist access required' })
    }
    const { test_message, phone_number } = req.body
    const testPhone = phone_number || '+256700000000'

    const result = await runAgent({
      phoneNumber: testPhone,
      channel:     'WHATSAPP',
      direction:   'INBOUND',
      incomingMessage: test_message || 'Hello, I would like to book an appointment.',
    })

    res.json({ success: true, response: result.text, escalated: result.escalated })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ════════════════════════════════════════════
// ADMIN: Manual scheduler triggers
// ════════════════════════════════════════════

// POST /agent/scheduler/run — disabled (outboundQueue/agentMemory tables not in schema)
router.post('/scheduler/run', requireAuth, async (_req, res) => {
  res.status(503).json({ error: 'Voice/outbound scheduler is disabled. Use AI Suite scheduler instead.' })
})

// ── XML escape helper for AT voice responses ─────────────────

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export default router
