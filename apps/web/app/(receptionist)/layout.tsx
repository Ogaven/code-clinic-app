'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  LayoutDashboard, CalendarDays, Users, MessageSquare,
  Bot, BarChart2, Settings, HelpCircle, Bell, Search,
  ChevronLeft, ChevronRight, LogOut, User, Lock, Download,
  Sun, Moon, Monitor,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const nav = [
  { label: 'Dashboard',      href: '/receptionist/dashboard',      icon: LayoutDashboard },
  { label: 'Appointments',   href: '/receptionist/appointments',   icon: CalendarDays },
  { label: 'Patients',       href: '/receptionist/patients',        icon: Users },
  { label: 'Communications', href: '/receptionist/communications',  icon: MessageSquare, badge: true },
  { label: 'AI Suite',       href: '/receptionist/ai-suite',        icon: Bot },
  { label: 'Reports',        href: '/receptionist/reports',         icon: BarChart2 },
  { label: 'Download App',   href: '/receptionist/download',        icon: Download },
]

const navBottom = [
  { label: 'Settings', href: '/settings', icon: Settings },
  { label: 'Help',     href: '/support',  icon: HelpCircle },
]


type Theme = 'light' | 'dark' | 'system'

function applyTheme(t: Theme) {
  const root = document.documentElement
  if (t === 'dark') {
    root.classList.add('dark')
  } else if (t === 'light') {
    root.classList.remove('dark')
  } else {
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) root.classList.add('dark')
    else root.classList.remove('dark')
  }
}

export default function ReceptionistLayout({ children }: { children: React.ReactNode }) {
  const pathname  = usePathname()
  const router    = useRouter()
  const [user, setUser]         = useState<any>(null)
  const [collapsed, setCol]     = useState(false)
  const [showProfile, setProf]  = useState(false)
  const [unread, setUnread]     = useState(0)
  const [search, setSearch]     = useState('')
  const [searchResults, setSR]  = useState<any[]>([])
  const [searching, setSearcing]= useState(false)
  const [installPrompt, setInstallPrompt] = useState<any>(null)
  const [installed, setInstalled] = useState(false)
  const [theme, setTheme]       = useState<Theme>('system')
  const [showTheme, setShowTheme] = useState(false)

  const API = '/api-proxy'

  useEffect(() => {
    const stored = localStorage.getItem('cc_user')
    if (!stored) { router.push('/login'); return }
    const u = JSON.parse(stored)
    setUser(u)
    fetchUnread(u)
    const t = setInterval(() => fetchUnread(u), 15000)
    // Apply saved theme
    const savedTheme = (localStorage.getItem('cc_theme') as Theme) || 'system'
    setTheme(savedTheme)
    applyTheme(savedTheme)
    // Listen for system preference changes when in system mode
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onMqChange = () => { if ((localStorage.getItem('cc_theme') || 'system') === 'system') applyTheme('system') }
    mq.addEventListener('change', onMqChange)
    return () => { clearInterval(t); mq.removeEventListener('change', onMqChange) }
  }, [])

  const themeIcon = theme === 'dark' ? <Moon size={16} /> : theme === 'light' ? <Sun size={16} /> : <Monitor size={16} />
  const themeLabel = theme === 'dark' ? 'Dark' : theme === 'light' ? 'Light' : 'System'

  useEffect(() => {
    const handler = (e: Event) => { e.preventDefault(); setInstallPrompt(e) }
    window.addEventListener('beforeinstallprompt', handler)
    window.addEventListener('appinstalled', () => setInstalled(true))
    if (window.matchMedia('(display-mode: standalone)').matches) setInstalled(true)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  async function handleInstall() {
    if (!installPrompt) return
    installPrompt.prompt()
    const { outcome } = await installPrompt.userChoice
    if (outcome === 'accepted') setInstalled(true)
    setInstallPrompt(null)
  }

  async function fetchUnread(u: any) {
    try {
      const token = localStorage.getItem('cc_token')
      const res = await fetch(`${API}/receptionist/notifications`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setUnread(data.unread || 0)
      }
    } catch {}
  }

  async function handleSearch(q: string) {
    setSearch(q)
    if (q.length < 2) { setSR([]); return }
    setSearcing(true)
    try {
      const token = localStorage.getItem('cc_token')
      const res = await fetch(`${API}/patients?q=${encodeURIComponent(q)}&limit=5`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) { const j = await res.json(); setSR(Array.isArray(j) ? j : j.data || []) }
    } catch {} finally { setSearcing(false) }
  }

  function logout() {
    localStorage.removeItem('cc_token')
    localStorage.removeItem('cc_user')
    router.push('/login')
  }

  const initials = user ? `${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}` : 'R'

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 dark:bg-[#0b1630]">

      {/* ── Mobile sidebar overlay ────────────────────────────── */}
      {collapsed === false && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setCol(true)}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
        </div>
      )}

      {/* ── Sidebar ──────────────────────────────────────────── */}
      <aside
        className={cn(
          'flex flex-col h-screen flex-shrink-0 transition-all duration-300 z-50',
          'fixed lg:sticky top-0',
          collapsed ? '-translate-x-full lg:translate-x-0 w-[220px] lg:w-[64px]' : 'translate-x-0 w-[220px]',
        )}
        style={{
          background: 'linear-gradient(180deg, #0c1e50 0%, #0e2866 100%)',
          borderRight: '1px solid rgba(255,255,255,0.07)',
        }}
      >
        {/* Logo */}
        <Link href="/receptionist/dashboard"
          className={cn(
            'flex items-center transition-all duration-200 border-b border-white/8',
            collapsed ? 'justify-center px-2 py-3' : 'px-4 py-3 gap-2',
          )}
          style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}
        >
          {collapsed ? (
            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #29ABE2, #1A237E)' }}>
              <span className="text-white font-black text-[10px]">CC</span>
            </div>
          ) : (
            <Image src="/logo.png" alt="Code Clinic" width={105} height={32} className="object-contain brightness-0 invert" priority />
          )}
        </Link>


        {/* Nav items */}
        <nav className="flex-1 overflow-y-auto py-3 space-y-0.5 px-2">
          {nav.map((item) => {
            const Icon   = item.icon
            const active = pathname === item.href || pathname.startsWith(item.href + '/')
            return (
              <Link key={item.href} href={item.href}
                title={collapsed ? item.label : undefined}
                className={cn(
                  'relative flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all group',
                  collapsed && 'justify-center px-2',
                  active
                    ? 'bg-white/15 text-white'
                    : 'text-blue-200/60 hover:bg-white/8 hover:text-blue-100',
                )}
              >
                {active && (
                  <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-cyan-400" />
                )}
                <Icon size={17} className="flex-shrink-0" />
                {!collapsed && (
                  <span className="text-[13px] font-medium truncate">{item.label}</span>
                )}
                {!collapsed && item.badge && unread > 0 && (
                  <span className="ml-auto text-[9px] font-black bg-red-500 text-white rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
                {collapsed && (
                  <div className="absolute left-full ml-3 px-2.5 py-1.5 rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-all z-50 shadow-xl text-xs text-white bg-gray-900">
                    {item.label}
                    <span className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-gray-900" />
                  </div>
                )}
              </Link>
            )
          })}
        </nav>

        {/* Bottom nav */}
        <div className="px-2 pb-2 border-t border-white/8 pt-2 space-y-0.5">
          {navBottom.map((item) => {
            const Icon = item.icon
            return (
              <Link key={item.href} href={item.href}
                title={collapsed ? item.label : undefined}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-xl transition-all text-blue-200/50 hover:bg-white/8 hover:text-blue-100',
                  collapsed && 'justify-center px-2',
                )}
              >
                <Icon size={16} className="flex-shrink-0" />
                {!collapsed && <span className="text-[12px] font-medium">{item.label}</span>}
              </Link>
            )
          })}

          {/* Collapse toggle */}
          <button
            onClick={() => setCol(!collapsed)}
            className="w-full flex items-center justify-center px-3 py-2 rounded-xl text-blue-200/40 hover:bg-white/8 hover:text-blue-100 transition-all"
          >
            {collapsed ? <ChevronRight size={15} /> : (
              <div className="flex items-center gap-2 text-xs font-medium">
                <ChevronLeft size={15} />
                <span>Collapse</span>
              </div>
            )}
          </button>
        </div>
      </aside>

      {/* ── Main Area ────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden lg:ml-0">

        {/* Top bar */}
        <header className="h-14 flex items-center gap-3 px-4 bg-white dark:bg-[#0e1f4d] border-b border-gray-100 dark:border-white/8 flex-shrink-0 z-20">

          {/* Hamburger (mobile only) */}
          <button onClick={() => setCol(false)}
            className="lg:hidden w-9 h-9 rounded-xl flex items-center justify-center bg-gray-50 dark:bg-white/8 border border-gray-200 dark:border-white/10 flex-shrink-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1A237E" strokeWidth="2.5" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
          </button>

          {/* Search */}
          <div className="flex-1 max-w-lg relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              value={search}
              onChange={e => handleSearch(e.target.value)}
              placeholder="Find patients or appointments..."
              className="w-full pl-9 pr-4 py-2 text-sm bg-gray-50 dark:bg-white/8 border border-gray-200 dark:border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all dark:text-white dark:placeholder-white/40"
            />
            {search.length > 1 && (
              <div className="absolute top-full mt-1 left-0 right-0 bg-white dark:bg-[#0e1f4d] rounded-xl shadow-xl border border-gray-100 dark:border-white/10 z-50 overflow-hidden">
                {searching ? (
                  <p className="px-4 py-3 text-xs text-gray-400">Searching...</p>
                ) : searchResults.length === 0 ? (
                  <p className="px-4 py-3 text-xs text-gray-400">No results found</p>
                ) : searchResults.map((p: any) => (
                  <button key={p.id} onClick={() => { router.push(`/receptionist/patients?id=${p.id}`); setSearch(''); setSR([]) }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors text-left">
                    <div className="w-7 h-7 rounded-full bg-cyan-100 flex items-center justify-center text-cyan-700 text-xs font-bold flex-shrink-0">
                      {p.firstName?.[0]}{p.lastName?.[0]}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-800 dark:text-white">{p.firstName} {p.lastName}</p>
                      <p className="text-xs text-gray-400">{p.phone}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-2 ml-auto">

            {/* Dental image — decorative */}
            <div className="hidden lg:block flex-shrink-0" style={{ width: 52, height: 40 }}>
              <Image src="/dental30.png" alt="" width={52} height={40}
                style={{ objectFit: 'contain', filter: 'drop-shadow(0 2px 6px rgba(41,171,226,0.3))' }} />
            </div>

            {/* Install app button */}
            {!installed && installPrompt && (
              <button onClick={handleInstall}
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all hover:scale-105"
                style={{ background: 'linear-gradient(135deg,#29ABE2,#1A237E)', color: 'white', boxShadow: '0 2px 8px rgba(41,171,226,0.35)' }}>
                <Download size={13} />
                <span>Install</span>
              </button>
            )}

            {/* Notification bell */}
            <Link href="/receptionist/communications" className="relative w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-white/8 transition-colors">
              <Bell size={18} className="text-gray-600 dark:text-white/70" />
              {unread > 0 && (
                <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-red-500 rounded-full text-white text-[8px] font-black flex items-center justify-center">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </Link>

            {/* Theme toggle */}
            <div className="relative">
              <button
                onClick={() => setShowTheme(s => !s)}
                title={`Theme: ${themeLabel}`}
                className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-white/8 transition-colors text-gray-600 dark:text-white/70">
                {themeIcon}
              </button>
              {showTheme && (
                <div className="absolute right-0 top-full mt-2 w-36 bg-white dark:bg-[#152040] rounded-xl shadow-xl border border-gray-100 dark:border-white/10 py-1.5 z-50 animate-fade-in">
                  {(['light', 'dark', 'system'] as Theme[]).map(t => (
                    <button key={t} onClick={() => { setTheme(t); localStorage.setItem('cc_theme', t); applyTheme(t); setShowTheme(false) }}
                      className={cn(
                        'w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors capitalize',
                        theme === t ? 'text-cyan-500 font-bold bg-cyan-50 dark:bg-cyan-900/20' : 'text-gray-700 dark:text-white/70 hover:bg-gray-50 dark:hover:bg-white/5',
                      )}>
                      {t === 'light' ? <Sun size={14} /> : t === 'dark' ? <Moon size={14} /> : <Monitor size={14} />}
                      {t === 'light' ? 'Light' : t === 'dark' ? 'Dark' : 'System'}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Avatar dropdown — extreme right */}
            <div className="relative">
              <button onClick={() => setProf(!showProfile)}
                className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm text-white transition-all hover:scale-105 ring-2 ring-white/30"
                style={{ background: 'linear-gradient(135deg, #29ABE2, #1A237E)' }}>
                {initials}
              </button>
              {showProfile && (
                <div className="absolute right-0 top-full mt-2 w-56 bg-white dark:bg-[#152040] rounded-2xl shadow-xl border border-gray-100 dark:border-white/10 py-2 z-50 animate-fade-in">
                  <div className="px-4 py-3 border-b border-gray-100 dark:border-white/8">
                    <div className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-base text-white mx-auto mb-2"
                      style={{ background: 'linear-gradient(135deg, #29ABE2, #1A237E)' }}>
                      {initials}
                    </div>
                    <p className="text-sm font-bold text-gray-800 dark:text-white text-center">{user?.firstName} {user?.lastName}</p>
                    <p className="text-xs text-gray-400 text-center truncate">{user?.email}</p>
                    <p className="text-[10px] font-bold text-cyan-500 text-center mt-0.5 uppercase tracking-wide">Receptionist</p>
                  </div>
                  {[
                    { icon: User, label: 'My Profile', href: '/settings' },
                    { icon: Lock, label: 'Change Password', href: '/settings?tab=password' },
                    { icon: Download, label: 'Download App', href: '/receptionist/download' },
                  ].map(({ icon: Icon, label, href }) => (
                    <Link key={href} href={href} onClick={() => setProf(false)}
                      className="flex items-center gap-3 px-4 py-2 text-sm text-gray-700 dark:text-white/70 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                      <Icon size={14} className="text-gray-400 dark:text-white/40" />
                      {label}
                    </Link>
                  ))}
                  <div className="border-t border-gray-100 dark:border-white/8 mt-1 pt-1">
                    <button onClick={logout}
                      className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                      <LogOut size={14} />
                      Logout
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
