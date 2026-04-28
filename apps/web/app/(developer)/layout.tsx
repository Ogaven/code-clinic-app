'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  LayoutDashboard, Users, Database, Settings,
  Terminal, Activity, LogOut, ChevronLeft, ChevronRight,
  Code2, Cpu, Menu, X, Shield,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const NAV = [
  { label: 'Dashboard',    href: '/developer/dashboard',   icon: LayoutDashboard },
  { label: 'System',       href: '/developer/system',      icon: Cpu },
  { label: 'Database',     href: '/developer/database',    icon: Database },
  { label: 'Users',        href: '/developer/users',       icon: Users },
  { label: 'API Explorer', href: '/developer/api',         icon: Terminal },
  { label: 'Logs',         href: '/developer/logs',        icon: Activity },
  { label: 'Security',     href: '/developer/security',    icon: Shield },
  { label: 'Settings',     href: '/developer/settings',    icon: Settings },
]

export default function DeveloperLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router   = useRouter()
  const [user, setUser]         = useState<any>(null)
  const [collapsed, setCol]     = useState(false)
  const [mobileOpen, setMobile] = useState(false)

  useEffect(() => {
    const raw = localStorage.getItem('cc_user')
    if (!raw) { router.replace('/login'); return }
    const u = JSON.parse(raw)
    if (u.role !== 'DEVELOPER') {
      const map: Record<string, string> = {
        ADMIN: '/dashboard', RECEPTIONIST: '/receptionist/dashboard',
        DOCTOR: '/doctor/dashboard', ACCOUNTS: '/accounts/dashboard',
      }
      router.replace(map[u.role] || '/login')
      return
    }
    setUser(u)
  }, [router])

  useEffect(() => { setMobile(false) }, [pathname])

  function logout() {
    localStorage.removeItem('cc_token')
    localStorage.removeItem('cc_user')
    router.push('/login')
  }

  const initials = user ? `${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}` : 'D'

  const NavItem = ({ item }: { item: typeof NAV[0] }) => {
    const active = pathname === item.href || pathname.startsWith(item.href + '/')
    const Icon = item.icon
    return (
      <Link href={item.href}
        className={cn(
          'flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-all group relative min-h-[40px]',
          collapsed && 'justify-center px-2',
          active
            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
            : 'text-slate-400 hover:text-slate-200 hover:bg-white/5',
        )}>
        {active && <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r-full bg-emerald-400" />}
        <Icon size={15} className="flex-shrink-0" />
        {!collapsed && <span className="truncate flex-1 font-mono text-xs">{item.label}</span>}
        {collapsed && (
          <div className="absolute left-full ml-3 px-2.5 py-1.5 rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-all z-50 shadow-xl text-xs bg-slate-800 text-slate-200 border border-white/10 font-mono">
            {item.label}
          </div>
        )}
      </Link>
    )
  }

  const SidebarContent = ({ onClose }: { onClose?: () => void }) => (
    <div className="flex flex-col h-full" style={{ background: '#0d1117', borderRight: '1px solid rgba(255,255,255,0.06)' }}>
      {/* Logo */}
      <div className={cn('flex items-center border-b border-white/[0.06] h-14 flex-shrink-0 gap-3',
        collapsed ? 'justify-center px-2' : 'px-4')}>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: 'linear-gradient(135deg,#10b981,#059669)' }}>
          <Code2 size={15} color="white" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="font-mono font-bold text-white text-sm leading-none">DevConsole</p>
            <p className="font-mono text-[10px] text-emerald-400/70 mt-0.5">Code Clinic</p>
          </div>
        )}
        {onClose && (
          <button onClick={onClose} className="ml-auto text-slate-400 hover:text-white p-1">
            <X size={16} />
          </button>
        )}
      </div>

      {/* User badge */}
      {!collapsed && (
        <div className="mx-3 mt-3 px-3 py-2.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
              style={{ background: 'linear-gradient(135deg,#10b981,#059669)' }}>
              {initials}
            </div>
            <div className="min-w-0">
              <p className="font-mono text-[11px] font-semibold text-white truncate">
                {user?.firstName} {user?.lastName}
              </p>
              <p className="font-mono text-[9px] text-emerald-400">DEVELOPER</p>
            </div>
          </div>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {NAV.map(item => <NavItem key={item.href} item={item} />)}
      </nav>

      {/* Bottom */}
      <div className="px-2 py-3 border-t border-white/[0.06] space-y-1">
        {!collapsed && (
          <div className="px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.05] mb-2">
            <p className="font-mono text-[9px] text-slate-500">env: production</p>
            <p className="font-mono text-[9px] text-slate-500">api: {typeof window !== 'undefined' ? window.location.origin : ''}/api-proxy</p>
          </div>
        )}
        <button onClick={logout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all text-xs font-mono min-h-[40px]"
          style={collapsed ? { justifyContent: 'center' } : {}}>
          <LogOut size={14} />
          {!collapsed && 'logout()'}
        </button>
        <button onClick={() => setCol(c => !c)}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-slate-600 hover:text-slate-400 hover:bg-white/5 transition-all text-xs font-mono min-h-[36px]"
          style={collapsed ? { justifyContent: 'center' } : {}}>
          {collapsed ? <ChevronRight size={14} /> : <><ChevronLeft size={14} /><span>collapse</span></>}
        </button>
      </div>
    </div>
  )

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#010409' }}>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setMobile(false)} />
          <div className="relative w-[260px] h-full z-10">
            <SidebarContent onClose={() => setMobile(false)} />
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <div className={cn('hidden md:block flex-shrink-0 transition-all duration-300', collapsed ? 'w-[56px]' : 'w-[220px]')}>
        <SidebarContent />
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Topbar */}
        <header className="h-14 flex items-center gap-3 px-4 border-b flex-shrink-0"
          style={{ background: '#0d1117', borderColor: 'rgba(255,255,255,0.06)' }}>
          <button onClick={() => setMobile(true)}
            className="md:hidden w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-200 hover:bg-white/5">
            <Menu size={18} />
          </button>

          {/* Breadcrumb */}
          <div className="flex items-center gap-2 font-mono text-sm flex-1">
            <span className="text-emerald-400">~/dev</span>
            <span className="text-slate-600">/</span>
            <span className="text-slate-300 capitalize">{pathname.split('/').filter(Boolean).slice(1).join(' / ') || 'dashboard'}</span>
          </div>

          {/* Status pill */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-emerald-500/20 bg-emerald-500/5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-mono text-[10px] text-emerald-400">online</span>
          </div>

          <div className="w-7 h-7 rounded-md flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0"
            style={{ background: 'linear-gradient(135deg,#10b981,#059669)' }}>
            {initials}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-6" style={{ background: '#010409' }}>
          {children}
        </main>
      </div>
    </div>
  )
}
