// Real push notification subscription — requests permission, subscribes via the
// service worker's PushManager, and registers the subscription with the backend.
// Must only be called from an explicit user action (a button click), never on
// page load, since Notification.requestPermission() requires a user gesture in
// most browsers and silently prompting on load is bad UX regardless.

export type SubscribeResult =
  | { ok: true }
  | { ok: false; reason: 'unsupported' | 'denied' | 'no-vapid-key' | 'error'; detail?: string }

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i)
  return outputArray
}

// Shared with subscribeToPush() and resyncPushSubscription() — the one place
// that actually POSTs a subscription to the backend, so both call sites can't drift.
async function persistSubscription(sub: PushSubscription): Promise<boolean> {
  const token = localStorage.getItem('cc_token')
  if (!token) return false
  const subJson = sub.toJSON()
  try {
    const res = await fetch('/api-proxy/push/subscribe', {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ endpoint: subJson.endpoint, keys: subJson.keys }),
    })
    return res.ok
  } catch {
    return false
  }
}

// Browsers can rotate a push subscription's keys at any time (expiry, the
// pushsubscriptionchange event) with no user action involved. Previously the
// only way the backend's PushSubscription row got refreshed was the user
// manually re-clicking "Enable Notifications", so a device could silently
// stop receiving escalations after any browser-driven rotation. This runs on
// every app load (see AuthSessionBootstrap) and whenever the service worker
// reports a rotation while a tab is open — cheap and idempotent (upsert by
// endpoint), so calling it opportunistically is safe.
export async function resyncPushSubscription(): Promise<void> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) return
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (sub) await persistSubscription(sub)
  } catch {}
}

export async function subscribeToPush(): Promise<SubscribeResult> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { ok: false, reason: 'unsupported' }
  }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return { ok: false, reason: 'denied' }

  const token = localStorage.getItem('cc_token')
  if (!token) return { ok: false, reason: 'error', detail: 'not signed in' }

  try {
    const keyRes = await fetch('/api-proxy/push/vapid-public-key', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!keyRes.ok) return { ok: false, reason: 'no-vapid-key' }
    const { publicKey } = await keyRes.json()
    if (!publicKey) return { ok: false, reason: 'no-vapid-key' }

    const reg = await navigator.serviceWorker.ready
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      })
    }

    const saved = await persistSubscription(sub)
    if (!saved) return { ok: false, reason: 'error', detail: 'save failed' }

    return { ok: true }
  } catch (e: any) {
    return { ok: false, reason: 'error', detail: e?.message }
  }
}

export async function unsubscribeFromPush(): Promise<void> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (!sub) return
    const token = localStorage.getItem('cc_token')
    await fetch('/api-proxy/push/subscribe', {
      method:  'DELETE',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ endpoint: sub.endpoint }),
    }).catch(() => {})
    await sub.unsubscribe()
  } catch {}
}

export async function isPushSubscribed(): Promise<boolean> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) return false
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    if (!reg) return false
    const sub = await reg.pushManager.getSubscription()
    return !!sub
  } catch {
    return false
  }
}
