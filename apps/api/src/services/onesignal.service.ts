import { env } from '../lib/env'

export interface OneSignalPayload {
  title: string
  body: string
  url?: string
}

export interface OneSignalDispatchResult {
  configured: boolean
  accepted: boolean
  notificationId?: string
  error?: string
}

export function isOneSignalConfigured(): boolean {
  return !!(env.ONESIGNAL_APP_ID && env.ONESIGNAL_REST_API_KEY)
}

// How long OneSignal should keep retrying delivery to a device that's
// temporarily offline (phone locked with no network, laptop asleep, etc.)
// before giving up, in seconds. Explicit rather than relying on OneSignal's
// own default (~3 days undocumented-in-code) so the choice is visible and
// intentional: long enough that a device offline overnight or over a
// weekend still gets every operational alert the moment it reconnects, short
// enough that a staff member who was offline for a week doesn't suddenly get
// buried in day-old "needs action" pushes that are likely stale/superseded
// by the time they arrive. 3 days (matches OneSignal's own default, made
// explicit) — operational alerts here are same-shift/same-day actionable
// items, not calendar-scheduled reminders that need a longer horizon.
const PUSH_TTL_SECONDS = 3 * 24 * 60 * 60

// OneSignal external_id is always the authenticated Code Clinic User.id.
// No patient identifiers or clinical content are used for addressing.
//
// elapsedMs below times only Code Clinic's request -> OneSignal's HTTP
// acceptance of the send. It does NOT measure actual device delivery, which
// happens asynchronously afterwards via FCM/APNs/the browser's own push
// service, entirely outside this process — a fast elapsedMs here proves our
// own code isn't the source of an end-to-end delay a user reports, but
// can't by itself prove the opposite (device delivery can still lag behind
// a prompt accept). targetedExternalIds is the number of external_ids in
// this call, not a confirmed eligible-device count — OneSignal's synchronous
// create-notification response doesn't report device fan-out.
export async function sendOneSignalToUser(userId: string, payload: OneSignalPayload): Promise<OneSignalDispatchResult> {
  if (!isOneSignalConfigured()) return { configured: false, accepted: false, error: 'not_configured' }

  const startedAt = Date.now()
  try {
    const response = await fetch('https://api.onesignal.com/notifications?c=push', {
      method: 'POST',
      headers: {
        Authorization: `Key ${env.ONESIGNAL_REST_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        app_id: env.ONESIGNAL_APP_ID,
        include_aliases: { external_id: [userId] },
        target_channel: 'push',
        headings: { en: payload.title },
        contents: { en: payload.body },
        url: payload.url,
        ttl: PUSH_TTL_SECONDS,
      }),
    })
    const elapsedMs = Date.now() - startedAt

    const data = await response.json().catch(() => ({})) as { id?: string; errors?: unknown }
    if (!response.ok || !data.id) {
      console.error('[OneSignal] Push rejected', { status: response.status, hasErrors: !!data.errors, elapsedMs, targetedExternalIds: 1 })
      return { configured: true, accepted: false, error: `http_${response.status}` }
    }
    console.log('[OneSignal] Push accepted', { elapsedMs, hasNotificationId: !!data.id, targetedExternalIds: 1 })
    return { configured: true, accepted: true, notificationId: data.id }
  } catch (error: any) {
    const elapsedMs = Date.now() - startedAt
    console.error('[OneSignal] Push dispatch failed:', error?.message, { elapsedMs })
    return { configured: true, accepted: false, error: 'network_error' }
  }
}
