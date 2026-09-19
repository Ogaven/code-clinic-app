// Internal treatment follow-up / hold scheduling — alerts staff when a
// TreatmentPlan's followUpAt (e.g. "come back in December for braces") is
// coming up, due today, or overdue, so it never just sits silently in the
// pipeline. Internal-only: creates a Notification row + push notification
// for the assigned doctor and reception/admin staff. NEVER sends any
// patient-facing WhatsApp/SMS message — this whole feature is staff-facing.
//
// Idempotency: one TreatmentFollowUpAlert row per (treatmentPlanId, alertType,
// sentForDate) — sentForDate is today's Kampala calendar day at 00:00. The
// row is written FIRST, before any Notification/push goes out (write-then-
// notify, not notify-then-write) so a crash between the two never produces a
// duplicate alert on retry — the unique constraint on that row is the only
// thing standing between "runs every N minutes forever" and spamming staff.
import { prisma } from '../lib/prisma'
import { startOfKampalaDay } from '../utils/kampala-time'
import { sendPushToUser } from './push.service'

// Anything due within this many days (but not today, not overdue) is
// DUE_SOON. Matches the "within 3 days" example in the task — no other
// due-soon threshold exists elsewhere in the codebase to reuse.
const DUE_SOON_WINDOW_DAYS = 3

export type FollowUpAlertType = 'DUE_SOON' | 'DUE_TODAY' | 'OVERDUE'

// Buckets a follow-up date against Kampala "today". Returns null when the
// follow-up is further out than the due-soon window (no alert yet).
export function bucketFollowUp(followUpAt: Date, today: Date = startOfKampalaDay()): FollowUpAlertType | null {
  const followUpDay = startOfKampalaDay(followUpAt)
  const diffDays = Math.round((followUpDay.getTime() - today.getTime()) / 86_400_000)
  if (diffDays < 0) return 'OVERDUE'
  if (diffDays === 0) return 'DUE_TODAY'
  if (diffDays <= DUE_SOON_WINDOW_DAYS) return 'DUE_SOON'
  return null
}

const ALERT_LABEL: Record<FollowUpAlertType, string> = {
  DUE_SOON:  'due soon',
  DUE_TODAY: 'due today',
  OVERDUE:   'overdue',
}

// Runs periodically (registered in main.ts). Queries every TreatmentPlan with
// a non-null followUpAt (regardless of status — a follow-up date matters
// wherever it's set, though "On Hold" is the primary use case per the task),
// buckets it against Kampala "today", and fires at most one alert per
// (plan, alertType) per Kampala calendar day.
export async function checkAndSendTreatmentFollowUpAlerts(): Promise<void> {
  try {
    const today = startOfKampalaDay()

    const plans = await prisma.treatmentPlan.findMany({
      where: { followUpAt: { not: null } },
      include: {
        patient: { select: { firstName: true, lastName: true } },
        doctor:  { include: { user: { select: { id: true } } } },
      },
    })
    if (plans.length === 0) return

    // Reception/admin recipients — same role set used elsewhere for internal
    // staff alerts (see maybeNotifyStaff in whatsapp.service.ts / notifyStaff
    // in scheduling.ts).
    const staff = await prisma.user.findMany({
      where:  { role: { in: ['RECEPTIONIST', 'ADMIN'] }, isActive: true },
      select: { id: true },
    })

    for (const plan of plans) {
      if (!plan.followUpAt) continue
      const alertType = bucketFollowUp(plan.followUpAt, today)
      if (!alertType) continue

      // Idempotency row FIRST. If this (plan, alertType, day) already has a
      // row, the unique constraint throws (Prisma code P2002) and we skip —
      // no notification, no push, no duplicate.
      try {
        await prisma.treatmentFollowUpAlert.create({
          data: { treatmentPlanId: plan.id, alertType, sentForDate: today },
        })
      } catch (e: any) {
        if (e?.code === 'P2002') continue
        throw e
      }

      const patientName = `${plan.patient.firstName} ${plan.patient.lastName}`.trim()
      const label = ALERT_LABEL[alertType]
      const title = `Follow-up ${label}: ${patientName}`
      const dueDateStr = plan.followUpAt.toLocaleDateString('en-GB', { timeZone: 'Africa/Kampala' })
      const reasonSuffix = plan.followUpReason ? ` — ${plan.followUpReason}` : ''
      const body = `${patientName}'s treatment follow-up (${plan.stage}, ${plan.status}) is ${label} (${dueDateStr})${reasonSuffix}`
      const href = `/patients/${plan.patientId}`

      const recipientIds = new Set<string>(staff.map(u => u.id))
      if (plan.doctor?.user?.id) recipientIds.add(plan.doctor.user.id)

      await Promise.all([...recipientIds].map(async userId => {
        try {
          await prisma.notification.create({
            data: { userId, type: 'SYSTEM', title, body, href, isRead: false },
          })
        } catch (e: any) {
          console.error('[TreatmentFollowUpAlert] Notification create failed:', e?.message)
          return
        }
        sendPushToUser(userId, { title, body, url: href }).catch(() => {})
      }))
    }
  } catch (e: any) {
    console.error('[TreatmentFollowUpAlert] Scheduler error:', e?.message)
  }
}
