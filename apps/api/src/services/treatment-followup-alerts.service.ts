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

// Planned treatment/follow-up reminders need enough runway for staff to act.
// These milestones intentionally avoid a noisy "every day for 30 days" model:
// reception/admin and the assigned doctor get progressively stronger reminders
// at 30, 14, 7, 3 and 1 day before the staff-set followUpAt date, then on the
// due date and once when it becomes overdue.
export type FollowUpAlertType =
  | 'UPCOMING_30'
  | 'UPCOMING_14'
  | 'UPCOMING_7'
  | 'UPCOMING_3'
  | 'UPCOMING_1'
  | 'DUE_TODAY'
  | 'OVERDUE'

export function bucketFollowUp(followUpAt: Date, today: Date = startOfKampalaDay()): FollowUpAlertType | null {
  const followUpDay = startOfKampalaDay(followUpAt)
  const diffDays = Math.round((followUpDay.getTime() - today.getTime()) / 86_400_000)
  if (diffDays < 0) return 'OVERDUE'
  if (diffDays === 0) return 'DUE_TODAY'
  if (diffDays === 1) return 'UPCOMING_1'
  if (diffDays === 3) return 'UPCOMING_3'
  if (diffDays === 7) return 'UPCOMING_7'
  if (diffDays === 14) return 'UPCOMING_14'
  if (diffDays === 30) return 'UPCOMING_30'
  return null
}

const ALERT_LABEL: Record<FollowUpAlertType, string> = {
  UPCOMING_30: 'due in 30 days',
  UPCOMING_14: 'due in 14 days',
  UPCOMING_7:  'due in 7 days',
  UPCOMING_3:  'due in 3 days',
  UPCOMING_1:  'due tomorrow',
  DUE_TODAY:   'due today',
  OVERDUE:     'overdue',
}

// Statuses a treatment plan can carry (pipeline.ts VALID_STATUSES) that mean
// there is nothing left for staff to act on -- a followUpAt left over from
// before the plan reached one of these is not a live commitment anymore.
// Planned/In Progress/On Hold all remain actionable (a due-soon/overdue
// follow-up on any of them is still real work staff need to see, not just
// the On Hold case this scheduler originally targeted).
const NON_ACTIONABLE_STATUSES = ['Completed', 'Cancelled', 'Declined']

// Runs periodically (registered in main.ts). Queries every ACTIONABLE
// TreatmentPlan with a non-null followUpAt -- followUpAt is the only field
// in the domain model that represents a genuine staff-set due date; there is
// no separate "treatment due date" to consume, and none is inferred from
// dateAdded/createdAt. Buckets it against Kampala "today", and fires at most
// one alert per (plan, alertType, planned follow-up date). This means a scheduler
// retry cannot spam staff, while changing the plan's follow-up date creates a
// fresh reminder lifecycle for the new date.
export async function checkAndSendTreatmentFollowUpAlerts(): Promise<void> {
  try {
    const today = startOfKampalaDay()

    const plans = await prisma.treatmentPlan.findMany({
      where: { followUpAt: { not: null }, status: { notIn: NON_ACTIONABLE_STATUSES } },
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
          data: { treatmentPlanId: plan.id, alertType, sentForDate: startOfKampalaDay(plan.followUpAt) },
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

      // Full clinical detail (stage/status/reason) is fine in the in-app
      // notification centre, which only the authenticated staff member ever
      // sees. A push notification can surface on a locked device screen, so
      // its body stays fully generic -- no patient name, per the lock-screen
      // privacy requirement (a push popup should say WHAT kind of action is
      // needed, never WHO it's about).
      const pushBody = alertType === 'OVERDUE'
        ? 'A planned treatment follow-up is overdue. Please review and contact the patient.'
        : alertType === 'DUE_TODAY'
          ? 'A planned treatment follow-up is due today. Please review and contact the patient.'
          : 'A planned treatment follow-up is approaching. Please review and contact the patient.'

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
        sendPushToUser(userId, { title, body: pushBody, url: href }).catch(() => {})
      }))
    }
  } catch (e: any) {
    console.error('[TreatmentFollowUpAlert] Scheduler error:', e?.message)
  }
}
