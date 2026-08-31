'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import DoctorTopBar from '@/components/layout/DoctorTopBar'
import DoctorChatbot from '@/components/DoctorSarahChatbot'
import { AppTheme, applyTheme, readTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { questrial } from '../fonts/questrial'

export default function DoctorLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [theme, setTheme] = useState<AppTheme>('system')
  const [user, setUser] = useState<any>(null)

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

    fetch('/api-proxy/doctors/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((doctor) => setUser((previous: any) => ({ ...previous, ...doctor?.user, avatarUrl: doctor?.photoUrl || doctor?.user?.avatarUrl || previous?.avatarUrl })))
      .catch(() => undefined)
      .finally(() => setReady(true))
  }, [router])

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
      <DoctorTopBar user={user} theme={theme} onTheme={(next) => { setTheme(next); applyTheme(next) }} />
      <main className="mx-auto w-full max-w-[1600px] px-4 pb-24 pt-5 sm:px-6 lg:px-8 lg:pb-8">
        {children}
      </main>
      <DoctorChatbot />
    </div>
  )
}
