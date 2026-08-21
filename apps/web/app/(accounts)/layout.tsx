'use client'

import TopBar from '@/components/layout/TopBar'
import { AppTheme, applyTheme, readTheme } from '@/lib/theme'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

const pageTitles: Record<string, string> = {
  '/accounts/dashboard': 'Accounts', '/accounts/chart-of-accounts': 'Chart of Accounts', '/accounts/invoices': 'Sales & Income',
  '/accounts/expenses': 'Expenses', '/accounts/reconciliation': 'Bank Reconciliation', '/accounts/journal': 'Journal Entries',
  '/accounts/ledger': 'General Ledger', '/accounts/live-checkout': 'Live Checkout', '/accounts/receivables': 'Patient Balances',
  '/accounts/bills': 'Bills', '/accounts/payables': 'Supplier Balances', '/accounts/reports': 'Finance Reports',
  '/accounts/payroll': 'Payroll',
}

export default function AccountsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [theme, setTheme] = useState<AppTheme>('system')
  const [dark, setDark] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem('cc_user')
    if (!stored) { router.push('/login'); return }
    const current = JSON.parse(stored)
    if (current.role !== 'ACCOUNTS' && current.role !== 'ADMIN') { router.replace('/login'); return }
    setUser(current)
    const saved = readTheme(); setTheme(saved); setDark(applyTheme(saved))
    const token = localStorage.getItem('cc_token')
    if (token) fetch('/api-proxy/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then(response => response.ok ? response.json() : null).then(data => {
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

  const title = pageTitles[pathname] || Object.entries(pageTitles).find(([key]) => pathname.startsWith(key + '/'))?.[1] || 'Accounts'
  return <div className={dark ? 'flex h-screen flex-col overflow-hidden bg-transparent' : 'flex h-screen flex-col overflow-hidden bg-clinic-bg'}>
    <TopBar title={title} user={user} theme={theme} onThemeChange={(next, isDark) => { setTheme(next); setDark(isDark) }} />
    <main className="flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>
  </div>
}
