'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  LayoutDashboard, CalendarDays, Users, Zap, Inbox,
  HelpCircle, X, Send, CheckCircle2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { AppTheme, applyTheme, readTheme } from '@/lib/theme'
import { questrial } from '../fonts/questrial'
import ReceptionistTopBar from '@/components/layout/ReceptionistTopBar'

async function fetchLivePerms(token: string): Promise<Record<string, boolean>> {
  try {
    const res = await fetch('/api-proxy/staff/permissions/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) return await res.json()
  } catch {}
  return {}
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
    try {
      const perm = await Notification.requestPermission()
      return perm
    } catch {
      return 'not-supported'
    }
  }
  return Notification.permission
}

function showLocalNotification(title: string, body: string, url?: string) {
  if (!('Notification' in window)) return
  if (Notification.permission !== 'granted') return
  const opts: NotificationOptions = { body, icon: '/icon.png', badge: '/icon.png', tag: 'codeclinic', data: { url } }
  // Mobile browsers require going through the ServiceWorker
  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    navigator.serviceWorker.ready.then(reg => reg.showNotification(title, opts)).catch(() => {})
    return
  }
  // Desktop fallback
  try {
    const n = new Notification(title, opts)
    if (url) n.onclick = () => { window.focus(); window.location.href = url }
  } catch {}
}

const BOTTOM_NAV = [
  { href: '/receptionist/dashboard',      icon: LayoutDashboard, label: 'Home' },
  { href: '/receptionist/scheduling',     icon: CalendarDays,    label: 'Schedule',  permKey: 'scheduling' },
  { href: '/receptionist/patients',       icon: Users,           label: 'Patients',  permKey: 'patients' },
  { href: '/receptionist/ai-suite/inbox', icon: Inbox,           label: 'Conversations', permKey: 'aiSuiteInbox' },
  { href: '/receptionist/flow',           icon: Zap,             label: 'Flow',      permKey: 'liveFlow' },
]

export default function ReceptionistLayout({ children }: { children: React.ReactNode }) {
  const pathname  = usePathname()
  const router    = useRouter()
  const [user, setUser]         = useState<any>(null)
  const [permsMap, setPermsMap] = useState<Record<string, boolean>>({})
  const [unread, setUnread]     = useState(0)
  const [installPrompt, setInstallPrompt] = useState<any>(null)
  const [installed, setInstalled] = useState(false)
  const [isIOS, setIsIOS] = useState(false)
  const [installToast, setInstallToast] = useState('')
  const [theme, setTheme]       = useState<AppTheme>('system')
  const [dark, setDark]         = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [notifPerm, setNotifPerm] = useState<string>('default')
  const [notifications, setNotifications] = useState<any[]>([])

  const API = '/api-proxy'

  useEffect(() => {
    const stored = localStorage.getItem('cc_user')
    if (!stored) { router.push('/login'); return }
    const u = JSON.parse(stored)
    // Redirect non-receptionist/non-doctor users to their own app
    if (u.role !== 'RECEPTIONIST' && u.role !== 'DOCTOR') {
      const map: Record<string, string> = {
        ADMIN: '/dashboard', DEVELOPER: '/developer/dashboard',
        ACCOUNTS: '/accounts/dashboard',
      }
      router.replace(map[u.role] || '/login')
      return
    }
    setUser(u)
    const tok = localStorage.getItem('cc_token') || ''
    // Refresh token at mount so cookie has latest permissions for middleware enforcement
    fetch('/api-proxy/auth/refresh', { method: 'POST', credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(refreshData => {
        const activeTok = refreshData?.accessToken ?? tok
        if (refreshData?.accessToken) {
          localStorage.setItem('cc_token', refreshData.accessToken)
          document.cookie = `cc_token=${refreshData.accessToken}; path=/; SameSite=Lax; max-age=43200`
        }
        return fetchLivePerms(activeTok)
      })
      .then(p => setPermsMap(p))
      .catch(() => fetchLivePerms(tok).then(p => setPermsMap(p)))
    refreshAvatar(u)
    fetchUnread()
    const t = setInterval(() => fetchUnread(), 10000)
    const saved = readTheme()
    setTheme(saved); setDark(applyTheme(saved))
    if ('Notification' in window) setNotifPerm(Notification.permission)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const onAvatar = (e: Event) => setUser((prev: any) => prev ? { ...prev, avatarUrl: (e as CustomEvent).detail } : prev)
    const onProfile = (e: Event) => setUser((prev: any) => prev ? { ...prev, ...(e as CustomEvent).detail } : prev)
    const onTheme = (e: Event) => { const next = (e as CustomEvent).detail as AppTheme; setTheme(next); setDark(applyTheme(next)) }
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onSystem = () => { if (readTheme() === 'system') setDark(applyTheme('system')) }
    window.addEventListener('cc-avatar-updated', onAvatar)
    window.addEventListener('cc-profile-updated', onProfile)
    window.addEventListener('cc-theme', onTheme)
    media.addEventListener('change', onSystem)
    return () => {
      window.removeEventListener('cc-avatar-updated', onAvatar)
      window.removeEventListener('cc-profile-updated', onProfile)
      window.removeEventListener('cc-theme', onTheme)
      media.removeEventListener('change', onSystem)
    }
  }, [])

  useEffect(() => {
    const ua = navigator.userAgent
    setIsIOS(/iPad|iPhone|iPod/.test(ua))
    const handler = (e: Event) => { e.preventDefault(); setInstallPrompt(e) }
    window.addEventListener('beforeinstallprompt', handler)
    window.addEventListener('appinstalled', () => {
      setInstalled(true)
      localStorage.setItem('app_installed', 'true')
    })
    if (window.matchMedia('(display-mode: standalone)').matches) setInstalled(true)
    if (localStorage.getItem('app_installed') === 'true') setInstalled(true)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  async function handleInstall() {
    if (!installPrompt) return
    installPrompt.prompt()
    const { outcome } = await installPrompt.userChoice
    if (outcome === 'accepted') {
      setInstalled(true)
      localStorage.setItem('app_installed', 'true')
    }
    setInstallPrompt(null)
  }

  function showInstallToast(msg: string, ms = 5000) {
    setInstallToast(msg)
    setTimeout(() => setInstallToast(''), ms)
  }

  function handlePwaClick() {
    if (isIOS) {
      showInstallToast('Tap the Share button (□↑) → then "Add to Home Screen"')
    } else if (installPrompt) {
      handleInstall()
    } else {
      const isChromium = !!(window as any).chrome &&
        (navigator.userAgent.includes('Chrome') || navigator.userAgent.includes('Edg'))
      if (isChromium) {
        showInstallToast('Click the ⊕ icon in your address bar to install', 5000)
      } else {
        showInstallToast('Open this app in Chrome or Edge to install', 4000)
      }
    }
  }

  async function fetchUnread() {
    try {
      const token = localStorage.getItem('cc_token')
      const res = await fetch(`${API}/receptionist/notifications`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        const count = data.unread || 0
        setNotifications(data.notifications?.slice(0, 20) || [])
        setUnread(prev => {
          if (count > prev && prev >= 0 && 'Notification' in window) {
            const unreadItems: any[] = (data.notifications || []).filter((n: any) => !n.isRead)
            const latest = unreadItems[0]
            if (Notification.permission === 'granted' && latest) {
              showLocalNotification(
                latest.title || 'New Notification',
                latest.body || latest.message || `You have ${count} unread messages.`,
                '/receptionist/communications',
              )
            }
          }
          return count
        })
      }
    } catch {}
  }

  function refreshAvatar(u: any) {
    const url = u.avatarUrl || u.avatar || null
    if (url) return
    const token = localStorage.getItem('cc_token')
    fetch('/api-proxy/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.avatarUrl) {
          setUser((prev: any) => prev ? { ...prev, avatarUrl: data.avatarUrl } : prev)
          localStorage.setItem('cc_user', JSON.stringify({ ...u, avatarUrl: data.avatarUrl }))
        }
      })
      .catch(() => {})
  }

  async function markOneRead(id: string) {
    try {
      const token = localStorage.getItem('cc_token')
      await fetch(`${API}/receptionist/notifications/${id}/read`, { method: 'PUT', headers: { Authorization: `Bearer ${token}` } })
    } catch {}
  }

  async function markAllRead() {
    try {
      const token = localStorage.getItem('cc_token')
      await fetch(`${API}/receptionist/notifications/mark-read`, { method: 'PUT', headers: { Authorization: `Bearer ${token}` } })
      setUnread(0)
      setNotifications(n => n.map(x => ({ ...x, isRead: true })))
    } catch {}
  }

  function openNotification(n: any) {
    if (!n.isRead) {
      setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, isRead: true } : x))
      setUnread(u => Math.max(0, u - 1))
      markOneRead(n.id)
    }
    if (n.href) router.push(n.href)
    else router.push('/receptionist/communications')
  }

  async function handleEnableNotifications() {
    const perm = await requestNotificationPermission()
    setNotifPerm(perm)
    if (perm === 'granted') {
      showLocalNotification('Notifications enabled!', 'You will now receive Code Clinic alerts.', '/receptionist/dashboard')
    }
  }

  const allowed = (key?: string) => !key || permsMap[key] !== false
  const visibleBottomNav = BOTTOM_NAV.filter(item => allowed(item.permKey))

  return (
    <div className={cn('cc-receptionist-shell flex h-screen flex-col overflow-hidden', questrial.variable, dark ? 'bg-transparent' : 'bg-clinic-bg')}>
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}

      <ReceptionistTopBar
        user={user}
        perms={permsMap}
        theme={theme}
        onThemeChange={(next, isDark) => { setTheme(next); setDark(isDark) }}
        unread={unread}
        notifications={notifications}
        onNotificationsOpen={fetchUnread}
        onMarkAllRead={markAllRead}
        onOpenNotification={openNotification}
        onOpenHelp={() => setShowHelp(true)}
        installed={installed}
        onInstallClick={handlePwaClick}
      />

      {/* Notification-permission nudge (only until granted/denied) */}
      {notifPerm !== 'granted' && notifPerm !== 'denied' && (
        <div className="px-4 lg:px-6 -mt-1 mb-1">
          <button onClick={handleEnableNotifications}
            className="flex items-center gap-1.5 text-[11px] font-medium text-amber-600 dark:text-amber-400 hover:underline">
            Enable browser notifications
          </button>
        </div>
      )}

      <main className="flex-1 overflow-y-auto pb-16 xl:pb-0">{children}</main>

      {/* ── Mobile Bottom Nav — quick single-tap access; the hamburger in
          ReceptionistTopBar covers the full nav tree (CRM/Reports dropdowns
          don't fit here). Shown below the xl breakpoint, matching where the
          floating nav island itself disappears. ─────────────────────── */}
      <nav className="xl:hidden fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-[#0a1f4a] border-t border-gray-100 dark:border-white/10 flex items-center justify-around px-2 py-1.5"
        style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom))' }}>
        {visibleBottomNav.map(({ href, icon: Icon, label }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link key={href} href={href}
              className={cn('flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl min-w-[44px] transition-all',
                active ? 'text-cyan-500' : 'text-gray-400 dark:text-white/40')}>
              <Icon size={20} />
              <span className="text-[9px] font-semibold">{label}</span>
            </Link>
          )
        })}
      </nav>

      {/* PWA install toast */}
      {installToast && (
        <div className="fixed bottom-24 xl:bottom-6 left-1/2 -translate-x-1/2 z-[99999] bg-gray-900 text-white px-5 py-3 rounded-2xl shadow-2xl text-sm font-semibold max-w-xs text-center pointer-events-none">
          {installToast}
        </div>
      )}
    </div>
  )
}
