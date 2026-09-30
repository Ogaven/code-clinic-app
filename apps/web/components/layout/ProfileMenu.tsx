'use client'

// Shared desktop profile dropdown — one implementation used by Admin
// (TopBar.tsx), Doctor (DoctorTopBar.tsx), and Receptionist
// (ReceptionistTopBar.tsx) so the three roles can't drift out of sync again.
// Mirrors components/mobile/MobileProfileSheet.tsx's sections (My Profile,
// Appearance, Notifications, Install App, Sign Out) but as a small anchored
// dropdown card rather than a full sheet.

import { useState } from 'react'
import { User, Settings as SettingsIcon, Palette, Download, LogOut, Sun, Moon, Monitor, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AppTheme } from '@/lib/theme'
import type { PwaInstallState } from '@/lib/pwaInstall'
import NotificationSettingsRow from '@/components/shared/NotificationSettingsRow'
import IOSInstallInstructions from '@/components/shared/IOSInstallInstructions'

const roleLabels: Record<string, string> = {
  ADMIN: 'Administrator', ACCOUNTS: 'Accounts', DOCTOR: 'Doctor', RECEPTIONIST: 'Receptionist', DEVELOPER: 'Developer',
}

export interface ProfileMenuUser {
  firstName: string
  lastName: string
  role: string
  avatarUrl?: string | null
}

export interface ProfileMenuExtraItem {
  icon: any
  label: string
  onClick: () => void
}

// Safe default when a caller (e.g. the Accounts layout, which reuses
// TopBar.tsx but doesn't call usePwaInstall()) doesn't pass one — renders
// with the Install App item simply hidden, same as before this menu existed.
const NO_INSTALL: PwaInstallState = {
  canInstallNative: false,
  isIOS: false,
  isStandalone: false,
  promptInstall: async () => 'unavailable',
}

interface ProfileMenuProps {
  user: ProfileMenuUser
  theme: AppTheme
  onTheme: (theme: AppTheme) => void
  profileHref: string
  settingsHref?: string
  onNavigate: (href: string) => void
  onSignOut: () => void
  install?: PwaInstallState
  /** Optional role-specific extras rendered above Sign Out (e.g. Receptionist's "Get Help"). */
  extraItems?: ProfileMenuExtraItem[]
}

export default function ProfileMenu({
  user, theme, onTheme, profileHref, settingsHref, onNavigate, onSignOut, install = NO_INSTALL, extraItems,
}: ProfileMenuProps) {
  const [showInstallHelp, setShowInstallHelp] = useState(false)

  // Same rule as the mobile sheet: only show a real, invokable install path —
  // Chromium once beforeinstallprompt has actually fired, or iOS/iPadOS
  // (Add to Home Screen always works there) — never a dead button.
  const showInstall = !install.isStandalone && (install.canInstallNative || install.isIOS)

  return (
    <div className="fixed right-4 top-[70px] z-[101] w-64 overflow-hidden rounded-2xl border border-gray-200 bg-white p-2 shadow-2xl dark:border-white/10 dark:bg-[#0c1b38]">
      <div className="px-3 py-2">
        <p className="text-sm font-semibold text-gray-900 dark:text-white">{user.firstName} {user.lastName}</p>
        <p className="text-[11px] text-gray-400">{roleLabels[user.role] || user.role}</p>
      </div>

      <button onClick={() => onNavigate(profileHref)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-100 dark:text-slate-200 dark:hover:bg-white/10">
        <User size={15} /> My Profile
      </button>
      {settingsHref && (
        <button onClick={() => onNavigate(settingsHref)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-100 dark:text-slate-200 dark:hover:bg-white/10">
          <SettingsIcon size={15} /> Settings
        </button>
      )}

      <div className="my-1 border-t border-gray-100 pt-2 dark:border-white/10">
        <p className="flex items-center gap-2 px-3 pb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
          <Palette size={13} /> Appearance
        </p>
        <div className="grid grid-cols-3 gap-1">
          {([['light', Sun], ['dark', Moon], ['system', Monitor]] as const).map(([value, Icon]) => (
            <button
              key={value}
              onClick={() => onTheme(value)}
              className={cn(
                'flex flex-col items-center gap-1 rounded-xl px-1 py-2 text-[10px] capitalize text-gray-500 hover:bg-gray-100 dark:text-slate-400 dark:hover:bg-white/10',
                theme === value && 'bg-cyan-50 font-semibold text-cyan-700 dark:bg-cyan-400/10 dark:text-cyan-300',
              )}
            >
              <span className="relative"><Icon size={15} />{theme === value && <Check size={8} className="absolute -right-2 -top-1" />}</span>
              {value}
            </button>
          ))}
        </div>
      </div>

      <div className="my-1 border-t border-gray-100 pt-2 dark:border-white/10">
        <NotificationSettingsRow variant="menu" />
      </div>

      <div className="my-1 border-t border-gray-100 pt-2 dark:border-white/10">
        {showInstall ? (
          <button
            onClick={async () => {
              if (install.isIOS) { setShowInstallHelp(true); return }
              await install.promptInstall()
            }}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-100 dark:text-slate-200 dark:hover:bg-white/10"
          >
            <Download size={15} /> Install App
          </button>
        ) : install.isStandalone ? (
          <div className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-gray-400 dark:text-slate-500">
            <Download size={15} /> App installed
          </div>
        ) : null}

        {extraItems?.map(item => (
          <button
            key={item.label}
            onClick={item.onClick}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-100 dark:text-slate-200 dark:hover:bg-white/10"
          >
            <item.icon size={15} /> {item.label}
          </button>
        ))}
      </div>

      <div className="my-1 border-t border-gray-100 dark:border-white/10" />
      <button onClick={onSignOut} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10">
        <LogOut size={15} /> Sign Out
      </button>

      {showInstallHelp && <IOSInstallInstructions onClose={() => setShowInstallHelp(false)} />}
    </div>
  )
}
