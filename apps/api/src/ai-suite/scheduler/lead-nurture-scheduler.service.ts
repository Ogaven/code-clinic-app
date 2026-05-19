import { sendWhatsAppMessage } from '../whatsapp/whatsapp.service'
import { prisma } from '../../lib/prisma'

// ── checkAndSendLeadNurtureMessages ──────────────────────────────────────────
// Runs every hour. Finds LEADNURTURE messages whose scheduledFor has passed and
// sends them via WhatsApp, then marks them sent and logs them in the inbox.

export async function checkAndSendLeadNurtureMessages(): Promise<void> {
  const now = new Date()

  const due = await prisma.aiScheduledMessage.findMany({
    where: {
      templateType: 'LEADNURTURE',
      sent:         false,
      scheduledFor: { lte: now },
    },
    include: {
      patient: { select: { id: true, firstName: true, phone: true } },
    },
  })

  if (due.length === 0) return

  console.log(`[LeadNurture] Sending ${due.length} scheduled message(s)`)

  for (const msg of due) {
    try {
      await sendWhatsAppMessage(msg.patient.phone, msg.content)

      await prisma.aiScheduledMessage.update({
        where: { id: msg.id },
        data:  { sent: true },
      })

      // Link to conversation so staff can see the message in the inbox
      let conv = await prisma.aiConversation.findFirst({
        where:   { phoneNumber: msg.patient.phone, channel: 'WHATSAPP', status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
      })
      if (!conv) {
        conv = await prisma.aiConversation.create({
          data: {
            patientId:    msg.patient.id,
            channel:      'WHATSAPP',
            phoneNumber:  msg.patient.phone,
            status:       'ACTIVE',
            agentEnabled: true,
          },
        })
      }

      await prisma.aiMessage.create({
        data: { conversationId: conv.id, role: 'AGENT', content: msg.content },
      })

      console.log(`[LeadNurture] Sent to ${msg.patient.firstName} (${msg.patient.phone})`)
    } catch (err: any) {
      console.error(`[LeadNurture] Failed for ${msg.patient.phone}:`, err.message ?? err)
    }
  }
}
