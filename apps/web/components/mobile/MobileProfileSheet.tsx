'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  User, Palette, Bell, Download, LogOut, X, Sun, Moon, Monitor, Check,
  BellOff, BellRing, Share, PlusSquare,
} from 'lucide-react'
import { cn, getInitials } from '@/lib/utils'
import { AppTheme, saveTheme } from '@/lib/theme'
import { subscribeToPush, unsubscribeFromPush, isPushSubscribed } from '@/lib/push'
import type { PwaInstallState } from '@/lib/pwaInstall'
import { getNotificationRowState } from '@/lib/notificationRowState'

const roleLabels: Record<string, string> = {
  ADMIN: 'Administrator', ACCOUNTS: 'Accounts', DOCTOR: 'Doctor', RECEPTIONIST: 'Receptionist', DEVELOPER: 'Developer',
}

export interface MobileProfileUser {
  firstName: string
  lastName: string
  role: string
  email?: string
  avatarUrl?: string | null
}

interface MobileProfileSheetProps {
  user: MobileProfileUser
  theme: AppTheme
  onThemeChange: (theme: AppTheme, dark: boolean) => void
  profileHref: string
  onClose: () => void
  onSignOut: () => void
  // Lifted from a hook call here to a persistent, always-mounted ancestor
  // (the role layout) — beforeinstallprompt fires once, early, and this
  // sheet only mounts when the user opens it. If the hook lived here, its
  // listener would attach too late to ever catch a real browser event that
  // already fired before the user's first tap on the profile avatar.
  install: PwaInstallState
}

export default function MobileProfileSheet({ user, theme, onThemeChange, profileHref, onClose, onSignOut, install }: MobileProfileSheetProps) {
  const router = useRouter()
  const sheetRef = useRef<HTMLDivElement>(null)
  const [showInstallHelp, setShowInstallHelp] = useState(false)

  useEffect(() => {
    sheetRef.current?.focus()
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function chooseTheme(next: AppTheme) {
    const dark = saveTheme(next)
    onThemeChange(next, dark)
  }

  function navigate(href: string) {
    router.push(href)
    onClose()
  }

  const initials = getInitials(user.firstName, user.lastName)
  // "Valid installation path" per spec: Chromium platforms only once the
  // browser has actually fired beforeinstallprompt (nothing to invoke before
  // that — never show a dead button), or any iOS/iPadOS browser (Add to
  // Home Screen always works there). Hidden entirely once already installed.
  const showInstall = !install.isStandalone && (install.canInstallNative || install.isIOS)

  return (
    <div className="xl:hidden fixed inset-0 z-[150] flex items-end justify-center bg-slate-950/45 backdrop-blur-sm sm:items-center" onMouseDown={onClose}>
      <div
        ref={sheetRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Profile"
        className="w-full max-w-sm overflow-hidden rounded-t-[28px] border-t border-gray-200/70 bg-white shadow-2xl outline-none animate-fade-in dark:border-white/10 dark:bg-[#0a1730] sm:rounded-[28px] sm:border"
        style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))', maxHeight: '85vh', overflowY: 'auto' }}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="relative flex items-center justify-center border-b border-gray-100 px-5 py-4 dark:border-white/8">
          <span className="absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-full bg-gray-200 dark:bg-white/15 sm:hidden" aria-hidden />
          <button onClick={onClose} aria-label="Close" className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10">
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-col items-center gap-2 px-6 py-5 text-center">
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt="" className="h-16 w-16 rounded-full object-cover" />
          ) : (
            <span className="grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-clinic-navy to-clinic-blue text-lg font-bold text-white">{initials}</span>
          )}
          <p className="text-base font-bold text-gray-900 dark:text-white">{user.firstName} {user.lastName}</p>
          <p className="text-xs font-semibold text-cyan-600 dark:text-cyan-400">{roleLabels[user.role] || user.role}</p>
          {user.email && <p className="text-xs text-gray-400 dark:text-slate-500">{user.email}</p>}
        </div>

        <div className="space-y-1 px-3 pb-2">
          <SheetButton icon={User} label="My Profile" onClick={() => navigate(profileHref)} />
        </div>

        <div className="border-t border-gray-100 px-3 py-3 dark:border-white/8">
          <p className="flex items-center gap-1.5 px-2 pb-2 text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-slate-500">
            <Palette size={12} /> Appearance
          </p>
          <div className="grid grid-cols-3 gap-1.5 px-1">
            {([['light', Sun], ['dark', Moon], ['system', Monitor]] as const).map(([value, Icon]) => (
              <button
                key={value}
                onClick={() => chooseTheme(value)}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-xl py-2.5 text-[11px] font-semibold capitalize text-gray-500 dark:text-slate-400',
                  theme === value ? 'bg-cyan-50 text-cyan-700 dark:bg-cyan-400/10 dark:text-cyan-300' : 'hover:bg-gray-50 dark:hover:bg-white/5',
                )}
              >
                <span className="relative"><Icon size={17} />{theme === value && <Check size={9} className="absolute -right-2.5 -top-1" />}</span>
                {value}
              </button>
            ))}
          </div>
        </div>

        <div className="border-t border-gray-100 px-3 py-3 dark:border-white/8">
          <NotificationSettingsRow />
        </div>

        <div className="space-y-1 border-t border-gray-100 px-3 py-2 dark:border-white/8">
          {showInstall && (
            <SheetButton
              icon={Download}
              label="Install App"
              onClick={async () => {
                if (install.isIOS) { setShowInstallHelp(true); return }
                await install.promptInstall()
              }}
            />
          )}
          <SheetButton icon={LogOut} label="Sign Out" tone="danger" onClick={onSignOut} />
        </div>
      </div>

      {showInstallHelp && <IOSInstallInstructions onClose={() => setShowInstallHelp(false)} />}
    </div>
  )
}

function SheetButton({ icon: Icon, label, onClick, tone }: { icon: any; label: string; onClick: () => void; tone?: 'danger' }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold transition-colors',
        tone === 'danger' ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10' : 'text-gray-700 hover:bg-gray-100 dark:text-slate-200 dark:hover:bg-white/10',
      )}
    >
      <Icon size={17} /> {label}
    </button>
  )
}

// Never auto-prompts — Notification.requestPermission() is only ever called
// from inside subscribeToPush(), which this row invokes solely on tap.
function NotificationSettingsRow() {
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

  return (
    <div>
      <p className="flex items-center gap-1.5 px-2 pb-2 text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-slate-500">
        <Bell size={12} /> Notifications
      </p>
      {rowState === 'unsupported' ? (
        <div className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-gray-400 dark:text-slate-500">
          <BellOff size={17} /> Not supported on this browser
        </div>
      ) : rowState === 'denied' ? (
        <div className="flex items-center gap-3 rounded-xl bg-gray-50 px-3 py-3 text-sm text-gray-500 dark:bg-white/5 dark:text-slate-400">
          <BellOff size={17} className="flex-shrink-0" />
          <span>Blocked — enable notifications for Code Clinic in your browser settings to turn this back on.</span>
        </div>
      ) : rowState === 'subscribed' ? (
        <button onClick={disable} disabled={busy} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-white/10">
          <BellRing size={17} className="text-emerald-500" /> Notifications enabled — tap to disable
        </button>
      ) : (
        <button onClick={enable} disabled={busy} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-white/10">
          <Bell size={17} /> Enable notifications
        </button>
      )}
    </div>
  )
}

// iOS/iPadOS has no beforeinstallprompt — this is the honest, real
// instruction flow for Safari's Add to Home Screen mechanism. The profile
// action itself is always labelled "Install App"; only this explanatory
// sheet mentions the underlying Share-menu steps.
function IOSInstallInstructions({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[160] flex items-end justify-center bg-slate-950/55 backdrop-blur-sm sm:items-center" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Install Code Clinic"
        className="w-full max-w-sm overflow-hidden rounded-t-[28px] border-t border-gray-200/70 bg-white p-6 shadow-2xl animate-fade-in dark:border-white/10 dark:bg-[#0a1730] sm:rounded-[28px] sm:border"
        style={{ paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl" style={{ background: 'linear-gradient(135deg,#0c1e50,#29ABE2)' }}>
          <Download size={24} className="text-white" />
        </div>
        <h3 className="text-center text-lg font-black text-gray-800 dark:text-white">Install Code Clinic</h3>
        <p className="mt-1 text-center text-sm text-gray-500 dark:text-slate-400">To install Code Clinic on your device:</p>
        <ol className="mt-5 space-y-4">
          <InstallStep n={1} icon={Share}>Tap the <strong>Share</strong> icon in Safari</InstallStep>
          <InstallStep n={2} icon={PlusSquare}>Select <strong>Add to Home Screen</strong></InstallStep>
          <InstallStep n={3} icon={Check}>Tap <strong>Add</strong></InstallStep>
        </ol>
        <button onClick={onClose} className="mt-6 w-full rounded-2xl py-3 text-sm font-bold text-white" style={{ background: 'linear-gradient(135deg,#0c1e50,#29ABE2)' }}>
          Got it
        </button>
      </div>
    </div>
  )
}

function InstallStep({ n, icon: Icon, children }: { n: number; icon: any; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-full text-xs font-black text-white" style={{ background: 'linear-gradient(135deg,#0c1e50,#29ABE2)' }}>{n}</span>
      <span className="flex items-center gap-2 pt-0.5 text-sm text-gray-700 dark:text-slate-200">
        <Icon size={15} className="flex-shrink-0 text-gray-400" />
        {children}
      </span>
    </li>
  )
}