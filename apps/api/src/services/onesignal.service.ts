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

// OneSignal external_id is always the authenticated Code Clinic User.id.
// No patient identifiers or clinical content are used for addressing.
export async function sendOneSignalToUser(userId: string, payload: OneSignalPayload): Promise<OneSignalDispatchResult> {
  if (!isOneSignalConfigured()) return { configured: false, accepted: false, error: 'not_configured' }

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
      }),
    })

    const data = await response.json().catch(() => ({})) as { id?: string; errors?: unknown }
    if (!response.ok || !data.id) {
      console.error('[OneSignal] Push rejected', { status: response.status, hasErrors: !!data.errors })
      return { configured: true, accepted: false, error: `http_${response.status}` }
    }
    return { configured: true, accepted: true, notificationId: data.id }
  } catch (error: any) {
    console.error('[OneSignal] Push dispatch failed:', error?.message)
    return { configured: true, accepted: false, error: 'network_error' }
  }
}
