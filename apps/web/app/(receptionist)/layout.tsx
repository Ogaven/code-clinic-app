'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import {
  LayoutDashboard, CalendarDays, Users, MessageSquare,
  Bot, BarChart2, Settings, HelpCircle, Bell, Search,
  ChevronLeft, ChevronRight, LogOut, User, Lock, Download,
  Sun, Moon, Monitor, X, Send, AlertCircle, Zap, CheckCircle2, Stethoscope, UserCog, Clock,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const navTop = [
  { label: 'Dashboard',    href: '/receptionist/dashboard',    icon: LayoutDashboard },
  { label: 'Appointments', href: '/receptionist/appointments', icon: CalendarDays },
  { label: 'Doctors',      href: '/receptionist/doctors',      icon: UserCog },
  { label: 'Services',     href: '/receptionist/services',     icon: Stethoscope },
  { label: 'Patients',     href: '/receptionist/patients',     icon: Users },
  { label: 'Live Flow',    href: '/receptionist/flow',         icon: Zap },
  { label: 'AI Suite',     href: '/receptionist/ai-suite',     icon: Bot },
  { label: 'Reports',      href: '/receptionist/reports',      icon: BarChart2 },
]

const navBottom = [
  { label: 'Communications', href: '/receptionist/communications', icon: MessageSquare, badge: true },
]

type Theme = 'light' | 'dark' | 'system'

function applyTheme(t: Theme) {
  const root = document.documentElement
  if (t === 'dark') root.classList.add('dark')
  else if (t === 'light') root.classList.remove('dark')
  else {
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) root.classList.add('dark')
    else root.classList.remove('dark')
  }
}

// ── Help / Support Modal ─────────────────────────────────────
function HelpModal({ onClose }: { onClose: () => void }) {
  const [type,    setType]    = useState('Bug')
  const [subject, setSubject] = useState('')
  const [desc,    setDesc]    = useState('')
  const [priority,setPri]     = useState('Normal')
  const [sending, setSending] = useState(false)
  const [sent,    setSent]    = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!subject.trim() || !desc.trim()) return
    setSending(true)
    // Simulate sending ticket to developer
    await new Promise(r => setTimeout(r, 1500))
    setSending(false)
    setSent(true)
    setTimeout(onClose, 2500)
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-[#0e2045] rounded-3xl shadow-2xl border border-gray-100 dark:border-white/10 w-full max-w-lg overflow-hidden animate-fade-in-up">

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100 dark:border-white/8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
              <HelpCircle size={18} className="text-white" />
            </div>
            <div>
              <h2 className="text-base font-black text-gray-800 dark:text-white">Get Help</h2>
              <p className="text-xs text-gray-400 dark:text-white/40">Submit a ticket · Sarah AI can help too</p>
            </div>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-gray-100 dark:hover:bg-white/8 transition-colors text-gray-400">
            <X size={16} />
          </button>
        </div>

        {sent ? (
          <div className="flex flex-col items-center justify-center gap-3 py-14 px-6 text-center">
            <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mb-2">
              <CheckCircle2 size={32} className="text-emerald-500" />
            </div>
            <h3 className="text-lg font-black text-gray-800 dark:text-white">Ticket Submitted!</h3>
            <p className="text-sm text-gray-500 dark:text-white/50">The developer has been notified. You{"'"}ll hear back shortly.</p>
          </div>
        ) : (
          <form onSubmit={submit} className="p-6 space-y-4">
            {/* Type + Priority */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold text-gray-500 dark:text-white/50 mb-1.5 block">Issue Type</label>
                <select value={type} onChange={e => setType(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/30">
                  {['Bug', 'Feature Request', 'Question', 'Urgent'].map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-500 dark:text-white/50 mb-1.5 block">Priority</label>
                <select value={priority} onChange={e => setPri(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/30">
                  {['Low', 'Normal', 'High', 'Critical'].map(p => <option key={p}>{p}</option>)}
                </select>
              </div>
            </div>

            {/* Subject */}
            <div>
              <label className="text-xs font-bold text-gray-500 dark:text-white/50 mb-1.5 block">Subject *</label>
              <input
                value={subject} onChange={e => setSubject(e.target.value)}
                placeholder="Brief summary of the issue..."
                className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 text-gray-800 dark:text-white placeholder-gray-400 dark:placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-cyan-500/30"
              />
            </div>

            {/* Description */}
            <div>
              <label className="text-xs font-bold text-gray-500 dark:text-white/50 mb-1.5 block">Description *</label>
              <textarea
                value={desc} onChange={e => setDesc(e.target.value)}
                rows={4}
                placeholder="Describe the issue in detail — steps to reproduce, what you expected vs what happened..."
                className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 text-gray-800 dark:text-white placeholder-gray-400 dark:placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 resize-none"
              />
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 pt-1">
              <button type="button" onClick={onClose}
                className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-white/10 text-sm font-semibold text-gray-600 dark:text-white/70 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                Cancel
              </button>
              <button type="submit" disabled={sending || !subject.trim() || !desc.trim()}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-black text-white transition-all disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)', boxShadow: '0 4px 16px rgba(41,171,226,0.35)' }}>
                {sending ? (
                  <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Sending...</>
                ) : (
                  <><Send size={14} /> Send Ticket</>
                )}
              </button>
            </div>

            <p className="text-xs text-gray-400 dark:text-white/30 text-center">
              Or open <strong className="text-cyan-500">Sarah AI</strong> on the dashboard — she can also create support tickets for you.
            </p>
          </form>
        )}
      </div>
    </div>
  )
}

// ── Notification permission helper ────────────────────────────
async function requestNotificationPermission() {
  if (!('Notification' in window)) return 'not-supported'
  if (Notification.permission === 'granted') return 'granted'
  if (Notification.permission !== 'denied') {
    const perm = await Notification.requestPermission()
    return perm
  }
  return Notification.permission
}

function showLocalNotification(title: string, body: string, url?: string) {
  if (Notification.permission !== 'granted') return
  const n = new Notification(title, {
    body,
    icon: '/icon.png',
    badge: '/icon.png',
    tag: 'codeclinic',
  })
  if (url) n.onclick = () => { window.focus(); window.location.href = url }
}

export default function ReceptionistLayout({ children }: { children: React.ReactNode }) {
  const pathname  = usePathname()
  const router    = useRouter()
  const [user, setUser]         = useState<any>(null)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
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
  const [showHelp, setShowHelp] = useState(false)
  const [notifPerm, setNotifPerm] = useState<string>('default')
  const [todayAppts, setTodayAppts] = useState<any[]>([])

  const API = '/api-proxy'

  useEffect(() => {
    const stored = localStorage.getItem('cc_user')
    if (!stored) { router.push('/login'); return }
    const u = JSON.parse(stored)
    setUser(u)
    // Check locally-stored avatar first (covers settings-page uploads and API-resolved URLs)
    if (u.avatarUrl || u.avatar) {
      setAvatarUrl(u.avatarUrl || u.avatar)
    } else {
      const token = localStorage.getItem('cc_token')
      fetch('/api-proxy/auth/me', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data?.avatarUrl) {
            setAvatarUrl(data.avatarUrl)
            localStorage.setItem('cc_user', JSON.stringify({ ...u, avatarUrl: data.avatarUrl }))
          }
        })
        .catch(() => {})
    }
    fetchUnread(u)
    fetchTodayAppts()
    const t = setInterval(() => fetchUnread(u), 15000)
    const savedTheme = (localStorage.getItem('cc_theme') as Theme) || 'system'
    setTheme(savedTheme)
    applyTheme(savedTheme)
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onMqChange = () => { if ((localStorage.getItem('cc_theme') || 'system') === 'system') applyTheme('system') }
    mq.addEventListener('change', onMqChange)
    // Notification permission status
    if ('Notification' in window) setNotifPerm(Notification.permission)
    return () => { clearInterval(t); mq.removeEventListener('change', onMqChange) }
  }, [])

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

  async function handleEnableNotifications() {
    const perm = await requestNotificationPermission()
    setNotifPerm(perm)
    if (perm === 'granted') {
      showLocalNotification('Notifications enabled!', 'You will now receive Code Clinic alerts.', '/receptionist/dashboard')
    }
  }

  async function fetchUnread(u: any) {
    try {
      const token = localStorage.getItem('cc_token')
      const res = await fetch(`${API}/receptionist/notifications`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        const count = data.unread || 0
        setUnread(prev => {
          // Fire notification if new unread
          if (count > prev && prev > 0 && Notification.permission === 'granted') {
            showLocalNotification('New Notification', `You have ${count} unread messages.`, '/receptionist/communications')
          }
          return count
        })
      }
    } catch {}
  }

  async function fetchTodayAppts() {
    try {
      const token = localStorage.getItem('cc_token')
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Kampala' })
      const res = await fetch(`${API}/scheduling/appointments?startDate=${today}&endDate=${today}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setTodayAppts(Array.isArray(data) ? data : [])
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

  const themeIcon  = theme === 'dark' ? <Moon size={16} /> : theme === 'light' ? <Sun size={16} /> : <Monitor size={16} />
  const themeLabel = theme === 'dark' ? 'Dark' : theme === 'light' ? 'Light' : 'System'
  const initials   = user ? `${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}` : 'R'

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 dark:bg-transparent">

      {/* Help modal */}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}

      {/* ── Mobile overlay ──────────────────────────────────── */}
      {!collapsed && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setCol(true)}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
        </div>
      )}

      {/* ── Sidebar ─────────────────────────────────────────── */}
      <aside
        className={cn(
          'rec-sidebar flex flex-col h-screen flex-shrink-0 transition-all duration-300 z-50',
          'fixed lg:sticky top-0',
          collapsed ? '-translate-x-full lg:translate-x-0 w-[220px] lg:w-[64px]' : 'translate-x-0 w-[220px]',
        )}
      >
        {/* Logo */}
        <Link href="/receptionist/dashboard"
          className={cn(
            'flex items-center transition-all duration-200',
            'border-b border-gray-100 dark:border-white/8',
            collapsed ? 'justify-center px-2 py-3' : 'px-4 py-3 gap-2',
          )}>
          {collapsed ? (
            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #29ABE2, #1A237E)' }}>
              <span className="text-white font-black text-[10px]">CC</span>
            </div>
          ) : (
            <Image src="/logo.png" alt="Code Clinic" width={105} height={32}
              className="object-contain dark:brightness-0 dark:invert" priority />
          )}
        </Link>

        {/* Nav items */}
        <nav className="flex-1 overflow-y-auto sidebar-nav py-3 px-2 flex flex-col">
          {/* Top section */}
          <div className="space-y-0.5">
            {navTop.map((item) => {
              const Icon   = item.icon
              const active = pathname === item.href || pathname.startsWith(item.href + '/')
              return (
                <Link key={item.href} href={item.href}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    'rec-nav-item relative flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all group text-[13px] font-medium',
                    collapsed && 'justify-center px-2',
                    active && 'active',
                  )}>
                  {active && (
                    <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-cyan-500" />
                  )}
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
          </div>

          {/* Today's Appointments mini-list */}
          {!collapsed && todayAppts.length > 0 && (
            <div className="mt-3 mb-1">
              <div className="flex items-center justify-between px-3 mb-1.5">
                <span className="text-[9px] font-black uppercase tracking-widest text-gray-400 dark:text-white/30 flex items-center gap-1">
                  <Clock size={9} /> Today
                </span>
                <span className="text-[9px] text-gray-400 dark:text-white/30 font-semibold">{todayAppts.length} appts</span>
              </div>
              <div className="space-y-0.5 max-h-[180px] overflow-y-auto pr-0.5">
                {todayAppts.map(appt => {
                  const t = new Date(appt.startAt).toLocaleTimeString('en-UG', {
                    timeZone: 'Africa/Kampala', hour: '2-digit', minute: '2-digit', hour12: true,
                  })
                  const statusDot: Record<string, string> = {
                    PENDING: 'bg-slate-400', CONFIRMED: 'bg-blue-500', CHECKED_IN: 'bg-yellow-500',
                    IN_CHAIR: 'bg-orange-500', WITH_PROVIDER: 'bg-teal-500',
                    READY_CHECKOUT: 'bg-purple-500', COMPLETED: 'bg-green-500',
                    NO_SHOW: 'bg-red-400', CANCELLED: 'bg-gray-300',
                  }
                  return (
                    <Link key={appt.id} href="/receptionist/appointments"
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/5 transition-colors group">
                      <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', statusDot[appt.status] || 'bg-gray-300')} />
                      <span className="text-[10px] text-gray-400 dark:text-white/40 font-mono flex-shrink-0 w-[52px]">{t}</span>
                      <span className="text-[11px] text-gray-700 dark:text-white/70 truncate font-medium group-hover:text-cyan-600 dark:group-hover:text-cyan-400 transition-colors">
                        {appt.patient.firstName} {appt.patient.lastName}
                      </span>
                    </Link>
                  )
                })}
              </div>
            </div>
          )}

          {/* Divider */}
          <div className={cn('my-2 border-t border-gray-100 dark:border-white/[0.06]', collapsed && 'mx-1')} />

          {/* Communications */}
          <div className="space-y-0.5">
            {navBottom.map((item) => {
              const Icon   = item.icon
              const active = pathname === item.href || pathname.startsWith(item.href + '/')
              return (
                <Link key={item.href} href={item.href}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    'rec-nav-item relative flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all group text-[13px] font-medium',
                    collapsed && 'justify-center px-2',
                    active && 'active',
                  )}>
                  {active && (
                    <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-cyan-500" />
                  )}
                  <Icon size={17} className="flex-shrink-0" />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                  {!collapsed && item.badge && unread > 0 && (
                    <span className="ml-auto text-[9px] font-black bg-red-500 text-white rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 badge-pop">
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
          </div>
        </nav>

        {/* Bottom nav — Settings + Help */}
        <div className="px-2 pb-2 border-t border-gray-100 dark:border-white/8 pt-2 space-y-0.5">
          <Link href="/receptionist/settings"
            title={collapsed ? 'Settings' : undefined}
            className={cn(
              'rec-nav-item flex items-center gap-3 px-3 py-2 rounded-xl transition-all text-[12px] font-medium',
              collapsed && 'justify-center px-2',
              (pathname === '/receptionist/settings' || pathname.startsWith('/receptionist/settings/')) && 'active',
            )}>
            <Settings size={16} className="flex-shrink-0" />
            {!collapsed && <span>Settings</span>}
          </Link>

          <button
            onClick={() => setShowHelp(true)}
            title={collapsed ? 'Help & Support' : undefined}
            className={cn(
              'rec-nav-item w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-all text-[12px] font-medium',
              collapsed && 'justify-center px-2',
            )}>
            <HelpCircle size={16} className="flex-shrink-0" />
            {!collapsed && <span>Support</span>}
          </button>

          {/* Notifications enable (if not granted) */}
          {notifPerm !== 'granted' && notifPerm !== 'denied' && !collapsed && (
            <button onClick={handleEnableNotifications}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-[11px] font-medium text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors">
              <Bell size={14} className="flex-shrink-0" />
              Enable Notifications
            </button>
          )}

          {/* Collapse toggle */}
          <button
            onClick={() => setCol(!collapsed)}
            className="w-full flex items-center justify-center px-3 py-2 rounded-xl rec-nav-item transition-all text-xs font-medium">
            {collapsed ? <ChevronRight size={15} /> : (
              <div className="flex items-center gap-2">
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
        <header className="h-14 flex items-center gap-3 px-4 bg-white dark:bg-[#0a1f4a]/80 dark:backdrop-blur-md border-b border-gray-100 dark:border-white/8 flex-shrink-0 z-20">

          {/* Hamburger (mobile) */}
          <button onClick={() => setCol(false)}
            className="lg:hidden w-9 h-9 rounded-xl flex items-center justify-center bg-gray-50 dark:bg-white/8 border border-gray-200 dark:border-white/10 flex-shrink-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
              className="text-gray-700 dark:text-white">
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
              <div className="absolute top-full mt-1 left-0 right-0 bg-white dark:bg-[#0e2045] rounded-xl shadow-xl border border-gray-100 dark:border-white/10 z-50 overflow-hidden">
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

            {/* Dental decorative image */}
            <div className="hidden lg:block flex-shrink-0" style={{ width: 52, height: 40 }}>
              <Image src="/dental30.png" alt="" width={52} height={40}
                style={{ objectFit: 'contain', filter: 'drop-shadow(0 2px 6px rgba(41,171,226,0.3))' }} />
            </div>

            {/* Install app */}
            {!installed && installPrompt && (
              <button onClick={handleInstall}
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all hover:scale-105"
                style={{ background: 'linear-gradient(135deg,#29ABE2,#1A237E)', color: 'white', boxShadow: '0 2px 8px rgba(41,171,226,0.35)' }}>
                <Download size={13} />
                <span>Install</span>
              </button>
            )}

            {/* Notification bell */}
            <Link href="/receptionist/communications"
              className="relative w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-white/8 transition-colors">
              <Bell size={18} className="text-gray-600 dark:text-white/70" />
              {unread > 0 && (
                <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-red-500 rounded-full text-white text-[8px] font-black flex items-center justify-center badge-pop">
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
                <div className="absolute right-0 top-full mt-2 w-36 bg-white dark:bg-[#0e2045] rounded-xl shadow-xl border border-gray-100 dark:border-white/10 py-1.5 z-50 animate-fade-in">
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

            {/* Avatar dropdown */}
            <div className="relative">
              <button onClick={() => setProf(!showProfile)}
                className="w-9 h-9 rounded-full overflow-hidden flex items-center justify-center font-bold text-sm text-white transition-all hover:scale-105 ring-2 ring-white/30"
                style={avatarUrl ? {} : { background: 'linear-gradient(135deg, #29ABE2, #1A237E)' }}>
                {avatarUrl ? <img src={avatarUrl} alt="" className="w-full h-full object-cover" onError={() => setAvatarUrl(null)} /> : initials}
              </button>
              {showProfile && (
                <div className="absolute right-0 top-full mt-2 w-56 bg-white dark:bg-[#0e2045] rounded-2xl shadow-xl border border-gray-100 dark:border-white/10 py-2 z-50 animate-fade-in">
                  <div className="px-4 py-3 border-b border-gray-100 dark:border-white/8">
                    {avatarUrl ? (
                      <img src={avatarUrl} alt="" className="w-12 h-12 rounded-full object-cover mx-auto mb-2" onError={() => setAvatarUrl(null)} />
                    ) : (
                    <div className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-base text-white mx-auto mb-2"
                      style={{ background: 'linear-gradient(135deg, #29ABE2, #1A237E)' }}>
                      {initials}
                    </div>
                    )}
                    <p className="text-sm font-bold text-gray-800 dark:text-white text-center">{user?.firstName} {user?.lastName}</p>
                    <p className="text-xs text-gray-400 text-center truncate">{user?.email}</p>
                    <p className="text-[10px] font-bold text-cyan-500 text-center mt-0.5 uppercase tracking-wide">Receptionist</p>
                  </div>
                  {[
                    { icon: User,     label: 'My Profile',       href: '/receptionist/settings' },
                    { icon: Lock,     label: 'Change Password',  href: '/receptionist/settings?tab=security' },
                    { icon: Download, label: 'Download App',     href: '/receptionist/download' },
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
