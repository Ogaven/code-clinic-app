'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowLeft, Camera, Save, Eye, EyeOff, Sun, Moon, Monitor, CheckCircle } from 'lucide-react'
import { cn, getInitials } from '@/lib/utils'

const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
const DAY_KEYS = ['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY','SUNDAY']

type Theme = 'light' | 'dark' | 'system'

export default function DoctorProfilePage() {
  const [doctor, setDoctor]       = useState<any>(null)
  const [user, setUser]           = useState<any>(null)
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [toast, setToast]         = useState('')

  // Form state
  const [firstName, setFirstName]     = useState('')
  const [lastName, setLastName]       = useState('')
  const [phone, setPhone]             = useState('')
  const [specialisation, setSpec]     = useState('')
  const [avatarUrl, setAvatarUrl]     = useState<string | null>(null)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Availability
  const [workingDays, setWorkingDays] = useState<string[]>([])
  const [startTime, setStartTime]     = useState('08:00')
  const [endTime, setEndTime]         = useState('17:00')
  const [availSaving, setAvailSaving] = useState(false)

  // Password
  const [curPwd, setCurPwd]   = useState('')
  const [newPwd, setNewPwd]   = useState('')
  const [confPwd, setConfPwd] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [pwdSaving, setPwdSaving] = useState(false)
  const [pwdError, setPwdError]   = useState('')

  // Theme
  const [theme, setTheme] = useState<Theme>('dark')

  // Check-in history
  const [checkIns, setCheckIns] = useState<any[]>([])

  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null

  const fetchData = useCallback(async () => {
    if (!token) return
    try {
      const u = JSON.parse(localStorage.getItem('cc_user') || '{}')
      setUser(u)
      setFirstName(u.firstName || '')
      setLastName(u.lastName || '')
      setPhone(u.phone || '')
      const t = (localStorage.getItem('cc_theme') as Theme) || 'dark'
      setTheme(t)

      const dr = await fetch('/api-proxy/doctors', { headers: { Authorization: `Bearer ${token}` } })
      const docs = await dr.json()
      const me = Array.isArray(docs) ? docs.find((d: any) => d.userId === u.id) : null
      setDoctor(me)
      if (me) {
        setSpec(me.specialisation || '')
        setAvatarUrl(me.avatarUrl || null)
        const days = Array.isArray(me.workingDays) ? me.workingDays : (me.workingDays ? JSON.parse(me.workingDays) : [])
        setWorkingDays(days)
        if (me.workStartTime) setStartTime(me.workStartTime.slice(0, 5))
        if (me.workEndTime) setEndTime(me.workEndTime.slice(0, 5))
      }

      const ciRes = await fetch('/api-proxy/doctors/check-in/history', { headers: { Authorization: `Bearer ${token}` } })
      if (ciRes.ok) setCheckIns(await ciRes.json())
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }, [token])

  useEffect(() => { fetchData() }, [fetchData])

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 3500) }

  async function saveProfile() {
    if (!doctor || !token) return
    setSaving(true)
    try {
      await fetch(`/api-proxy/employees/${user.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ firstName, lastName, phone }),
      })
      await fetch(`/api-proxy/doctors/${doctor.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ specialisation }),
      })
      const stored = JSON.parse(localStorage.getItem('cc_user') || '{}')
      localStorage.setItem('cc_user', JSON.stringify({ ...stored, firstName, lastName, phone }))
      showToast('Profile saved!')
    } catch {} finally { setSaving(false) }
  }

  async function saveAvailability() {
    if (!doctor || !token) return
    setAvailSaving(true)
    try {
      await fetch(`/api-proxy/doctors/${doctor.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ workingDays, workStartTime: startTime, workEndTime: endTime }),
      })
      showToast('Availability updated!')
    } catch {} finally { setAvailSaving(false) }
  }

  async function changePassword() {
    setPwdError('')
    if (newPwd !== confPwd) { setPwdError('Passwords do not match'); return }
    if (newPwd.length < 8) { setPwdError('Password must be at least 8 characters'); return }
    if (!token) return
    setPwdSaving(true)
    try {
      const r = await fetch('/api-proxy/auth/change-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ currentPassword: curPwd, newPassword: newPwd }),
      })
      if (r.ok) { showToast('Password updated!'); setCurPwd(''); setNewPwd(''); setConfPwd('') }
      else { const d = await r.json(); setPwdError(d.error || 'Failed to update password') }
    } catch { setPwdError('Network error') } finally { setPwdSaving(false) }
  }

  async function handleAvatarFile(file: File) {
    if (!file || !token || !user) return
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) { showToast('Only JPEG, PNG, WebP allowed'); return }
    setAvatarUploading(true)
    const reader = new FileReader()
    reader.onload = e => { if (e.target?.result) setAvatarUrl(e.target.result as string) }
    reader.readAsDataURL(file)
    try {
      const form = new FormData(); form.append('avatar', file)
      const r = await fetch(`/api-proxy/employees/${user.id}/avatar`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
      })
      if (r.ok) {
        const d = await r.json()
        setAvatarUrl(d.avatarUrl)
        localStorage.setItem('cc_avatar', d.avatarUrl)
        window.dispatchEvent(new CustomEvent('cc-avatar-updated', { detail: d.avatarUrl }))
        showToast('Photo updated!')
      } else {
        const d = await r.json().catch(() => ({}))
        showToast(d.error || `Upload failed (${r.status})`)
      }
    } catch (e: any) {
      showToast('Upload failed — check connection')
    } finally { setAvatarUploading(false) }
  }

  function applyTheme(t: Theme) {
    const root = document.documentElement
    if (t === 'dark') root.classList.add('dark')
    else if (t === 'light') root.classList.remove('dark')
    else window.matchMedia('(prefers-color-scheme: dark)').matches ? root.classList.add('dark') : root.classList.remove('dark')
    setTheme(t); localStorage.setItem('cc_theme', t)
  }

  function toggleDay(dayKey: string) {
    setWorkingDays(prev => prev.includes(dayKey) ? prev.filter(d => d !== dayKey) : [...prev, dayKey])
  }

  function fmtDuration(ins: any[]) {
    const checkIn = ins.find(i => i.type === 'CHECK_IN')
    const checkOut = ins.find(i => i.type === 'CHECK_OUT')
    if (!checkIn || !checkOut) return '—'
    const mins = Math.floor((new Date(checkOut.createdAt).getTime() - new Date(checkIn.createdAt).getTime()) / 60000)
    return `${Math.floor(mins / 60)}h ${mins % 60}m`
  }

  if (loading) return (
    <div className="p-6 space-y-4 animate-pulse">
      <div className="h-8 w-48 bg-gray-200 dark:bg-white/10 rounded" />
      <div className="h-40 bg-gray-100 dark:bg-white/5 rounded-2xl" />
    </div>
  )

  const initials = getInitials(firstName, lastName)

  return (
    <div className="space-y-5 p-4 md:p-6 pb-24 md:pb-6 animate-fade-in max-w-2xl">
      {toast && (
        <div className="fixed top-4 right-4 z-[99999] bg-emerald-600 text-white px-5 py-3 rounded-2xl shadow-2xl text-sm font-semibold flex items-center gap-2">
          <CheckCircle size={15} /> {toast}
        </div>
      )}

      <div className="flex items-center gap-3">
        <Link href="/doctor/dashboard" className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-white/10 text-gray-400">
          <ArrowLeft size={16} />
        </Link>
        <h1 className="text-xl font-bold text-gray-800 dark:text-white">My Profile</h1>
      </div>

      {/* ── 1. PHOTO & BASIC INFO ──────────────────────────────────────── */}
      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm p-5 space-y-4">
        <h2 className="font-bold text-gray-800 dark:text-white text-sm">Photo & Basic Info</h2>

        {/* Avatar */}
        <div className="flex items-center gap-4">
          <div className="relative w-20 h-20 flex-shrink-0">
            {avatarUrl
              ? <Image src={avatarUrl} alt="Avatar" fill className="rounded-full object-cover" />
              : <div className="w-20 h-20 rounded-full flex items-center justify-center text-2xl font-black text-white" style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>{initials}</div>
            }
            <button onClick={() => fileRef.current?.click()}
              className="absolute -bottom-1 -right-1 w-7 h-7 bg-blue-600 rounded-full flex items-center justify-center text-white shadow-lg hover:bg-blue-700 transition-colors">
              {avatarUploading ? <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Camera size={13} />}
            </button>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
              onChange={e => { if (e.target.files?.[0]) handleAvatarFile(e.target.files[0]) }} />
          </div>
          <div>
            <p className="font-bold text-gray-800 dark:text-white">Dr. {firstName} {lastName}</p>
            <p className="text-sm text-gray-400">{specialisation || 'General Dentist'}</p>
            <p className="text-xs text-gray-400">{user?.email}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { label: 'First Name', value: firstName, set: setFirstName },
            { label: 'Last Name', value: lastName, set: setLastName },
            { label: 'Phone', value: phone, set: setPhone },
            { label: 'Specialisation', value: specialisation, set: setSpec },
          ].map(({ label, value, set }) => (
            <div key={label}>
              <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1 block">{label}</label>
              <input value={value} onChange={e => set(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none" />
            </div>
          ))}
        </div>

        <button onClick={saveProfile} disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors min-h-[44px]">
          <Save size={14} /> {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>

      {/* ── 2. AVAILABILITY ──────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm p-5 space-y-4">
        <h2 className="font-bold text-gray-800 dark:text-white text-sm">Working Days & Hours</h2>

        <div className="flex gap-2 flex-wrap">
          {DAYS.map((day, i) => {
            const key = DAY_KEYS[i]
            const active = workingDays.includes(key)
            return (
              <button key={key} onClick={() => toggleDay(key)}
                className={cn('w-11 h-11 rounded-xl text-xs font-bold transition-all',
                  active ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/20')}>
                {day}
              </button>
            )
          })}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1 block">Start Time</label>
            <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none" />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1 block">End Time</label>
            <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none" />
          </div>
        </div>

        <button onClick={saveAvailability} disabled={availSaving}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 transition-colors min-h-[44px]">
          <Save size={14} /> {availSaving ? 'Saving…' : 'Save Availability'}
        </button>
      </div>

      {/* ── 3. CHANGE PASSWORD ───────────────────────────────────────────── */}
      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm p-5 space-y-4">
        <h2 className="font-bold text-gray-800 dark:text-white text-sm">Change Password</h2>

        {[
          { label: 'Current Password', value: curPwd, set: setCurPwd },
          { label: 'New Password', value: newPwd, set: setNewPwd },
          { label: 'Confirm New Password', value: confPwd, set: setConfPwd },
        ].map(({ label, value, set }) => (
          <div key={label}>
            <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1 block">{label}</label>
            <div className="relative">
              <input type={showPwd ? 'text' : 'password'} value={value} onChange={e => set(e.target.value)}
                className="w-full pl-3 pr-10 py-2.5 text-sm border border-gray-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none" />
              <button type="button" onClick={() => setShowPwd(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-white">
                {showPwd ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
        ))}

        {pwdError && <p className="text-xs text-red-500 font-medium">{pwdError}</p>}

        <button onClick={changePassword} disabled={pwdSaving || !curPwd || !newPwd || !confPwd}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50 transition-colors min-h-[44px]">
          <Save size={14} /> {pwdSaving ? 'Updating…' : 'Update Password'}
        </button>
      </div>

      {/* ── 4. THEME ─────────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm p-5 space-y-3">
        <h2 className="font-bold text-gray-800 dark:text-white text-sm">Display Theme</h2>
        <div className="flex gap-3">
          {([['light', 'Light', Sun], ['system', 'System', Monitor], ['dark', 'Dark', Moon]] as const).map(([t, label, Icon]) => (
            <button key={t} onClick={() => applyTheme(t)}
              className={cn('flex-1 flex flex-col items-center gap-1.5 py-3 rounded-xl border-2 text-xs font-semibold transition-all',
                theme === t ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400' : 'border-gray-200 dark:border-white/10 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-white/20')}>
              <Icon size={18} /> {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── 5. CHECK IN HISTORY ──────────────────────────────────────────── */}
      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-50 dark:border-white/[0.06]">
          <h2 className="font-bold text-gray-800 dark:text-white text-sm">Check-In History (Last 7 Days)</h2>
        </div>
        {checkIns.length === 0 ? (
          <p className="text-sm text-gray-400 px-5 py-6 text-center">No check-in records found</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 dark:bg-white/[0.03]">
                  {['Date','Time','Type'].map(h => (
                    <th key={h} className="text-left text-[10px] font-bold uppercase tracking-wide text-gray-400 px-5 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-white/[0.04]">
                {checkIns.slice(0, 14).map((ci) => (
                  <tr key={ci.id} className="hover:bg-gray-50 dark:hover:bg-white/[0.03]">
                    <td className="px-5 py-3 text-xs text-gray-600 dark:text-gray-300">
                      {new Date(ci.createdAt).toLocaleDateString('en-UG', { weekday: 'short', day: 'numeric', month: 'short' })}
                    </td>
                    <td className="px-5 py-3 text-xs text-gray-600 dark:text-gray-300">
                      {new Date(ci.createdAt).toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi' })}
                    </td>
                    <td className="px-5 py-3">
                      <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full',
                        ci.type === 'CHECK_IN' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-400')}>
                        {ci.type === 'CHECK_IN' ? '✓ Check In' : '← Check Out'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
