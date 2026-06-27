import { Router } from 'express'
import { prisma } from '../lib/prisma'
import { sendWhatsAppMessage } from '../ai-suite/whatsapp/whatsapp.service'

const router = Router()

// POST /api/website-lead
// Called by the pop-up on codeclinic.ug when visitor submits name + phone.
// No auth required — public endpoint.
// Rate limit: check if same phone submitted in last 24 hours.

router.post('/', async (req, res) => {
  try {
    res.status(200).json({ success: true }) // respond immediately, process async

    const { name, phone, source } = req.body
    if (!name || !phone) return

    // Normalize phone: strip spaces, ensure starts with + or 256
    const digits = String(phone).replace(/\D/g, '')
    const normalized = digits.startsWith('256') ? '+' + digits
      : digits.startsWith('0') && digits.length === 10 ? '+256' + digits.slice(1)
      : digits.length === 9 ? '+256' + digits
      : '+' + digits

    // Check if already contacted in last 24 hours (avoid spam)
    const recentConv = await prisma.aiConversation.findFirst({
      where: {
        phoneNumber: normalized,
        channel:     'WHATSAPP',
        createdAt:   { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    })
    if (recentConv) {
      console.log('[WebsiteLead] Already contacted', normalized, 'in last 24h — skipping')
      return
    }

    // Get first name only
    const firstName = name.trim().split(' ')[0]

    // Check if existing patient
    const patient = await prisma.patient.findFirst({ where: { phone: normalized } })

    // Create conversation record
    const conv = await prisma.aiConversation.create({
      data: {
        patientId:    patient?.id ?? null,
        channel:      'WHATSAPP',
        phoneNumber:  normalized,
        status:       'ACTIVE',
        agentEnabled: true,
        updatedAt:    new Date(),
      },
    })

    // Save context as system message (never shown to patient)
    await prisma.aiMessage.create({
      data: {
        conversationId: conv.id,
        role:           'SYSTEM',
        content:        `[WEBSITE LEAD] Visitor ${firstName} (${normalized}) submitted their details on codeclinic.ug. Source: ${source || 'website_popup'}. This is their first contact. Introduce yourself warmly.`,
      },
    })

    // Sarah's opening message (FIX 3 — warm acknowledgment)
    const greeting = `Hi ${firstName}! 😊 Thanks for reaching out to Code Clinic. We received your message and one of our team will be in touch shortly. Is there anything else I can help you with in the meantime?`

    // Save agent message
    await prisma.aiMessage.create({
      data: { conversationId: conv.id, role: 'AGENT', content: greeting },
    })

    // Send warm message to lead
    await sendWhatsAppMessage(normalized, greeting, '')

    console.log('[WebsiteLead] Sarah texted', normalized, 'from website popup')

    // FIX 2 — Alert staff immediately
    const staffNumber = process.env.STAFF_WHATSAPP_NUMBER || '+256763430276'
    const staffAlert = `🔔 New Lead from Website\nName: ${name}\nPhone: ${normalized}\nReply to them directly on WhatsApp if they left a number, or call them back.`
    sendWhatsAppMessage(staffNumber, staffAlert, '').catch((e: any) =>
      console.error('[WebsiteLead] Staff alert failed:', e?.message)
    )

  } catch (err: any) {
    console.error('[WebsiteLead] Error:', err?.message || JSON.stringify(err) || 'unknown error')
  }
})

export default router
