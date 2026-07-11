'use client'

import { Search, Bell, ChevronDown, Sun, Moon, Download, Smartphone, Monitor, X } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getInitials } from '@/lib/utils'

interface TopBarProps {
  title: string
  dark?: boolean
  onThemeToggle?: (dark: boolean) => void
  user?: { firstName: string; lastName: string; role: string; avatarUrl?: string | null }
}

const roleLabels: Record<string, string> = {
  ADMIN: 'Administrator', DOCTOR: 'Doctor', RECEPTIONIST: 'Receptionist',
  ACCOUNTS: 'Accounts', DEVELOPER: 'Developer',
}
const roleColors: Record<string, string> = {
  ADMIN: '#1A237E', DOCTOR: '#29ABE2', RECEPTIONIST: '#10B981',
  ACCOUNTS: '#F59E0B', DEVELOPER: '#8B5CF6',
}
const TYPE_DOT: Record<string, string> = {
  APPOINTMENT: '#29ABE2', INVOICE: '#F59E0B', AI: '#10B981', SYSTEM: '#6B7280',
}

function timeAgo(dateStr: string): string {
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000)
  if (mins < 1)   return 'just now'
  if (mins < 60)  return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)   return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function TopBar({ title, user, dark = false, onThemeToggle }: TopBarProps) {
  const router = useRouter()
  const [notifOpen,    setNotifOpen]    = useState(false)
  const [installOpen,  setInstallOpen]  = useState(false)
  const [profileOpen,  setProfileOpen]  = useState(false)
  const [search,       setSearch]       = useState('')
  const [installPrompt, setInstallPrompt] = useState<any>(null)
  const [installed,    setInstalled]    = useState(false)
  const [isIOS,        setIsIOS]        = useState(false)
  const [isAndroid,    setIsAndroid]    = useState(false)
  const [notifications, setNotifications] = useState<any[]>([])
  const [unread,       setUnread]       = useState(0)

  useEffect(() => {
    const ua  = navigator.userAgent
    setIsIOS(/iPad|iPhone|iPod/.test(ua))
    setIsAndroid(/Android/.test(ua))

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

  useEffect(() => {
    fetchNotifications()
    const t = setInterval(fetchNotifications, 30000)
    return () => clearInterval(t)
  }, [])

  async function fetchNotifications() {
    try {
      const token = localStorage.getItem('cc_token')
      if (!token) return
      const res = await fetch('/api-proxy/receptionist/notifications', { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) return
      const data = await res.json()
      setNotifications(Array.isArray(data.notifications) ? data.notifications.slice(0, 20) : [])
      setUnread(data.unread || 0)
    } catch {}
  }

  async function markOneRead(id: string) {
    try {
      const token = localStorage.getItem('cc_token')
      await fetch(`/api-proxy/receptionist/notifications/${id}/read`, { method: 'PUT', headers: { Authorization: `Bearer ${token}` } })
    } catch {}
  }

  async function markAllRead() {
    try {
      const token = localStorage.getItem('cc_token')
      await fetch('/api-proxy/receptionist/notifications/mark-read', { method: 'PUT', headers: { Authorization: `Bearer ${token}` } })
      setUnread(0)
      setNotifications(n => n.map(x => ({ ...x, isRead: true })))
    } catch {}
  }

  async function handleInstall() {
    if (installPrompt) {
      installPrompt.prompt()
      const { outcome } = await installPrompt.userChoice
      if (outcome === 'accepted') setInstalled(true)
      setInstallPrompt(null)
    }
  }

  function toggleTheme() {
    const next = !dark
    localStorage.setItem('cc_theme', next ? 'dark' : 'light')
    document.documentElement.classList.toggle('dark', next)
    onThemeToggle?.(next)
    window.dispatchEvent(new CustomEvent('cc-theme', { detail: next ? 'dark' : 'light' }))
  }

  const initials  = user ? getInitials(user.firstName, user.lastName) : '??'
  const roleColor = user ? (roleColors[user.role] || '#1A237E') : '#1A237E'
  const bg        = dark ? 'rgba(10,18,60,0.85)'      : 'rgba(255,255,255,0.85)'
  const bdr       = dark ? 'rgba(255,255,255,0.08)'   : 'rgba(229,231,235,0.9)'
  const titleC    = dark ? '#E0E8FF'  : '#1A237E'
  const searchBg  = dark ? 'rgba(255,255,255,0.06)'   : '#F3F4F6'
  const searchBdr = dark ? 'rgba(255,255,255,0.1)'    : '#E5E7EB'
  const searchCl  = dark ? '#C8D8F0'  : '#374151'
  const iconCl    = dark ? '#8BA0C0'  : '#6B7280'
  const nameCl    = dark ? '#E0E8FF'  : '#111827'
  const btnBg     = dark ? 'rgba(255,255,255,0.08)'   : 'rgba(255,255,255,0.9)'
  const btnBdr    = dark ? 'rgba(255,255,255,0.12)'   : '#E5E7EB'
  const dropBg    = dark ? 'rgba(12,20,75,0.97)'      : '#fff'

  return (
    <>
    <header className="h-[60px] flex items-center justify-between px-5 sticky top-0 z-20 gap-4 flex-shrink-0"
      style={{ background: bg, backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderBottom: `1px solid ${bdr}`, transition: 'background 0.3s' }}>

      <h1 className="text-[17px] font-bold whitespace-nowrap flex-shrink-0"
        style={{ fontFamily: 'Plus Jakarta Sans', color: titleC }}>{title}</h1>

      <div className="flex-1 max-w-md">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: iconCl }} />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search patients, appointments, invoices..."
            className="w-full pl-9 pr-4 py-2 rounded-xl text-xs outline-none transition-all"
            style={{ background: searchBg, border: `1px solid ${searchBdr}`, color: searchCl }} />
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">

        {/* Install / Download button — device-aware */}
        {!installed && (
          <button
            onClick={() => {
              if (installPrompt && (isAndroid || !isIOS)) { handleInstall() }
              else { setInstallOpen(true) }
            }}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all hover:scale-105"
            style={{ background: 'linear-gradient(135deg,#29ABE2,#1A237E)', color: 'white', boxShadow: '0 2px 8px rgba(41,171,226,0.4)' }}>
            <Download size={13} />
            {isIOS ? 'Add to Home Screen' : 'Install App'}
          </button>
        )}

        {/* Theme */}
        <button onClick={toggleTheme}
          className="w-9 h-9 rounded-xl flex items-center justify-center transition-all hover:scale-105"
          style={{ background: btnBg, border: `1px solid ${btnBdr}` }}>
          {dark ? <Sun size={15} color="#FCD34D" /> : <Moon size={15} color="#1A237E" />}
        </button>

        {/* Notifications */}
        <div className="relative">
          <button onClick={() => { setNotifOpen(!notifOpen); setProfileOpen(false) }}
            className="relative w-9 h-9 rounded-xl flex items-center justify-center transition-all hover:scale-105"
            style={{ background: btnBg, border: `1px solid ${btnBdr}` }}>
            <Bell size={28} style={{ color: iconCl }} />
            {unread > 0 && (
              <span className="absolute flex items-center justify-center text-white text-[10px] font-bold bg-red-500 rounded-full"
                style={{ top: -4, right: -4, minWidth: 18, height: 18, padding: '0 4px' }}>
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>
        </div>

        <div className="w-px h-6" style={{ background: bdr }} />

        {/* Profile — clickable dropdown */}
        {user && (
          <div className="relative">
            <button onClick={() => { setProfileOpen(!profileOpen); setNotifOpen(false) }}
              className="flex items-center gap-2.5 cursor-pointer group">
              {user.avatarUrl ? (
                <img src={user.avatarUrl} alt="" className="w-8 h-8 rounded-xl object-cover" style={{ border: `2px solid ${bdr}` }} />
              ) : (
                <div className="w-8 h-8 rounded-xl flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0"
                  style={{ background: `linear-gradient(135deg,${roleColor},${roleColor}99)` }}>
                  {initials}
                </div>
              )}
              <div className="hidden md:block">
                <p className="text-[13px] font-semibold leading-tight" style={{ color: nameCl }}>
                  {user.role === 'DOCTOR' ? 'Dr. ' : ''}{user.firstName} {user.lastName}
                </p>
                <p className="text-[10px] font-medium" style={{ color: roleColor }}>{roleLabels[user.role] || user.role}</p>
              </div>
              <ChevronDown size={13} className="hidden md:block" style={{ color: iconCl }} />
            </button>

          </div>
        )}
      </div>

      {/* Install guide modal */}
      {installOpen && (
        <>
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={() => setInstallOpen(false)} />
          <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[340px] rounded-3xl shadow-2xl p-6"
            style={{ background: dropBg, border: `1px solid ${bdr}` }}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-base" style={{ color: titleC, fontFamily: 'Plus Jakarta Sans' }}>Install Code Clinic</h3>
              <button onClick={() => setInstallOpen(false)} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-white/10">
                <X size={15} style={{ color: iconCl }} />
              </button>
            </div>

            {/* Android / Chrome */}
            <div className="rounded-2xl p-4 mb-3" style={{ background: dark ? 'rgba(255,255,255,0.05)' : '#F8FAFF', border: `1px solid ${bdr}` }}>
              <div className="flex items-center gap-2 mb-2">
                <Smartphone size={16} style={{ color: '#29ABE2' }} />
                <p className="font-bold text-sm" style={{ color: titleC }}>Android / Chrome</p>
              </div>
              <ol className="text-xs space-y-1" style={{ color: dark ? '#93C5FD' : '#4B5563' }}>
                <li>1. Tap the <strong>⋮ menu</strong> in Chrome</li>
                <li>2. Tap <strong>"Add to Home screen"</strong></li>
                <li>3. Tap <strong>"Add"</strong> — done!</li>
              </ol>
            </div>

            {/* iPhone / Safari */}
            <div className="rounded-2xl p-4 mb-3" style={{ background: dark ? 'rgba(255,255,255,0.05)' : '#F8FAFF', border: `1px solid ${bdr}` }}>
              <div className="flex items-center gap-2 mb-2">
                <Smartphone size={16} style={{ color: '#6B7280' }} />
                <p className="font-bold text-sm" style={{ color: titleC }}>iPhone / Safari</p>
              </div>
              <ol className="text-xs space-y-1" style={{ color: dark ? '#93C5FD' : '#4B5563' }}>
                <li>1. Tap the <strong>Share button</strong> (□↑)</li>
                <li>2. Scroll down → <strong>"Add to Home Screen"</strong></li>
                <li>3. Tap <strong>"Add"</strong> — done!</li>
              </ol>
            </div>

            {/* Desktop */}
            <div className="rounded-2xl p-4 mb-4" style={{ background: dark ? 'rgba(255,255,255,0.05)' : '#F8FAFF', border: `1px solid ${bdr}` }}>
              <div className="flex items-center gap-2 mb-2">
                <Monitor size={16} style={{ color: '#1A237E' }} />
                <p className="font-bold text-sm" style={{ color: titleC }}>Desktop (Chrome / Edge)</p>
              </div>
              <ol className="text-xs space-y-1" style={{ color: dark ? '#93C5FD' : '#4B5563' }}>
                <li>1. Look for the <strong>install icon ⊕</strong> in the address bar</li>
                <li>2. Click it → <strong>"Install"</strong></li>
                <li>3. App opens in its own window!</li>
              </ol>
            </div>

            {installPrompt && (
              <button onClick={() => { handleInstall(); setInstallOpen(false) }}
                className="w-full py-3 rounded-2xl font-bold text-white text-sm"
                style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)', boxShadow: '0 6px 20px rgba(41,171,226,0.4)' }}>
                Install Now on This Device
              </button>
            )}
          </div>
        </>
      )}
    </header>

      {/* Profile dropdown — outside <header> to escape its stacking context */}
      {profileOpen && user && (
        <>
          <div className="fixed inset-0" style={{ zIndex: 9998 }} onClick={() => setProfileOpen(false)} />
          <div className="fixed rounded-2xl shadow-xl overflow-hidden py-1"
            style={{ top: 64, right: 16, width: 208, zIndex: 9999, background: dropBg, border: `1px solid ${bdr}`, backdropFilter: 'blur(20px)' }}>
            <div className="px-4 py-3" style={{ borderBottom: `1px solid ${bdr}` }}>
              <p className="font-bold text-sm" style={{ color: titleC }}>{user.firstName} {user.lastName}</p>
              <p className="text-[11px]" style={{ color: roleColor }}>{roleLabels[user.role]}</p>
            </div>
            <button onClick={() => { router.push('/settings'); setProfileOpen(false) }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium hover:bg-white/5 transition-colors"
              style={{ color: dark ? '#C8D8F0' : '#374151' }}>
              <span className="text-base">👤</span> Edit Profile
            </button>
            <button onClick={() => { router.push('/settings'); setProfileOpen(false) }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium hover:bg-white/5 transition-colors"
              style={{ color: dark ? '#C8D8F0' : '#374151' }}>
              <span className="text-base">🔑</span> Change Password
            </button>
            <div className="my-1" style={{ borderTop: `1px solid ${bdr}` }} />
            <button onClick={() => {
              localStorage.removeItem('cc_token')
              localStorage.removeItem('cc_user')
              document.cookie = 'cc_token=; path=/; SameSite=Lax; max-age=0'
              window.location.href = '/login'
            }} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium hover:bg-red-500/10 transition-colors text-red-400">
              <span className="text-base">🚪</span> Sign Out
            </button>
          </div>
        </>
      )}

      {/* Notification dropdown — outside <header> to escape its stacking context */}
      {notifOpen && (
        <>
          <div className="fixed inset-0" style={{ zIndex: 9998 }} onClick={() => setNotifOpen(false)} />
          <div className="fixed rounded-2xl shadow-2xl overflow-hidden"
            style={{ top: 64, right: 16, width: 380, zIndex: 9999, background: dropBg, border: `1px solid ${bdr}`, backdropFilter: 'blur(20px)' }}>

            <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${bdr}` }}>
              <p className="font-bold text-sm" style={{ color: titleC }}>Notifications</p>
              {unread > 0 && (
                <button onClick={markAllRead}
                  className="text-[11px] font-semibold px-2 py-1 rounded-lg transition-colors hover:opacity-70"
                  style={{ color: '#29ABE2', background: dark ? 'rgba(41,171,226,0.12)' : 'rgba(41,171,226,0.08)' }}>
                  Mark all read
                </button>
              )}
            </div>

            <div className="divide-y overflow-y-auto" style={{ borderColor: bdr, maxHeight: 360 }}>
              {notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 gap-2">
                  <Bell size={28} style={{ color: iconCl, opacity: 0.35 }} />
                  <p className="text-xs font-medium" style={{ color: iconCl }}>No notifications yet</p>
                </div>
              ) : notifications.slice(0, 6).map((n: any) => (
                <div key={n.id}
                  onClick={() => {
                    if (!n.isRead) {
                      setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, isRead: true } : x))
                      setUnread(u => Math.max(0, u - 1))
                      markOneRead(n.id)
                    }
                    setNotifOpen(false)
                    if (n.href) { router.push(n.href) }
                  }}
                  className="flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                  style={{ background: !n.isRead ? (dark ? 'rgba(41,171,226,0.07)' : 'rgba(59,130,246,0.05)') : 'transparent' }}>
                  <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ background: TYPE_DOT[n.type] || '#6B7280' }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold leading-snug" style={{ color: dark ? '#C8D8F0' : '#1f2937' }}>{n.title}</p>
                    <p className="text-[11px] leading-snug mt-0.5 line-clamp-2" style={{ color: dark ? '#8BA0C0' : '#6B7280' }}>{n.body}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 flex-shrink-0 ml-1">
                    <span className="text-[10px] whitespace-nowrap" style={{ color: iconCl }}>{timeAgo(n.createdAt)}</span>
                    {!n.isRead && <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />}
                  </div>
                </div>
              ))}
            </div>

            {user?.role && (() => {
              const NOTIF_ROUTES: Record<string, string> = {
                RECEPTIONIST: '/receptionist/notifications',
                DOCTOR:       '/doctor/notifications',
                ADMIN:        '/admin/notifications',
                ACCOUNTS:     '/accounts/notifications',
              }
              const dest = NOTIF_ROUTES[user.role]
              if (!dest) return null
              return (
                <div className="px-4 py-2.5 text-center" style={{ borderTop: `1px solid ${bdr}` }}>
                  <button onClick={() => { router.push(dest); setNotifOpen(false) }}
                    className="text-xs font-semibold hover:underline" style={{ color: '#29ABE2' }}>
                    View all notifications
                  </button>
                </div>
              )
            })()}
          </div>
        </>
      )}
    </>
  )
}
