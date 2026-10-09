// Staff-only daily recall digest. No patient messaging or outbound push.
// Estimates are excluded pending clinical confirmation.
import { prisma } from '../lib/prisma'

export async function checkDailyRecallStaffAlerts(now = new Date()): Promise<{ confirmedDue: number; notified: number }> {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kampala', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const confirmedDue = await prisma.patient.count({
    where: { isActive: true, recallInterval: { not: null }, recallStatus: { in: ['DUE', 'OVERDUE_30', 'OVERDUE_90', 'OVERDUE_180_PLUS'] } },
  })
  if (confirmedDue === 0) return { confirmedDue, notified: 0 }
  const recipients = await prisma.user.findMany({
    where: { isActive: true, role: { in: ['ADMIN', 'RECEPTIONIST'] } },
    select: { id: true },
  })
  const title = `Daily recall review · ${day}`
  const href = '/crm/recall'
  let notified = 0
  for (const user of recipients) {
    const existing = await prisma.notification.findFirst({ where: { userId: user.id, title, href }, select: { id: true } })
    if (existing) continue
    await prisma.notification.create({
      data: {
        userId: user.id, type: 'SYSTEM', title, href,
        body: `${confirmedDue} patients with staff-set recall intervals need review. Confirm clinical recall eligibility and dates before contacting anyone. Estimated recalls require separate confirmation.`,
      },
    })
    notified++
  }
  return { confirmedDue, notified }
}
