'use client'

import Sidebar from '@/components/layout/Sidebar'
import TopBar from '@/components/layout/TopBar'
import SarahChatbot from '@/components/SarahChatbot'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

const pageTitles: Record<string, string> = {
  '/dashboard':              'Dashboard',
  '/scheduling':             'Appointments',
  '/patients':               'Patients',
  '/treatments':             'Treatments',
  '/stocks':                 'Stocks',
  '/employees':              'Staff List',
  '/accounts':               'Accounts',
  '/accounts/dashboard':     'Accounts',
  '/accounts/invoices':      'Sales',
  '/accounts/expenses':      'Expenses',
  '/accounts/payroll':       'Payroll',
  '/accounts/reports':       'Reports',
  '/ai-suite':               'AI Suite',
  '/ai-suite/voice-studio':  'Voice Studio',
  '/ai-suite/recordings':    'Call Recordings',
  '/ai-suite/knowledge-base':'Knowledge Base',
  '/ai-suite/agent-config':  'Agent Config',
  '/campaigns':              'Campaigns',
  '/crm/leads':              'CRM — Leads',
  '/crm/quizzes':            'Quizzes',
  '/crm/qr':                 'QR Capture',
  '/crm/website-visitors':   'Website Visitors',
  '/settings':               'Settings',
  '/support':                'Customer Support',
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router   = useRouter()
  const [user, setUser] = useState<any>(null)
  const [dark, setDark] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem('cc_user')
    if (!stored) { router.push('/login'); return }
    const u = JSON.parse(stored)
    if (u.role === 'RECEPTIONIST') { router.replace('/receptionist/dashboard'); return }
    setUser(u)

    // Apply dark/light mode
    const isDark = localStorage.getItem('cc_theme') === 'dark'
    setDark(isDark)
    document.documentElement.classList.toggle('dark', isDark)
  }, [])

  // Listen for theme changes dispatched by TopBar
  useEffect(() => {
    function onTheme(e: Event) {
      const isDark = (e as CustomEvent).detail === 'dark'
      setDark(isDark)
    }
    window.addEventListener('cc-theme', onTheme)
    return () => window.removeEventListener('cc-theme', onTheme)
  }, [])

  const title = pageTitles[pathname] || 'Dashboard'

  return (
    <div className={`flex h-screen overflow-hidden transition-colors duration-300 ${dark ? 'bg-gray-950' : 'bg-clinic-bg'}`}>
      <Sidebar role={user?.role} dark={dark} />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <TopBar title={title} user={user} dark={dark} onThemeToggle={(d) => setDark(d)} />
        <main className={`flex-1 overflow-y-auto p-6 transition-colors duration-300 ${dark ? 'bg-gray-950' : ''}`}>
          {children}
        </main>
      </div>
      <SarahChatbot />
    </div>
  )
}
