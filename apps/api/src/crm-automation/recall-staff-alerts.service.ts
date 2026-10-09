// Staff-only daily recall digest. No patient messaging or outbound push.
// Estimates are excluded pending clinical confirmation.
import { prisma } from '../lib/prisma'

export async function checkDailyRecallStaffAlerts(now = new Date()): Promise<{ confirmedDue: number; notified: number }> {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kampala', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  // Count only patients with a staff-confirmed interval AND a completed
  // periodontal-maintenance/recall-hygiene visit. An ordinary consultation,
  // Check & Treat, or review must never establish hygiene recall eligibility.
  // Compute against the latest *hygiene* visit, not an unrelated later visit.
  // Fail closed when the clinic has no qualifying hygiene history.
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count FROM (
      SELECT p.id, MAX(a."startAt") AS "lastHygieneAt", p."recallInterval"
      FROM patients p
      JOIN appointments a ON a."patientId" = p.id AND a.status = 'COMPLETED'
      JOIN services s ON s.id = a."serviceId"
      WHERE p."isActive" = true
        AND p."recallInterval" IN ('THREE_MONTH', 'SIX_MONTH', 'TWELVE_MONTH')
        AND LOWER(REGEXP_REPLACE(TRIM(s.name), '[^a-zA-Z0-9]+', ' ', 'g')) IN (
          'periodontal maintenance',
          'recall hygiene visit',
          'periodontal maintenance recall hygiene visit'
        )
      GROUP BY p.id, p."recallInterval"
    ) eligible
    WHERE eligible."lastHygieneAt" +
      (CASE eligible."recallInterval"
        WHEN 'THREE_MONTH' THEN 90
        WHEN 'SIX_MONTH' THEN 180
        ELSE 365 END) * INTERVAL '1 day' <= ${now}
  `
  const confirmedDue = Number(rows[0]?.count ?? 0)
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
        body: `${confirmedDue} patients with staff-set recall intervals and completed hygiene visits need review. Confirm clinical recall eligibility and dates before contacting anyone. Estimated recalls require separate confirmation.`,
      },
    })
    notified++
  }
  return { confirmedDue, notified }
}
