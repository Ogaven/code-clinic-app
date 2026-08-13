import { sendWhatsAppMessage } from '../whatsapp/whatsapp.service'
import { STAFF_NUMBER } from '../whatsapp/staff-relay.service'
import { prisma } from '../../lib/prisma'

// Runs once daily. Finds patients whose birthday is today and sends a WhatsApp
// staff alert listing them with a link to the Campaigns Birthdays tab.
export async function checkAndSendBirthdayAlerts(): Promise<void> {
  const now        = new Date()
  const todayMonth = now.getMonth() + 1  // 1-12, in EAT (TZ is set at startup)
  const todayDay   = now.getDate()

  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)

  // Dedup: only send one staff alert per calendar day
  const alreadyAlerted = await prisma.botMessageLog.findFirst({
    where: {
      templateType: 'BIRTHDAY_STAFF_ALERT',
      sentAt:       { gte: todayStart },
    },
  })
  if (alreadyAlerted) {
    console.log('[Birthday] Staff alert already sent today — skipping')
    return
  }

  const patients = await prisma.$queryRaw<Array<{
    id:        string
    firstName: string
    lastName:  string
    phone:     string
    dob:       Date
  }>>`
    SELECT id, "firstName", "lastName", phone, dob
    FROM patients
    WHERE EXTRACT(MONTH FROM dob) = ${todayMonth}
      AND EXTRACT(DAY FROM dob)   = ${todayDay}
      AND "isActive" = true
      AND phone IS NOT NULL
      AND phone != ''
    ORDER BY "firstName"
  `

  if (patients.length === 0) {
    console.log('[Birthday] No birthdays today')
    return
  }

  const nameList = patients.map(p => {
    const age  = now.getFullYear() - new Date(p.dob).getFullYear()
    return `• ${p.firstName} ${p.lastName} (turns ${age})`
  }).join('\n')

  const msg = `🎂 Birthday Alert — ${todayDay}/${todayMonth}\n\n${nameList}\n\nHead to Campaigns → Birthdays tab to send each patient a personalised birthday greeting.`

  await sendWhatsAppMessage(STAFF_NUMBER, msg)

  await prisma.botMessageLog.create({
    data: {
      recipientPhone: STAFF_NUMBER,
      channel:        'WHATSAPP',
      templateType:   'BIRTHDAY_STAFF_ALERT',
      messageBody:    msg,
      deliveryStatus: 'sent',
    },
  })

  console.log(`[Birthday] Staff alert sent — ${patients.length} birthday patient(s)`)
}
