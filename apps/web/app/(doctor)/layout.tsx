'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState, useCallback } from 'react'
import {
  LayoutDashboard, CalendarDays, Users, Activity,
  MessageSquare, Settings, HelpCircle, Download,
  Bell, UserCircle, LogOut,
  ChevronLeft, ChevronRight, Menu, X,
  Sun, Moon, ListChecks, CheckCircle2, Inbox,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { setAuthCookie } from '@/lib/api'
import DoctorChatbot from '@/components/DoctorChatbot'

type Theme = 'light' | 'dark' | 'system'

function applyTheme(t: Theme) {
  const root = document.documentElement
  if (t === 'dark') root.classList.add('dark')
  else if (t === 'light') root.classList.remove('dark')
  else window.matchMedia('(prefers-color-scheme: dark)').matches
    ? root.classList.add('dark') : root.classList.remove('dark')
}

async function fetchLivePerms(token: string): Promise<Record<string, boolean>> {
  try {
    const res = await fetch('/api-proxy/staff/permissions/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) return await res.json()
  } catch {}
  return {}
}

const NAV_CORE = [
  { label: 'Dashboard',      href: '/doctor/dashboard', icon: LayoutDashboard },
  { label: 'Appointments',   href: '/doctor/schedule',  icon: CalendarDays,  permKey: 'appointments' },
  { label: 'My Patients',    href: '/doctor/patients',  icon: Users,         permKey: 'patients' },
  { label: 'Patient Flow',   href: '/doctor/flow',      icon: Activity,      permKey: 'liveFlow' },
  { label: 'Communications', href: '/doctor/messages',  icon: MessageSquare, badge: true, permKey: 'communications' },
]

const NAV_AI_SUITE = [
  { label: 'AI Inbox',               href: '/receptionist/ai-suite/inbox',                  icon: Inbox,        permKey: 'aiSuiteInbox' },
  { label: 'Follow-up Dashboard',    href: '/receptionist/ai-suite/followup-dashboard',     icon: CheckCircle2, permKey: 'aiSuiteFollowup' },
  { label: 'Confirmation Dashboard', href: '/receptionist/ai-suite/confirmation-dashboard', icon: ListChecks,   permKey: 'aiSuiteConfirmation' },
]

const NAV_BOTTOM = [
  { label: 'Settings',     href: '/doctor/settings',  icon: Settings },
  { label: 'Support',      href: '/doctor/support',   icon: HelpCircle },
  { label: 'Download App', href: '/doctor/download',  icon: Download },
]

function NavLink({
  href, label, icon: Icon, badge, unread, collapsed, muted, onNavigate,
}: {
  href: string; label: string; icon: any; badge?: boolean; unread: number
  collapsed: boolean; muted?: boolean; onNavigate?: () => void
}) {
  const pathname = usePathname()
  const active   = pathname === href || pathname.startsWith(href + '/')
  const showBadge = badge && unread > 0

  return (
    <Link href={href} title={collapsed ? label : undefined} onClick={onNavigate}
      className={cn(
        'relative flex items-center gap-3 px-3 rounded-xl transition-all font-medium group min-h-[44px]',
        muted ? 'py-2 text-[12px]' : 'py-2.5 text-[13px]',
        collapsed && 'justify-center px-2',
        active
          ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-semibold'
          : muted
            ? 'text-gray-400 dark:text-white/30 hover:bg-gray-100 dark:hover:bg-white/[0.05]'
            : 'text-gray-600 dark:text-white/60 hover:bg-gray-100 dark:hover:bg-white/[0.05]',
      )}>
      {active && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-blue-500" />}
      <Icon size={muted ? 14 : 16} className="flex-shrink-0" />
      {!collapsed && <span className="truncate flex-1">{label}</span>}
      {showBadge && !collapsed && (
        <span className="ml-auto text-[9px] font-bold bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center flex-shrink-0">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
      {showBadge && collapsed && <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />}
      {collapsed && (
        <div className="absolute left-full ml-3 px-2.5 py-1.5 rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-all z-50 shadow-xl text-xs text-white bg-gray-900">
          {label}
          <span className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-gray-900" />
        </div>
      )}
    </Link>
  )
}

export default function DoctorLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router   = useRouter()

  const [user, setUser]           = useState<any>(null)
  const [permsMap, setPermsMap]   = useState<Record<string, boolean>>({})
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [collapsed, setCol]       = useState(false)
  const [theme, setTheme]         = useState<Theme>('dark')
  const [showProfile, setProf]    = useState(false)
  const [unread, setUnread]       = useState(0)
  const [drawerOpen, setDrawer]   = useState(false)
  const [token, setToken]         = useState<string | null>(
    typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  )

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

  const fetchDoctorAvatar = useCallback(async (userId: string) => {
    if (!token) return
    try {
      const r = await fetch('/api-proxy/doctors', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!r.ok) return
      const docs = await r.json()
      if (!Array.isArray(docs)) return
      const me = docs.find((d: any) => d.userId === userId)
      if (me?.avatarUrl) {
        setAvatarUrl(me.avatarUrl)
        localStorage.setItem('cc_avatar', me.avatarUrl)
      }
    } catch {}
  }, [token])

  useEffect(() => {
    const raw = localStorage.getItem('cc_user')
    if (!raw) { router.replace('/login'); return }
    const u = JSON.parse(raw)

    if (u.role !== 'DOCTOR' && u.role !== 'RECEPTIONIST') {
      const roleMap: Record<string, string> = {
        ADMIN: '/dashboard', DEVELOPER: '/developer/dashboard',
        ACCOUNTS: '/accounts/dashboard',
      }
      router.replace(roleMap[u.role] || '/login')
      return
    }

    setUser(u)
    const tok = localStorage.getItem('cc_token') || ''
    fetchLivePerms(tok).then(p => { console.log('[Perms] loaded:', p); setPermsMap(p) })
    const t = (localStorage.getItem('cc_theme') as Theme) || 'dark'
    setTheme(t)
    applyTheme(t)

    const cached = localStorage.getItem('cc_avatar')
    if (cached) setAvatarUrl(cached)

    const refreshSilently = () => {
      fetch('/api-proxy/auth/refresh', { method: 'POST', credentials: 'include' })
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (d?.accessToken) {
            localStorage.setItem('cc_token', d.accessToken)
            setAuthCookie(d.accessToken)
            setToken(d.accessToken)
            fetchLivePerms(d.accessToken).then(p => { console.log('[Perms] refreshed:', p); setPermsMap(p) })
          }
        })
        .catch(() => {})
    }

    // Refresh immediately so expired tokens are replaced before any API call
    refreshSilently()

    fetchUnread()
    fetchDoctorAvatar(u.id)

    const refreshInterval = setInterval(refreshSilently, 6 * 60 * 1000)
    const unreadInterval  = setInterval(fetchUnread, 30000)
    return () => { clearInterval(refreshInterval); clearInterval(unreadInterval) }
  }, [router, fetchUnread, fetchDoctorAvatar])

  // Re-fetch avatar on navigation and on same-tab upload events
  useEffect(() => {
    const cached = localStorage.getItem('cc_avatar')
    if (cached) setAvatarUrl(cached)
  }, [pathname])

  useEffect(() => {
    const onAvatarUpdate = (e: CustomEvent) => setAvatarUrl(e.detail as string)
    window.addEventListener('cc-avatar-updated', onAvatarUpdate as EventListener)
    return () => window.removeEventListener('cc-avatar-updated', onAvatarUpdate as EventListener)
  }, [])

  useEffect(() => { setDrawer(false) }, [pathname])

  function logout() {
    localStorage.removeItem('cc_token')
    localStorage.removeItem('cc_user')
    localStorage.removeItem('cc_avatar')
    document.cookie = 'cc_token=; path=/; SameSite=Lax; max-age=0'
    router.push('/login')
  }

  function cycleTheme() {
    const next: Record<Theme, Theme> = { light: 'dark', dark: 'system', system: 'light' }
    const t = next[theme]
    setTheme(t)
    localStorage.setItem('cc_theme', t)
    applyTheme(t)
  }

  const allowed = (key?: string) => !key || permsMap[key] !== false
  const visibleNavCore    = NAV_CORE.filter(item => allowed(item.permKey))
  const visibleNavAISuite = NAV_AI_SUITE.filter(item => allowed(item.permKey))

  const initials = user ? `${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}` : 'D'

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50 dark:bg-[#0A0F1E]">

      {/* ── Desktop Sidebar ──────────────────────────────────────────────────── */}
      <aside className={cn(
        'hidden md:flex flex-col h-screen flex-shrink-0 transition-all duration-300',
        'border-r border-gray-100 dark:border-white/[0.06]',
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

        {/* Main nav — scrollable */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {visibleNavCore.map(({ permKey: _pk, ...item }) => (
            <NavLink key={item.href} {...item} unread={unread} collapsed={collapsed} />
          ))}
          {visibleNavAISuite.length > 0 && (
            <>
              {!collapsed && (
                <p className="px-3 pt-4 pb-1 text-[10px] font-bold tracking-widest text-gray-400 dark:text-white/30 uppercase">
                  AI Suite
                </p>
              )}
              {visibleNavAISuite.map(({ permKey: _pk, ...item }) => (
                <NavLink key={item.href} {...item} unread={unread} collapsed={collapsed} />
              ))}
            </>
          )}
        </nav>

        {/* Bottom nav — pinned */}
        <div className="border-t border-gray-100 dark:border-white/[0.06] px-2 py-2 space-y-0.5">
          {NAV_BOTTOM.map(item => (
            <NavLink key={item.href} {...item} unread={0} collapsed={collapsed} muted />
          ))}
          <button onClick={() => setCol(c => !c)}
            className="w-full flex items-center justify-center px-3 py-2 mt-1 rounded-xl text-gray-400 dark:text-white/30 hover:bg-gray-100 dark:hover:bg-white/5 transition-all text-xs font-medium gap-1 min-h-[44px]">
            {collapsed ? <ChevronRight size={15} /> : <><ChevronLeft size={15} /><span>Collapse</span></>}
          </button>
        </div>
      </aside>

      {/* ── Mobile Drawer ────────────────────────────────────────────────────── */}
      {drawerOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setDrawer(false)} />
          <aside className="relative w-[280px] max-w-[85vw] h-full bg-white dark:bg-[#0d1526] flex flex-col z-10 shadow-2xl"
            style={{ paddingTop: 'env(safe-area-inset-top)' }}>
            <div className="flex items-center justify-between h-14 px-4 border-b border-gray-100 dark:border-white/[0.06] flex-shrink-0">
              <Image src="/logo.png" alt="Code Clinic" width={105} height={32}
                className="object-contain dark:brightness-0 dark:invert" priority />
              <button onClick={() => setDrawer(false)}
                className="w-9 h-9 flex items-center justify-center rounded-xl text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">
                <X size={18} />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
              {visibleNavCore.map(({ permKey: _pk, ...item }) => (
                <NavLink key={item.href} {...item} unread={unread} collapsed={false} onNavigate={() => setDrawer(false)} />
              ))}
              {visibleNavAISuite.length > 0 && (
                <>
                  <p className="px-3 pt-4 pb-1 text-[10px] font-bold tracking-widest text-gray-400 dark:text-white/30 uppercase">
                    AI Suite
                  </p>
                  {visibleNavAISuite.map(({ permKey: _pk, ...item }) => (
                    <NavLink key={item.href} {...item} unread={unread} collapsed={false} onNavigate={() => setDrawer(false)} />
                  ))}
                </>
              )}
            </nav>
            <div className="border-t border-gray-100 dark:border-white/[0.06] px-2 py-2 pb-4 space-y-0.5">
              {NAV_BOTTOM.map(item => (
                <NavLink key={item.href} {...item} unread={0} collapsed={false} muted onNavigate={() => setDrawer(false)} />
              ))}
              <button onClick={logout}
                className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors min-h-[44px]">
                <LogOut size={15} /> Logout
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* ── Main ─────────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Topbar */}
        <header className="h-14 flex items-center gap-2 px-4 bg-white dark:bg-[#0d1526]/80 dark:backdrop-blur-md border-b border-gray-100 dark:border-white/[0.06] flex-shrink-0 relative z-40">

          <button onClick={() => setDrawer(true)}
            className="md:hidden w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-white/8 transition-colors text-gray-500 dark:text-white/60">
            <Menu size={20} />
          </button>

          <div className="flex-1" />

          {/* Dark / light mode toggle */}
          <button onClick={cycleTheme} title={`Theme: ${theme}`}
            className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-white/8 transition-colors">
            {theme === 'dark'
              ? <Moon size={17} className="text-blue-400" />
              : theme === 'light'
                ? <Sun size={17} className="text-yellow-500" />
                : <Sun size={17} className="text-gray-400" />}
          </button>

          {/* Notifications bell */}
          <Link href="/doctor/notifications"
            className="relative w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-white/8 transition-colors">
            <Bell size={18} className="text-gray-500 dark:text-white/60" />
            {unread > 0 && <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full" />}
          </Link>

          {/* Avatar — real photo or initials */}
          <div className="relative">
            <button onClick={() => setProf(p => !p)}>
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt="Dr." className="w-9 h-9 rounded-full object-cover ring-2 ring-white/30" />
              ) : (
                <div className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm text-white ring-2 ring-white/30"
                  style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
                  {initials}
                </div>
              )}
            </button>
            {showProfile && (
              <div className="absolute right-0 top-full mt-2 w-52 bg-white dark:bg-[#0e2045] rounded-2xl shadow-xl border border-gray-100 dark:border-white/10 py-2 z-50">
                <div className="px-4 py-3 border-b border-gray-100 dark:border-white/8 text-center">
                  {avatarUrl
                    ? <img src={avatarUrl} alt="Dr." className="w-14 h-14 rounded-full object-cover mx-auto mb-2 ring-2 ring-blue-200 dark:ring-blue-900" />
                    : <div className="w-14 h-14 rounded-full flex items-center justify-center font-bold text-lg text-white mx-auto mb-2 ring-2 ring-blue-200 dark:ring-blue-900"
                        style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>{initials}</div>
                  }
                  <p className="text-sm font-bold text-gray-800 dark:text-white">Dr. {user?.firstName} {user?.lastName}</p>
                  <p className="text-xs text-gray-400 truncate">{user?.email}</p>
                  <p className="text-[10px] font-bold text-blue-500 mt-0.5 uppercase">Doctor</p>
                </div>
                <Link href="/doctor/profile" onClick={() => setProf(false)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors min-h-[44px]">
                  <UserCircle size={14} /> My Profile
                </Link>
                <button onClick={logout}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors min-h-[44px]">
                  <LogOut size={14} /> Logout
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto relative">
          {children}
          <DoctorChatbot />
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-[#0d1526] border-t border-gray-100 dark:border-white/[0.06] flex z-40"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {[
          { label: 'Home',         href: '/doctor/dashboard', emoji: '🏠',  permKey: undefined },
          { label: 'Appointments', href: '/doctor/schedule',  emoji: '🗓',  permKey: 'appointments' },
          { label: 'Patients',     href: '/doctor/patients',  emoji: '👥',  permKey: 'patients' },
          { label: 'Messages',     href: '/doctor/messages',  emoji: '💬',  permKey: 'communications' },
          { label: 'More',         href: '#',                 emoji: '☰',  permKey: undefined, isMenu: true },
        ].filter(item => allowed(item.permKey)).map(({ label, href, emoji, isMenu }) => {
          const active = !isMenu && (pathname === href || pathname.startsWith(href + '/'))
          return isMenu ? (
            <button key="more" onClick={() => setDrawer(true)}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[60px] text-xs font-medium text-gray-400 dark:text-white/40">
              <span className="text-xl leading-none">{emoji}</span>
              <span className="text-[10px]">{label}</span>
            </button>
          ) : (
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
    </div>
  )
}
