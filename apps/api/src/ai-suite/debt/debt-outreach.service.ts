import { sendWhatsAppMessage } from '../whatsapp/whatsapp.service'
import { prisma } from '../../lib/prisma'

// ── triggerDebtOutreach ───────────────────────────────────────────────────────
// Sends a single warm debt-reminder WhatsApp message to a patient.
// Skips silently if a DEBT message was already sent to this patient in the last
// 7 days to avoid double-messaging.

export async function triggerDebtOutreach(
  patientId:     string,
  balanceAmount: number,
  currency       = 'UGX',
): Promise<void> {
  const patient = await prisma.patient.findUnique({ where: { id: patientId } })
  if (!patient) throw new Error(`Patient ${patientId} not found`)

  // Dedup: skip if messaged in the last 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const recentDebt = await prisma.aiScheduledMessage.findFirst({
    where: {
      patientId,
      templateType: 'DEBT',
      sent:         true,
      createdAt:    { gte: sevenDaysAgo },
    },
  })
  if (recentDebt) {
    console.log(`[DebtOutreach] Skipped ${patient.firstName} — already contacted in last 7 days`)
    return
  }

  // Find or create active WHATSAPP conversation
  let conv = await prisma.aiConversation.findFirst({
    where:   { phoneNumber: patient.phone, channel: 'WHATSAPP', status: 'ACTIVE' },
    orderBy: { createdAt: 'desc' },
  })
  if (!conv) {
    conv = await prisma.aiConversation.create({
      data: {
        patientId:    patient.id,
        channel:      'WHATSAPP',
        phoneNumber:  patient.phone,
        status:       'ACTIVE',
        agentEnabled: true,
      },
    })
  }

  const formatted = balanceAmount.toLocaleString()
  const message =
    `Hi ${patient.firstName} 😊 Hope you're doing well! I'm reaching out from Code Clinic regarding your account. I noticed there's an outstanding balance of ${currency} ${formatted} on your account. I completely understand that things can get busy — no pressure at all. I just wanted to check in and see if there's anything we can do to make it easier for you to sort this out. Feel free to reply and we can figure something out together 🙏`

  await sendWhatsAppMessage(patient.phone, message)

  await prisma.aiScheduledMessage.create({
    data: {
      patientId,
      channel:      'WHATSAPP',
      templateType: 'DEBT',
      scheduledFor: new Date(),
      sent:         true,
      content:      message,
    },
  })

  await prisma.aiMessage.create({
    data: { conversationId: conv.id, role: 'AGENT', content: message },
  })

  console.log(`[DebtOutreach] Sent to ${patient.firstName} (${patient.phone}) — ${currency} ${formatted}`)
}
