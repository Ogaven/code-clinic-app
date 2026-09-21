'use client'

// Shared "Notifications" row logic for both the mobile profile sheet
// (components/mobile/MobileProfileSheet.tsx) and the desktop profile
// dropdown (components/layout/ProfileMenu.tsx) — one copy of the real
// subscribe/unsubscribe flow so the two surfaces can't drift.
//
// Never auto-prompts — Notification.requestPermission() is only ever called
// from inside subscribeToPush(), which this row invokes solely on tap.

import { useEffect, useState } from 'react'
import { Bell, BellOff, BellRing } from 'lucide-react'
import { cn } from '@/lib/utils'
import { subscribeToPush, unsubscribeFromPush, isPushSubscribed } from '@/lib/push'
import { getNotificationRowState } from '@/lib/notificationRowState'

interface NotificationSettingsRowProps {
  /** 'sheet' = full-size mobile row with its own heading (default). 'menu' = compact row for the small desktop dropdown. */
  variant?: 'sheet' | 'menu'
}

export default function NotificationSettingsRow({ variant = 'sheet' }: NotificationSettingsRowProps) {
  const [supported, setSupported] = useState(true)
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default')
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [isIOS, setIsIOS] = useState(false)
  const [isStandalone, setIsStandalone] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [testStatus, setTestStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  useEffect(() => {
    const hasNotificationApi = typeof window !== 'undefined' && 'Notification' in window
    const hasPushApi = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window
    setSupported(hasNotificationApi && hasPushApi)
    if (hasNotificationApi) setPermission(Notification.permission)
    isPushSubscribed().then(setSubscribed)

    // iPadOS reports itself as "MacIntel" but is touch-only, unlike a real Mac.
    const ua = navigator.userAgent
    setIsIOS(/iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))
    setIsStandalone(
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true
    )
    try {
      const u = JSON.parse(localStorage.getItem('cc_user') || '{}')
      setIsAdmin(u.role === 'ADMIN')
    } catch { setIsAdmin(false) }
  }, [])

  async function sendTest() {
    setTestStatus('sending')
    try {
      const token = localStorage.getItem('cc_token')
      const res = await fetch('/api-proxy/push/test', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      setTestStatus(res.ok ? 'sent' : 'error')
    } catch {
      setTestStatus('error')
    }
    setTimeout(() => setTestStatus('idle'), 4000)
  }

  async function enable() {
    setBusy(true)
    const result = await subscribeToPush()
    if (typeof window !== 'undefined' && 'Notification' in window) setPermission(Notification.permission)
    setSubscribed(result.ok)
    setBusy(false)
  }

  async function disable() {
    setBusy(true)
    await unsubscribeFromPush()
    setSubscribed(false)
    setBusy(false)
  }

  const rowState = getNotificationRowState({ supported, permission, subscribed, isIOS, isStandalone })
  const compact = variant === 'menu'
  const iconSize = compact ? 15 : 17

  const headingCls = compact
    ? 'flex items-center gap-2 px-3 pb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400'
    : 'flex items-center gap-1.5 px-2 pb-2 text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-slate-500'
  const buttonCls = compact
    ? 'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-white/10'
    : 'flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-white/10'
  const staticCls = compact
    ? 'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-gray-400 dark:text-slate-500'
    : 'flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-gray-400 dark:text-slate-500'

  return (
    <div>
      <p className={headingCls}><Bell size={compact ? 13 : 12} /> Notifications</p>
      {rowState === 'ios-needs-install' ? (
        <div className={cn(staticCls, 'bg-gray-50 dark:bg-white/5')}>
          <BellOff size={iconSize} className="flex-shrink-0" />
          <span>{compact ? 'Add to Home Screen to enable' : 'On iPhone/iPad: tap Share → Add to Home Screen, then open Code Clinic from there to enable notifications.'}</span>
        </div>
      ) : rowState === 'unsupported' ? (
        <div className={staticCls}>
          <BellOff size={iconSize} /> Not supported on this browser
        </div>
      ) : rowState === 'denied' ? (
        <div className={cn(staticCls, 'bg-gray-50 dark:bg-white/5')}>
          <BellOff size={iconSize} className="flex-shrink-0" />
          <span>{compact ? 'Notifications blocked' : 'Blocked — enable notifications for Code Clinic in your browser settings to turn this back on.'}</span>
        </div>
      ) : rowState === 'subscribed' ? (
        <>
          <button onClick={disable} disabled={busy} className={buttonCls}>
            <BellRing size={iconSize} className="text-emerald-500" /> {compact ? 'Notifications enabled' : 'Notifications enabled — tap to disable'}
          </button>
          {isAdmin && (
            <button onClick={sendTest} disabled={testStatus === 'sending'} className={buttonCls}>
              <Bell size={iconSize} />
              {testStatus === 'sending' ? 'Sending test…'
                : testStatus === 'sent' ? 'Test sent — check your device'
                : testStatus === 'error' ? 'Test failed — try again'
                : 'Send test notification'}
            </button>
          )}
        </>
      ) : (
        <button onClick={enable} disabled={busy} className={buttonCls}>
          <Bell size={iconSize} /> {compact ? 'Enable Notifications' : 'Enable notifications'}
        </button>
      )}
    </div>
  )
}
