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

  useEffect(() => {
    const hasNotificationApi = typeof window !== 'undefined' && 'Notification' in window
    const hasPushApi = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window
    setSupported(hasNotificationApi && hasPushApi)
    if (hasNotificationApi) setPermission(Notification.permission)
    isPushSubscribed().then(setSubscribed)
  }, [])

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

  const rowState = getNotificationRowState({ supported, permission, subscribed })
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
      {rowState === 'unsupported' ? (
        <div className={staticCls}>
          <BellOff size={iconSize} /> Not supported on this browser
        </div>
      ) : rowState === 'denied' ? (
        <div className={cn(staticCls, 'bg-gray-50 dark:bg-white/5')}>
          <BellOff size={iconSize} className="flex-shrink-0" />
          <span>{compact ? 'Notifications blocked' : 'Blocked — enable notifications for Code Clinic in your browser settings to turn this back on.'}</span>
        </div>
      ) : rowState === 'subscribed' ? (
        <button onClick={disable} disabled={busy} className={buttonCls}>
          <BellRing size={iconSize} className="text-emerald-500" /> {compact ? 'Notifications enabled' : 'Notifications enabled — tap to disable'}
        </button>
      ) : (
        <button onClick={enable} disabled={busy} className={buttonCls}>
          <Bell size={iconSize} /> {compact ? 'Enable Notifications' : 'Enable notifications'}
        </button>
      )}
    </div>
  )
}
