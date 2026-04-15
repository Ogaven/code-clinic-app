'use client'

import { useEffect, useState, useCallback } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import {
  Calendar, Users, CheckCircle, Clock, Activity,
  ChevronRight, CalendarDays, Ban,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import LivePatientFlow from '@/components/scheduling/LivePatientFlow'

// ── Kampala live clock ──────────────────────────────────────────────────────
function KampalaClock() {
  const [time, setTime] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  const kla = new Date(time.toLocaleString('en-US', { timeZone: 'Africa/Kampala' }))
  const h = kla.getHours() % 12, m = kla.getMinutes(), s = kla.getSeconds()
  const hDeg = h / 12 * 360 + m / 60 * 30
  const mDeg = m / 60 * 360 + s / 60 * 6
  const sDeg = s / 60 * 360
  const cx = 36, cy = 36, r = 32
  const hand = (deg: number, len: number) => ({
    x2: cx + Math.cos((deg - 90) * Math.PI / 180) * len,
    y2: cy + Math.sin((deg - 90) * Math.PI / 180) * len,
  })
  const timeStr = kla.toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })
  const dateStr = kla.toLocaleDateString('en-UG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Kampala' })
  return (
    <div className="flex items-center gap-3">
      <svg width="72" height="72" viewBox="0 0 72 72">
        <circle cx={cx} cy={cy} r={r} fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" />
        {Array.from({ length: 12 }).map((_, i) => {
          const a = (i / 12) * 360 - 90
          const x1 = cx + Math.cos(a * Math.PI / 180) * (r - 5)
          const y1 = cy + Math.sin(a * Math.PI / 180) * (r - 5)
          const x2 = cx + Math.cos(a * Math.PI / 180) * (r - 2)
          const y2 = cy + Math.sin(a * Math.PI / 180) * (r - 2)
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(255,255,255,0.4)" strokeWidth={i % 3 === 0 ? 2 : 1} strokeLinecap="round" />
        })}
        <line x1={cx} y1={cy} x2={hand(hDeg, 18).x2} y2={hand(hDeg, 18).y2} stroke="white" strokeWidth="2.5" strokeLinecap="round" />
        <line x1={cx} y1={cy} x2={hand(mDeg, 25).x2} y2={hand(mDeg, 25).y2} stroke="#29ABE2" strokeWidth="2" strokeLinecap="round" />
        <line x1={cx} y1={cy} x2={hand(sDeg, 28).x2} y2={hand(sDeg, 28).y2} stroke="#EC4899" strokeWidth="1" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="2.5" fill="white" />
        <circle cx={cx} cy={cy} r="1" fill="#29ABE2" />
      </svg>
      <div>
        <p className="text-white font-bold text-lg leading-none">{timeStr}</p>
        <p className="text-white/60 text-xs mt-0.5">{dateStr}</p>
        <p className="text-emerald-300 text-[10px] font-semibold tracking-wide mt-0.5">EAT · Kampala</p>
      </div>
    </div>
  )
}

function getGreeting() {
  const h = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Kampala' })).getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

const STATUS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  PENDING:          { label: 'Scheduled',  color: '#6B7280', bg: '#F3F4F6' },
  CONFIRMED:        { label: 'Confirmed',  color: '#3B82F6', bg: '#EFF6FF' },
  ARRIVED:          { label: 'Arrived',    color: '#3B82F6', bg: '#DBEAFE' },
  WAITING:          { label: 'Waiting',    color: '#F59E0B', bg: '#FEF3C7' },
  IN_OPERATORY:     { label: 'Operatory',  color: '#F97316', bg: '#FFF7ED' },
  WITH_PROVIDER:    { label: 'In Chair',   color: '#14B8A6', bg: '#F0FDFA' },
  SESSION_COMPLETE: { label: 'Complete',   color: '#10B981', bg: '#ECFDF5' },
  CHECKOUT:         { label: 'Checkout',   color: '#8B5CF6', bg: '#F5F3FF' },
  DEPARTED:         { label: 'Departed',   color: '#6B7280', bg: '#F9FAFB' },
  COMPLETED:        { label: 'Done',       color: '#10B981', bg: '#ECFDF5' },
  CANCELLED:        { label: 'Cancelled',  color: '#EF4444', bg: '#FEF2F2' },
  NO_SHOW:          { label: 'No Show',    color: '#9CA3AF', bg: '#F3F4F6' },
}

function fmtTime(s: string) {
  return new Date(s).toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Kampala' })
}

export default function DoctorDashboardPage() {
  const [user, setUser]               = useState<any>(null)
  const [doctor, setDoctor]           = useState<any>(null)
  const [appointments, setAppts]      = useState<any[]>([])
  const [loading, setLoading]         = useState(true)
  const [checkedIn, setCheckedIn]     = useState(false)
  const [checkInTime, setCheckInTime] = useState('')
  const [checkingIn, setCheckingIn]   = useState(false)
  const [toast, setToast]             = useState('')
  const [blockOpen, setBlockOpen]     = useState(false)
  const [blockDate, setBlockDate]     = useState(() => new Date().toISOString().slice(0, 10))
  const [blockStart, setBlockStart]   = useState('12:00')
  const [blockEnd, setBlockEnd]       = useState('13:00')
  const [blockReason, setBlockReason] = useState('Lunch Break')
  const [blockSaving, setBlockSaving] = useState(false)

  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null

  const fetchData = useCallback(async () => {
    if (!token) return
    try {
      const u = JSON.parse(localStorage.getItem('cc_user') || '{}')
      setUser(u)
      const dr = await fetch('/api-proxy/doctors', { headers: { Authorization: `Bearer ${token}` } })
      const doctors = await dr.json()
      const me = Array.isArray(doctors) ? doctors.find((d: any) => d.userId === u.id) : null
      setDoctor(me)
      const today = new Date().toISOString().slice(0, 10)
      const apptRes = await fetch(`/api-proxy/scheduling/appointments?startDate=${today}&endDate=${today}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const all = await apptRes.json()
      setAppts(Array.isArray(all) && me ? all.filter((a: any) => a.doctorId === me.id) : [])
      const ciRes = await fetch('/api-proxy/doctors/check-in/today', { headers: { Authorization: `Bearer ${token}` } })
      const ci = await ciRes.json()
      setCheckedIn(ci.checkedIn); setCheckInTime(ci.time || '')
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }, [token])

  useEffect(() => { fetchData() }, [fetchData])

  async function handleCheckIn() {
    if (checkedIn || checkingIn || !token) return
    setCheckingIn(true)
    try {
      const r = await fetch('/api-proxy/doctors/check-in', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type: 'CHECK_IN' }),
      })
      const d = await r.json()
      if (d.success) {
        setCheckedIn(true); setCheckInTime(d.time)
        setToast(`Welcome, Dr. ${user?.firstName}! Checked in at ${d.time} 👋`)
        setTimeout(() => setToast(''), 4000)
      }
    } catch {} finally { setCheckingIn(false) }
  }

  async function handleBlockTime() {
    if (!doctor || !token) return
    setBlockSaving(true)
    try {
      await fetch(`/api-proxy/scheduling/doctors/${doctor.id}/block-time`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ startAt: `${blockDate}T${blockStart}:00`, endAt: `${blockDate}T${blockEnd}:00`, reason: blockReason }),
      })
      setBlockOpen(false)
      setToast('Time blocked successfully!')
      setTimeout(() => setToast(''), 3000)
    } catch {} finally { setBlockSaving(false) }
  }

  const completed = appointments.filter(a => ['SESSION_COMPLETE','CHECKOUT','DEPARTED','COMPLETED'].includes(a.status)).length
  const active    = appointments.filter(a => ['ARRIVED','WAITING','IN_OPERATORY','WITH_PROVIDER'].includes(a.status)).length
  const pending   = appointments.filter(a => ['PENDING','CONFIRMED'].includes(a.status)).length

  return (
    <div className="space-y-4 p-4 md:p-6 animate-fade-in">

      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-[99999] bg-emerald-600 text-white px-5 py-3 rounded-2xl shadow-2xl text-sm font-semibold">
          {toast}
        </div>
      )}

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-3xl shadow-2xl"
        style={{ background: 'linear-gradient(135deg,#0A1628 0%,#0d2151 55%,#1A237E 100%)', minHeight: 256 }}>

        {/* Right: dental hero image */}
        <div className="absolute right-0 top-0 bottom-0 w-1/2 pointer-events-none select-none">
          <div className="absolute inset-0 z-10" style={{ background: 'linear-gradient(to right,#0A1628 0%,transparent 35%)' }} />
          <Image src="/images/dental-hero.png" alt="Dental" fill
            style={{ objectFit: 'cover', objectPosition: 'center', opacity: 0.9 }} priority />
          {/* Floating stat cards */}
          <div className="absolute top-4 right-4 z-20 flex flex-col gap-2">
            <div className="backdrop-blur-sm bg-white/10 border border-white/20 rounded-2xl px-3 py-2 text-right">
              <p className="text-white font-black text-xl leading-none">8</p>
              <p className="text-white/60 text-[10px] font-semibold">Doctors on duty</p>
            </div>
            <div className="backdrop-blur-sm bg-white/10 border border-white/20 rounded-2xl px-3 py-2 text-right">
              <p className="text-white font-black text-xl leading-none">5</p>
              <p className="text-white/60 text-[10px] font-semibold">Rooms available</p>
            </div>
          </div>
        </div>

        {/* Left: content */}
        <div className="relative z-10 p-6 lg:p-8" style={{ maxWidth: '58%' }}>
          <p className="text-white/60 text-sm font-medium mb-0.5">{getGreeting()},</p>
          <h1 className="text-2xl lg:text-3xl font-black text-white mb-1" style={{ fontFamily: 'Plus Jakarta Sans' }}>
            Dr. {user?.firstName || '…'} {user?.lastName} 👋
          </h1>
          <p className="text-white/50 text-xs mb-4">
            {checkedIn ? `✓ Checked in at ${checkInTime} · Ready to see patients` : 'You haven\'t checked in yet today'}
          </p>

          <div className="mb-5"><KampalaClock /></div>

          {/* Today stats */}
          <div className="flex items-center gap-5 mb-5 flex-wrap">
            {[
              { label: 'patients', value: appointments.length, color: '#29ABE2' },
              { label: 'completed', value: completed, color: '#10B981' },
              { label: 'pending', value: pending, color: '#F59E0B' },
            ].map(s => (
              <div key={s.label}>
                <span className="text-2xl font-black mr-1" style={{ color: s.color }}>{loading ? '—' : s.value}</span>
                <span className="text-white/50 text-xs">{s.label}</span>
              </div>
            ))}
          </div>

          {/* Buttons */}
          <div className="flex gap-3 flex-wrap">
            <button onClick={handleCheckIn} disabled={checkedIn || checkingIn}
              className={cn(
                'flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm transition-all shadow-lg min-h-[44px]',
                checkedIn
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 cursor-default'
                  : 'bg-emerald-500 hover:bg-emerald-400 text-white hover:-translate-y-0.5',
              )}>
              <CheckCircle size={15} />
              {checkedIn ? `✓ Checked In ${checkInTime}` : checkingIn ? 'Checking in…' : 'Check In to Clinic'}
            </button>
            <button onClick={() => setBlockOpen(true)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm bg-orange-500 hover:bg-orange-400 text-white shadow-lg hover:-translate-y-0.5 transition-all min-h-[44px]">
              <Ban size={15} /> Block Time Off
            </button>
          </div>
        </div>
      </div>

      {/* ── KPI ROW ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Today', value: appointments.length, icon: Calendar, color: '#29ABE2' },
          { label: 'In Progress', value: active, icon: Activity, color: '#F59E0B' },
          { label: 'Completed', value: completed, icon: CheckCircle, color: '#10B981' },
          { label: 'Waiting', value: pending, icon: Clock, color: '#8B5CF6' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">{label}</p>
              <div className="w-7 h-7 rounded-xl flex items-center justify-center" style={{ background: color + '20' }}>
                <Icon size={14} style={{ color }} />
              </div>
            </div>
            <p className="text-3xl font-black" style={{ color }}>{loading ? '—' : value}</p>
          </div>
        ))}
      </div>

      {/* ── LIVE PATIENT FLOW ──────────────────────────────────────────── */}
      {doctor && <LivePatientFlow doctorId={doctor.id} refreshInterval={20000} />}

      {/* ── TODAY'S SCHEDULE ───────────────────────────────────────────── */}
      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50 dark:border-white/[0.06]">
          <div>
            <h2 className="text-base font-bold text-gray-800 dark:text-white">Today&apos;s Schedule</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {new Date().toLocaleDateString('en-UG', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Kampala' })}
            </p>
          </div>
          <Link href="/doctor/schedule" className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1">
            Full schedule <ChevronRight size={13} />
          </Link>
        </div>

        {loading ? (
          <div className="p-5 space-y-3">
            {[1,2,3].map(i => <div key={i} className="h-14 bg-gray-100 dark:bg-white/5 rounded-xl animate-pulse" />)}
          </div>
        ) : appointments.length === 0 ? (
          <div className="py-12 text-center text-gray-400">
            <CalendarDays size={36} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">No appointments today</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50 dark:divide-white/[0.04]">
            {appointments.slice(0, 8).map((a) => {
              const cfg = STATUS_CFG[a.status] || { label: a.status, color: '#6B7280', bg: '#F3F4F6' }
              return (
                <div key={a.id} className="flex items-center gap-4 px-5 py-3.5 hover:bg-blue-50/30 dark:hover:bg-white/[0.03] transition-colors">
                  <p className="w-14 text-xs font-bold text-gray-700 dark:text-white text-right flex-shrink-0">{fmtTime(a.startAt)}</p>
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: a.service?.colour || '#29ABE2' }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 dark:text-white truncate">{a.patient?.firstName} {a.patient?.lastName}</p>
                    <p className="text-xs text-gray-400 truncate">{a.service?.name}</p>
                  </div>
                  <span className="text-[10px] font-bold px-2.5 py-1 rounded-full flex-shrink-0"
                    style={{ background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
                  <Link href={`/patients/${a.patient?.id}`}
                    className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors flex-shrink-0">
                    <Users size={13} />
                  </Link>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pb-20 md:pb-4">
        {[
          { label: '📋 My Schedule', href: '/doctor/schedule', cls: 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border-blue-100 dark:border-blue-800' },
          { label: '👥 My Patients', href: '/doctor/patients', cls: 'bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300 border-teal-100 dark:border-teal-800' },
          { label: '💬 Messages',    href: '/doctor/messages', cls: 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 border-purple-100 dark:border-purple-800' },
          { label: '👤 My Profile',  href: '/doctor/profile',  cls: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-amber-100 dark:border-amber-800' },
        ].map(({ label, href, cls }) => (
          <Link key={href} href={href}
            className={cn('flex items-center justify-center text-sm font-semibold px-4 py-3.5 rounded-2xl border transition-all hover:-translate-y-0.5 hover:shadow-md min-h-[52px]', cls)}>
            {label}
          </Link>
        ))}
      </div>

      {/* Block Time Modal */}
      {blockOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between px-5 py-4 border-b dark:border-white/10">
              <h2 className="font-bold text-gray-800 dark:text-white">Block Time Off</h2>
              <button onClick={() => setBlockOpen(false)} className="text-gray-400 hover:text-gray-700 dark:hover:text-white text-lg">✕</button>
            </div>
            <div className="p-5 space-y-3">
              {[
                { label: 'Date', el: <input type="date" value={blockDate} onChange={e => setBlockDate(e.target.value)} className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none" /> },
              ].map(({ label, el }) => (
                <div key={label}><label className="text-xs font-semibold text-gray-500 mb-1 block">{label}</label>{el}</div>
              ))}
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-semibold text-gray-500 mb-1 block">Start</label>
                  <input type="time" value={blockStart} onChange={e => setBlockStart(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none" /></div>
                <div><label className="text-xs font-semibold text-gray-500 mb-1 block">End</label>
                  <input type="time" value={blockEnd} onChange={e => setBlockEnd(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none" /></div>
              </div>
              <div><label className="text-xs font-semibold text-gray-500 mb-1 block">Reason</label>
                <select value={blockReason} onChange={e => setBlockReason(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none">
                  {['Lunch Break','Meeting','Training','Personal','Holiday','CME','On Call','Other'].map(r => <option key={r}>{r}</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-3 px-5 py-4 border-t dark:border-white/10">
              <button onClick={() => setBlockOpen(false)} className="px-4 py-2 text-sm text-gray-500">Cancel</button>
              <button onClick={handleBlockTime} disabled={blockSaving}
                className="px-5 py-2 text-sm font-bold text-white bg-orange-500 hover:bg-orange-600 rounded-xl disabled:opacity-50 transition-colors">
                {blockSaving ? 'Blocking…' : 'Block Time'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
