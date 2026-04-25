import { Router } from 'express'
import { PrismaClient } from '@prisma/client'
import { makeOutboundCall, formatToE164, isSipConnected } from './sip.service'
import { startVoiceConversation } from './voice-ai.service'
import { sendSMS } from '../sms/sms.service'

const router = Router()
const prisma = new PrismaClient()

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
      async () => {
        // onConnected — start the AI voice session
        await startVoiceConversation(callId, e164Number, 'outbound')
          .catch(err => console.error('[Voice] startVoiceConversation error:', err.message))
      },
      async () => {
        // onHangup — send SMS if call never connected (no-answer path)
        // We determine "no answer" by checking whether an AgentLog was created.
        // If not, the call never connected, so send the SMS fallback.
        const log = await prisma.agentLog.findFirst({
          where: { callSid: callId },
        }).catch(() => null)

        if (!log) {
          await sendSMS(
            toNumber,
            `Hi! I tried calling you from Code Clinic but couldn't reach you. Feel free to reply here and I'll help you out 😊`,
          ).catch(err => console.error('[Voice] SMS fallback error:', err.message))
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
      ? `Hi ${firstName}! I tried calling you from Code Clinic but couldn't reach you. Feel free to reply here and I'll help you out 😊`
      : `Hi! I tried calling you from Code Clinic but couldn't reach you. Feel free to reply here and I'll help you out 😊`

    await sendSMS(toNumber, message)

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

export default router
