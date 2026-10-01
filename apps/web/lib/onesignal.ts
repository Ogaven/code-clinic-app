'use client'

declare global {
  interface Window {
    OneSignalDeferred?: Array<(OneSignal: any) => void>
    __ccOneSignalInitialized?: boolean
    __ccOneSignalReady?: Promise<boolean>
  }
}

export const ONESIGNAL_APP_ID = '68a5af26-5ce7-447b-9081-0a7b1be369fc'

function currentUser(): { id?: string; role?: string } | null {
  try {
    const raw = localStorage.getItem('cc_user')
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function withOneSignal(callback: (OneSignal: any) => void) {
  if (typeof window === 'undefined') return
  window.OneSignalDeferred = window.OneSignalDeferred || []
  window.OneSignalDeferred.push(callback)
}

function initOneSignal(OneSignal: any): Promise<boolean> {
  if (!window.__ccOneSignalReady) {
    window.__ccOneSignalReady = (async () => {
      try {
        await OneSignal.init({
          appId: ONESIGNAL_APP_ID,
          serviceWorkerPath: '/onesignal/OneSignalSDKWorker.js',
          serviceWorkerParam: { scope: '/onesignal/' },
          notifyButton: { enable: false },
          allowLocalhostAsSecureOrigin: process.env.NODE_ENV !== 'production',
        })
        return true
      } catch (error) {
        console.error('[push] OneSignal initialization failed', error)
        return false
      }
    })()
  }
  return window.__ccOneSignalReady
}

export function initializeOneSignal(): void {
  if (typeof window === 'undefined' || window.__ccOneSignalInitialized) return
  window.__ccOneSignalInitialized = true

  if (!document.querySelector('script[data-codeclinic-onesignal]')) {
    const script = document.createElement('script')
    script.src = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js'
    script.defer = true
    script.dataset.codeclinicOnesignal = 'true'
    document.head.appendChild(script)
  }

  withOneSignal(async (OneSignal) => {
    if (!(await initOneSignal(OneSignal))) return

    const user = currentUser()
    if (user?.id) {
      await OneSignal.login(user.id)
      if (user.role) await OneSignal.User.addTag('codeclinic_role', user.role)

      // A device can retain browser permission while its OneSignal push
      // subscription is opted out (browser/profile migration, cleared site
      // data, an earlier SDK state, etc.). On an already-authorized device,
      // restore the provider subscription without showing a new permission
      // prompt. This is what lets Windows/Android receive background push
      // after Code Clinic has been closed, provided the OS/browser permits
      // background notifications and the device later has network access.
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        await OneSignal.User?.PushSubscription?.optIn?.()
      }
    }
  })
}

export async function enableOneSignalNotifications(): Promise<boolean> {
  initializeOneSignal()
  return new Promise((resolve) => {
    withOneSignal(async (OneSignal) => {
      try {
        if (!(await initOneSignal(OneSignal))) return resolve(false)
        const user = currentUser()
        if (!user?.id) return resolve(false)
        await OneSignal.login(user.id)
        if (user.role) await OneSignal.User.addTag('codeclinic_role', user.role)
        await OneSignal.Notifications.requestPermission()
        if (OneSignal.Notifications.permission === true) {
          await OneSignal.User?.PushSubscription?.optIn?.()
        }
        resolve(
          OneSignal.Notifications.permission === true &&
          OneSignal.User?.PushSubscription?.optedIn !== false
        )
      } catch (error) {
        console.error('[push] OneSignal enable failed', error)
        resolve(false)
      }
    })
  })
}

export function logoutOneSignal(): void {
  withOneSignal(async (OneSignal) => {
    try {
      if (await initOneSignal(OneSignal)) await OneSignal.logout()
    } catch {}
  })
}


export async function getOneSignalSubscriptionState(): Promise<{ permission: boolean; optedIn: boolean }> {
  initializeOneSignal()
  return new Promise((resolve) => {
    withOneSignal(async (OneSignal) => {
      try {
        if (!(await initOneSignal(OneSignal))) return resolve({ permission: false, optedIn: false })
        const user = currentUser()
        if (user?.id) await OneSignal.login(user.id)
        const permission = OneSignal.Notifications?.permission === true
        const optedIn = OneSignal.User?.PushSubscription?.optedIn === true
        resolve({ permission, optedIn })
      } catch {
        resolve({ permission: false, optedIn: false })
      }
    })
  })
}
