'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { Bell, CalendarDays, Check, Download, HelpCircle, LogOut, Menu, Monitor, Moon, Palette, Search, Sun, User, UserRound, X } from 'lucide-react'
import { cn, getInitials } from '@/lib/utils'
import { AppTheme, saveTheme } from '@/lib/theme'

type UserInfo = { firstName: string; lastName: string; role: string; email?: string; avatarUrl?: string | null }
type NavLink = { label: string; href?: string; children?: NavLink[]; permKey?: string; disabled?: boolean }
type SearchResult =
  | { type: 'patient'; id: string; primary: string; secondary: string }
  | { type: 'appointment'; id: string; primary: string; secondary: string; patientId: string }

interface ReceptionistTopBarProps {
  user?: UserInfo | null
  perms: Record<string, boolean>
  theme: AppTheme
  onThemeChange: (theme: AppTheme, dark: boolean) => void
  unread: number
  notifications: any[]
  onNotificationsOpen: () => void
  onMarkAllRead: () => void
  onOpenNotification: (item: any) => void
  onOpenHelp: () => void
  installed: boolean
  onInstallClick: () => void
}

const roleLabels: Record<string, string> = {
  ADMIN: 'Administrator', ACCOUNTS: 'Accounts', DOCTOR: 'Doctor', RECEPTIONIST: 'Receptionist', DEVELOPER: 'Developer',
}

// Every destination the OLD receptionist sidebar exposed is still reachable
// here — Scheduling and Appointments folded together, Billing/Treatment
// Pipeline/Referrals/Campaigns shown as disabled (Receptionist genuinely has
// no page/authorization for them — see report), Communications kept as its
// own top-level item since it carries the real unread badge.
const NAV: NavLink[] = [
  { label: 'Overview', href: '/receptionist/dashboard' },
  { label: 'Patients', children: [
    { label: 'Patient Profiles', href: '/receptionist/patients', permKey: 'patients' },
    // Real billing exists — a full invoices/balance BillingTab on each
    // patient's detail page (fetches GET /billing/invoices?patientId=) —
    // there is no standalone billing list for Receptionist, so this opens
    // the same Patients list as the real, honest entry point into it.
    { label: 'Billing', href: '/receptionist/patients', permKey: 'patients' },
  ] },
  { label: 'Appointments', children: [
    { label: 'Appointments', href: '/receptionist/appointments', permKey: 'appointments' },
    { label: 'Scheduling', href: '/receptionist/scheduling', permKey: 'scheduling' },
  ] },
  { label: 'Live Flow', href: '/receptionist/flow', permKey: 'liveFlow' },
  { label: 'AI Suite', children: [
    { label: 'Agent Control', href: '/receptionist/ai-suite' },
    { label: 'Conversations', href: '/receptionist/ai-suite/inbox', permKey: 'aiSuiteInbox' },
    { label: 'Call Logs', href: '/receptionist/ai-suite/calls', permKey: 'callLogs' },
    { label: 'Voice Studio', href: '/receptionist/ai-suite/voice-studio', permKey: 'voiceStudio' },
    { label: 'Knowledge Base', href: '/receptionist/ai-suite/knowledge', permKey: 'knowledgeBase' },
    { label: 'Escalations', href: '/receptionist/ai-suite/escalations', permKey: 'aiSuiteInbox' },
    { label: 'Follow-up Dashboard', href: '/receptionist/ai-suite/followup-dashboard', permKey: 'aiSuiteFollowup' },
    { label: 'Confirmation Dashboard', href: '/receptionist/ai-suite/confirmation-dashboard', permKey: 'aiSuiteConfirmation' },
    { label: 'Analytics & Costs', href: '/receptionist/ai-suite/analytics' },
    { label: 'Settings', href: '/receptionist/ai-suite/settings' },
  ] },
  { label: 'CRM', children: [
    { label: 'Treatment Pipeline', href: '/receptionist/treatment-pipeline', permKey: 'treatmentPipeline' },
    { label: 'Leads', href: '/receptionist/leads', permKey: 'leads' },
    { label: 'Referrals', href: '/receptionist/referrals', permKey: 'referrals' },
    // Campaigns stays disabled deliberately: the Admin page is almost
    // entirely real send-actions (WhatsApp broadcast, template send,
    // birthday message send) with no safe read-only subset to carve out —
    // see the closeout report for the full reasoning. Not a missing
    // permission check to fix; a scope decision for an explicit follow-up.
    { label: 'Campaigns', disabled: true },
  ] },
  { label: 'Reports', children: [
    { label: 'Case Acceptance', href: '/receptionist/reports?tab=case-acceptance', permKey: 'reports' },
    { label: 'Patient Live Flow', href: '/receptionist/reports?tab=flow', permKey: 'reports' },
    // "Daily / Weekly Reports" was removed: /receptionist/reports has only
    // three real tabs (Patient Flow / Feedback / Case Acceptance) and no
    // daily/weekly report exists — the item used to fall through to the
    // same default tab as "Patient Live Flow" above, i.e. two menu entries
    // showing identical content. Disabled rather than left misleading; see
    // redesign review report.
    { label: 'Daily / Weekly Reports', disabled: true },
  ] },
  { label: 'Communications', href: '/receptionist/communications', permKey: 'communications' },
]

const TYPE_DOT: Record<string, string> = { APPOINTMENT: '#29ABE2', INVOICE: '#F59E0B', AI: '#10B981', SYSTEM: '#6B7280', PATIENT_FLOW: '#8B5CF6' }

function hrefPath(href: string) { return href.split('?')[0] }

function isActive(pathname: string, item: NavLink): boolean {
  if (item.href && (pathname === hrefPath(item.href) || pathname.startsWith(hrefPath(item.href) + '/'))) return true
  return item.children?.some(child => isActive(pathname, child)) || false
}

function timeAgo(value: string) {
  const mins = Math.floor((Date.now() - new Date(value).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`
  return `${Math.floor(mins / 1440)}d ago`
}

const navItemCls = (active: boolean) => cn(
  'flex h-full items-center rounded-full px-3.5 text-[13px] tracking-[-0.01em] transition-all focus:outline-none focus:ring-2 focus:ring-cyan-400/50',
  active
    ? 'bg-white font-semibold text-clinic-navy shadow-[0_1px_2px_rgba(15,23,42,0.06),0_4px_10px_rgba(15,23,42,0.10)] dark:bg-white/[0.14] dark:text-white'
    : 'font-medium text-gray-500 hover:bg-white/70 hover:text-clinic-navy dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white',
)

function allowed(perms: Record<string, boolean>, key?: string) { return !key || perms[key] !== false }

// A dropdown item is visible if it has no permKey, or the key isn't
// explicitly denied. A parent with children is visible if at least one
// child remains visible after filtering (disabled placeholders always show).
function visibleNav(nav: NavLink[], perms: Record<string, boolean>): NavLink[] {
  return nav
    .map(item => {
      if (item.children) {
        const children = item.children.filter(c => c.disabled || allowed(perms, c.permKey))
        return { ...item, children }
      }
      return item
    })
    .filter(item => (item.href ? allowed(perms, item.permKey) : (item.children && item.children.length > 0)))
}

export default function ReceptionistTopBar({
  user, perms, theme, onThemeChange, unread, notifications, onNotificationsOpen, onMarkAllRead, onOpenNotification,
  onOpenHelp, installed, onInstallClick,
}: ReceptionistTopBarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const searchInput = useRef<HTMLInputElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [notifOpen, setNotifOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)

  useEffect(() => { setMenuOpen(false); setSearchOpen(false); setProfileOpen(false); setNotifOpen(false) }, [pathname])
  useEffect(() => { if (searchOpen) setTimeout(() => searchInput.current?.focus(), 40) }, [searchOpen])
  useEffect(() => { setActiveIndex(0) }, [results])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === '/' && !searchOpen && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault(); setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [searchOpen])

  async function handleSearch(value: string) {
    setQuery(value)
    const q = value.trim()
    if (q.length < 2) { setResults([]); return }
    setSearching(true)
    try {
      const token = localStorage.getItem('cc_token')
      const headers = { Authorization: `Bearer ${token}` }
      // Appointments: reuses the real GET /scheduling/appointments?search=
      // filter (matches patient name/phone) already used elsewhere in the
      // app, widened to a -7d..+30d window so a quick front-desk search
      // isn't limited to just today's list.
      const today = new Date()
      const start = new Date(today); start.setDate(start.getDate() - 7)
      const end   = new Date(today); end.setDate(end.getDate() + 30)
      const isoDate = (d: Date) => d.toISOString().slice(0, 10)
      const apptParams = new URLSearchParams({
        search: q, startDate: isoDate(start), endDate: isoDate(end), limit: '5',
      })
      const [patientsRes, apptsRes] = await Promise.all([
        fetch(`/api-proxy/patients?q=${encodeURIComponent(q)}&limit=5`, { headers }),
        fetch(`/api-proxy/scheduling/appointments?${apptParams}`, { headers }),
      ])
      const patientResults: SearchResult[] = []
      if (patientsRes.ok) {
        const data = await patientsRes.json()
        const patients = Array.isArray(data) ? data : data.data || []
        for (const p of patients) patientResults.push({
          type: 'patient', id: p.id,
          primary: `${p.firstName} ${p.lastName}`,
          secondary: p.phone || p.email || 'Patient record',
        })
      }
      const apptResults: SearchResult[] = []
      if (apptsRes.ok) {
        const data = await apptsRes.json()
        const appts = Array.isArray(data) ? data : data.appointments || []
        for (const a of appts) {
          const when = new Date(a.startAt).toLocaleString('en-GB', {
            weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi',
          })
          const doctorName = a.doctor?.user ? `Dr. ${a.doctor.user.firstName} ${a.doctor.user.lastName}` : ''
          apptResults.push({
            type: 'appointment', id: a.id, patientId: a.patient?.id,
            primary: a.patient ? `${a.patient.firstName} ${a.patient.lastName}` : 'Appointment',
            secondary: [when, doctorName, a.status].filter(Boolean).join(' · '),
          })
        }
      }
      setResults([...patientResults, ...apptResults])
    } catch {} finally { setSearching(false) }
  }

  function selectResult(result: SearchResult) {
    if (result.type === 'patient') router.push(`/receptionist/patients/${result.id}`)
    // No appointment-detail route exists — the real, existing destination
    // is the appointments list itself (no query-param filter is supported
    // there to deep-link a single row, so this intentionally doesn't
    // invent one).
    if (result.type === 'appointment') router.push('/receptionist/appointments')
    closeSearch()
  }

  function closeSearch() { setSearchOpen(false); setQuery(''); setResults([]); setActiveIndex(0) }

  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') { closeSearch(); return }
    if (!results.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex(i => (i + 1) % results.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex(i => (i - 1 + results.length) % results.length) }
    else if (e.key === 'Enter') { e.preventDefault(); const r = results[activeIndex]; if (r) selectResult(r) }
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

  const nav = visibleNav(NAV, perms)
  const initials = user ? getInitials(user.firstName, user.lastName) : 'CC'
  const iconButton = 'relative grid h-10 w-10 place-items-center rounded-full border border-gray-200/80 bg-white/70 text-gray-600 shadow-sm transition hover:-translate-y-0.5 hover:bg-white dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-300 dark:hover:bg-white/10'

  return (
    <>
      <div className="sticky top-0 z-40 flex flex-shrink-0 items-center gap-3 px-4 py-3 lg:px-6">
        <Link href="/receptionist/dashboard" className="flex w-[128px] flex-shrink-0 items-center" aria-label="Code Clinic home">
          <Image src="/logo.png" alt="Code Clinic" width={118} height={38} className="object-contain dark:brightness-0 dark:invert" priority />
        </Link>

        <nav className="mx-auto hidden h-12 items-center gap-0.5 rounded-full border border-white/70 bg-white/60 px-2.5 shadow-[0_8px_28px_rgba(15,23,42,0.08)] backdrop-blur-2xl dark:border-white/10 dark:bg-white/[0.06] xl:flex" aria-label="Primary navigation">
          {nav.map(item => (
            <div key={item.label} className="group/item relative h-full" tabIndex={item.children ? 0 : undefined}>
              {item.href ? (
                <Link href={item.href} className={navItemCls(isActive(pathname, item))}>{item.label}</Link>
              ) : (
                <button className={navItemCls(isActive(pathname, item))} aria-haspopup="menu">{item.label}</button>
              )}
              {item.children && <Dropdown item={item} pathname={pathname} />}
            </div>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 xl:ml-0">
          {!installed && (
            <button className={iconButton} onClick={onInstallClick} title="Install App"><Download size={18} /></button>
          )}
          <button className={iconButton} onClick={() => { setSearchOpen(true); setNotifOpen(false); setProfileOpen(false) }} title="Search"><Search size={18} /></button>
          <button className={iconButton} onClick={() => { const next = !notifOpen; setNotifOpen(next); setProfileOpen(false); if (next) onNotificationsOpen() }} title="Notifications">
            <Bell size={18} />{unread > 0 && <span className="absolute -right-1 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">{unread > 9 ? '9+' : unread}</span>}
          </button>
          {user && <button onClick={() => { setProfileOpen(!profileOpen); setNotifOpen(false) }} className="hidden items-center gap-2 rounded-full border border-transparent p-1 pr-2 text-left transition hover:border-gray-200 hover:bg-white/70 dark:hover:border-white/10 dark:hover:bg-white/[0.06] sm:flex">
            {user.avatarUrl ? <img src={user.avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover object-top" /> : <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-clinic-navy to-clinic-blue text-[11px] font-bold text-white">{initials}</span>}
            <span className="hidden min-w-0 lg:block"><span className="block max-w-[110px] truncate text-xs font-semibold text-gray-800 dark:text-white">{user.firstName} {user.lastName}</span><span className="block text-[10px] text-gray-400">{roleLabels[user.role] || user.role}</span></span>
          </button>}
          <button className={cn(iconButton, 'xl:hidden')} onClick={() => setMenuOpen(true)} title="Open navigation"><Menu size={19} /></button>
        </div>
      </div>

      {searchOpen && (
        <SearchOverlay
          query={query} results={results} searching={searching} activeIndex={activeIndex}
          inputRef={searchInput} onQuery={handleSearch} onKeyDown={onSearchKeyDown}
          onClose={closeSearch} onSelect={selectResult} onHover={setActiveIndex}
        />
      )}
      {notifOpen && <PopoverBackdrop onClose={() => setNotifOpen(false)}><div className="fixed right-4 top-[70px] z-[101] w-[min(380px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-white/10 dark:bg-[#0c1b38]">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-white/10"><strong className="text-sm font-semibold dark:text-white">Notifications</strong>{unread > 0 && <button onClick={onMarkAllRead} className="text-xs font-semibold text-cyan-600">Mark all read</button>}</div>
        <div className="max-h-[380px] overflow-y-auto">{notifications.length === 0 ? <div className="py-12 text-center text-xs text-gray-400">No notifications yet</div> : notifications.slice(0, 8).map(item => <button key={item.id} onClick={() => onOpenNotification(item)} className={cn('flex w-full gap-3 border-b border-gray-100 px-4 py-3 text-left hover:bg-gray-50 dark:border-white/5 dark:hover:bg-white/5', !item.isRead && 'bg-cyan-50/60 dark:bg-cyan-400/[0.06]')}><span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full" style={{ background: TYPE_DOT[item.type] || '#94a3b8' }} /><span className="min-w-0 flex-1"><span className="block text-xs font-semibold text-gray-800 dark:text-slate-200">{item.title}</span><span className="mt-0.5 line-clamp-2 block text-[11px] text-gray-500 dark:text-slate-400">{item.body}</span></span><span className="text-[9px] text-gray-400">{timeAgo(item.createdAt)}</span></button>)}</div>
      </div></PopoverBackdrop>}
      {profileOpen && user && <PopoverBackdrop onClose={() => setProfileOpen(false)}><ProfileMenu user={user} theme={theme} onTheme={chooseTheme} onNavigate={href => { router.push(href); setProfileOpen(false) }} onHelp={() => { onOpenHelp(); setProfileOpen(false) }} onSignOut={signOut} /></PopoverBackdrop>}
      {menuOpen && <MobileMenu pathname={pathname} nav={nav} user={user} theme={theme} onTheme={chooseTheme} onNavigate={href => { router.push(href); setMenuOpen(false) }} onHelp={() => { onOpenHelp(); setMenuOpen(false) }} onSignOut={signOut} onClose={() => setMenuOpen(false)} />}
    </>
  )
}

function Dropdown({ item, pathname }: { item: NavLink; pathname: string }) {
  return <div role="menu" className="invisible absolute left-1/2 top-[calc(100%-2px)] w-64 -translate-x-1/2 translate-y-2 pt-3 opacity-0 transition duration-150 group-hover/item:visible group-hover/item:translate-y-0 group-hover/item:opacity-100 group-focus-within/item:visible group-focus-within/item:translate-y-0 group-focus-within/item:opacity-100">
    <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white/95 p-2 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-[#0b1a36]/95">
      {item.children?.map(child => <div key={child.label}>
        {child.disabled ? <div className="flex items-center justify-between rounded-xl px-3 py-2.5 text-sm text-gray-400"><span>{child.label}</span><span className="text-[9px] font-bold uppercase">Unavailable</span></div> : <Link href={child.href || '#'} className={cn('block rounded-xl px-3 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-100 dark:text-slate-200 dark:hover:bg-white/10', isActive(pathname, child) && 'bg-cyan-50 font-semibold text-cyan-700 dark:bg-cyan-400/10 dark:text-cyan-300')}>{child.label}</Link>}
      </div>)}
    </div>
  </div>
}

function PopoverBackdrop({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return <><button className="fixed inset-0 z-[100] cursor-default" onClick={onClose} aria-label="Close menu" />{children}</>
}

function SearchOverlay({ query, results, searching, activeIndex, inputRef, onQuery, onKeyDown, onClose, onSelect, onHover }: {
  query: string; results: SearchResult[]; searching: boolean; activeIndex: number
  inputRef: React.RefObject<HTMLInputElement>
  onQuery: (value: string) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onClose: () => void
  onSelect: (result: SearchResult) => void
  onHover: (index: number) => void
}) {
  return <div className="fixed inset-0 z-[120] flex justify-center bg-slate-950/40 px-4 pt-[12vh] backdrop-blur-md" onMouseDown={onClose}>
    <div className="h-fit w-full max-w-2xl overflow-hidden rounded-3xl border border-white/40 bg-white shadow-2xl dark:border-white/10 dark:bg-[#0b1a36]" onMouseDown={e => e.stopPropagation()}>
      <div className="flex items-center gap-3 border-b border-gray-100 px-4 dark:border-white/10">
        <Search size={19} className="flex-shrink-0 text-gray-400" />
        <input
          ref={inputRef} value={query} onChange={e => onQuery(e.target.value)} onKeyDown={onKeyDown}
          placeholder="Search patients, appointments…"
          className="h-14 flex-1 bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400 dark:text-white"
        />
        <kbd className="hidden flex-shrink-0 items-center rounded-md border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-semibold text-gray-400 sm:flex dark:border-white/10 dark:bg-white/5 dark:text-slate-400">ESC</kbd>
        <button onClick={onClose} className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10"><X size={16} /></button>
      </div>
      <div className="max-h-[420px] overflow-y-auto p-2">
        {query.trim().length < 2 ? (
          <p className="px-3 py-10 text-center text-xs text-gray-400">Start typing to find a patient.</p>
        ) : searching ? (
          <p className="px-3 py-10 text-center text-xs text-gray-400">Searching...</p>
        ) : results.length === 0 ? (
          <p className="px-3 py-10 text-center text-xs text-gray-400">No results found.</p>
        ) : results.map((result, i) => (
          <button key={`${result.type}-${result.id}`} onMouseEnter={() => onHover(i)} onClick={() => onSelect(result)}
            className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors', i === activeIndex ? 'bg-cyan-50 dark:bg-cyan-400/10' : 'hover:bg-gray-50 dark:hover:bg-white/[0.06]')}>
            <span className={cn('grid h-9 w-9 flex-shrink-0 place-items-center rounded-full text-xs font-semibold',
              result.type === 'appointment' ? 'bg-violet-100 text-violet-700 dark:bg-violet-400/15 dark:text-violet-300' : 'bg-cyan-100 text-cyan-700 dark:bg-cyan-400/15 dark:text-cyan-300')}>
              {result.type === 'appointment' ? <CalendarDays size={16} /> : <UserRound size={16} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-gray-800 dark:text-white">{result.primary}</span>
              <span className="block truncate text-xs text-gray-400">{result.secondary}</span>
            </span>
            <span className="flex-shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:bg-white/10 dark:text-slate-400">
              {result.type === 'appointment' ? 'Appointment' : 'Patient'}
            </span>
          </button>
        ))}
      </div>
    </div>
  </div>
}

function ProfileMenu({ user, theme, onTheme, onNavigate, onHelp, onSignOut }: { user: UserInfo; theme: AppTheme; onTheme: (theme: AppTheme) => void; onNavigate: (href: string) => void; onHelp: () => void; onSignOut: () => void }) {
  return <div className="fixed right-4 top-[70px] z-[101] w-64 overflow-hidden rounded-2xl border border-gray-200 bg-white p-2 shadow-2xl dark:border-white/10 dark:bg-[#0c1b38]">
    <div className="px-3 py-2"><p className="text-sm font-semibold text-gray-900 dark:text-white">{user.firstName} {user.lastName}</p><p className="text-[11px] text-gray-400">{roleLabels[user.role] || user.role}</p></div>
    <button onClick={() => onNavigate('/receptionist/profile')} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-100 dark:text-slate-200 dark:hover:bg-white/10"><User size={15} /> My Profile</button>
    <div className="my-1 border-t border-gray-100 pt-2 dark:border-white/10"><p className="flex items-center gap-2 px-3 pb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400"><Palette size={13} /> Appearance</p><div className="grid grid-cols-3 gap-1">{([['light', Sun], ['dark', Moon], ['system', Monitor]] as const).map(([value, Icon]) => <button key={value} onClick={() => onTheme(value)} className={cn('flex flex-col items-center gap-1 rounded-xl px-1 py-2 text-[10px] capitalize text-gray-500 hover:bg-gray-100 dark:text-slate-400 dark:hover:bg-white/10', theme === value && 'bg-cyan-50 font-semibold text-cyan-700 dark:bg-cyan-400/10 dark:text-cyan-300')}><span className="relative"><Icon size={15} />{theme === value && <Check size={8} className="absolute -right-2 -top-1" />}</span>{value}</button>)}</div></div>
    <button onClick={() => onNavigate('/receptionist/download')} className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-100 dark:text-slate-200 dark:hover:bg-white/10"><Download size={15} /> Download App</button>
    <button onClick={onHelp} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-100 dark:text-slate-200 dark:hover:bg-white/10"><HelpCircle size={15} /> Get Help</button>
    <div className="my-1 border-t border-gray-100 dark:border-white/10" />
    <button onClick={onSignOut} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"><LogOut size={15} /> Sign Out</button>
  </div>
}

function MobileMenu({ pathname, nav, user, theme, onTheme, onNavigate, onHelp, onSignOut, onClose }: { pathname: string; nav: NavLink[]; user?: UserInfo | null; theme: AppTheme; onTheme: (theme: AppTheme) => void; onNavigate: (href: string) => void; onHelp: () => void; onSignOut: () => void; onClose: () => void }) {
  return <div className="fixed inset-0 z-[130] bg-slate-950/45 backdrop-blur-sm" onMouseDown={onClose}>
    <div className="ml-auto flex h-full w-[min(360px,90vw)] flex-col bg-white shadow-2xl dark:bg-[#08162f]" onMouseDown={e => e.stopPropagation()}>
      <div className="flex h-[68px] items-center justify-between border-b border-gray-100 px-5 dark:border-white/10"><strong className="text-sm font-semibold dark:text-white">Navigation</strong><button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full hover:bg-gray-100 dark:text-white dark:hover:bg-white/10"><X size={18} /></button></div>
      <div className="flex-1 overflow-y-auto p-3">
        {nav.map(item => <div key={item.label} className="mb-1">
          {item.href ? (
            <Link href={item.href} className={cn('block rounded-xl px-3 py-3 text-sm font-semibold text-gray-700 dark:text-slate-200', isActive(pathname, item) && 'bg-cyan-50 text-cyan-700 dark:bg-cyan-400/10 dark:text-cyan-300')}>{item.label}</Link>
          ) : (
            <>
              <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-gray-400">{item.label}</p>
              <div className="ml-2 border-l border-gray-200 pl-2 dark:border-white/10">
                {item.children?.map(child => child.disabled
                  ? <span key={child.label} className="flex justify-between rounded-lg px-3 py-2 text-sm text-gray-400">{child.label}<span className="text-[9px] uppercase">Unavailable</span></span>
                  : <Link key={child.label} href={child.href || '#'} className="block rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-white/10">{child.label}</Link>)}
              </div>
            </>
          )}
        </div>)}
      </div>
      {user && <div className="border-t border-gray-100 p-3 dark:border-white/10">
        <p className="px-2 pb-2 text-xs font-semibold text-gray-800 dark:text-white">{user.firstName} {user.lastName}<span className="ml-2 font-normal text-gray-400">{roleLabels[user.role] || user.role}</span></p>
        <button onClick={() => onNavigate('/receptionist/profile')} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-white/10"><User size={15} /> My Profile</button>
        <div className="my-2 grid grid-cols-3 gap-1">{([['light', Sun], ['dark', Moon], ['system', Monitor]] as const).map(([value, Icon]) => <button key={value} onClick={() => onTheme(value)} className={cn('flex items-center justify-center gap-1 rounded-lg py-2 text-[10px] capitalize text-gray-500 dark:text-slate-400', theme === value && 'bg-cyan-50 font-semibold text-cyan-700 dark:bg-cyan-400/10 dark:text-cyan-300')}><Icon size={13} />{value}</button>)}</div>
        <button onClick={onHelp} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-white/10"><HelpCircle size={15} /> Get Help</button>
        <button onClick={onSignOut} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"><LogOut size={15} /> Sign Out</button>
      </div>}
    </div>
  </div>
}
