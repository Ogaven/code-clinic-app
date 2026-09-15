'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { User, Palette, Download, LogOut, X, Sun, Moon, Monitor, Check } from 'lucide-react'
import { cn, getInitials } from '@/lib/utils'
import { AppTheme, saveTheme } from '@/lib/theme'
import type { PwaInstallState } from '@/lib/pwaInstall'
import NotificationSettingsRow from '@/components/shared/NotificationSettingsRow'
import IOSInstallInstructions from '@/components/shared/IOSInstallInstructions'

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
  // menu only mounts when the user opens it. If the hook lived here, its
  // listener would attach too late to ever catch a real browser event that
  // already fired before the user's first tap on the profile avatar.
  install: PwaInstallState
  // Bounding-rect source for anchoring this as a small popover directly
  // under the header's profile avatar — a normal mobile account menu, not a
  // sheet that covers most of the phone. Mirrors the desktop ProfileMenu's
  // small-anchored-dropdown pattern.
  anchorRef: React.RefObject<HTMLButtonElement>
}

export default function MobileProfileSheet({ user, theme, onThemeChange, profileHref, onClose, onSignOut, install, anchorRef }: MobileProfileSheetProps) {
  const router = useRouter()
  const menuRef = useRef<HTMLDivElement>(null)
  const [showInstallHelp, setShowInstallHelp] = useState(false)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)

  useLayoutEffect(() => {
    function place() {
      const rect = anchorRef.current?.getBoundingClientRect()
      if (rect) setPos({ top: rect.bottom + 8, right: Math.max(8, window.innerWidth - rect.right) })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [anchorRef])

  useEffect(() => {
    menuRef.current?.focus()
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
    <div className="xl:hidden fixed inset-0 z-[150]" onMouseDown={onClose}>
      <div
        ref={menuRef}
        tabIndex={-1}
        role="menu"
        aria-label="Account menu"
        className="absolute w-[264px] max-w-[calc(100vw-16px)] overflow-hidden rounded-2xl border border-gray-200/70 bg-white shadow-2xl outline-none animate-fade-in dark:border-white/10 dark:bg-[#0a1730]"
        style={{ top: pos?.top ?? 64, right: pos?.right ?? 8, visibility: pos ? 'visible' : 'hidden' }}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-gray-100 px-3.5 py-3 dark:border-white/8">
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt="" className="h-9 w-9 flex-shrink-0 rounded-full object-cover" />
          ) : (
            <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-full bg-gradient-to-br from-clinic-navy to-clinic-blue text-xs font-bold text-white">{initials}</span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-gray-900 dark:text-white">{user.firstName} {user.lastName}</p>
            <p className="truncate text-[11px] text-gray-400 dark:text-slate-500">
              {roleLabels[user.role] || user.role}{user.email ? ` · ${user.email}` : ''}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-full text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10">
            <X size={14} />
          </button>
        </div>

        <div className="py-1">
          <MenuRow icon={User} label="My Profile" onClick={() => navigate(profileHref)} />
        </div>

        <div className="border-t border-gray-100 px-3.5 py-2 dark:border-white/8">
          <p className="flex items-center gap-1.5 pb-1.5 text-[9px] font-bold uppercase tracking-wide text-gray-400 dark:text-slate-500">
            <Palette size={11} /> Appearance
          </p>
          <div className="grid grid-cols-3 gap-1">
            {([['light', Sun], ['dark', Moon], ['system', Monitor]] as const).map(([value, Icon]) => (
              <button
                key={value}
                onClick={() => chooseTheme(value)}
                className={cn(
                  'flex flex-col items-center gap-0.5 rounded-lg py-1.5 text-[10px] font-semibold capitalize text-gray-500 dark:text-slate-400',
                  theme === value ? 'bg-cyan-50 text-cyan-700 dark:bg-cyan-400/10 dark:text-cyan-300' : 'hover:bg-gray-50 dark:hover:bg-white/5',
                )}
              >
                <span className="relative"><Icon size={14} />{theme === value && <Check size={8} className="absolute -right-2 -top-1" />}</span>
                {value}
              </button>
            ))}
          </div>
        </div>

        <div className="border-t border-gray-100 py-1 dark:border-white/8">
          <NotificationSettingsRow variant="menu" />
        </div>

        <div className="border-t border-gray-100 py-1 dark:border-white/8">
          {showInstall && (
            <MenuRow
              icon={Download}
              label="Install App"
              onClick={async () => {
                if (install.isIOS) { setShowInstallHelp(true); return }
                await install.promptInstall()
              }}
            />
          )}
          <MenuRow icon={LogOut} label="Sign Out" tone="danger" onClick={onSignOut} />
        </div>
      </div>

      {showInstallHelp && <IOSInstallInstructions onClose={() => setShowInstallHelp(false)} />}
    </div>
  )
}

function MenuRow({ icon: Icon, label, onClick, tone }: { icon: any; label: string; onClick: () => void; tone?: 'danger' }) {
  return (
    <button
      onClick={onClick}
      role="menuitem"
      className={cn(
        'flex w-full items-center gap-2.5 px-3.5 py-2 text-[13px] font-semibold transition-colors',
        tone === 'danger' ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10' : 'text-gray-700 hover:bg-gray-100 dark:text-slate-200 dark:hover:bg-white/10',
      )}
    >
      <Icon size={15} /> {label}
    </button>
  )
}
