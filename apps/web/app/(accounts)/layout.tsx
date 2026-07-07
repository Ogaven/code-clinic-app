'use client'

import Sidebar from '@/components/layout/Sidebar'
import TopBar from '@/components/layout/TopBar'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Menu, X } from 'lucide-react'

const pageTitles: Record<string, string> = {
  '/accounts/dashboard':          'Dashboard',
  '/accounts/chart-of-accounts':  'Chart of Accounts',
  '/accounts/invoices':           'Sales & Income',
  '/accounts/expenses':           'Expenses',
  '/accounts/reconciliation':     'Bank Reconciliation',
  '/accounts/journal':            'Journal Entries',
  '/accounts/ledger':             'General Ledger',
  '/accounts/live-checkout':      'Live Checkout',
  '/accounts/receivables':        'Patient Balances',
  '/accounts/bills':              'Bills',
  '/accounts/payables':           'Supplier Balances',
  '/accounts/reports/pl':         'Profit & Loss',
  '/accounts/reports/balance':    'Balance Sheet',
  '/accounts/reports/cashflow':   'Cash Flow',
  '/accounts/reports/tax':        'Tax Report',
  '/accounts/reports/monthly':    'Monthly Summary',
  '/accounts/reports/annual':     'Annual Summary',
  '/accounts/payroll':            'Salary Expenses',
  '/accounts/payroll/staff':      'Staff Records',
  '/stocks':                      'Stocks & Inventory',
  '/settings':                    'Settings',
  '/support':                     'Support',
  '/ai-suite':                    'Agent Control',
  '/ai-suite/inbox':              'Inbox',
  '/ai-suite/calls':              'Call Logs',
  '/ai-suite/voice-studio':       'Voice Studio',
  '/ai-suite/knowledge-base':     'Knowledge Base',
  '/ai-suite/settings':           'AI Settings',
}

export default function AccountsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router   = useRouter()
  const [user, setUser]      = useState<any>(null)
  const [dark, setDark]      = useState(false)
  const [mobileOpen, setMob] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem('cc_user')
    if (!stored) { router.push('/login'); return }
    const u = JSON.parse(stored)
    if (u.role !== 'ACCOUNTS' && u.role !== 'ADMIN') {
      router.replace('/login'); return
    }
    setUser(u)
    const isDark = localStorage.getItem('cc_theme') === 'dark'
    setDark(isDark)
    document.documentElement.classList.toggle('dark', isDark)
  }, [])

  useEffect(() => {
    function onTheme(e: Event) { setDark((e as CustomEvent).detail === 'dark') }
    window.addEventListener('cc-theme', onTheme)
    return () => window.removeEventListener('cc-theme', onTheme)
  }, [])

  useEffect(() => { setMob(false) }, [pathname])

  const title = pageTitles[pathname]
    || Object.entries(pageTitles).find(([k]) => pathname.startsWith(k + '/'))?.[1]
    || 'Accounts'

  return (
    <div className={`flex h-screen overflow-hidden transition-colors duration-300 ${dark ? 'bg-transparent' : 'bg-clinic-bg'}`}>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setMob(false)} />
          <div className="absolute left-0 top-0 h-full z-50">
            <Sidebar role="ACCOUNTS" dark={dark} />
          </div>
          <button onClick={() => setMob(false)}
            className="absolute top-4 right-4 z-50 w-9 h-9 bg-white/10 rounded-xl flex items-center justify-center">
            <X size={18} color="white" />
          </button>
        </div>
      )}

      <div className="hidden lg:block">
        <Sidebar role="ACCOUNTS" dark={dark} />
      </div>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="flex lg:hidden items-center gap-3 px-4 h-14 border-b flex-shrink-0"
          style={{ background: dark ? 'rgba(10,18,60,0.95)' : 'white', borderColor: dark ? 'rgba(255,255,255,0.08)' : '#E5E7EB' }}>
          <button onClick={() => setMob(true)}
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: dark ? 'rgba(255,255,255,0.08)' : '#F3F4F6' }}>
            <Menu size={18} color={dark ? '#C8D8F0' : '#1A237E'} />
          </button>
          <span className="font-bold text-sm flex-1" style={{ color: dark ? '#E0E8FF' : '#1A237E', fontFamily: 'Plus Jakarta Sans' }}>
            {title}
          </span>
          {user?.avatarUrl ? (
            <img src={user.avatarUrl} alt="" className="w-8 h-8 rounded-xl object-cover flex-shrink-0" />
          ) : (
            <div className="w-8 h-8 rounded-xl flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0"
              style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
              {user ? `${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}` : 'A'}
            </div>
          )}
        </div>

        <div className="hidden lg:block">
          <TopBar title={title} user={user} dark={dark} onThemeToggle={(d) => setDark(d)} />
        </div>

        <main className={`flex-1 overflow-y-auto p-4 lg:p-6 transition-colors duration-300 ${dark ? 'bg-transparent' : ''}`}>
          {children}
        </main>
      </div>
    </div>
  )
}
