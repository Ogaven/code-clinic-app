import { prisma } from '../../../lib/prisma'

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
