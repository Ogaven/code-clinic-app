'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import DoctorTopBar from '@/components/layout/DoctorTopBar'
import DoctorChatbot from '@/components/DoctorSarahChatbot'
import { AppTheme, applyTheme, readTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { questrial } from '../fonts/questrial'
import MobileHeader from '@/components/mobile/MobileHeader'
import MobileBottomNav from '@/components/mobile/MobileBottomNav'
import MobileProfileSheet from '@/components/mobile/MobileProfileSheet'
import { usePwaInstall } from '@/lib/pwaInstall'

async function fetchLivePerms(token: string): Promise<Record<string, boolean>> {
  try {
    const res = await fetch('/api-proxy/staff/permissions/me', { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) return await res.json()
  } catch {}
  return {}
}

export default function DoctorLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [theme, setTheme] = useState<AppTheme>('system')
  const [user, setUser] = useState<any>(null)
  const [permsMap, setPermsMap] = useState<Record<string, boolean>>({})
  const [profileOpen, setProfileOpen] = useState(false)
  // Mounted here (always-on for the session), not inside MobileProfileSheet
  // (which only mounts when opened) — beforeinstallprompt fires once, early,
  // and a listener attached late would miss it.
  const pwaInstall = usePwaInstall()

  useEffect(() => {
    const savedTheme = readTheme()
    setTheme(savedTheme)
    applyTheme(savedTheme)

    const token = localStorage.getItem('cc_token')
    const current = JSON.parse(localStorage.getItem('cc_user') || '{}')
    if (!token || current.role !== 'DOCTOR') {
      router.replace('/login')
      return
    }
    setUser(current)
    fetchLivePerms(token).then(setPermsMap)

    fetch('/api-proxy/doctors/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((doctor) => setUser((previous: any) => ({ ...previous, ...doctor?.user, avatarUrl: doctor?.photoUrl || doctor?.user?.avatarUrl || previous?.avatarUrl })))
      .catch(() => undefined)
      .finally(() => setReady(true))
  }, [router])

  function signOut() {
    localStorage.removeItem('cc_token'); localStorage.removeItem('cc_user')
    document.cookie = 'cc_token=; path=/; max-age=0'
    router.push('/login')
  }

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  return (
    <div
      className={cn(questrial.variable, 'min-h-screen bg-background text-foreground')}
      style={{ fontFamily: 'var(--font-questrial)', letterSpacing: '.006em', lineHeight: 1.55 }}
    >
      <div className="hidden xl:block">
        <DoctorTopBar user={user} theme={theme} onTheme={(next) => { setTheme(next); applyTheme(next) }} />
      </div>
      {user && (
        <MobileHeader
          homeHref="/doctor/dashboard"
          notificationsHref="/doctor/notifications"
          user={user}
          onProfileClick={() => setProfileOpen(true)}
          searchEndpoint="/api-proxy/patients"
          onSelectPatient={id => router.push(`/doctor/patients/${id}`)}
        />
      )}
      <main className="mx-auto w-full max-w-[1600px] px-4 pb-24 pt-5 sm:px-6 lg:px-8 lg:pb-8">
        {children}
      </main>
      <MobileBottomNav role="DOCTOR" perms={permsMap} />
      {profileOpen && user && (
        <MobileProfileSheet
          user={user}
          theme={theme}
          onThemeChange={(next) => { setTheme(next); applyTheme(next) }}
          profileHref="/doctor/profile"
          onClose={() => setProfileOpen(false)}
          onSignOut={signOut}
          install={pwaInstall}
        />
      )}
      <DoctorChatbot />
    </div>
  )
}
