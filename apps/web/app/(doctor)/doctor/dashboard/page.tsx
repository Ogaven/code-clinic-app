'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  Calendar, Users, CheckCircle2, Clock, TrendingUp,
  ChevronRight, Stethoscope, Activity, CalendarPlus, Ban,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import Avatar from '@/components/ui/Avatar'
import AvatarUpload from '@/components/ui/AvatarUpload'
import LivePatientFlow from '@/components/scheduling/LivePatientFlow'

// ── Status config ─────────────────────────────────────────────
const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Scheduled', CONFIRMED: 'Confirmed',
  ARRIVED: 'Arrived', WAITING: 'Waiting', IN_OPERATORY: 'In Operatory',
  WITH_PROVIDER: 'With Provider', SESSION_COMPLETE: 'Complete', CHECKOUT: 'Checkout',
  DEPARTED: 'Left', CHECKED_IN: 'Checked In', IN_CHAIR: 'In Chair',
  READY_CHECKOUT: 'Ready', COMPLETED: 'Done', CANCELLED: 'Cancelled', NO_SHOW: 'No Show',
}
const STATUS_COLOR: Record<string, { bg: string; text: string }> = {
  PENDING:          { bg: 'bg-slate-100', text: 'text-slate-600' },
  CONFIRMED:        { bg: 'bg-blue-100',  text: 'text-blue-700' },
  ARRIVED:          { bg: 'bg-amber-100', text: 'text-amber-700' },
  WAITING:          { bg: 'bg-yellow-100',text: 'text-yellow-700' },
  IN_OPERATORY:     { bg: 'bg-orange-100',text: 'text-orange-700' },
  WITH_PROVIDER:    { bg: 'bg-teal-100',  text: 'text-teal-700' },
  SESSION_COMPLETE: { bg: 'bg-green-100', text: 'text-green-700' },
  CHECKOUT:         { bg: 'bg-purple-100',text: 'text-purple-700' },
  DEPARTED:         { bg: 'bg-gray-100',  text: 'text-gray-500' },
  CHECKED_IN:       { bg: 'bg-amber-100', text: 'text-amber-700' },
  IN_CHAIR:         { bg: 'bg-orange-100',text: 'text-orange-700' },
  READY_CHECKOUT:   { bg: 'bg-purple-100',text: 'text-purple-700' },
  COMPLETED:        { bg: 'bg-green-100', text: 'text-green-700' },
  CANCELLED:        { bg: 'bg-gray-100',  text: 'text-gray-500' },
  NO_SHOW:          { bg: 'bg-red-50',    text: 'text-red-500' },
}
const STATUS_NEXT: Record<string, string> = {
  CONFIRMED: 'ARRIVED', ARRIVED: 'WAITING', WAITING: 'IN_OPERATORY',
  IN_OPERATORY: 'WITH_PROVIDER', WITH_PROVIDER: 'SESSION_COMPLETE',
  SESSION_COMPLETE: 'DEPARTED',
  // legacy
  CHECKED_IN: 'IN_CHAIR', IN_CHAIR: 'WITH_PROVIDER', READY_CHECKOUT: 'COMPLETED',
}
const STATUS_NEXT_LABEL: Record<string, string> = {
  CONFIRMED: 'Mark Arrived', ARRIVED: 'Seat in Waiting',
  WAITING: 'Move to Room', IN_OPERATORY: 'With Provider',
  WITH_PROVIDER: 'Session Done', SESSION_COMPLETE: 'Mark Departed',
  CHECKED_IN: 'In Chair', IN_CHAIR: 'With Provider', READY_CHECKOUT: 'Complete',
}

function getGreeting() {
  const h = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Kampala' })).getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

// ── Appointment card (mobile-first big tap targets) ───────────
function ApptCard({ appt, onRefresh, token }: { appt: any; onRefresh: () => void; token: string | null }) {
  const [loading, setLoading] = useState(false)
  const startTime = new Date(appt.startAt).toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Kampala' })
  const endTime = new Date(appt.endAt).toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Kampala' })
  const sc = STATUS_COLOR[appt.status] || STATUS_COLOR.PENDING
  const nextStatus = STATUS_NEXT[appt.status]
  const isActive = ['ARRIVED','WAITING','IN_OPERATORY','WITH_PROVIDER','CHECKED_IN','IN_CHAIR'].includes(appt.status)

  async function advance() {
    if (!nextStatus) return
    setLoading(true)
    try {
      await fetch(`/api-proxy/scheduling/appointments/${appt.id}/status`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      })
      onRefresh()
    } finally { setLoading(false) }
  }

  return (
    <div className={cn(
      'rounded-2xl border bg-white shadow-sm p-4 transition-all',
      isActive ? 'border-teal-200 ring-1 ring-teal-100' : 'border-gray-100',
    )}>
      <div className="flex items-start gap-3">
        <Avatar
          firstName={appt.patient?.firstName}
          lastName={appt.patient?.lastName}
          colour={appt.service?.colour || '#29ABE2'}
          size="md"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div>
              <p className="font-bold text-gray-900 text-base">{appt.patient?.firstName} {appt.patient?.lastName}</p>
              <p className="text-xs text-gray-400 mt-0.5">{appt.service?.name}</p>
            </div>
            <span className={cn('text-[11px] font-bold px-2.5 py-1 rounded-full flex-shrink-0', sc.bg, sc.text)}>
              {STATUS_LABEL[appt.status] || appt.status}
            </span>
          </div>

          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <span className="flex items-center gap-1 text-xs text-gray-500">
              <Clock size={12} /> {startTime} – {endTime}
            </span>
          </div>

          <div className="flex gap-2 mt-3">
            <Link href={`/patients/${appt.patient?.id}?tab=dental`}
              className="flex-1 h-11 flex items-center justify-center text-xs font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors">
              🦷 Chart
            </Link>
            <Link href={`/patients/${appt.patient?.id}`}
              className="flex-1 h-11 flex items-center justify-center text-xs font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors">
              Profile
            </Link>
            {nextStatus && !['DEPARTED','COMPLETED','CANCELLED','NO_SHOW'].includes(appt.status) && (
              <button
                onClick={advance}
                disabled={loading}
                className="flex-[2] h-11 flex items-center justify-center gap-1 text-xs font-bold text-white rounded-xl transition-all hover:opacity-90 disabled:opacity-60"
                style={{ background: isActive ? '#0D9488' : '#3B82F6' }}>
                {loading ? '...' : `→ ${STATUS_NEXT_LABEL[appt.status] || 'Advance'}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────
export default function DoctorDashboard() {
  const [user, setUser]         = useState<any>(null)
  const [doctor, setDoctor]     = useState<any>(null)
  const [todayAppts, setToday]  = useState<any[]>([])
  const [stats, setStats]       = useState({ total: 0, completed: 0, pending: 0, inProgress: 0 })
  const [loading, setLoading]   = useState(true)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)

  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null

  const fetchAll = useCallback(async () => {
    try {
      const [appts, doctors] = await Promise.all([
        fetch('/api-proxy/scheduling/appointments?today=true', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
        fetch('/api-proxy/doctors', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
      ])

      const u = JSON.parse(localStorage.getItem('cc_user') || '{}')
      setUser(u)

      const myDoctor = Array.isArray(doctors)
        ? doctors.find((d: any) => d.userId === u.id || d.firstName === u.firstName)
        : null
      setDoctor(myDoctor)
      if (myDoctor?.avatarUrl) setAvatarUrl(myDoctor.avatarUrl)

      const myId = myDoctor?.id
      const todayList = Array.isArray(appts)
        ? (myId ? appts.filter((a: any) => a.doctor?.id === myId || a.doctorId === myId) : appts)
        : []

      setToday(todayList)
      setStats({
        total:      todayList.length,
        completed:  todayList.filter((a: any) => ['COMPLETED','SESSION_COMPLETE','DEPARTED'].includes(a.status)).length,
        pending:    todayList.filter((a: any) => ['PENDING', 'CONFIRMED'].includes(a.status)).length,
        inProgress: todayList.filter((a: any) => ['ARRIVED','WAITING','IN_OPERATORY','WITH_PROVIDER','CHECKED_IN','IN_CHAIR'].includes(a.status)).length,
      })
    } catch (e) {
      console.error(e)
    } finally { setLoading(false) }
  }, [token])

  useEffect(() => {
    fetchAll()
    const t = setInterval(fetchAll, 30000)
    return () => clearInterval(t)
  }, [fetchAll])

  if (loading) return (
    <div className="flex items-center justify-center h-full min-h-[60vh]">
      <div className="text-center">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-gray-400">Loading your dashboard...</p>
      </div>
    </div>
  )

  const docColour = doctor?.colour || '#29ABE2'

  return (
    <div className="pb-24 md:pb-8">
      <div className="p-4 md:p-6 space-y-5 max-w-[1200px] mx-auto animate-fade-in">

        {/* ── Hero ─────────────────────────────────────────────── */}
        <div className="rounded-3xl p-5 text-white relative overflow-hidden"
          style={{ background: `linear-gradient(135deg, #1A237E, ${docColour})`, boxShadow: `0 16px 48px ${docColour}40` }}>
          <div className="relative z-10 flex items-center gap-4">

            {/* Doctor photo — tap to change */}
            <div className="flex-shrink-0">
              {user && (
                <AvatarUpload
                  userId={user.id}
                  firstName={user.firstName || ''}
                  lastName={user.lastName || ''}
                  currentAvatarUrl={avatarUrl}
                  colour={docColour}
                  size="xl"
                  token={token || undefined}
                  onUploaded={(url) => setAvatarUrl(url)}
                />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-blue-200 text-sm font-medium">{getGreeting()},</p>
              <h1 className="text-2xl md:text-3xl font-black truncate">Dr. {user?.firstName} {user?.lastName}</h1>
              <p className="text-blue-200 text-sm mt-0.5">{doctor?.specialisation || 'Dental Practitioner'}</p>
              <div className="flex flex-wrap gap-2 mt-3 text-xs">
                <span className="bg-white/15 rounded-xl px-2.5 py-1 font-semibold">{stats.total} today</span>
                <span className="bg-white/15 rounded-xl px-2.5 py-1 font-semibold">{stats.inProgress} active</span>
                <span className="bg-white/15 rounded-xl px-2.5 py-1 font-semibold">{stats.completed} done</span>
              </div>
            </div>
          </div>
          <p className="text-blue-200/60 text-[10px] mt-2 relative z-10">Tap photo to change</p>
          <div className="absolute -right-12 -top-12 w-48 h-48 rounded-full opacity-10 border-4 border-white" />
          <div className="absolute -right-4 -bottom-16 w-64 h-64 rounded-full opacity-10 border-4 border-white" />
        </div>

        {/* ── KPI Row ───────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { icon: Calendar,     label: "Today's Patients", value: stats.total,      color: '#29ABE2', sub: 'scheduled' },
            { icon: Activity,     label: 'In Progress',      value: stats.inProgress, color: '#F97316', sub: 'in clinic' },
            { icon: CheckCircle2, label: 'Completed',        value: stats.completed,  color: '#10B981', sub: 'today' },
            { icon: Clock,        label: 'Waiting',          value: stats.pending,    color: '#6366F1', sub: 'to be seen' },
          ].map((k, i) => (
            <div key={i} className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm hover:shadow-md transition-all min-h-[88px]">
              <div className="flex items-start justify-between mb-2">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide leading-tight">{k.label}</p>
                <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: k.color + '20' }}>
                  <k.icon size={14} style={{ color: k.color }} />
                </div>
              </div>
              <p className="text-2xl font-black" style={{ color: k.color }}>{k.value}</p>
              <p className="text-[10px] text-gray-400 mt-0.5">{k.sub}</p>
            </div>
          ))}
        </div>

        {/* ── Quick Actions ─────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { href: '/scheduling', icon: CalendarPlus, label: 'View Schedule', color: '#3B82F6', bg: '#EFF6FF' },
            { href: '/patients', icon: Users, label: 'My Patients', color: '#10B981', bg: '#F0FDF4' },
            { href: '/doctor/dashboard', icon: Ban, label: 'Block Time Off', color: '#F59E0B', bg: '#FFFBEB' },
          ].map((a, i) => (
            <Link key={i} href={a.href}
              className="flex flex-col items-center justify-center gap-2 p-4 rounded-2xl border transition-all hover:scale-[1.02] hover:shadow-md min-h-[80px]"
              style={{ background: a.bg, borderColor: a.color + '30' }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: a.color + '20' }}>
                <a.icon size={18} style={{ color: a.color }} />
              </div>
              <p className="text-xs font-bold text-gray-700 text-center leading-tight">{a.label}</p>
            </Link>
          ))}
        </div>

        {/* ── Live Patient Flow (their patients only) ───────────── */}
        <LivePatientFlow doctorId={doctor?.id} refreshInterval={20000} />

        {/* ── Today's Appointments ─────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold text-gray-900">Today&apos;s Schedule</h2>
            <Link href="/scheduling" className="text-xs font-semibold text-blue-600 hover:underline flex items-center gap-1">
              Full Schedule <ChevronRight size={12} />
            </Link>
          </div>

          {todayAppts.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-10 text-center">
              <Calendar size={32} className="mx-auto mb-3 text-gray-200" />
              <p className="text-sm font-medium text-gray-400">No appointments today</p>
              <p className="text-xs text-gray-300 mt-1">Enjoy the quiet time!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {todayAppts.map(appt => (
                <ApptCard key={appt.id} appt={appt} onRefresh={fetchAll} token={token} />
              ))}
            </div>
          )}
        </div>

        {/* ── Doctor Availability (simple toggle) ──────────────── */}
        <DoctorAvailability doctor={doctor} token={token} onSaved={fetchAll} />

      </div>

      {/* ── Mobile Bottom Nav ─────────────────────────────────── */}
      <MobileBottomNav />
    </div>
  )
}

// ── Mobile Bottom Nav ─────────────────────────────────────────
function MobileBottomNav() {
  const [path, setPath] = useState('')
  useEffect(() => { setPath(window.location.pathname) }, [])
  const items = [
    { href: '/doctor/dashboard', icon: '🏠', label: 'Home' },
    { href: '/patients', icon: '👥', label: 'Patients' },
    { href: '/scheduling', icon: '📅', label: 'Schedule' },
    { href: '/receptionist/communications', icon: '💬', label: 'Messages' },
    { href: '/settings', icon: '👤', label: 'Profile' },
  ]
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-white dark:bg-[#0a1525] border-t border-gray-100 dark:border-white/10 safe-area-inset-bottom">
      <div className="flex items-stretch">
        {items.map((item) => {
          const active = path === item.href || path.startsWith(item.href + '/')
          return (
            <Link key={item.href} href={item.href}
              className={cn(
                'flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 min-h-[60px] transition-colors',
                active ? 'text-blue-600' : 'text-gray-400 hover:text-gray-600',
              )}>
              <span className="text-xl leading-none">{item.icon}</span>
              <span className="text-[9px] font-semibold leading-tight">{item.label}</span>
              {active && <span className="absolute top-0 left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-full bg-blue-500" />}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

// ── Doctor Availability Panel ─────────────────────────────────
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function DoctorAvailability({ doctor, token, onSaved }: { doctor: any; token: string | null; onSaved: () => void }) {
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const defaultDays = doctor?.workingDays ? JSON.parse(doctor.workingDays) : [1,2,3,4,5]
  const defaultHours = doctor?.workingHours
    ? (typeof JSON.parse(doctor.workingHours) === 'object' && !Array.isArray(JSON.parse(doctor.workingHours))
        ? JSON.parse(doctor.workingHours)
        : { start: '08:00', end: '18:00' })
    : { start: '08:00', end: '18:00' }

  const [activeDays, setActiveDays] = useState<number[]>(defaultDays)
  const [hours, setHours] = useState<{ start: string; end: string }>(defaultHours)

  if (!doctor) return null

  function toggleDay(d: number) {
    setActiveDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort())
  }

  async function save() {
    setSaving(true)
    try {
      await fetch(`/api-proxy/doctors/${doctor.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ workingDays: activeDays, workingHours: hours }),
      })
      setSaved(true); setTimeout(() => setSaved(false), 2000)
      onSaved()
    } finally { setSaving(false) }
  }

  return (
    <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm p-4">
      <h3 className="text-sm font-bold text-gray-800 dark:text-white mb-4">My Availability</h3>

      {/* Working days */}
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Working Days</p>
      <div className="flex gap-2 mb-4 flex-wrap">
        {DAYS.map((d, i) => {
          const dayNum = i + 1
          const active = activeDays.includes(dayNum)
          return (
            <button key={d} onClick={() => toggleDay(dayNum)}
              className={cn(
                'min-h-[44px] min-w-[44px] rounded-xl text-xs font-bold transition-all',
                active
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-gray-100 text-gray-400 hover:bg-gray-200',
              )}>
              {d}
            </button>
          )
        })}
      </div>

      {/* Working hours */}
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Working Hours</p>
      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1">
          <label className="text-[10px] text-gray-400">From</label>
          <input type="time" value={hours.start} onChange={e => setHours(h => ({ ...h, start: e.target.value }))}
            className="block w-full mt-1 px-3 py-2.5 border border-gray-200 dark:border-white/10 rounded-xl text-sm bg-gray-50 dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]" />
        </div>
        <div className="flex-1">
          <label className="text-[10px] text-gray-400">To</label>
          <input type="time" value={hours.end} onChange={e => setHours(h => ({ ...h, end: e.target.value }))}
            className="block w-full mt-1 px-3 py-2.5 border border-gray-200 dark:border-white/10 rounded-xl text-sm bg-gray-50 dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]" />
        </div>
      </div>

      <button onClick={save} disabled={saving}
        className="w-full h-12 rounded-xl font-bold text-sm text-white transition-all hover:opacity-90 disabled:opacity-60"
        style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
        {saving ? 'Saving...' : saved ? '✓ Saved!' : 'Save Availability'}
      </button>
    </div>
  )
}
