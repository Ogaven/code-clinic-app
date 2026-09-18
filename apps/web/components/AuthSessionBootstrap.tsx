'use client'

// Mounted once, globally, in the root layout — keeps a returning staff
// session alive across app closes/reopens and overnight/background use,
// without ever minting a long-lived access token:
//
//  1. On mount, opportunistically exchanges the 30-day httpOnly refresh
//     cookie for a fresh access token. This is the same request the
//     receptionist layout already made on its own mount; centralizing it
//     here covers every role (admin/doctor/accounts/developer previously had
//     no equivalent) instead of just reception.
//  2. On return to foreground (visibilitychange), does the same — a PWA/tab
//     left open overnight gets a fresh token the moment staff look at it
//     again, rather than waiting for the next API call to 401 first.
//  3. Resyncs the current push subscription to the backend on every load,
//     and again whenever the service worker reports a pushsubscriptionchange
//     (browser-driven key rotation) — see lib/push.ts resyncPushSubscription.
//
// Silent by design: if the refresh token itself is gone/expired, this does
// nothing and the existing per-request 401 handling in lib/api.ts
// (fetchWithAuth/apiFetch) still redirects to /login when an actual API call
// fails. This component never forces a redirect itself.
import { useEffect } from 'react'
import { refreshToken } from '@/lib/api'
import { resyncPushSubscription } from '@/lib/push'

export default function AuthSessionBootstrap() {
  useEffect(() => {
    const isReturningSession = () => !!localStorage.getItem('cc_user')

    if (isReturningSession()) {
      refreshToken()
      resyncPushSubscription()
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'visible' && isReturningSession()) {
        refreshToken()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    function onSwMessage(e: MessageEvent) {
      if (e.data?.type === 'PUSH_SUBSCRIPTION_CHANGED') resyncPushSubscription()
    }
    navigator.serviceWorker?.addEventListener('message', onSwMessage)

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      navigator.serviceWorker?.removeEventListener('message', onSwMessage)
    }
  }, [])

  return null
}
