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

// Sends a real push notification to every subscribed device for this user.
// Fire-and-forget by design — a push failure must never break the caller's
// existing notification/escalation flow. Expired subscriptions (410/404
// from the push service, meaning the browser unsubscribed) are cleaned up.
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
