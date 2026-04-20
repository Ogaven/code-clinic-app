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

function AnalogClock() {
  const [time, setTime] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  const kla  = new Date(time.toLocaleString('en-US', { timeZone: 'Africa/Kampala' }))
  const h    = kla.getHours() % 12
  const m    = kla.getMinutes()
  const s    = kla.getSeconds()
  const hDeg = h / 12 * 360 + m / 60 * 30
  const mDeg = m / 60 * 360 + s / 60 * 6
  const sDeg = s / 60 * 360
  const cx = 44, cy = 44, r = 40
  const hand = (deg: number, len: number) => ({
    x2: cx + Math.cos((deg - 90) * Math.PI / 180) * len,
    y2: cy + Math.sin((deg - 90) * Math.PI / 180) * len,
  })
  const timeStr = kla.toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit', hour12: true })
  const dateStr = kla.toLocaleDateString('en-UG', { weekday: 'short', day: 'numeric', month: 'long', year: '2-digit' })
    .replace(',', '').replace(/(\d+) (\w+) (\d+)/, '$1 $2 \'$3')
  return (
    <div className="flex flex-col items-center gap-1.5">
      <svg width="88" height="88" viewBox="0 0 88 88">
        <circle cx={cx} cy={cy} r={r} fill="rgba(255,255,255,0.1)" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5"/>
        <circle cx={cx} cy={cy} r={r-4} fill="rgba(255,255,255,0.04)"/>
        {Array.from({ length: 12 }).map((_, i) => {
          const a  = (i / 12) * 360 - 90
          const x1 = cx + Math.cos(a * Math.PI/180) * (r - 6)
          const y1 = cy + Math.sin(a * Math.PI/180) * (r - 6)
          const x2 = cx + Math.cos(a * Math.PI/180) * (r - 2)
          const y2 = cy + Math.sin(a * Math.PI/180) * (r - 2)
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(255,255,255,0.45)" strokeWidth={i % 3 === 0 ? 2 : 1} strokeLinecap="round"/>
        })}
        <line x1={cx} y1={cy} x2={hand(hDeg,22).x2} y2={hand(hDeg,22).y2} stroke="white" strokeWidth="3" strokeLinecap="round"/>
        <line x1={cx} y1={cy} x2={hand(mDeg,30).x2} y2={hand(mDeg,30).y2} stroke="#29ABE2" strokeWidth="2" strokeLinecap="round"/>
        <line x1={cx} y1={cy} x2={hand(sDeg,34).x2} y2={hand(sDeg,34).y2} stroke="#EC4899" strokeWidth="1.2" strokeLinecap="round"/>
        <circle cx={cx} cy={cy} r="3.5" fill="white"/>
        <circle cx={cx} cy={cy} r="1.5" fill="#29ABE2"/>
      </svg>
      <p className="text-white/90 text-[11px] font-bold tracking-wide">{timeStr} EAT</p>
      <p className="text-blue-200 text-[9px] font-semibold tracking-wider uppercase">{dateStr}</p>
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
  const [toast, setToast]             = useState('')
  const [blockOpen, setBlockOpen]     = useState(false)
  const [blockDate, setBlockDate]     = useState(() => new Date().toISOString().slice(0, 10))
  const [blockStart, setBlockStart]   = useState('12:00')
  const [blockEnd, setBlockEnd]       = useState('13:00')
  const [blockReason, setBlockReason] = useState('Lunch Break')
  const [blockSaving, setBlockSaving] = useState(false)
  const [checkedIn, setCheckedIn]     = useState(false)
  const [checkInTime, setCheckInTime] = useState('')
  const [checkingIn, setCheckingIn]   = useState(false)

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
      // Fetch check-in status
      const ciRes = await fetch('/api-proxy/doctors/check-in/today', { headers: { Authorization: `Bearer ${token}` } })
      if (ciRes.ok) {
        const ci = await ciRes.json()
        setCheckedIn(ci.checkedIn || false)
        if (ci.time) setCheckInTime(ci.time)
      }
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }, [token])

  useEffect(() => { fetchData() }, [fetchData])


  async function handleBlockTime() {
    if (!doctor || !token) return
    setBlockSaving(true)
    try {
      await fetch(`/api-proxy/scheduling/doctors/${doctor.id}/block-time`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          startAt: `${blockDate}T${blockStart}:00`,
          endAt: `${blockDate}T${blockEnd}:00`,
          reason: blockReason,
        }),
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
    <div className="space-y-4 p-4 md:p-5 pb-24 md:pb-6 animate-fade-in">

      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-[99999] bg-emerald-600 text-white px-5 py-3 rounded-2xl shadow-2xl text-sm font-semibold">
          {toast}
        </div>
      )}

      {/* ── HERO: greeting left · clock centre · dental right ──────────────── */}
      <div className="relative flex items-end gap-4" style={{ marginBottom: -44 }}>

        {/* Left: Greeting + Check In */}
        <div className="flex-1 pb-3 relative z-10">
          <p className="text-gray-500 dark:text-blue-300/60 text-sm font-medium">{getGreeting()},</p>
          <h1 className="text-2xl font-black text-gray-900 dark:text-white" style={{ fontFamily: 'Plus Jakarta Sans' }}>
            Dr. {user?.firstName || '…'} {user?.lastName} 👋
          </h1>
          <p className="text-gray-400 dark:text-gray-400 text-sm mt-0.5">{doctor?.specialisation || 'General Dentistry'}</p>
        </div>

        {/* Centre: Analog clock — hidden on mobile */}
        <div className="hidden sm:block flex-shrink-0 rounded-2xl px-5 py-4 shadow-2xl"
          style={{
            background: 'linear-gradient(135deg,#1A237E,#0d47a1)',
            boxShadow: '0 12px 40px rgba(26,35,126,0.4)',
            position: 'absolute', left: '50%', bottom: 0, transform: 'translateX(-50%)', zIndex: 5,
          }}>
          <AnalogClock />
        </div>

        {/* Right: Dental image — hidden on mobile */}
        <div className="hidden sm:block flex-shrink-0 pointer-events-none select-none" style={{ width: 170 }}>
          <Image src="/dental40.png" alt="Dental" width={170} height={150} priority
            style={{ objectFit: 'contain', objectPosition: 'bottom', filter: 'drop-shadow(0 10px 32px rgba(41,171,226,0.35))', display: 'block', width: '100%', height: 'auto' }} />
        </div>
      </div>

      {/* Spacer to clear the overlapping clock widget — desktop only */}
      <div className="hidden sm:block" style={{ height: 52 }} />

      {/* ── CHECK IN / OUT ──────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm p-4 flex items-center gap-4 flex-wrap">
        <div className={cn('w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0',
          checkedIn ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-gray-100 dark:bg-white/10')}>
          <Activity size={22} className={checkedIn ? 'text-emerald-600' : 'text-gray-400'} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-800 dark:text-white">
            {checkedIn ? '✓ Currently checked in' : 'Not checked in today'}
          </p>
          <p className="text-xs text-gray-400">
            {checkedIn && checkInTime ? `Checked in at ${checkInTime}` : 'Check in to notify reception you are available'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={async () => { if (checkingIn || checkedIn) return; setCheckingIn(true); try { const r = await fetch('/api-proxy/doctors/check-in', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ type: 'CHECK_IN' }) }); if (r.ok) { const d = await r.json(); setCheckedIn(true); setCheckInTime(d.time || ''); setToast(`Checked in at ${d.time}`); setTimeout(() => setToast(''), 3500) } } catch {} finally { setCheckingIn(false) } }}
            disabled={checkingIn || checkedIn}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-40 min-h-[44px] bg-emerald-600 hover:bg-emerald-700">
            {checkingIn ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : '✓ Check In'}
          </button>
          <button
            onClick={async () => { if (checkingIn || !checkedIn) return; setCheckingIn(true); try { const r = await fetch('/api-proxy/doctors/check-in', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ type: 'CHECK_OUT' }) }); if (r.ok) { const d = await r.json(); setCheckedIn(false); setCheckInTime(''); setToast('Checked out successfully'); setTimeout(() => setToast(''), 3500) } } catch {} finally { setCheckingIn(false) } }}
            disabled={checkingIn || !checkedIn}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-40 min-h-[44px] bg-red-500 hover:bg-red-600">
            {checkingIn ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : '← Check Out'}
          </button>
        </div>
      </div>

      {/* ── KPI ROW ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Today',       value: appointments.length, icon: Calendar,     color: '#29ABE2' },
          { label: 'In Progress', value: active,              icon: Activity,     color: '#F59E0B' },
          { label: 'Completed',   value: completed,           icon: CheckCircle,  color: '#10B981' },
          { label: 'Pending',     value: pending,             icon: Clock,        color: '#8B5CF6' },
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

      {/* ── QUICK ACTIONS ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        <Link href="/doctor/schedule"
          className="flex flex-col items-center gap-2 p-4 rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all hover:-translate-y-0.5 shadow-sm min-h-[76px] justify-center">
          <CalendarDays size={22} className="text-blue-500" />
          <span className="text-xs font-bold text-gray-700 dark:text-gray-300 text-center leading-tight">My Schedule</span>
        </Link>
        <button onClick={() => setBlockOpen(true)}
          className="flex flex-col items-center gap-2 p-4 rounded-2xl border border-orange-100 dark:border-orange-900/30 bg-white dark:bg-white/5 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-all hover:-translate-y-0.5 shadow-sm min-h-[76px] justify-center w-full">
          <Ban size={22} className="text-orange-500" />
          <span className="text-xs font-bold text-gray-700 dark:text-gray-300 text-center leading-tight">Block Time</span>
        </button>
        <Link href="/doctor/patients"
          className="flex flex-col items-center gap-2 p-4 rounded-2xl border border-teal-100 dark:border-teal-900/30 bg-white dark:bg-white/5 hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-all hover:-translate-y-0.5 shadow-sm min-h-[76px] justify-center">
          <Users size={22} className="text-teal-500" />
          <span className="text-xs font-bold text-gray-700 dark:text-gray-300 text-center leading-tight">My Patients</span>
        </Link>
      </div>

      {/* ── LIVE PATIENT FLOW ───────────────────────────────────────────────── */}
      {doctor && <LivePatientFlow doctorId={doctor.id} refreshInterval={20000} patientBasePath="/doctor/patients" />}

      {/* ── TODAY'S SCHEDULE ────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50 dark:border-white/[0.06]">
          <div>
            <h2 className="text-base font-bold text-gray-800 dark:text-white">Today&apos;s Schedule</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {new Date().toLocaleDateString('en-UG', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Kampala' })}
            </p>
          </div>
          <Link href="/doctor/schedule"
            className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1">
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
            {appointments
              .slice()
              .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
              .slice(0, 8)
              .map((a) => {
                const cfg = STATUS_CFG[a.status] || { label: a.status, color: '#6B7280', bg: '#F3F4F6' }
                return (
                  <div key={a.id} className="flex items-center gap-3 px-4 sm:px-5 py-3.5 hover:bg-blue-50/30 dark:hover:bg-white/[0.03] transition-colors">
                    <p className="w-14 text-xs font-bold text-gray-700 dark:text-white text-right flex-shrink-0">{fmtTime(a.startAt)}</p>
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: a.service?.colour || '#29ABE2' }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 dark:text-white truncate">{a.patient?.firstName} {a.patient?.lastName}</p>
                      <p className="text-xs text-gray-400 truncate">{a.service?.name}</p>
                    </div>
                    <span className="text-[10px] font-bold px-2.5 py-1 rounded-full flex-shrink-0"
                      style={{ background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
                    <Link href={`/doctor/patients/${a.patient?.id}`}
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors flex-shrink-0 min-w-[32px]">
                      <Users size={13} />
                    </Link>
                  </div>
                )
              })}
          </div>
        )}
      </div>

      {/* Block Time Modal (bottom sheet on mobile) */}
      {blockOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-2xl shadow-2xl w-full sm:max-w-sm">
            <div className="w-10 h-1 bg-gray-300 dark:bg-gray-600 rounded-full mx-auto mt-3 mb-1 sm:hidden" />
            <div className="flex items-center justify-between px-5 py-4 border-b dark:border-white/10">
              <h2 className="font-bold text-gray-800 dark:text-white">Block Time Off</h2>
              <button onClick={() => setBlockOpen(false)}
                className="w-9 h-9 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/10 text-lg transition-colors">
                ✕
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1.5 block">Date</label>
                <input type="date" value={blockDate} onChange={e => setBlockDate(e.target.value)}
                  className="w-full px-3 py-3 text-base border border-gray-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1.5 block">Start</label>
                  <input type="time" value={blockStart} onChange={e => setBlockStart(e.target.value)}
                    className="w-full px-3 py-3 text-base border border-gray-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1.5 block">End</label>
                  <input type="time" value={blockEnd} onChange={e => setBlockEnd(e.target.value)}
                    className="w-full px-3 py-3 text-base border border-gray-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1.5 block">Reason</label>
                <select value={blockReason} onChange={e => setBlockReason(e.target.value)}
                  className="w-full px-3 py-3 text-base border border-gray-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none">
                  {['Lunch Break','Meeting','Training','Personal','Holiday','CME','On Call','Other'].map(r => <option key={r}>{r}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-3 px-5 pb-6 sm:pb-4 pt-0">
              <button onClick={() => setBlockOpen(false)}
                className="flex-1 px-4 py-3 text-sm text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-white/10 rounded-xl font-medium min-h-[44px]">
                Cancel
              </button>
              <button onClick={handleBlockTime} disabled={blockSaving}
                className="flex-1 px-5 py-3 text-sm font-bold text-white bg-orange-500 hover:bg-orange-600 rounded-xl disabled:opacity-50 transition-colors min-h-[44px]">
                {blockSaving ? 'Blocking…' : 'Block Time'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
