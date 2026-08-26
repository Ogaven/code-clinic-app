import { sendWhatsAppMessage } from '../whatsapp/whatsapp.service'
import { STAFF_NUMBER } from '../whatsapp/staff-relay.service'
import { prisma } from '../../lib/prisma'

// Runs once daily. Finds patients whose birthday is today and sends a WhatsApp
// staff alert listing them with a link to the Campaigns Birthdays tab.
//
// TIMEZONE FIX: previously used now.getMonth()/now.getDate() — these are
// LOCAL accessors that depend on process.env.TZ actually taking effect for
// Date methods, which Node does not reliably guarantee for a runtime
// assignment (V8's timezone handling can already be initialized before that
// line runs, especially in containerized/cloud environments that default to
// UTC). This is the root cause of birthdays appearing "one calendar day
// early": for the ~3-hour window each day when Kampala's calendar date has
// already advanced but UTC's has not (Kampala 00:00-02:59, since Kampala is
// UTC+3), a UTC-effective now.getDate() would report the PREVIOUS day.
// Fixed by reading Uganda's real calendar day explicitly via
// timeZone: 'Africa/Kampala', immune to server/container ambient timezone.
export async function checkAndSendBirthdayAlerts(): Promise<void> {
  const now        = new Date()
  const todayMonth = parseInt(now.toLocaleDateString('en-US', { month: 'numeric', timeZone: 'Africa/Kampala' }))
  const todayDay   = parseInt(now.toLocaleDateString('en-US', { day: 'numeric', timeZone: 'Africa/Kampala' }))
  const todayStart = new Date(`${now.toLocaleDateString('en-CA', { timeZone: 'Africa/Kampala' })}T00:00:00+03:00`)

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
