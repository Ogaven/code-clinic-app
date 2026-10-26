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
      // Never send a generic nurture nudge over an unanswered patient question.
      // The lead may have replied after this reminder was originally scheduled.
      const conversations = await prisma.aiConversation.findMany({
        where: { patientId: msg.patient.id, channel: 'WHATSAPP' },
        select: { id: true, agentEnabled: true, status: true },
      })
      const activeIds = conversations.filter(c => c.status === 'ACTIVE').map(c => c.id)
      const staffControlled = conversations.some(c => c.status === 'ACTIVE' && !c.agentEnabled)
      const latestMessage = activeIds.length ? await prisma.aiMessage.findFirst({
        where: { conversationId: { in: activeIds }, role: { in: ['USER', 'AGENT'] } },
        orderBy: { createdAt: 'desc' },
        select: { role: true, createdAt: true },
      }) : null
      if (staffControlled || (latestMessage?.role === 'USER')) {
        console.log('[LeadNurture] Skipping scheduled reminder: patient replied or staff controls conversation')
        await prisma.aiScheduledMessage.update({ where: { id: msg.id }, data: { sent: true } })
        continue
      }
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
