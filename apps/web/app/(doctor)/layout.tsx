'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState, useCallback } from 'react'
import {
  LayoutDashboard, CalendarDays, Users, Activity,
  MessageSquare, Bell, UserCircle, Settings, HelpCircle,
  Download, LogOut, Sun, Moon, Monitor, ChevronLeft, ChevronRight,
  CheckCircle, Clock,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import DoctorSarahChatbot from '@/components/DoctorSarahChatbot'

type Theme = 'light' | 'dark' | 'system'

function applyTheme(t: Theme) {
  const root = document.documentElement
  if (t === 'dark') root.classList.add('dark')
  else if (t === 'light') root.classList.remove('dark')
  else window.matchMedia('(prefers-color-scheme: dark)').matches
    ? root.classList.add('dark') : root.classList.remove('dark')
}

const NAV = [
  {
    section: 'MY CLINIC',
    items: [
      { label: 'Dashboard',     href: '/doctor/dashboard',     icon: LayoutDashboard },
      { label: 'My Schedule',   href: '/doctor/schedule',      icon: CalendarDays },
      { label: 'My Patients',   href: '/doctor/patients',      icon: Users },
      { label: 'Patient Flow',  href: '/doctor/flow',          icon: Activity },
    ],
  },
  {
    section: 'COMMUNICATION',
    items: [
      { label: 'Messages',       href: '/doctor/messages',      icon: MessageSquare, badge: true },
      { label: 'Notifications',  href: '/doctor/notifications', icon: Bell, badge: true },
    ],
  },
  {
    section: 'MY ACCOUNT',
    items: [
      { label: 'My Profile',    href: '/doctor/profile',   icon: UserCircle },
      { label: 'Settings',      href: '/doctor/settings',  icon: Settings },
      { label: 'Support',       href: '/doctor/support',   icon: HelpCircle },
      { label: 'Download App',  href: '/doctor/download',  icon: Download },
    ],
  },
]

export default function DoctorLayout({ children }: { children: React.ReactNode }) {
  const pathname  = usePathname()
  const router    = useRouter()
  const [user, setUser]         = useState<any>(null)
  const [collapsed, setCol]     = useState(false)
  const [theme, setTheme]       = useState<Theme>('dark')
  const [showProfile, setProf]  = useState(false)
  const [unread, setUnread]     = useState(0)
  const [checkedIn, setCheckedIn] = useState(false)
  const [checkInTime, setCheckInTime] = useState<string>('')
  const [checkingIn, setCheckingIn] = useState(false)

  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null

  const fetchCheckIn = useCallback(async () => {
    if (!token) return
    try {
      const r = await fetch('/api-proxy/doctors/check-in/today', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const d = await r.json()
      setCheckedIn(d.checkedIn)
      setCheckInTime(d.time || '')
    } catch {}
  }, [token])

  const fetchUnread = useCallback(async () => {
    if (!token) return
    try {
      const r = await fetch('/api-proxy/receptionist/notifications', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const d = await r.json()
      setUnread(d.unread || 0)
    } catch {}
  }, [token])

  useEffect(() => {
    const stored = localStorage.getItem('cc_user')
    if (!stored) { router.push('/login'); return }
    const u = JSON.parse(stored)
    if (u.role !== 'DOCTOR') { router.replace('/dashboard'); return }
    setUser(u)
    const t = (localStorage.getItem('cc_theme') as Theme) || 'dark'
    setTheme(t)
    applyTheme(t)
    fetchCheckIn()
    fetchUnread()
    const interval = setInterval(fetchUnread, 30000)
    return () => clearInterval(interval)
  }, [router, fetchCheckIn, fetchUnread])

  async function handleCheckIn() {
    if (checkedIn || checkingIn || !token) return
    setCheckingIn(true)
    try {
      const r = await fetch('/api-proxy/doctors/check-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type: 'CHECK_IN' }),
      })
      const d = await r.json()
      if (d.success) {
        setCheckedIn(true)
        setCheckInTime(d.time)
      }
    } catch {} finally { setCheckingIn(false) }
  }

  function logout() {
    localStorage.removeItem('cc_token')
    localStorage.removeItem('cc_user')
    router.push('/login')
  }

  function cycleTheme() {
    const next: Theme = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system'
    setTheme(next)
    localStorage.setItem('cc_theme', next)
    applyTheme(next)
  }

  const initials = user ? `${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}` : 'D'

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50 dark:bg-[#0A0F1E]">

      {/* ── Sidebar ── */}
      <aside className={cn(
        'flex flex-col h-screen flex-shrink-0 transition-all duration-300 z-50',
        'fixed lg:sticky top-0 border-r border-gray-100 dark:border-white/[0.06]',
        'bg-white dark:bg-[#0d1526]',
        collapsed ? 'w-[60px]' : 'w-[220px]',
      )}>
        {/* Logo */}
        <Link href="/doctor/dashboard"
          className={cn('flex items-center border-b border-gray-100 dark:border-white/[0.06] h-14 flex-shrink-0',
            collapsed ? 'justify-center px-2' : 'px-4 gap-2')}>
          {collapsed
            ? <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#29ABE2,#1A237E)' }}>
                <span className="text-white font-black text-[10px]">CC</span>
              </div>
            : <Image src="/logo.png" alt="Code Clinic" width={105} height={32}
                className="object-contain dark:brightness-0 dark:invert" priority />}
        </Link>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
          {NAV.map(({ section, items }) => (
            <div key={section}>
              {!collapsed && (
                <p className="text-[9px] font-bold tracking-widest text-gray-400 dark:text-white/30 px-3 mb-1.5">{section}</p>
              )}
              <div className="space-y-0.5">
                {items.map(({ label, href, icon: Icon, badge }) => {
                  const active = pathname === href || pathname.startsWith(href + '/')
                  const showBadge = badge && unread > 0 && (href.includes('messages') || href.includes('notifications'))
                  return (
                    <Link key={href} href={href} title={collapsed ? label : undefined}
                      className={cn(
                        'relative flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-[13px] font-medium group',
                        collapsed && 'justify-center px-2',
                        active
                          ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-semibold'
                          : 'text-gray-600 dark:text-white/60 hover:bg-gray-100 dark:hover:bg-white/[0.05]',
                      )}>
                      {active && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-blue-500" />}
                      <Icon size={16} className="flex-shrink-0" />
                      {!collapsed && <span className="truncate flex-1">{label}</span>}
                      {showBadge && !collapsed && (
                        <span className="ml-auto text-[9px] font-bold bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center flex-shrink-0">
                          {unread > 9 ? '9+' : unread}
                        </span>
                      )}
                      {showBadge && collapsed && (
                        <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
                      )}
                      {collapsed && (
                        <div className="absolute left-full ml-3 px-2.5 py-1.5 rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-all z-50 shadow-xl text-xs text-white bg-gray-900">
                          {label}
                          <span className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-gray-900" />
                        </div>
                      )}
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Bottom section */}
        <div className="px-2 pb-3 border-t border-gray-100 dark:border-white/[0.06] pt-3 space-y-1.5">
          {/* Check In button */}
          <button onClick={handleCheckIn} disabled={checkedIn || checkingIn}
            className={cn(
              'w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-bold transition-all',
              collapsed && 'justify-center px-2',
              checkedIn
                ? 'bg-gray-100 dark:bg-white/5 text-gray-400 dark:text-white/30 cursor-default'
                : 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm',
            )}>
            {checkedIn
              ? <><CheckCircle size={14} className="flex-shrink-0" />{!collapsed && <span className="truncate">Checked In {checkInTime}</span>}</>
              : <><Clock size={14} className="flex-shrink-0" />{!collapsed && <span>{checkingIn ? 'Checking in…' : 'Check In'}</span>}</>
            }
          </button>

          {/* Theme toggle */}
          <button onClick={cycleTheme}
            className={cn('w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-gray-400 dark:text-white/40 hover:bg-gray-100 dark:hover:bg-white/5 transition-all',
              collapsed && 'justify-center px-2')}>
            {theme === 'dark' ? <Moon size={14} /> : theme === 'light' ? <Sun size={14} /> : <Monitor size={14} />}
            {!collapsed && <span className="capitalize">{theme} mode</span>}
          </button>

          {/* Collapse toggle */}
          <button onClick={() => setCol(c => !c)}
            className={cn('w-full flex items-center justify-center px-3 py-2 rounded-xl text-gray-400 dark:text-white/30 hover:bg-gray-100 dark:hover:bg-white/5 transition-all text-xs font-medium gap-2',
              !collapsed && 'gap-1')}>
            {collapsed ? <ChevronRight size={15} /> : <><ChevronLeft size={15} /><span>Collapse</span></>}
          </button>
        </div>
      </aside>

      {/* ── Main ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Topbar */}
        <header className="h-14 flex items-center gap-3 px-4 bg-white dark:bg-[#0d1526]/80 dark:backdrop-blur-md border-b border-gray-100 dark:border-white/[0.06] flex-shrink-0 z-20">
          <div className="flex-1" />

          {/* Theme */}
          <button onClick={cycleTheme}
            className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-white/8 transition-colors text-gray-500 dark:text-white/60">
            {theme === 'dark' ? <Moon size={16} /> : theme === 'light' ? <Sun size={16} /> : <Monitor size={16} />}
          </button>

          {/* Notifications bell with badge */}
          <Link href="/doctor/notifications"
            className="relative w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-white/8 transition-colors">
            <Bell size={18} className="text-gray-500 dark:text-white/60" />
            {unread > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full" />
            )}
          </Link>

          {/* Avatar */}
          <div className="relative">
            <button onClick={() => setProf(p => !p)}
              className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm text-white ring-2 ring-white/30"
              style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
              {initials}
            </button>
            {showProfile && (
              <div className="absolute right-0 top-full mt-2 w-52 bg-white dark:bg-[#0e2045] rounded-2xl shadow-xl border border-gray-100 dark:border-white/10 py-2 z-50 animate-fade-in">
                <div className="px-4 py-3 border-b border-gray-100 dark:border-white/8 text-center">
                  <p className="text-sm font-bold text-gray-800 dark:text-white">Dr. {user?.firstName} {user?.lastName}</p>
                  <p className="text-xs text-gray-400 truncate">{user?.email}</p>
                  <p className="text-[10px] font-bold text-blue-500 mt-0.5 uppercase">Doctor</p>
                </div>
                <Link href="/doctor/profile" onClick={() => setProf(false)}
                  className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                  <UserCircle size={14} /> My Profile
                </Link>
                <button onClick={logout}
                  className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                  <LogOut size={14} /> Logout
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-[#0d1526] border-t border-gray-100 dark:border-white/[0.06] flex z-40"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {[
          { label: 'Home',     href: '/doctor/dashboard',   emoji: '🏠' },
          { label: 'Patients', href: '/doctor/patients',    emoji: '👥' },
          { label: 'Schedule', href: '/doctor/schedule',    emoji: '📅' },
          { label: 'Messages', href: '/doctor/messages',    emoji: '💬' },
          { label: 'Profile',  href: '/doctor/profile',     emoji: '👤' },
        ].map(({ label, href, emoji }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link key={href} href={href}
              className={cn(
                'flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[60px] text-xs font-medium transition-colors',
                active ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400 dark:text-white/40',
              )}>
              <span className="text-xl leading-none">{emoji}</span>
              <span className="text-[10px]">{label}</span>
            </Link>
          )
        })}
      </nav>

      {/* Draggable Sarah chatbot */}
      <DoctorSarahChatbot />
    </div>
  )
}
