'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  LayoutDashboard, CalendarDays, Users, Settings,
  Bell, LogOut, Sun, Moon, Monitor, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const nav = [
  { label: 'Dashboard',   href: '/doctor/dashboard', icon: LayoutDashboard },
  { label: 'Schedule',    href: '/scheduling',        icon: CalendarDays },
  { label: 'Patients',    href: '/patients',           icon: Users },
]

type Theme = 'light' | 'dark' | 'system'
function applyTheme(t: Theme) {
  const root = document.documentElement
  if (t === 'dark') root.classList.add('dark')
  else if (t === 'light') root.classList.remove('dark')
  else window.matchMedia('(prefers-color-scheme: dark)').matches ? root.classList.add('dark') : root.classList.remove('dark')
}

export default function DoctorLayout({ children }: { children: React.ReactNode }) {
  const pathname  = usePathname()
  const router    = useRouter()
  const [user, setUser]       = useState<any>(null)
  const [collapsed, setCol]   = useState(false)
  const [theme, setTheme]     = useState<Theme>('system')
  const [showProfile, setProf]= useState(false)

  useEffect(() => {
    const stored = localStorage.getItem('cc_user')
    if (!stored) { router.push('/login'); return }
    const u = JSON.parse(stored)
    if (u.role !== 'DOCTOR') { router.replace('/dashboard'); return }
    setUser(u)
    const savedTheme = (localStorage.getItem('cc_theme') as Theme) || 'system'
    setTheme(savedTheme)
    applyTheme(savedTheme)
  }, [router])

  function logout() {
    localStorage.removeItem('cc_token')
    localStorage.removeItem('cc_user')
    router.push('/login')
  }

  const initials = user ? `${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}` : 'D'

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 dark:bg-[#070f2b]">

      {/* Sidebar */}
      <aside className={cn(
        'flex flex-col h-screen flex-shrink-0 transition-all duration-300 z-50',
        'fixed lg:sticky top-0 border-r border-gray-100 dark:border-white/8',
        'bg-white dark:bg-[#0a1525]',
        collapsed ? 'w-[64px]' : 'w-[200px]',
      )}>
        {/* Logo */}
        <Link href="/doctor/dashboard"
          className={cn('flex items-center border-b border-gray-100 dark:border-white/8 h-14', collapsed ? 'justify-center px-2' : 'px-4 gap-2')}>
          {collapsed ? (
            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: 'linear-gradient(135deg,#29ABE2,#1A237E)' }}>
              <span className="text-white font-black text-[10px]">CC</span>
            </div>
          ) : (
            <Image src="/logo.png" alt="Code Clinic" width={105} height={32}
              className="object-contain dark:brightness-0 dark:invert" priority />
          )}
        </Link>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 space-y-0.5 px-2">
          {nav.map(item => {
            const Icon   = item.icon
            const active = pathname === item.href || pathname.startsWith(item.href + '/')
            return (
              <Link key={item.href} href={item.href}
                title={collapsed ? item.label : undefined}
                className={cn(
                  'relative flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-[13px] font-medium group',
                  collapsed && 'justify-center px-2',
                  active
                    ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-semibold'
                    : 'text-gray-600 dark:text-white/60 hover:bg-gray-100 dark:hover:bg-white/5',
                )}>
                {active && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-blue-500" />}
                <Icon size={17} className="flex-shrink-0" />
                {!collapsed && <span className="truncate">{item.label}</span>}
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

        {/* Bottom */}
        <div className="px-2 pb-3 border-t border-gray-100 dark:border-white/8 pt-2 space-y-0.5">
          <Link href="#" onClick={e => { e.preventDefault(); setCol(c => !c) }}
            className="flex items-center justify-center w-full px-3 py-2 rounded-xl text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5 transition-all text-xs font-medium gap-2">
            {collapsed ? <ChevronRight size={15} /> : <><ChevronLeft size={15} /><span>Collapse</span></>}
          </Link>
        </div>
      </aside>

      {/* Main */}
      <div className={cn('flex-1 flex flex-col min-w-0 overflow-hidden', collapsed ? 'lg:ml-0' : 'lg:ml-0')}>
        {/* Topbar */}
        <header className="h-14 flex items-center gap-3 px-4 bg-white dark:bg-[#0a1f4a]/80 dark:backdrop-blur-md border-b border-gray-100 dark:border-white/8 flex-shrink-0 z-20 flex-shrink-0">
          <div className="flex-1" />

          {/* Theme */}
          <button
            onClick={() => {
              const next: Theme = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system'
              setTheme(next); localStorage.setItem('cc_theme', next); applyTheme(next)
            }}
            className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-white/8 transition-colors text-gray-500 dark:text-white/60">
            {theme === 'dark' ? <Moon size={16} /> : theme === 'light' ? <Sun size={16} /> : <Monitor size={16} />}
          </button>

          {/* Notifications */}
          <button className="relative w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-white/8 transition-colors">
            <Bell size={18} className="text-gray-500 dark:text-white/60" />
          </button>

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
                <button onClick={logout}
                  className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                  <LogOut size={14} />
                  Logout
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
