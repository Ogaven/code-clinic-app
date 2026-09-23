import webpush from 'web-push'
import { prisma } from '../lib/prisma'
import { env } from '../lib/env'

const vapidConfigured = !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT)

if (vapidConfigured) {
  webpush.setVapidDetails(env.VAPID_SUBJECT!, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!)
} else {
  console.warn('[Push] VAPID keys not configured — push notifications are disabled (in-app notifications still work).')
}

export interface PushPayload {
  title: string
  body:  string
  url?:  string
  icon?: string
}

// ── Self-alert when a user's push subscriptions silently die ────────────────
// A subscription can be revoked by the browser/OS at any time with no user
// action involved (see sw.js's pushsubscriptionchange handler, which only
// self-heals while the app is open). If it dies while the user never opens
// the app, sendPushToUser previously just deleted the dead row and moved on
// -- the user got zero signal that OS-level push had stopped working for
// them, discoverable only by chance (checking in-app notifications, which
// defeats the point of push). This records one persistent, deduped in-app
// notice the moment a user's LAST subscription is cleaned up, so the next
// time they open the app for any reason at all, they see a clear, actionable
// "re-enable notifications" prompt instead of silence.
const lastPushExhaustionAlertAtByUser = new Map<string, number>()
const PUSH_EXHAUSTION_ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000
const PUSH_EXHAUSTION_ALERT_TITLE = '🔕 Push notifications stopped working on this device'

async function alertUserPushSubscriptionsExhausted(userId: string): Promise<void> {
  const now = Date.now()
  const lastAt = lastPushExhaustionAlertAtByUser.get(userId) ?? 0
  if (now - lastAt < PUSH_EXHAUSTION_ALERT_COOLDOWN_MS) return

  const cooldownStart = new Date(now - PUSH_EXHAUSTION_ALERT_COOLDOWN_MS)
  const recent = await prisma.notification.findFirst({
    where: { userId, type: 'PROVIDER_HEALTH', title: PUSH_EXHAUSTION_ALERT_TITLE, createdAt: { gte: cooldownStart } },
    select: { id: true },
  }).catch(() => null)
  if (recent) { lastPushExhaustionAlertAtByUser.set(userId, now); return }

  lastPushExhaustionAlertAtByUser.set(userId, now)

  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
    const href = user?.role === 'RECEPTIONIST' ? '/receptionist/settings' : '/settings'
    await prisma.notification.create({
      data: {
        userId,
        type:  'PROVIDER_HEALTH',
        title: PUSH_EXHAUSTION_ALERT_TITLE,
        body:  'Your browser/device stopped receiving push notifications (the subscription expired). Open Settings and re-enable notifications so you don’t miss new escalations.',
        href,
      },
    })
  } catch (e: any) {
    console.error(`[Push] Failed to record push-expired notice for user ${userId}:`, e.message)
  }
}

// Sends a real push notification to every subscribed device for this user.
// Fire-and-forget by design — a push failure must never break the caller's
// existing notification/escalation flow. Expired subscriptions (410/404
// from the push service, meaning the browser unsubscribed) are cleaned up;
// if that was the user's last subscription, alertUserPushSubscriptionsExhausted
// records an in-app notice so the gap doesn't stay invisible.
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  if (!vapidConfigured) return

  try {
    const subs = await prisma.pushSubscription.findMany({ where: { userId } })
    if (subs.length === 0) return

    const body = JSON.stringify(payload)
    await Promise.all(subs.map(async sub => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
        )
      } catch (err: any) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {})
          try {
            const remaining = await prisma.pushSubscription.count({ where: { userId } })
            if (remaining === 0) await alertUserPushSubscriptionsExhausted(userId)
          } catch (e: any) {
            console.error(`[Push] Failed to check remaining subscriptions for user ${userId}:`, e.message)
          }
        } else {
          console.error(`[Push] Send failed for user ${userId}:`, err.message)
        }
      }
    }))
  } catch (e: any) {
    console.error('[Push] sendPushToUser error:', e.message)
  }
}

export interface PushDispatchResult {
  targeted:  number
  succeeded: number
  expired:   number
  failed:    number
}

// Admin-only acceptance-test send — targets only the calling user's own
// subscriptions (never another staff member's) and returns per-subscription
// dispatch outcomes so the caller can report exactly what the push provider did,
// rather than the fire-and-forget void that sendPushToUser returns.
export async function sendTestPushToUser(userId: string): Promise<PushDispatchResult> {
  const subs = await prisma.pushSubscription.findMany({ where: { userId } })
  const body = JSON.stringify({
    title: 'Code Clinic',
    body:  'Code Clinic notification test — background notifications are working.',
  } satisfies PushPayload)

  let succeeded = 0, expired = 0, failed = 0
  await Promise.all(subs.map(async sub => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body,
      )
      succeeded++
    } catch (err: any) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        expired++
        await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {})
      } else {
        failed++
        console.error(`[Push] Test send failed for user ${userId}:`, err.message)
      }
    }
  }))

  return { targeted: subs.length, succeeded, expired, failed }
}

export function isPushConfigured(): boolean {
  return vapidConfigured
}
