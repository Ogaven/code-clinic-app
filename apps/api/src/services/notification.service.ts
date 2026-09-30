// Shared staff-notification fan-out — the durable in-app Notification row is
// the source of truth; OneSignal push is the attention/delivery channel on
// top of it. Every new notification-producing hook added in this milestone
// (treatment pipeline transitions, CRM lead sweeps) goes through this single
// function instead of re-implementing the same two-step
// prisma.notification.create + sendPushToUser idiom that's scattered ad hoc
// across ~14 existing call sites in this codebase (whatsapp.service.ts,
// scheduling.ts, lead-sla.service.ts, etc. — each predates this helper and is
// left untouched; this is additive, not a replacement for them).
//
// The persistent write always happens first and is awaited; the push is
// fire-and-forget and can never fail the caller or destroy the persistent
// record — a rejected/errored push still leaves the in-app notification
// exactly as durable as it would be with no push at all.
import { prisma } from '../lib/prisma'
import { sendPushToUser } from './push.service'

export interface NotifyUsersParams {
  /** Recipient Code Clinic User ids — resolved by the caller from the actual
   *  business entity/assignment (never a bare role broadcast for anything
   *  patient/case-specific). Duplicates are collapsed automatically. */
  userIds: string[]
  /** Free-text Notification.type — follows the existing convention
   *  (ESCALATION | APPOINTMENT | CONFIRMATION | MESSAGE | SYSTEM |
   *  PROVIDER_HEALTH), not a DB-enforced enum. */
  type: string
  title: string
  /** Full detail for the authenticated, persistent in-app feed only. */
  body: string
  /** Generic, lock-screen-safe text for the OS push popup — must never
   *  contain patient name/phone/diagnosis/financial detail. Falls back to
   *  `body` only when the caller has nothing to redact (already generic). */
  pushBody?: string
  href: string
  /** Observability label only (e.g. "treatment.assigned", "lead.needs_help")
   *  — logged alongside recipient count, never persisted on the row. */
  category?: string
}

export async function notifyUsers(params: NotifyUsersParams): Promise<void> {
  const { userIds, type, title, body, href } = params
  const pushBody = params.pushBody ?? body
  const uniqueIds = [...new Set(userIds)]
  if (uniqueIds.length === 0) return

  console.log('[Notify]', { category: params.category ?? type, recipients: uniqueIds.length })

  await Promise.all(uniqueIds.map(async userId => {
    try {
      await prisma.notification.create({ data: { userId, type, title, body, href } })
    } catch (e: any) {
      console.error('[Notify] persistent notification create failed:', e?.message)
      // Never push for a recipient whose durable record failed to write —
      // the in-app row is the source of truth; a push with nothing behind
      // it would be a dangling, unexplainable popup.
      return
    }
    // Multi-device fan-out (including OneSignal's own per-external_id device
    // list, and the VAPID fallback's per-subscription loop) is entirely
    // sendPushToUser's responsibility — one call per user here is correct
    // regardless of how many devices that user has registered, and a dead
    // device never blocks another active one (see push.service.ts).
    sendPushToUser(userId, { title, body: pushBody, url: href }).catch(() => {})
  }))
}
