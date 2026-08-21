'use client'

import TopBar from '@/components/layout/TopBar'
import SarahChatbot from '@/components/SarahChatbot'
import { AppTheme, applyTheme, readTheme } from '@/lib/theme'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

const pageTitles: Record<string, string> = {
  '/dashboard': 'Overview', '/admin/dashboard': 'Overview', '/scheduling': 'Appointments', '/appointments': 'Appointments',
  '/patients': 'Patients', '/stocks': 'Stocks & Inventory', '/employees': 'Staff List', '/audit-log': 'Audit Log',
  '/admin/staff/permissions': 'Staff Permissions', '/accounts': 'Accounts', '/reports': 'Reports',
  '/reports/clinical': 'Daily / Weekly Reports', '/reports/patient-flow': 'Patient Live Flow',
  '/reports/case-acceptance': 'Case Acceptance', '/ai-suite': 'Agent Control', '/ai-suite/inbox': 'Conversations',
  '/ai-suite/escalations': 'Escalations', '/ai-suite/calls': 'Call Logs', '/ai-suite/voice-studio': 'Voice Studio',
  '/ai-suite/knowledge-base': 'Knowledge Base', '/ai-suite/settings': 'AI Settings', '/ai-suite/followup-dashboard': 'Follow-ups',
  '/ai-suite/confirmation-dashboard': 'Confirmations', '/ai-suite/analytics': 'Analytics & Costs', '/campaigns': 'Campaigns',
  '/leads': 'Leads', '/treatment-pipeline': 'Treatment Pipeline', '/referrals': 'Referrals', '/settings': 'Settings',
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [theme, setTheme] = useState<AppTheme>('system')
  const [dark, setDark] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem('cc_user')
    if (!stored) { router.push('/login'); return }
    const current = JSON.parse(stored)
    if (current.role === 'RECEPTIONIST') { router.replace('/receptionist/dashboard'); return }
    if (current.role === 'DOCTOR') { router.replace('/doctor/dashboard'); return }
    if (current.role === 'DEVELOPER') { router.replace('/developer/dashboard'); return }
    if (current.role === 'ACCOUNTS') {
      const allowed = ['/accounts', '/stocks', '/settings', '/support']
      if (!allowed.some(prefix => pathname === prefix || pathname.startsWith(prefix + '/'))) { router.replace('/accounts/dashboard'); return }
    }
    setUser(current)
    const saved = readTheme()
    setTheme(saved); setDark(applyTheme(saved))

    const token = localStorage.getItem('cc_token')
    if (token) fetch('/api-proxy/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then(response => response.ok ? response.json() : null)
      .then(data => {
        if (data?.avatarUrl !== undefined) {
          setUser((previous: any) => previous ? { ...previous, avatarUrl: data.avatarUrl } : previous)
          localStorage.setItem('cc_user', JSON.stringify({ ...current, avatarUrl: data.avatarUrl }))
        }
      }).catch(() => {})
  }, [])

  useEffect(() => {
    const onAvatar = (event: Event) => setUser((previous: any) => previous ? { ...previous, avatarUrl: (event as CustomEvent).detail } : previous)
    const onTheme = (event: Event) => { const next = (event as CustomEvent).detail as AppTheme; setTheme(next); setDark(applyTheme(next)) }
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onSystem = () => { if (readTheme() === 'system') setDark(applyTheme('system')) }
    window.addEventListener('cc-avatar-updated', onAvatar); window.addEventListener('cc-theme', onTheme); media.addEventListener('change', onSystem)
    return () => { window.removeEventListener('cc-avatar-updated', onAvatar); window.removeEventListener('cc-theme', onTheme); media.removeEventListener('change', onSystem) }
  }, [])

  const title = pageTitles[pathname] || (pathname.startsWith('/patients/') ? 'Patient Profile' : null)
    || Object.entries(pageTitles).find(([key]) => pathname.startsWith(key + '/'))?.[1] || 'Overview'

  return <div className={dark ? 'flex h-screen flex-col overflow-hidden bg-transparent' : 'flex h-screen flex-col overflow-hidden bg-clinic-bg'}>
    <TopBar title={title} user={user} theme={theme} onThemeChange={(next, isDark) => { setTheme(next); setDark(isDark) }} />
    <main className="flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>
    <SarahChatbot />
  </div>
}
