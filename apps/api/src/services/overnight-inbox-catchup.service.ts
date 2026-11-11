import { prisma } from '../lib/prisma'
import { sendPushToUser } from './push.service'
import { withinLeadAlertHours } from './lead-alert-hours'

/**
 * One morning digest per staff member for unread routine inbox messages
 * received between yesterday's closing time and today's opening time.
 * In-app notification rows survive restarts; the digest title is used
 * to avoid repeated sends on subsequent scheduler ticks.
 */
export async function sendOvernightInboxCatchup(now: Date = new Date()): Promise<number> {
  if (!withinLeadAlertHours(now)) return 0
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Kampala', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const part = (type: string) => Number(parts.find(p => p.type === type)?.value ?? '0')
  const year = part('year'), month = part('month'), day = part('day')
  const todayOpeningUtc = Date.UTC(year, month - 1, day, 4) // 07:00 EAT
  const yesterdayClosingUtc = todayOpeningUtc - 13 * 60 * 60 * 1000 // previous 18:00 EAT
  const title = `Overnight inbox messages — ${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const staff = await prisma.user.findMany({
    where: { role: { in: ['RECEPTIONIST', 'ADMIN'] }, isActive: true },
    select: { id: true, role: true },
  })
  let attempted = 0
  for (const user of staff) {
    // A long-running sweep must never dispatch routine pushes after closing.
    if (!withinLeadAlertHours()) break
    const pending = await prisma.notification.count({
      where: {
        userId: user.id,
        type: 'MESSAGE',
        isRead: false,
        href: { contains: '/ai-suite/inbox' },
        createdAt: { gte: new Date(yesterdayClosingUtc), lt: new Date(todayOpeningUtc) },
      },
    })
    if (pending === 0) continue
    const alreadySent = await prisma.notification.findFirst({
      where: { userId: user.id, title },
      select: { id: true },
    })
    if (alreadySent) continue
    const href = user.role === 'RECEPTIONIST' ? '/receptionist/ai-suite/inbox' : '/ai-suite/inbox'
    const body = `${pending} unread inbox notification${pending === 1 ? '' : 's'} arrived overnight. Review conversations requiring human attention.`
    // Avoid persisting a digest after closing without attempting its push.
    if (!withinLeadAlertHours()) break
    // Persist the digest before sending so restart retries do not generate duplicate pushes.
    await prisma.notification.create({
      data: { userId: user.id, type: 'MESSAGE', title, body, href },
    })
    try {
      // The push API swallows provider failures: this records an attempted
      // dispatch, not confirmed delivery to a device.
      await sendPushToUser(user.id, {
        title: 'Overnight messages need review',
        body: 'Unread conversations arrived overnight — tap to review.',
        url: href,
      })
      attempted++
    } catch (error) {
      console.error('[OvernightInboxCatchup] Push failed:', error)
    }
  }
  return attempted
}
