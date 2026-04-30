'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import {
  User, Lock, Bell, Palette, Camera, Check, X, Eye, EyeOff,
  Save, Sun, Moon, Monitor, Shield, Mail, Phone, MessageSquare,
  Smartphone, Globe, LogOut, Trash2, CheckCircle2, AlertCircle,
  Link2, RefreshCw, Calendar, Unlink, Wifi, WifiOff, RotateCw,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type Tab = 'profile' | 'security' | 'notifications' | 'appearance' | 'integrations'

type GCalStatus = {
  connected:     boolean
  email?:        string | null
  hasRefresh?:   boolean
  webhookActive?: boolean
  webhookExpiry?: string | null
}
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

function Toast({ msg, type, onClose }: { msg: string; type: 'ok' | 'err'; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 3500); return () => clearTimeout(t) }, [onClose])
  return (
    <div className={cn(
      'fixed bottom-6 right-6 flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-2xl z-[200] animate-fade-in-up text-sm font-semibold',
      type === 'ok' ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white',
    )}>
      {type === 'ok' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
      {msg}
    </div>
  )
}

export default function SettingsPage() {
  const router  = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)

  const [tab, setTab] = useState<Tab>('profile')
  const [user, setUser]       = useState<any>(null)
  const [toast, setToast]     = useState<{ msg: string; type: 'ok' | 'err' } | null>(null)
  const [saving, setSaving]   = useState(false)
  const [avatar, setAvatar]   = useState<string | null>(null)

  // Profile fields
  const [firstName,  setFirstName]  = useState('')
  const [lastName,   setLastName]   = useState('')
  const [email,      setEmail]      = useState('')
  const [phone,      setPhone]      = useState('')
  const [bio,        setBio]        = useState('')

  // Security fields
  const [oldPw,      setOldPw]      = useState('')
  const [newPw,      setNewPw]      = useState('')
  const [confirmPw,  setConfirmPw]  = useState('')
  const [showOld,    setShowOld]    = useState(false)
  const [showNew,    setShowNew]    = useState(false)
  const [changingPw, setChangingPw] = useState(false)

  // Notification prefs
  const [notifEmail,  setNotifEmail]  = useState(true)
  const [notifPush,   setNotifPush]   = useState(false)
  const [notifSMS,    setNotifSMS]    = useState(false)
  const [notifAppt,   setNotifAppt]   = useState(true)
  const [notifEscal,  setNotifEscal]  = useState(true)
  const [notifReport, setNotifReport] = useState(false)
  const [notifPerm,   setNotifPerm]   = useState<NotificationPermission | 'unsupported'>('default')

  // Appearance
  const [theme, setTheme] = useState<Theme>('system')
  const [lang,  setLang]  = useState('en-UG')

  // Integrations
  const [gcal,       setGcal]       = useState<GCalStatus>({ connected: false })
  const [gcalLoading, setGcalLoad]  = useState(false)
  const [syncing,    setSyncing]    = useState(false)

  const API = '/api-proxy'

  useEffect(() => {
    // Read tab from URL without useSearchParams (avoids Suspense requirement)
    const params = new URLSearchParams(window.location.search)
    const t = params.get('tab') as Tab
    if (t && ['profile', 'security', 'notifications', 'appearance', 'integrations'].includes(t)) setTab(t)

    // Handle Google Calendar OAuth return
    const gcalResult = params.get('gcal')
    if (gcalResult === 'connected') {
      showToast('Google Calendar connected!', 'ok')
      setTab('integrations')
    } else if (gcalResult === 'error') {
      showToast('Google Calendar connection failed. Try again.', 'err')
      setTab('integrations')
    }

    const stored = localStorage.getItem('cc_user')
    if (!stored) { router.push('/login'); return }
    const u = JSON.parse(stored)
    setUser(u)
    setFirstName(u.firstName || '')
    setLastName(u.lastName   || '')
    setEmail(u.email         || '')
    setPhone(u.phone         || '')
    setBio(u.bio             || '')
    setAvatar(u.avatar       || null)

    const savedTheme = (localStorage.getItem('cc_theme') as Theme) || 'system'
    setTheme(savedTheme)

    const savedNotif = JSON.parse(localStorage.getItem('cc_notif_prefs') || '{}')
    if (savedNotif.email  !== undefined) setNotifEmail(savedNotif.email)
    if (savedNotif.sms    !== undefined) setNotifSMS(savedNotif.sms)
    if (savedNotif.appt   !== undefined) setNotifAppt(savedNotif.appt)
    if (savedNotif.escal  !== undefined) setNotifEscal(savedNotif.escal)
    if (savedNotif.report !== undefined) setNotifReport(savedNotif.report)

    if ('Notification' in window) setNotifPerm(Notification.permission)
    else setNotifPerm('unsupported')
  }, [])

  useEffect(() => {
    if (tab === 'integrations') fetchGCalStatus()
  }, [tab])

  function showToast(msg: string, type: 'ok' | 'err') {
    setToast({ msg, type })
  }

  function handleAvatarFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { showToast('Image must be under 5MB', 'err'); return }
    const reader = new FileReader()
    reader.onload = () => setAvatar(reader.result as string)
    reader.readAsDataURL(file)
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault()
    if (!firstName.trim() || !lastName.trim()) { showToast('Name is required', 'err'); return }
    setSaving(true)
    try {
      const token = localStorage.getItem('cc_token')
      const res = await fetch(`${API}/auth/me`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName: firstName.trim(), lastName: lastName.trim(), phone: phone.trim(), bio: bio.trim(), avatar }),
      })
      if (res.ok) {
        const updated = await res.json()
        const stored  = JSON.parse(localStorage.getItem('cc_user') || '{}')
        const merged  = { ...stored, ...updated }
        localStorage.setItem('cc_user', JSON.stringify(merged))
        setUser(merged)
        showToast('Profile saved!', 'ok')
      } else {
        // Save locally even if API not ready
        const stored = JSON.parse(localStorage.getItem('cc_user') || '{}')
        const merged = { ...stored, firstName: firstName.trim(), lastName: lastName.trim(), phone: phone.trim(), bio: bio.trim(), avatar }
        localStorage.setItem('cc_user', JSON.stringify(merged))
        setUser(merged)
        showToast('Profile saved locally', 'ok')
      }
    } catch {
      const stored = JSON.parse(localStorage.getItem('cc_user') || '{}')
      localStorage.setItem('cc_user', JSON.stringify({ ...stored, firstName, lastName, phone, bio, avatar }))
      showToast('Profile saved locally', 'ok')
    } finally { setSaving(false) }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault()
    if (!oldPw || !newPw || !confirmPw) { showToast('Fill all password fields', 'err'); return }
    if (newPw.length < 8) { showToast('New password must be 8+ characters', 'err'); return }
    if (newPw !== confirmPw) { showToast('Passwords do not match', 'err'); return }
    setChangingPw(true)
    try {
      const token = localStorage.getItem('cc_token')
      const res = await fetch(`${API}/users/change-password`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPassword: oldPw, newPassword: newPw }),
      })
      if (res.ok) {
        showToast('Password changed!', 'ok')
        setOldPw(''); setNewPw(''); setConfirmPw('')
      } else {
        const err = await res.json().catch(() => ({}))
        showToast(err.message || 'Incorrect current password', 'err')
      }
    } catch {
      showToast('Network error — try again', 'err')
    } finally { setChangingPw(false) }
  }

  function saveNotifications() {
    const prefs = { email: notifEmail, sms: notifSMS, appt: notifAppt, escal: notifEscal, report: notifReport }
    localStorage.setItem('cc_notif_prefs', JSON.stringify(prefs))
    showToast('Notification preferences saved', 'ok')
  }

  async function enablePushNotifications() {
    if (!('Notification' in window)) { showToast('Browser does not support notifications', 'err'); return }
    let perm: NotificationPermission
    try {
      perm = await Notification.requestPermission()
    } catch {
      showToast('Notifications not supported on this browser', 'err')
      return
    }
    setNotifPerm(perm)
    setNotifPush(perm === 'granted')
    if (perm === 'granted') {
      const opts = { body: 'You will now receive Code Clinic alerts.', icon: '/icon.png' }
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready.then(reg => reg.showNotification('Notifications enabled!', opts)).catch(() => {})
      } else {
        try { new Notification('Notifications enabled!', opts) } catch {}
      }
      showToast('Push notifications enabled!', 'ok')
    } else {
      showToast('Permission denied in browser settings', 'err')
    }
  }

  function changeTheme(t: Theme) {
    setTheme(t)
    localStorage.setItem('cc_theme', t)
    applyTheme(t)
  }

  async function fetchGCalStatus() {
    try {
      const token = localStorage.getItem('cc_token')
      const res = await fetch(`${API}/integrations/google-calendar/status`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) setGcal(await res.json())
    } catch {}
  }

  async function connectGCal() {
    setGcalLoad(true)
    try {
      const token = localStorage.getItem('cc_token')
      const res   = await fetch(`${API}/integrations/google-calendar/auth-url?returnTo=/receptionist/settings%3Ftab%3Dintegrations`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const { url } = await res.json()
        window.location.href = url
      } else {
        showToast('Failed to get Google auth URL', 'err')
        setGcalLoad(false)
      }
    } catch {
      showToast('Network error', 'err')
      setGcalLoad(false)
    }
  }

  async function disconnectGCal() {
    if (!confirm('Disconnect Google Calendar? Existing appointments will not be removed from Google Calendar.')) return
    try {
      const token = localStorage.getItem('cc_token')
      await fetch(`${API}/integrations/google-calendar/disconnect`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      setGcal({ connected: false })
      showToast('Google Calendar disconnected', 'ok')
    } catch {
      showToast('Failed to disconnect', 'err')
    }
  }

  async function manualSync() {
    setSyncing(true)
    try {
      const token = localStorage.getItem('cc_token')
      const res   = await fetch(`${API}/integrations/google-calendar/sync`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ daysBack: 7, daysForward: 60 }),
      })
      const data = await res.json()
      if (res.status === 401 || data.error === 'token_expired') {
        setGcal({ connected: false })
        showToast('Google session expired — please reconnect.', 'err')
      } else if (res.ok) {
        const synced  = (data.created || 0) + (data.updated || 0)
        const errored = data.errors || 0
        if (synced > 0) {
          showToast(`Synced ${synced} of ${data.total} appointments${errored > 0 ? ` (${errored} failed)` : ''}`, 'ok')
        } else if (errored > 0) {
          showToast(`Sync failed — ${errored} errors. Check Railway logs.`, 'err')
        } else {
          showToast(data.message || 'No appointments in range', 'ok')
        }
        await fetchGCalStatus()
      } else {
        showToast(data.message || data.error || 'Sync failed', 'err')
      }
    } catch {
      showToast('Network error during sync', 'err')
    } finally { setSyncing(false) }
  }

  const initials = user ? `${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}` : 'R'
  const pwStrength = newPw.length === 0 ? 0 : newPw.length < 6 ? 1 : newPw.length < 10 ? 2 : /[A-Z]/.test(newPw) && /[0-9]/.test(newPw) ? 4 : 3
  const pwColors   = ['', 'bg-red-500', 'bg-amber-400', 'bg-yellow-400', 'bg-emerald-500']
  const pwLabels   = ['', 'Weak', 'Fair', 'Good', 'Strong']

  const tabs: { key: Tab; label: string; icon: any }[] = [
    { key: 'profile',       label: 'Profile',       icon: User      },
    { key: 'security',      label: 'Security',      icon: Shield    },
    { key: 'notifications', label: 'Notifications', icon: Bell      },
    { key: 'appearance',    label: 'Appearance',    icon: Palette   },
    { key: 'integrations',  label: 'Integrations',  icon: Link2     },
  ]

  return (
    <div className="max-w-4xl mx-auto">
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      {/* ── Hero Banner ─────────────────────────────────────────── */}
      <div className="relative overflow-hidden px-6 py-8 md:px-8"
        style={{ background: 'linear-gradient(135deg,#0c1e50 0%,#1a3a8f 50%,#0c3060 100%)' }}>
        {/* Background blobs */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute -top-16 -right-16 w-64 h-64 rounded-full opacity-20"
            style={{ background: 'radial-gradient(circle,#29ABE2,transparent)' }} />
          <div className="absolute -bottom-12 -left-12 w-48 h-48 rounded-full opacity-15"
            style={{ background: 'radial-gradient(circle,#9B59B6,transparent)' }} />
        </div>

        <div className="relative flex items-center gap-5">
          {/* Avatar */}
          <div className="relative flex-shrink-0">
            {avatar ? (
              <img src={avatar} alt="Avatar" className="w-20 h-20 rounded-3xl object-cover ring-4 ring-white/20" />
            ) : (
              <div className="w-20 h-20 rounded-3xl flex items-center justify-center ring-4 ring-white/20 border-2 border-dashed border-white/30 cursor-pointer hover:border-white/60 transition-colors"
                onClick={() => fileRef.current?.click()}>
                <Camera size={24} className="text-white/40" />
              </div>
            )}
            <button type="button" onClick={() => fileRef.current?.click()}
              className="absolute -bottom-1.5 -right-1.5 w-8 h-8 rounded-xl flex items-center justify-center text-white shadow-lg border-2 border-white/20"
              style={{ background: 'linear-gradient(135deg,#29ABE2,#1A237E)' }}>
              <Camera size={13} />
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarFile} />
          </div>

          <div>
            <p className="text-[10px] font-black text-cyan-300/60 uppercase tracking-widest mb-0.5">Account Settings</p>
            <h1 className="text-2xl font-black text-white">{user?.firstName} {user?.lastName}</h1>
            <p className="text-sm text-blue-200/60 mt-0.5">{user?.email}</p>
            <span className="inline-block mt-1.5 text-[10px] font-black bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 px-2 py-0.5 rounded-full uppercase tracking-wider">
              Receptionist
            </span>
          </div>
        </div>
      </div>

      <div className="p-5 space-y-5">
      <div className="flex flex-col md:flex-row gap-5">

        {/* Sidebar tabs */}
        <div className="md:w-52 flex-shrink-0">
          <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/8 shadow-sm overflow-hidden">
            {tabs.map(({ key, label, icon: Icon }) => (
              <button key={key} onClick={() => setTab(key)}
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-3 text-sm font-medium transition-all border-b border-gray-50 dark:border-white/5 last:border-0',
                  tab === key
                    ? 'bg-cyan-50 dark:bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 font-bold border-l-2 border-l-cyan-500'
                    : 'text-gray-600 dark:text-white/60 hover:bg-gray-50 dark:hover:bg-white/5',
                )}>
                <Icon size={15} className="flex-shrink-0" />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1">

          {/* ── PROFILE ─────────────────────────────────────────── */}
          {tab === 'profile' && (
            <form onSubmit={saveProfile} className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/8 shadow-sm p-6 space-y-6">
              <h2 className="text-base font-black text-gray-800 dark:text-white">Personal Information</h2>

              {/* Avatar */}
              <div className="flex items-center gap-5">
                <div className="relative">
                  {avatar ? (
                    <img src={avatar} alt="Avatar" className="w-20 h-20 rounded-2xl object-cover ring-4 ring-cyan-500/20" />
                  ) : (
                    <div className="w-20 h-20 rounded-2xl flex items-center justify-center ring-4 ring-cyan-500/20 border-2 border-dashed border-gray-300 dark:border-white/20 cursor-pointer hover:border-cyan-400 dark:hover:border-cyan-400 transition-colors"
                      onClick={() => fileRef.current?.click()}>
                      <Camera size={24} className="text-gray-300 dark:text-white/20" />
                    </div>
                  )}
                  <button type="button" onClick={() => fileRef.current?.click()}
                    className="absolute -bottom-2 -right-2 w-8 h-8 rounded-xl flex items-center justify-center text-white shadow-lg"
                    style={{ background: 'linear-gradient(135deg,#29ABE2,#1A237E)' }}>
                    <Camera size={13} />
                  </button>
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarFile} />
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-800 dark:text-white">{user?.firstName} {user?.lastName}</p>
                  <p className="text-xs text-gray-400 dark:text-white/40 mb-2">{user?.email}</p>
                  <button type="button" onClick={() => fileRef.current?.click()}
                    className="text-xs font-bold text-cyan-500 hover:text-cyan-600 transition-colors">
                    Upload photo
                  </button>
                  {avatar && (
                    <button type="button" onClick={() => setAvatar(null)}
                      className="ml-3 text-xs font-bold text-red-400 hover:text-red-500 transition-colors">
                      Remove
                    </button>
                  )}
                </div>
              </div>

              {/* Name row */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-gray-500 dark:text-white/50 mb-1.5 block">First Name *</label>
                  <input value={firstName} onChange={e => setFirstName(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/30 transition-all" />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500 dark:text-white/50 mb-1.5 block">Last Name *</label>
                  <input value={lastName} onChange={e => setLastName(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/30 transition-all" />
                </div>
              </div>

              {/* Email */}
              <div>
                <label className="text-xs font-bold text-gray-500 dark:text-white/50 mb-1.5 block">Email Address</label>
                <input value={email} readOnly
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-100 dark:bg-white/3 text-gray-500 dark:text-white/40 cursor-not-allowed" />
                <p className="text-[11px] text-gray-400 dark:text-white/30 mt-1">Email cannot be changed. Contact admin.</p>
              </div>

              {/* Phone */}
              <div>
                <label className="text-xs font-bold text-gray-500 dark:text-white/50 mb-1.5 block">Phone Number</label>
                <div className="flex">
                  <span className="flex items-center px-3 border border-r-0 border-gray-200 dark:border-white/10 rounded-l-xl bg-gray-100 dark:bg-white/5 text-sm text-gray-500 dark:text-white/40">🇺🇬 +256</span>
                  <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="7XX XXX XXX"
                    className="flex-1 px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-r-xl bg-gray-50 dark:bg-white/5 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/30 transition-all" />
                </div>
              </div>

              {/* Bio */}
              <div>
                <label className="text-xs font-bold text-gray-500 dark:text-white/50 mb-1.5 block">Bio / Notes</label>
                <textarea value={bio} onChange={e => setBio(e.target.value)} rows={3}
                  placeholder="Brief note about yourself..."
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/30 transition-all resize-none" />
              </div>

              <button type="submit" disabled={saving}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-black text-white disabled:opacity-60 transition-all hover:-translate-y-0.5"
                style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)', boxShadow: '0 4px 16px rgba(41,171,226,0.35)' }}>
                {saving ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <Save size={14} />}
                {saving ? 'Saving...' : 'Save Profile'}
              </button>
            </form>
          )}

          {/* ── SECURITY ────────────────────────────────────────── */}
          {tab === 'security' && (
            <div className="space-y-4">
              {/* Change password */}
              <form onSubmit={changePassword} className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/8 shadow-sm p-6 space-y-5">
                <div>
                  <h2 className="text-base font-black text-gray-800 dark:text-white">Change Password</h2>
                  <p className="text-xs text-gray-400 dark:text-white/40 mt-0.5">Use a strong password you {"don't"} use elsewhere</p>
                </div>

                <div>
                  <label className="text-xs font-bold text-gray-500 dark:text-white/50 mb-1.5 block">Current Password</label>
                  <div className="relative">
                    <input type={showOld ? 'text' : 'password'} value={oldPw} onChange={e => setOldPw(e.target.value)}
                      className="w-full px-3 py-2.5 pr-10 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/30" />
                    <button type="button" onClick={() => setShowOld(s => !s)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      {showOld ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-gray-500 dark:text-white/50 mb-1.5 block">New Password</label>
                  <div className="relative">
                    <input type={showNew ? 'text' : 'password'} value={newPw} onChange={e => setNewPw(e.target.value)}
                      className="w-full px-3 py-2.5 pr-10 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/30" />
                    <button type="button" onClick={() => setShowNew(s => !s)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      {showNew ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  {newPw.length > 0 && (
                    <div className="mt-2">
                      <div className="flex gap-1 mb-1">
                        {[1,2,3,4].map(i => (
                          <div key={i} className={cn('h-1.5 flex-1 rounded-full transition-all', i <= pwStrength ? pwColors[pwStrength] : 'bg-gray-200 dark:bg-white/10')} />
                        ))}
                      </div>
                      <p className={cn('text-[11px] font-bold', pwStrength >= 3 ? 'text-emerald-500' : pwStrength >= 2 ? 'text-amber-500' : 'text-red-500')}>
                        {pwLabels[pwStrength]}
                      </p>
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-xs font-bold text-gray-500 dark:text-white/50 mb-1.5 block">Confirm New Password</label>
                  <div className="relative">
                    <input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
                      className={cn(
                        'w-full px-3 py-2.5 text-sm border rounded-xl bg-gray-50 dark:bg-white/5 text-gray-800 dark:text-white focus:outline-none focus:ring-2 transition-all',
                        confirmPw && confirmPw !== newPw
                          ? 'border-red-300 focus:ring-red-500/30'
                          : 'border-gray-200 dark:border-white/10 focus:ring-cyan-500/30',
                      )} />
                    {confirmPw && confirmPw === newPw && (
                      <Check size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500" />
                    )}
                  </div>
                </div>

                <button type="submit" disabled={changingPw}
                  className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-black text-white disabled:opacity-60 transition-all hover:-translate-y-0.5"
                  style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)', boxShadow: '0 4px 16px rgba(41,171,226,0.3)' }}>
                  {changingPw ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <Lock size={14} />}
                  {changingPw ? 'Changing...' : 'Change Password'}
                </button>
              </form>

              {/* Active sessions */}
              <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/8 shadow-sm p-6">
                <h2 className="text-base font-black text-gray-800 dark:text-white mb-4">Active Sessions</h2>
                <div className="space-y-3">
                  {[
                    { device: 'This Device (Chrome)', location: 'Kampala, Uganda', time: 'Now', current: true },
                  ].map((s, i) => (
                    <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-white/5">
                      <div className="flex items-center gap-3">
                        <Globe size={16} className="text-gray-400 dark:text-white/40" />
                        <div>
                          <p className="text-sm font-semibold text-gray-800 dark:text-white flex items-center gap-2">
                            {s.device}
                            {s.current && <span className="text-[10px] bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 rounded-full font-bold">Current</span>}
                          </p>
                          <p className="text-xs text-gray-400 dark:text-white/30">{s.location} · {s.time}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── NOTIFICATIONS ───────────────────────────────────── */}
          {tab === 'notifications' && (
            <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/8 shadow-sm p-6 space-y-6">
              <div>
                <h2 className="text-base font-black text-gray-800 dark:text-white">Notification Preferences</h2>
                <p className="text-xs text-gray-400 dark:text-white/40 mt-0.5">Choose how and when you want to be notified</p>
              </div>

              {/* Push toggle */}
              <div className="p-4 rounded-2xl border border-amber-200 dark:border-amber-700/30 bg-amber-50 dark:bg-amber-900/10">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Smartphone size={18} className="text-amber-600 dark:text-amber-400" />
                    <div>
                      <p className="text-sm font-bold text-gray-800 dark:text-white">Browser Push Notifications</p>
                      <p className="text-xs text-gray-500 dark:text-white/40">
                        {notifPerm === 'granted' ? 'Enabled — you will receive desktop alerts'
                          : notifPerm === 'denied' ? 'Blocked — enable in browser settings'
                          : notifPerm === 'unsupported' ? 'Not supported in this browser'
                          : 'Not yet enabled'}
                      </p>
                    </div>
                  </div>
                  {notifPerm !== 'granted' && notifPerm !== 'denied' && notifPerm !== 'unsupported' && (
                    <button onClick={enablePushNotifications}
                      className="px-4 py-2 rounded-xl text-xs font-black text-white"
                      style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
                      Enable
                    </button>
                  )}
                  {notifPerm === 'granted' && (
                    <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 size={14} /> Active
                    </span>
                  )}
                </div>
              </div>

              {/* Channels */}
              <div>
                <p className="text-xs font-black text-gray-500 dark:text-white/50 uppercase tracking-widest mb-3">Channels</p>
                <div className="space-y-3">
                  {[
                    { icon: Mail,         label: 'Email notifications',   sub: 'Daily digest and alerts to your email', val: notifEmail,  set: setNotifEmail  },
                    { icon: Smartphone,   label: 'Push notifications',    sub: 'Browser / device alerts',              val: notifPerm === 'granted', set: () => {} },
                    { icon: MessageSquare,label: 'SMS notifications',     sub: 'Text alerts to your phone',            val: notifSMS,    set: setNotifSMS    },
                  ].map(({ icon: Icon, label, sub, val, set }) => (
                    <div key={label} className="flex items-center justify-between py-3 border-b border-gray-100 dark:border-white/5 last:border-0">
                      <div className="flex items-center gap-3">
                        <Icon size={15} className="text-gray-400 dark:text-white/40" />
                        <div>
                          <p className="text-sm font-semibold text-gray-800 dark:text-white">{label}</p>
                          <p className="text-xs text-gray-400 dark:text-white/30">{sub}</p>
                        </div>
                      </div>
                      <button onClick={() => (set as any)(!val)}
                        className={cn('w-11 h-6 rounded-full transition-all relative flex-shrink-0', val ? 'bg-cyan-500' : 'bg-gray-200 dark:bg-white/10')}>
                        <span className={cn('absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all', val ? 'left-6' : 'left-1')} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Alert types */}
              <div>
                <p className="text-xs font-black text-gray-500 dark:text-white/50 uppercase tracking-widest mb-3">Alert Types</p>
                <div className="space-y-3">
                  {[
                    { label: 'New appointments',   sub: 'When a new appointment is booked',          val: notifAppt,   set: setNotifAppt   },
                    { label: 'Escalations',        sub: 'When AI escalates a patient to you',        val: notifEscal,  set: setNotifEscal  },
                    { label: 'Daily reports',      sub: 'End-of-day summary sent each evening',      val: notifReport, set: setNotifReport },
                  ].map(({ label, sub, val, set }) => (
                    <div key={label} className="flex items-center justify-between py-2.5">
                      <div>
                        <p className="text-sm font-semibold text-gray-800 dark:text-white">{label}</p>
                        <p className="text-xs text-gray-400 dark:text-white/30">{sub}</p>
                      </div>
                      <button onClick={() => set(!val)}
                        className={cn('w-11 h-6 rounded-full transition-all relative flex-shrink-0', val ? 'bg-cyan-500' : 'bg-gray-200 dark:bg-white/10')}>
                        <span className={cn('absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all', val ? 'left-6' : 'left-1')} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <button onClick={saveNotifications}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-black text-white transition-all hover:-translate-y-0.5"
                style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)', boxShadow: '0 4px 16px rgba(41,171,226,0.3)' }}>
                <Save size={14} /> Save Preferences
              </button>
            </div>
          )}

          {/* ── INTEGRATIONS ────────────────────────────────────── */}
          {tab === 'integrations' && (
            <div className="space-y-4">
              {/* Google Calendar card */}
              <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/8 shadow-sm overflow-hidden">

                {/* Header */}
                <div className="px-6 py-5 border-b border-gray-100 dark:border-white/8 flex items-center gap-4">
                  <div className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0"
                    style={{ background: 'linear-gradient(135deg,#4285F4,#34A853)' }}>
                    <Calendar size={20} className="text-white" />
                  </div>
                  <div className="flex-1">
                    <h2 className="text-base font-black text-gray-800 dark:text-white">Google Calendar</h2>
                    <p className="text-xs text-gray-400 dark:text-white/40 mt-0.5">Two-way sync — appointments appear in Google Calendar and changes reflect back here</p>
                  </div>
                  {gcal.connected
                    ? <span className="flex items-center gap-1.5 text-xs font-black text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-700/30 px-2.5 py-1 rounded-full">
                        <Wifi size={12} /> Connected
                      </span>
                    : <span className="flex items-center gap-1.5 text-xs font-black text-gray-400 dark:text-white/30 bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 px-2.5 py-1 rounded-full">
                        <WifiOff size={12} /> Not connected
                      </span>
                  }
                </div>

                <div className="px-6 py-5 space-y-5">
                  {gcal.connected ? (
                    <>
                      {/* Connection details */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between py-2 border-b border-gray-50 dark:border-white/5">
                          <span className="text-xs font-bold text-gray-500 dark:text-white/50">Google Account</span>
                          <span className="text-sm text-gray-800 dark:text-white font-medium">{gcal.email || '—'}</span>
                        </div>
                        <div className="flex items-center justify-between py-2 border-b border-gray-50 dark:border-white/5">
                          <span className="text-xs font-bold text-gray-500 dark:text-white/50">Sync Direction</span>
                          <span className="text-sm text-gray-800 dark:text-white font-medium flex items-center gap-1.5">
                            <RefreshCw size={12} className="text-cyan-500" /> Two-way
                          </span>
                        </div>
                        <div className="flex items-center justify-between py-2">
                          <span className="text-xs font-bold text-gray-500 dark:text-white/50">Push Notifications</span>
                          {gcal.webhookActive
                            ? <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                                <CheckCircle2 size={13} /> Active
                              </span>
                            : <span className="flex items-center gap-1.5 text-xs font-bold text-amber-500">
                                <AlertCircle size={13} /> Inactive
                              </span>
                          }
                        </div>
                      </div>

                      {/* What syncs */}
                      <div className="bg-gray-50 dark:bg-white/3 rounded-xl p-4 space-y-2">
                        <p className="text-[11px] font-black text-gray-500 dark:text-white/40 uppercase tracking-widest mb-2">What syncs</p>
                        {[
                          'New appointments → created in Google Calendar',
                          'Reschedules → time updated in Google Calendar',
                          'Status changes → event colour updated',
                          'Google Calendar moves → appointment time updated here',
                          'Google Calendar deletions → appointment marked cancelled',
                        ].map(item => (
                          <div key={item} className="flex items-center gap-2.5 text-xs text-gray-600 dark:text-white/60">
                            <CheckCircle2 size={12} className="text-emerald-500 flex-shrink-0" />
                            {item}
                          </div>
                        ))}
                      </div>

                      {/* Actions */}
                      <div className="flex flex-wrap gap-3">
                        <button onClick={manualSync} disabled={syncing}
                          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-60 transition-all hover:-translate-y-0.5"
                          style={{ background: 'linear-gradient(135deg,#4285F4,#34A853)', boxShadow: '0 4px 12px rgba(66,133,244,0.35)' }}>
                          {syncing
                            ? <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Syncing...</>
                            : <><RotateCw size={14} /> Sync Now</>
                          }
                        </button>
                        <button onClick={disconnectGCal}
                          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold border border-red-200 dark:border-red-700/40 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                          <Unlink size={14} /> Disconnect
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      {/* Not connected — benefits list */}
                      <div className="space-y-2">
                        {[
                          'Appointments auto-appear in your Google Calendar',
                          'Get Google reminders for each appointment',
                          'Move events in Google Calendar to reschedule here',
                          'Delete events in Google to cancel appointments',
                        ].map(item => (
                          <div key={item} className="flex items-center gap-2.5 text-sm text-gray-600 dark:text-white/60">
                            <div className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                              <Check size={11} className="text-blue-500" />
                            </div>
                            {item}
                          </div>
                        ))}
                      </div>

                      <button onClick={connectGCal} disabled={gcalLoading}
                        className="flex items-center gap-2.5 px-5 py-3 rounded-xl text-sm font-black text-white disabled:opacity-60 transition-all hover:-translate-y-0.5"
                        style={{ background: 'linear-gradient(135deg,#4285F4,#34A853)', boxShadow: '0 4px 16px rgba(66,133,244,0.4)' }}>
                        {gcalLoading
                          ? <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Redirecting...</>
                          : <><Calendar size={15} /> Connect Google Calendar</>
                        }
                      </button>
                      <p className="text-xs text-gray-400 dark:text-white/30">
                        You will be redirected to Google to grant calendar access. Only the clinic calendar is used.
                      </p>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── APPEARANCE ──────────────────────────────────────── */}
          {tab === 'appearance' && (
            <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/8 shadow-sm p-6 space-y-6">
              <div>
                <h2 className="text-base font-black text-gray-800 dark:text-white">Appearance</h2>
                <p className="text-xs text-gray-400 dark:text-white/40 mt-0.5">Customize how Code Clinic looks for you</p>
              </div>

              {/* Theme selector */}
              <div>
                <p className="text-xs font-black text-gray-500 dark:text-white/50 uppercase tracking-widest mb-3">Theme</p>
                <div className="grid grid-cols-3 gap-3">
                  {([
                    { key: 'light',  label: 'Light',  icon: Sun,     preview: 'bg-white border-gray-200' },
                    { key: 'dark',   label: 'Dark',   icon: Moon,    preview: 'bg-[#0f2d5e] border-cyan-500/30' },
                    { key: 'system', label: 'System', icon: Monitor, preview: 'bg-gradient-to-br from-white to-[#0f2d5e] border-gray-300' },
                  ] as { key: Theme; label: string; icon: any; preview: string }[]).map(({ key, label, icon: Icon, preview }) => (
                    <button key={key} onClick={() => changeTheme(key)}
                      className={cn(
                        'flex flex-col items-center gap-2.5 p-4 rounded-2xl border-2 transition-all',
                        theme === key
                          ? 'border-cyan-500 bg-cyan-50 dark:bg-cyan-500/10'
                          : 'border-gray-200 dark:border-white/10 hover:border-gray-300 dark:hover:border-white/20',
                      )}>
                      <div className={cn('w-12 h-8 rounded-lg border', preview)} />
                      <div className="flex items-center gap-1.5">
                        <Icon size={13} className={theme === key ? 'text-cyan-500' : 'text-gray-500 dark:text-white/50'} />
                        <span className={cn('text-xs font-bold', theme === key ? 'text-cyan-600 dark:text-cyan-400' : 'text-gray-600 dark:text-white/60')}>
                          {label}
                        </span>
                      </div>
                      {theme === key && (
                        <div className="w-4 h-4 rounded-full bg-cyan-500 flex items-center justify-center">
                          <Check size={10} className="text-white" />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Language */}
              <div>
                <p className="text-xs font-black text-gray-500 dark:text-white/50 uppercase tracking-widest mb-3">Language & Region</p>
                <select value={lang} onChange={e => setLang(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/30">
                  <option value="en-UG">English (Uganda)</option>
                  <option value="en-US">English (United States)</option>
                  <option value="en-GB">English (United Kingdom)</option>
                </select>
              </div>

              {/* Font size preview */}
              <div className="p-4 rounded-2xl bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/8">
                <p className="text-xs font-black text-gray-500 dark:text-white/50 uppercase tracking-widest mb-3">Preview</p>
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-sm font-black"
                    style={{ background: 'linear-gradient(135deg,#29ABE2,#1A237E)' }}>
                    {initials}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-800 dark:text-white">{user?.firstName} {user?.lastName}</p>
                    <p className="text-xs text-gray-400 dark:text-white/40">Receptionist · Code Clinic</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  )
}
