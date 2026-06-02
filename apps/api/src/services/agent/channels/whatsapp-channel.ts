import Anthropic from '@anthropic-ai/sdk'
import { runAgent } from '../unified-agent'
import { prisma } from '../../../lib/prisma'

// ── In-memory session store (Redis-upgradeable) ────────────────
// Key: phone number → { history, lastActive }
// Sessions expire after 24 hours of inactivity

interface Session {
  history: Anthropic.MessageParam[]
  lastActive: Date
  patientId?: string
}

const sessions = new Map<string, Session>()
const SESSION_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

function cleanExpiredSessions() {
  const cutoff = new Date(Date.now() - SESSION_TTL_MS)
  for (const [key, session] of sessions.entries()) {
    if (session.lastActive < cutoff) sessions.delete(key)
  }
}

function getSession(phone: string): Session {
  const existing = sessions.get(phone)
  if (existing && existing.lastActive.getTime() > Date.now() - SESSION_TTL_MS) {
    return existing
  }
  const newSession: Session = { history: [], lastActive: new Date() }
  sessions.set(phone, newSession)
  return newSession
}

function updateSession(phone: string, session: Session) {
  session.lastActive = new Date()
  sessions.set(phone, session)
}

// ── Send WhatsApp message via Africa's Talking ─────────────────

export async function sendWhatsAppMessage(phone: string, message: string): Promise<void> {
  const apiKey    = process.env.AT_API_KEY
  const username  = process.env.AT_USERNAME
  const waNumber  = process.env.AT_WHATSAPP_NUMBER || process.env.WHATSAPP_PHONE_NUMBER

  if (!apiKey || !username || apiKey === 'your-api-key') {
    console.log(`[WHATSAPP STUB] Would send to ${phone}:\n${message}`)
    return
  }

  try {
    // Africa's Talking WhatsApp API
    const AfricasTalking = require('africastalking')
    const at = AfricasTalking({ apiKey, username })

    // AT WhatsApp uses their messaging service
    await at.APPLICATION.fetchApplicationData()
      .catch(() => { /* ignore — just testing connection */ })

    // Use HTTP directly for WhatsApp (AT SDK may not have WhatsApp module)
    const response = await fetch('https://api.africastalking.com/version1/messaging/whatsapp', {
      method: 'POST',
      headers: {
        'apiKey': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username,
        to: phone,
        message,
        from: waNumber,
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('[WHATSAPP] Send failed:', err)
    } else {
      console.log(`[WHATSAPP] Sent to ${phone}: ${message.slice(0, 60)}...`)
    }
  } catch (err: any) {
    console.error('[WHATSAPP] Error sending message:', err.message)
  }

  // Log in AgentLog
  const patient = await prisma.patient.findFirst({ where: { phone } })
  await prisma.agentLog.create({
    data: {
      patientId: patient?.id,
      type: 'WHATSAPP_OUTBOUND',
      channel: 'WHATSAPP',
      transcript: message,
      outcome: 'SENT',
    },
  }).catch(() => { /* non-blocking */ })
}

// ── Split long messages (WhatsApp 1600 char limit) ─────────────

function splitMessage(text: string, maxLen = 1580): string[] {
  if (text.length <= maxLen) return [text]

  const parts: string[] = []
  let remaining = text

  while (remaining.length > maxLen) {
    // Find natural break point (sentence end or newline)
    let cutAt = remaining.lastIndexOf('\n', maxLen)
    if (cutAt < maxLen * 0.5) cutAt = remaining.lastIndexOf('. ', maxLen)
    if (cutAt < maxLen * 0.5) cutAt = maxLen

    parts.push(remaining.slice(0, cutAt).trim())
    remaining = remaining.slice(cutAt).trim()
  }
  if (remaining) parts.push(remaining)
  return parts
}

// ── Main webhook handler ───────────────────────────────────────

export async function handleWhatsAppWebhook(body: any): Promise<void> {
  cleanExpiredSessions()

  // Parse Africa's Talking webhook payload
  // AT WhatsApp sends: { from, body: { message }, messageId, waNumber }
  const from    = body.from    || body.data?.from    || body.phoneNumber
  const text    = body.text    || body.data?.text    || body.body?.message || body.message
  const msgId   = body.id      || body.messageId     || body.data?.id

  if (!from || !text) {
    console.warn('[WHATSAPP WEBHOOK] Missing from or text:', body)
    return
  }

  // Normalise phone number
  const phoneNumber = normalisePhone(from)

  console.log(`[WHATSAPP] Inbound from ${phoneNumber}: ${text.slice(0, 80)}`)

  // Load or create session
  const session = getSession(phoneNumber)

  // Append user message to history
  session.history.push({ role: 'user', content: text })

  try {
    // Run agent with full conversation history
    const result = await runAgent({
      phoneNumber,
      channel: 'WHATSAPP',
      direction: 'INBOUND',
      incomingMessage: text,
      conversationHistory: session.history,
    })

    // Append assistant response to history
    session.history.push({ role: 'assistant', content: result.text })

    // Trim history to last 20 turns (prevent infinite growth)
    if (session.history.length > 40) {
      session.history = session.history.slice(-40)
    }

    updateSession(phoneNumber, session)

    // Send response (split if needed, with 1-second delay between parts)
    const parts = splitMessage(result.text)
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, 1000))
      await sendWhatsAppMessage(phoneNumber, parts[i])
    }

    // Log inbound message
    const patient = await prisma.patient.findFirst({ where: { phone: phoneNumber } })
    await prisma.agentLog.create({
      data: {
        patientId: patient?.id,
        type: 'WHATSAPP_INBOUND',
        channel: 'WHATSAPP',
        transcript: `Patient: ${text}\nAgent: ${result.text}`,
        outcome: result.escalated ? 'ESCALATED' : 'COMPLETED',
        escalated: result.escalated,
      },
    }).catch(() => { /* non-blocking */ })

  } catch (err: any) {
    console.error('[WHATSAPP] Agent error:', err.message)
    await sendWhatsAppMessage(
      phoneNumber,
      "I'm sorry, I ran into a technical issue. Please call us directly at 0205477000 and our team will help you right away! 🙏"
    )
  }
}

// ── Send WhatsApp follow-up for missed calls ───────────────────

export async function sendMissedCallWhatsApp(
  phone: string,
  patientName: string,
  doctorName: string,
  appointmentTime: string,
  appointmentId: string
): Promise<void> {
  const message =
    `Hello ${patientName}! 😊\n\n` +
    `This is Zoe from Code Clinic. I tried calling you about your appointment tomorrow with ${doctorName} at ${appointmentTime}.\n\n` +
    `Please reply to confirm, reschedule, or cancel:\n` +
    `✅ Reply "CONFIRM" to confirm your attendance\n` +
    `📅 Reply "RESCHEDULE" to pick a new time\n` +
    `❌ Reply "CANCEL" to cancel\n\n` +
    `We look forward to seeing you! 🦷`

  await sendWhatsAppMessage(phone, message)
}

// ── Normalise phone to +256 format ───────────────────────────

function normalisePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.startsWith('256')) return `+${digits}`
  if (digits.startsWith('0') && digits.length === 10) return `+256${digits.slice(1)}`
  if (digits.length === 9) return `+256${digits}`
  return `+${digits}` // best effort
}
