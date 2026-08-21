'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { Bell, Check, LogOut, Menu, Monitor, Moon, Palette, Search, Settings, Sun, User, X } from 'lucide-react'
import { cn, getInitials } from '@/lib/utils'
import { AppTheme, saveTheme } from '@/lib/theme'

type UserInfo = { firstName: string; lastName: string; role: string; avatarUrl?: string | null }
type NavLink = { label: string; href?: string; children?: NavLink[]; disabled?: boolean }

interface TopBarProps {
  title: string
  theme: AppTheme
  user?: UserInfo
  onThemeChange: (theme: AppTheme, dark: boolean) => void
}

const roleLabels: Record<string, string> = {
  ADMIN: 'Administrator', ACCOUNTS: 'Accounts', DOCTOR: 'Doctor', RECEPTIONIST: 'Receptionist', DEVELOPER: 'Developer',
}

const NAV: NavLink[] = [
  { label: 'Overview', href: '/dashboard' },
  { label: 'Patients', href: '/patients' },
  { label: 'Appointments', href: '/scheduling' },
  { label: 'Treatments', children: [{ label: 'Treatment Pipeline', href: '/treatment-pipeline' }] },
  { label: 'Billing', children: [
    { label: 'Accounts', href: '/accounts/dashboard' }, { label: 'Sales', href: '/accounts/invoices' },
    { label: 'Expenses', href: '/accounts/expenses' }, { label: 'Payroll', href: '/accounts/payroll' }, { label: 'Stocks', href: '/stocks' },
  ] },
  { label: 'AI Suite', children: [
    { label: 'Conversations', href: '/ai-suite/inbox' }, { label: 'Knowledge Base', href: '/ai-suite/knowledge-base' },
    { label: 'Escalations', href: '/ai-suite/escalations' }, { label: 'Follow-ups', href: '/ai-suite/followup-dashboard' },
    { label: 'Confirmations', href: '/ai-suite/confirmation-dashboard' }, { label: 'Reminders', disabled: true },
    { label: 'Settings', href: '/ai-suite/settings', children: [
      { label: 'Agent Control', href: '/ai-suite' }, { label: 'Call Logs', href: '/ai-suite/calls' },
      { label: 'Voice Studio', href: '/ai-suite/voice-studio' }, { label: 'Analytics & Costs', href: '/ai-suite/analytics' },
    ] },
  ] },
  { label: 'CRM', children: [{ label: 'Leads', href: '/leads' }, { label: 'Campaigns', href: '/campaigns' }, { label: 'Referrals', href: '/referrals' }] },
  { label: 'Reports', children: [
    { label: 'Case Acceptance', href: '/reports/case-acceptance' }, { label: 'Patient Live Flow', href: '/reports/patient-flow' },
    { label: 'Daily / Weekly Reports', href: '/reports/clinical' },
  ] },
]

const TYPE_DOT: Record<string, string> = { APPOINTMENT: '#29ABE2', INVOICE: '#F59E0B', AI: '#10B981', SYSTEM: '#6B7280' }

function isActive(pathname: string, item: NavLink): boolean {
  if (item.href === '/dashboard') return pathname === '/dashboard' || pathname === '/admin/dashboard'
  if (item.href && (pathname === item.href || pathname.startsWith(item.href + '/'))) return true
  return item.children?.some(child => isActive(pathname, child)) || false
}

function timeAgo(value: string) {
  const mins = Math.floor((Date.now() - new Date(value).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`
  return `${Math.floor(mins / 1440)}d ago`
}

export default function TopBar({ title, user, theme, onThemeChange }: TopBarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const searchInput = useRef<HTMLInputElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [searching, setSearching] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [notifications, setNotifications] = useState<any[]>([])
  const [unread, setUnread] = useState(0)

  useEffect(() => { setMenuOpen(false); setSearchOpen(false); setProfileOpen(false); setNotifOpen(false) }, [pathname])
  useEffect(() => { if (searchOpen) setTimeout(() => searchInput.current?.focus(), 40) }, [searchOpen])
  useEffect(() => {
    fetchNotifications()
    const timer = setInterval(fetchNotifications, 30000)
    return () => clearInterval(timer)
  }, [])

  async function fetchNotifications() {
    const token = localStorage.getItem('cc_token')
    if (!token) return
    try {
      const res = await fetch('/api-proxy/receptionist/notifications', { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) return
      const data = await res.json()
      setNotifications(Array.isArray(data.notifications) ? data.notifications.slice(0, 20) : [])
      setUnread(data.unread || 0)
    } catch {}
  }

  async function handleSearch(value: string) {
    setQuery(value)
    if (value.trim().length < 2) { setResults([]); return }
    setSearching(true)
    try {
      const token = localStorage.getItem('cc_token')
      const res = await fetch(`/api-proxy/patients?q=${encodeURIComponent(value.trim())}&limit=8`, { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) { const data = await res.json(); setResults(Array.isArray(data) ? data : data.data || []) }
    } catch {} finally { setSearching(false) }
  }

  async function markAllRead() {
    const token = localStorage.getItem('cc_token')
    try { await fetch('/api-proxy/receptionist/notifications/mark-read', { method: 'PUT', headers: { Authorization: `Bearer ${token}` } }) } catch {}
    setUnread(0); setNotifications(items => items.map(item => ({ ...item, isRead: true })))
  }

  async function openNotification(item: any) {
    if (!item.isRead) {
      setUnread(value => Math.max(0, value - 1))
      setNotifications(items => items.map(value => value.id === item.id ? { ...value, isRead: true } : value))
      const token = localStorage.getItem('cc_token')
      fetch(`/api-proxy/receptionist/notifications/${item.id}/read`, { method: 'PUT', headers: { Authorization: `Bearer ${token}` } }).catch(() => {})
    }
    setNotifOpen(false)
    if (item.href) router.push(item.href)
  }

  function chooseTheme(next: AppTheme) {
    const dark = saveTheme(next)
    onThemeChange(next, dark)
  }

  function signOut() {
    localStorage.removeItem('cc_token'); localStorage.removeItem('cc_user')
    document.cookie = 'cc_token=; path=/; SameSite=Lax; max-age=0'
    window.location.href = '/login'
  }

  const initials = user ? getInitials(user.firstName, user.lastName) : 'CC'
  const iconButton = 'relative grid h-10 w-10 place-items-center rounded-full border border-gray-200/80 bg-white/70 text-gray-600 shadow-sm transition hover:-translate-y-0.5 hover:bg-white dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-300 dark:hover:bg-white/10'

  return (
    <>
      <header className="relative z-40 flex h-[76px] flex-shrink-0 items-center gap-3 border-b border-gray-200/70 bg-white/75 px-4 backdrop-blur-xl dark:border-white/10 dark:bg-[#07152f]/80 lg:px-6">
        <Link href={user?.role === 'ACCOUNTS' ? '/accounts/dashboard' : '/dashboard'} className="flex w-[128px] flex-shrink-0 items-center" aria-label="Code Clinic home">
          <Image src="/logo.png" alt="Code Clinic" width={118} height={38} className="object-contain dark:brightness-0 dark:invert" priority />
        </Link>

        <nav className="mx-auto hidden h-12 items-center gap-0.5 rounded-full border border-white/70 bg-white/65 px-2 shadow-[0_8px_28px_rgba(15,23,42,0.09)] backdrop-blur-2xl dark:border-white/10 dark:bg-white/[0.07] xl:flex" aria-label="Primary navigation">
          {NAV.map(item => (
            <div key={item.label} className="group/item relative h-full" tabIndex={item.children ? 0 : undefined}>
              {item.href ? (
                <Link href={item.href} className={cn('flex h-full items-center rounded-full px-3 text-[11px] font-bold uppercase text-gray-500 transition focus:outline-none focus:ring-2 focus:ring-cyan-400/50 dark:text-slate-300', isActive(pathname, item) ? 'bg-clinic-navy text-white shadow-sm dark:bg-cyan-400 dark:text-[#07152f]' : 'hover:bg-white hover:text-clinic-navy dark:hover:bg-white/10 dark:hover:text-white')}>{item.label}</Link>
              ) : (
                <button className={cn('flex h-full items-center rounded-full px-3 text-[11px] font-bold uppercase text-gray-500 transition focus:outline-none focus:ring-2 focus:ring-cyan-400/50 dark:text-slate-300', isActive(pathname, item) ? 'bg-clinic-navy text-white shadow-sm dark:bg-cyan-400 dark:text-[#07152f]' : 'hover:bg-white hover:text-clinic-navy dark:hover:bg-white/10 dark:hover:text-white')} aria-haspopup="menu">{item.label}</button>
              )}
              {item.children && <Dropdown item={item} pathname={pathname} />}
            </div>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 xl:ml-0">
          <button className={iconButton} onClick={() => { setSearchOpen(true); setNotifOpen(false); setProfileOpen(false) }} title="Search"><Search size={18} /></button>
          <button className={iconButton} onClick={() => { setNotifOpen(!notifOpen); setProfileOpen(false) }} title="Notifications">
            <Bell size={18} />{unread > 0 && <span className="absolute -right-1 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">{unread > 9 ? '9+' : unread}</span>}
          </button>
          {user && <button onClick={() => { setProfileOpen(!profileOpen); setNotifOpen(false) }} className="hidden items-center gap-2 rounded-full border border-transparent p-1 pr-2 text-left transition hover:border-gray-200 hover:bg-white/70 dark:hover:border-white/10 dark:hover:bg-white/[0.06] sm:flex">
            {user.avatarUrl ? <img src={user.avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover object-top" /> : <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-clinic-navy to-clinic-blue text-[11px] font-bold text-white">{initials}</span>}
            <span className="hidden min-w-0 lg:block"><span className="block max-w-[110px] truncate text-xs font-bold text-gray-800 dark:text-white">{user.firstName} {user.lastName}</span><span className="block text-[10px] text-gray-400">{roleLabels[user.role] || user.role}</span></span>
          </button>}
          <button className={cn(iconButton, 'xl:hidden')} onClick={() => setMenuOpen(true)} title="Open navigation"><Menu size={19} /></button>
        </div>
        <span className="sr-only">{title}</span>
      </header>

      {searchOpen && <SearchOverlay query={query} results={results} searching={searching} inputRef={searchInput} onQuery={handleSearch} onClose={() => { setSearchOpen(false); setQuery(''); setResults([]) }} onSelect={(id: string) => { router.push(`/patients/${id}`); setSearchOpen(false) }} />}
      {notifOpen && <PopoverBackdrop onClose={() => setNotifOpen(false)}><div className="fixed right-4 top-[70px] z-[101] w-[min(380px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-white/10 dark:bg-[#0c1b38]">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-white/10"><strong className="text-sm dark:text-white">Notifications</strong>{unread > 0 && <button onClick={markAllRead} className="text-xs font-semibold text-cyan-600">Mark all read</button>}</div>
        <div className="max-h-[380px] overflow-y-auto">{notifications.length === 0 ? <div className="py-12 text-center text-xs text-gray-400">No notifications yet</div> : notifications.slice(0, 8).map(item => <button key={item.id} onClick={() => openNotification(item)} className={cn('flex w-full gap-3 border-b border-gray-100 px-4 py-3 text-left hover:bg-gray-50 dark:border-white/5 dark:hover:bg-white/5', !item.isRead && 'bg-cyan-50/60 dark:bg-cyan-400/[0.06]')}><span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full" style={{ background: TYPE_DOT[item.type] || '#94a3b8' }} /><span className="min-w-0 flex-1"><span className="block text-xs font-semibold text-gray-800 dark:text-slate-200">{item.title}</span><span className="mt-0.5 line-clamp-2 block text-[11px] text-gray-500 dark:text-slate-400">{item.body}</span></span><span className="text-[9px] text-gray-400">{timeAgo(item.createdAt)}</span></button>)}</div>
      </div></PopoverBackdrop>}
      {profileOpen && user && <PopoverBackdrop onClose={() => setProfileOpen(false)}><ProfileMenu user={user} theme={theme} onTheme={chooseTheme} onNavigate={href => { router.push(href); setProfileOpen(false) }} onSignOut={signOut} /></PopoverBackdrop>}
      {menuOpen && <MobileMenu pathname={pathname} user={user} theme={theme} onTheme={chooseTheme} onNavigate={href => { router.push(href); setMenuOpen(false) }} onSignOut={signOut} onClose={() => setMenuOpen(false)} />}
    </>
  )
}

function Dropdown({ item, pathname }: { item: NavLink; pathname: string }) {
  return <div role="menu" className="invisible absolute left-1/2 top-[calc(100%-2px)] w-64 -translate-x-1/2 translate-y-2 pt-3 opacity-0 transition duration-150 group-hover/item:visible group-hover/item:translate-y-0 group-hover/item:opacity-100 group-focus-within/item:visible group-focus-within/item:translate-y-0 group-focus-within/item:opacity-100">
    <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white/95 p-2 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-[#0b1a36]/95">
      {item.children?.map(child => <div key={child.label}>
        {child.disabled ? <div className="flex items-center justify-between rounded-xl px-3 py-2.5 text-sm text-gray-400"><span>{child.label}</span><span className="text-[9px] font-bold uppercase">Unavailable</span></div> : <Link href={child.href || '#'} className={cn('block rounded-xl px-3 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-100 dark:text-slate-200 dark:hover:bg-white/10', isActive(pathname, child) && 'bg-cyan-50 text-cyan-700 dark:bg-cyan-400/10 dark:text-cyan-300')}>{child.label}</Link>}
        {child.children && <div className="mb-1 ml-3 border-l border-gray-200 pl-2 dark:border-white/10">{child.children.map(nested => <Link key={nested.label} href={nested.href || '#'} className="block rounded-lg px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white">{nested.label}</Link>)}</div>}
      </div>)}
    </div>
  </div>
}

function PopoverBackdrop({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return <><button className="fixed inset-0 z-[100] cursor-default" onClick={onClose} aria-label="Close menu" />{children}</>
}

function SearchOverlay({ query, results, searching, inputRef, onQuery, onClose, onSelect }: any) {
  return <div className="fixed inset-0 z-[120] flex justify-center bg-slate-950/35 px-4 pt-[12vh] backdrop-blur-sm" onMouseDown={onClose}>
    <div className="h-fit w-full max-w-2xl overflow-hidden rounded-2xl border border-white/40 bg-white shadow-2xl dark:border-white/10 dark:bg-[#0b1a36]" onMouseDown={e => e.stopPropagation()}>
      <div className="flex items-center gap-3 border-b border-gray-100 px-4 dark:border-white/10"><Search size={19} className="text-gray-400" /><input ref={inputRef} value={query} onChange={e => onQuery(e.target.value)} placeholder="Search patients..." className="h-14 flex-1 bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400 dark:text-white" /><button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10"><X size={16} /></button></div>
      <div className="max-h-[420px] overflow-y-auto p-2">{query.trim().length < 2 ? <p className="px-3 py-10 text-center text-xs text-gray-400">Enter at least two characters to find a patient.</p> : searching ? <p className="px-3 py-10 text-center text-xs text-gray-400">Searching...</p> : results.length === 0 ? <p className="px-3 py-10 text-center text-xs text-gray-400">No patients found.</p> : results.map((patient: any) => <button key={patient.id} onClick={() => onSelect(patient.id)} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-gray-50 dark:hover:bg-white/[0.06]"><span className="grid h-9 w-9 place-items-center rounded-full bg-cyan-100 text-xs font-bold text-cyan-700">{patient.firstName?.[0]}{patient.lastName?.[0]}</span><span><span className="block text-sm font-semibold text-gray-800 dark:text-white">{patient.firstName} {patient.lastName}</span><span className="block text-xs text-gray-400">{patient.phone || patient.email || 'Patient record'}</span></span></button>)}</div>
    </div>
  </div>
}

function ProfileMenu({ user, theme, onTheme, onNavigate, onSignOut }: { user: UserInfo; theme: AppTheme; onTheme: (theme: AppTheme) => void; onNavigate: (href: string) => void; onSignOut: () => void }) {
  return <div className="fixed right-4 top-[70px] z-[101] w-64 overflow-hidden rounded-2xl border border-gray-200 bg-white p-2 shadow-2xl dark:border-white/10 dark:bg-[#0c1b38]">
    <div className="px-3 py-2"><p className="text-sm font-bold text-gray-900 dark:text-white">{user.firstName} {user.lastName}</p><p className="text-[11px] text-gray-400">{roleLabels[user.role] || user.role}</p></div>
    <button onClick={() => onNavigate('/settings')} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-100 dark:text-slate-200 dark:hover:bg-white/10"><User size={15} /> My Profile</button>
    <div className="my-1 border-t border-gray-100 pt-2 dark:border-white/10"><p className="flex items-center gap-2 px-3 pb-2 text-[10px] font-bold uppercase text-gray-400"><Palette size={13} /> Appearance</p><div className="grid grid-cols-3 gap-1">{([['light', Sun], ['dark', Moon], ['system', Monitor]] as const).map(([value, Icon]) => <button key={value} onClick={() => onTheme(value)} className={cn('flex flex-col items-center gap-1 rounded-xl px-1 py-2 text-[10px] capitalize text-gray-500 hover:bg-gray-100 dark:text-slate-400 dark:hover:bg-white/10', theme === value && 'bg-cyan-50 font-bold text-cyan-700 dark:bg-cyan-400/10 dark:text-cyan-300')}><span className="relative"><Icon size={15} />{theme === value && <Check size={8} className="absolute -right-2 -top-1" />}</span>{value}</button>)}</div></div>
    <button onClick={() => onNavigate('/settings')} className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-100 dark:text-slate-200 dark:hover:bg-white/10"><Settings size={15} /> Settings</button>
    <button onClick={onSignOut} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"><LogOut size={15} /> Sign Out</button>
  </div>
}

function MobileMenu({ pathname, user, theme, onTheme, onNavigate, onSignOut, onClose }: { pathname: string; user?: UserInfo; theme: AppTheme; onTheme: (theme: AppTheme) => void; onNavigate: (href: string) => void; onSignOut: () => void; onClose: () => void }) {
  return <div className="fixed inset-0 z-[130] bg-slate-950/45 backdrop-blur-sm" onMouseDown={onClose}><div className="ml-auto flex h-full w-[min(360px,90vw)] flex-col bg-white shadow-2xl dark:bg-[#08162f]" onMouseDown={e => e.stopPropagation()}><div className="flex h-[68px] items-center justify-between border-b border-gray-100 px-5 dark:border-white/10"><strong className="text-sm dark:text-white">Navigation</strong><button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full hover:bg-gray-100 dark:text-white dark:hover:bg-white/10"><X size={18} /></button></div><div className="flex-1 overflow-y-auto p-3">{NAV.map(item => <div key={item.label} className="mb-1">{item.href ? <Link href={item.href} className={cn('block rounded-xl px-3 py-3 text-sm font-bold text-gray-700 dark:text-slate-200', isActive(pathname, item) && 'bg-cyan-50 text-cyan-700 dark:bg-cyan-400/10 dark:text-cyan-300')}>{item.label}</Link> : <><p className="px-3 pb-1 pt-3 text-[10px] font-bold uppercase text-gray-400">{item.label}</p><div className="ml-2 border-l border-gray-200 pl-2 dark:border-white/10">{item.children?.map(child => child.disabled ? <span key={child.label} className="flex justify-between rounded-lg px-3 py-2 text-sm text-gray-400">{child.label}<span className="text-[9px] uppercase">Unavailable</span></span> : <div key={child.label}><Link href={child.href || '#'} className="block rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-white/10">{child.label}</Link>{child.children?.map(nested => <Link key={nested.label} href={nested.href || '#'} className="ml-3 block rounded-lg px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10">{nested.label}</Link>)}</div>)}</div></>}</div>)}</div>{user && <div className="border-t border-gray-100 p-3 dark:border-white/10"><p className="px-2 pb-2 text-xs font-bold text-gray-800 dark:text-white">{user.firstName} {user.lastName}<span className="ml-2 font-normal text-gray-400">{roleLabels[user.role] || user.role}</span></p><button onClick={() => onNavigate('/settings')} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-white/10"><User size={15} /> My Profile</button><div className="my-2 grid grid-cols-3 gap-1">{([['light', Sun], ['dark', Moon], ['system', Monitor]] as const).map(([value, Icon]) => <button key={value} onClick={() => onTheme(value)} className={cn('flex items-center justify-center gap-1 rounded-lg py-2 text-[10px] capitalize text-gray-500 dark:text-slate-400', theme === value && 'bg-cyan-50 font-bold text-cyan-700 dark:bg-cyan-400/10 dark:text-cyan-300')}><Icon size={13} />{value}</button>)}</div><button onClick={onSignOut} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"><LogOut size={15} /> Sign Out</button></div>}</div></div>
}
