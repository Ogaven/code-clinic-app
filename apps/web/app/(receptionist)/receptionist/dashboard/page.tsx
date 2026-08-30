'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import {
  Calendar, AlertTriangle, ArrowUpRight, UserCheck,
  Plus, X, LogIn, LogOut, Search, UserPlus,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { fetchWithAuth } from '@/lib/api'
import Avatar from '@/components/ui/Avatar'
import BookingDrawer from '@/components/scheduling/BookingDrawer'
import ReceptionistLiveFlow from '@/components/scheduling/ReceptionistLiveFlow'
import PatientsOverviewCard from '@/components/receptionist/PatientsOverviewCard'
import PatientSatisfactionCard from '@/components/receptionist/PatientSatisfactionCard'
import GrowthCrmCard from '@/components/receptionist/GrowthCrmCard'
import AiSuiteSnapshotCard from '@/components/receptionist/AiSuiteSnapshotCard'
import { CompactCard, DistributionBar, ChipLegend } from '@/components/receptionist/DashboardPrimitives'
import PatientFormFields, { EMPTY_PATIENT_FORM, buildPatientRequestBody, type PatientFormValues } from '@/components/patients/PatientFormFields'

// Same status set + colours as the Admin dashboard's "Appointments This
// Week" card (apps/web/app/(admin)/dashboard/page.tsx) — kept visually and
// semantically identical so Receptionist reads as the same product, not a
// re-invented one.
const WEEK_STATUSES = [
  { key: 'CONFIRMED', label: 'Confirmed', color: '#2563EB' },
  { key: 'PENDING', label: 'Pending', color: '#D97706' },
  { key: 'NO_SHOW', label: 'No-show', color: '#DC2626' },
  { key: 'RESCHEDULED', label: 'Rescheduled', color: '#7C3AED' },
  { key: 'CANCELLED', label: 'Cancelled', color: '#9CA3AF' },
]

// Same pipeline stages + colours as the Admin dashboard's "Treatment
// Pipeline" card, over the same all-time GET /clinical/analytics/
// dental-dashboard aggregate (requireAuth only — no role restriction).
const PIPELINE_STATUSES = [
  { key: 'Planned', label: 'Planned', color: '#1D4ED8' },
  { key: 'In Progress', label: 'In Progress', color: '#D97706' },
  { key: 'Completed', label: 'Completed', color: '#059669' },
  { key: 'On Hold', label: 'On Hold', color: '#CA8A04' },
  { key: 'Declined', label: 'Declined', color: '#E11D48' },
  { key: 'Cancelled', label: 'Cancelled', color: '#9CA3AF' },
]

// Same live-flow grouping as ReceptionistLiveFlow's STAGES and the Admin
// dashboard's FLOW_STAGES, kept in sync deliberately so this summary card
// never disagrees with the detailed board below it or the full board at
// /receptionist/flow. COMPLETED is deliberately absent — a departed patient
// isn't "active" any more.
const FLOW_STAGES = [
  { key: 'arrived', label: 'Arrived', statuses: ['ARRIVED', 'CHECKED_IN'], color: '#3B82F6' },
  { key: 'waiting', label: 'Waiting', statuses: ['WAITING'], color: '#EAB308' },
  { key: 'session', label: 'In Session', statuses: ['IN_OPERATORY', 'IN_CHAIR', 'WITH_PROVIDER'], color: '#F97316' },
  { key: 'checkout', label: 'Checkout', statuses: ['READY_CHECKOUT'], color: '#A855F7' },
]

interface Appt {
  id: string; startAt: string; endAt?: string; status: string
  patient: { firstName: string; lastName: string }
  doctor: { user: { firstName: string; lastName: string } }
  service: { name: string; colour: string }
}

// ── Main Page ─────────────────────────────────────────────────
export default function ReceptionistDashboard() {
  const API     = '/api-proxy'
  const [user, setUser]             = useState<any>(null)
  const [stats, setStats]           = useState<any>(null)
  const [appointments, setAppts]    = useState<any[]>([])
  const [weekAppts, setWeekAppts]   = useState<any[] | null>(null)
  const [upcoming, setUpcoming]     = useState<any[]>([])
  const [loading, setLoading]       = useState(true)
  const lastFetch = useRef(0)
  const [showCheckin, setShowCheckin]   = useState(false)
  const [checkinSearch, setCheckinSearch] = useState('')
  const [checkinResults, setCheckinResults] = useState<any[]>([])
  const [checkinSearching, setCheckinSearching] = useState(false)
  const [checkinMode, setCheckinMode] = useState<'in' | 'out'>('in')
  const [checkinError, setCheckinError] = useState('')
  const [checkinLoading, setCheckinLoading] = useState(false)
  const [dentalData, setDentalData] = useState<{ pipeline: Record<string, { count: number; totalUGX: number }> } | null>(null)
  const [showBooking, setShowBooking]   = useState(false)
  const [showAddPatient, setShowAddPatient] = useState(false)
  const [newPatient, setNewPatient]     = useState<PatientFormValues>(EMPTY_PATIENT_FORM)
  const [addingPatient, setAddingPatient] = useState(false)
  const [addPatientError, setAddPatientError] = useState('')

  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const authH = { Authorization: `Bearer ${token}` }

  useEffect(() => {
    const stored = localStorage.getItem('cc_user')
    if (stored) setUser(JSON.parse(stored))
    fetchAll(true)
    const t = setInterval(() => fetchAll(), 30000)
    return () => clearInterval(t)
  }, [])

  async function fetchAll(force = false) {
    const now = Date.now()
    if (!force && now - lastFetch.current < 5 * 60 * 1000 && stats !== null) return
    try {
      const [s, a, u] = await Promise.all([
        fetch(`${API}/receptionist/dashboard-stats`, { headers: authH }).then(r => r.json()),
        fetch(`${API}/receptionist/today-appointments`, { headers: authH }).then(r => r.json()),
        fetch(`${API}/receptionist/upcoming-appointments`, { headers: authH }).then(r => r.json()),
      ])
      lastFetch.current = Date.now()
      setStats(s); setAppts(Array.isArray(a) ? a : [])
      setUpcoming(Array.isArray(u) ? u : [])
    } catch {} finally { setLoading(false) }
  }

  // "Appointments This Week" (Mon–Sun) — same real endpoint and date-range
  // convention as the Admin dashboard's equivalent card.
  useEffect(() => {
    const now = new Date()
    const dow = now.getDay()
    const monday = new Date(now); monday.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1))
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6)
    const iso = (d: Date) => d.toISOString().slice(0, 10)
    fetch(`${API}/scheduling/appointments?startDate=${iso(monday)}&endDate=${iso(sunday)}`, { headers: authH })
      .then(r => r.ok ? r.json() : [])
      .then(d => { if (Array.isArray(d)) setWeekAppts(d) })
      .catch(() => {})

    // Treatment Pipeline — same all-time aggregate the Admin dashboard's
    // equivalent card reads (requireAuth only, no role restriction).
    fetch(`${API}/clinical/analytics/dental-dashboard`, { headers: authH })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d && !d.error) setDentalData(d) })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleCheckinSearch(q: string) {
    setCheckinSearch(q)
    if (q.length < 2) { setCheckinResults([]); return }
    setCheckinSearching(true)
    try {
      const res = await fetch(`${API}/receptionist/today-appointments?q=${encodeURIComponent(q)}`, { headers: authH })
      if (res.ok) {
        const data = await res.json()
        setCheckinResults(Array.isArray(data) ? data : [])
      }
    } catch {} finally { setCheckinSearching(false) }
  }

  async function doCheckInOut(apptId: string) {
    const status = checkinMode === 'in' ? 'CHECKED_IN' : 'COMPLETED'
    setCheckinLoading(true)
    setCheckinError('')
    try {
      const res = await fetchWithAuth(`${API}/scheduling/appointments/${apptId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setCheckinError(body.error || `Failed to ${checkinMode === 'in' ? 'check in' : 'check out'} patient. Please try again.`)
        return
      }
      if (checkinMode === 'in') {
        fetchWithAuth(`${API}/scheduling/appointments/${apptId}/checkin-notify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }).catch(() => {})
      }
      setShowCheckin(false)
      setCheckinSearch('')
      setCheckinResults([])
      fetchAll(true)
    } catch {
      setCheckinError('Network error — please check your connection and try again.')
    } finally {
      setCheckinLoading(false)
    }
  }

  const greeting = () => {
    const h = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Nairobi' })).getHours()
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  }

  const sk = stats === null

  const weekCounts = WEEK_STATUSES.map(s => ({ ...s, count: (weekAppts ?? []).filter(a => a.status === s.key).length }))
  const weekTotal  = weekAppts ? weekAppts.length : 0

  const pipelineCounts = PIPELINE_STATUSES.map(s => ({ ...s, count: dentalData ? (dentalData.pipeline[s.key]?.count ?? 0) : 0 }))
  const pipelineTotal  = dentalData ? Object.values(dentalData.pipeline).reduce((s, p) => s + p.count, 0) : 0

  // Live now — same FLOW_STAGES grouping as the detailed board below and the
  // full board at /receptionist/flow. Read from `appointments` (today's
  // appointments, already fetched for the Check In/Out modal), so this
  // summary can never disagree with the detailed board it sits above.
  const flowCounts = FLOW_STAGES.map(s => ({ ...s, count: appointments.filter((a: Appt) => s.statuses.includes(a.status)).length }))
  const flowTotal  = flowCounts.reduce((s, f) => s + f.count, 0)

  // Upcoming Appointments timeline — pixel-based geometry, copied verbatim
  // from the Admin dashboard's equivalent card (apps/web/app/(admin)/
  // dashboard/page.tsx) per explicit direction to match Admin's existing
  // design exactly rather than invent a new presentation. Admin's own
  // futureAppts needs no day-filter because its `upcoming` source (GET
  // /scheduling/appointments) is already today-scoped server-side. This
  // dashboard's source, GET /receptionist/upcoming-appointments, is NOT
  // day-capped by design (it can genuinely return tomorrow's or later
  // appointments) — plotting those onto an 8AM–6PM "today" timeline would
  // misrepresent them, so they're filtered out here to the current
  // Africa/Kampala calendar day before the (otherwise identical) Admin
  // filter/sort/slice logic runs.
  const kampalaDateStr = (t: number | string) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Africa/Kampala' })
  const todayKampalaStr = kampalaDateStr(Date.now())
  const tomorrowKampalaStr = kampalaDateStr(Date.now() + 86400000)
  const DAY_START_HOUR = 8, DAY_END_HOUR = 18, HOUR_PX = 84
  const timelineWidth = (DAY_END_HOUR - DAY_START_HOUR) * HOUR_PX
  const hourMarks = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]
  const pxOf = (t: number) => {
    const d = new Date(t)
    const hourFloat = d.getHours() + d.getMinutes() / 60
    return Math.max(0, Math.min(timelineWidth, (hourFloat - DAY_START_HOUR) * HOUR_PX))
  }
  const nowPx = pxOf(Date.now())
  // All real future (non-cancelled) appointments from the endpoint, sorted —
  // used both to build today's timeline (futureAppts, a same-day subset) and,
  // when that subset is empty, to truthfully report the actual next
  // appointment instead of implying there are none at all.
  const allFutureAppts: Appt[] = (upcoming as Appt[])
    .filter(a => new Date(a.startAt).getTime() >= Date.now() && a.status !== 'CANCELLED')
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
  const futureAppts: Appt[] = allFutureAppts
    .filter(a => kampalaDateStr(a.startAt) === todayKampalaStr)
    .slice(0, 8)
  // Nearest appointment beyond today, only relevant when today's timeline is
  // empty — real data from the same endpoint, Africa/Kampala throughout.
  const nextBeyondToday: Appt | null = futureAppts.length === 0 ? (allFutureAppts[0] ?? null) : null
  const nextBeyondTodayWhen = nextBeyondToday ? (() => {
    const dateStr = kampalaDateStr(nextBeyondToday.startAt)
    const time = new Date(nextBeyondToday.startAt).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Kampala' })
    const dayLabel = dateStr === tomorrowKampalaStr
      ? 'Tomorrow'
      : new Date(nextBeyondToday.startAt).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Kampala' })
    return `${dayLabel} · ${time}`
  })() : ''

  return (
    <div className="p-5 space-y-5 max-w-[1600px] mx-auto overflow-x-hidden">

      {/* ── Check In/Out Modal ───────────────────────────────────── */}
      {showCheckin && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-[#0e2045] rounded-3xl shadow-2xl border border-gray-100 dark:border-white/10 w-full max-w-md overflow-hidden animate-fade-in-up">
            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100 dark:border-white/8">
              <div className="flex items-center gap-3">
                <div className="flex gap-1 bg-gray-100 dark:bg-white/8 rounded-xl p-1">
                  <button onClick={() => setCheckinMode('in')}
                    className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all',
                      checkinMode === 'in' ? 'bg-cyan-500 text-white shadow-sm' : 'text-gray-500 dark:text-white/50 hover:text-gray-700')}>
                    <LogIn size={13} /> Check In
                  </button>
                  <button onClick={() => setCheckinMode('out')}
                    className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all',
                      checkinMode === 'out' ? 'bg-emerald-500 text-white shadow-sm' : 'text-gray-500 dark:text-white/50 hover:text-gray-700')}>
                    <LogOut size={13} /> Check Out
                  </button>
                </div>
              </div>
              <button onClick={() => { setShowCheckin(false); setCheckinSearch(''); setCheckinResults([]); setCheckinError('') }}
                className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-gray-100 dark:hover:bg-white/8 transition-colors">
                <X size={16} className="text-gray-400" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <p className="text-sm text-gray-500 dark:text-white/50">
                {checkinMode === 'in' ? "Search today's appointment to check in a patient" : "Search today's appointment to check out a patient"}
              </p>

              {/* Search */}
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <input
                  autoFocus
                  value={checkinSearch}
                  onChange={e => handleCheckinSearch(e.target.value)}
                  placeholder="Search by patient name..."
                  className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all"
                />
              </div>

              {/* Results */}
              {checkinSearching && <p className="text-xs text-gray-400 text-center py-3">Searching...</p>}
              {!checkinSearching && checkinSearch.length >= 2 && checkinResults.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-3">No appointments found for today</p>
              )}
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {checkinResults.map((appt: any) => {
                  const time = new Date(appt.startAt).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', hour12:true, timeZone:'Africa/Nairobi' })
                  const canCheckin  = checkinMode === 'in'  && ['PENDING','CONFIRMED'].includes(appt.status)
                  const canCheckout = checkinMode === 'out' && ['IN_CHAIR','WITH_PROVIDER','READY_CHECKOUT'].includes(appt.status)
                  const canAct = canCheckin || canCheckout
                  return (
                    <div key={appt.id} className={cn(
                      'flex items-center gap-3 p-3 rounded-2xl border transition-all',
                      canAct ? 'border-cyan-200 dark:border-cyan-500/30 bg-cyan-50/50 dark:bg-cyan-900/10 cursor-pointer hover:border-cyan-400' : 'border-gray-100 dark:border-white/8 opacity-60',
                    )} onClick={() => canAct && !checkinLoading && doCheckInOut(appt.id)}>
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                        style={{ background: appt.service?.colour || '#29ABE2' }}>
                        {appt.patient?.firstName?.[0]}{appt.patient?.lastName?.[0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-gray-800 dark:text-white">{appt.patient?.firstName} {appt.patient?.lastName}</p>
                        <p className="text-xs text-gray-400">{appt.service?.name} · {time}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-white/50">{appt.status}</span>
                        {canAct && (
                          <span className="text-[10px] font-black px-2 py-0.5 rounded-lg text-white" style={{ background: checkinMode === 'in' ? '#29ABE2' : '#10B981' }}>
                            {checkinMode === 'in' ? 'Check In' : 'Check Out'}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Error message */}
              {checkinError && (
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30">
                  <AlertTriangle size={14} className="text-red-500 flex-shrink-0" />
                  <p className="text-xs text-red-600 dark:text-red-400">{checkinError}</p>
                </div>
              )}

              {/* Loading indicator */}
              {checkinLoading && (
                <p className="text-xs text-cyan-500 text-center py-1 animate-pulse">Processing...</p>
              )}

              {/* Today's list shortcut */}
              {checkinSearch.length < 2 && appointments.length > 0 && (
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  <p className="text-xs font-bold text-gray-400 dark:text-white/40 uppercase tracking-wider">Today's Appointments</p>
                  {appointments.slice(0, 8).map((appt: any) => {
                    const time = new Date(appt.startAt).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', hour12:true, timeZone:'Africa/Nairobi' })
                    const canCheckin  = checkinMode === 'in'  && ['PENDING','CONFIRMED'].includes(appt.status)
                    const canCheckout = checkinMode === 'out' && ['IN_CHAIR','WITH_PROVIDER','READY_CHECKOUT'].includes(appt.status)
                    const canAct = canCheckin || canCheckout
                    if (!canAct) return null
                    return (
                      <div key={appt.id}
                        className="flex items-center gap-3 p-3 rounded-2xl border border-cyan-200 dark:border-cyan-500/30 bg-cyan-50/50 dark:bg-cyan-900/10 cursor-pointer hover:border-cyan-400 transition-all"
                        onClick={() => !checkinLoading && doCheckInOut(appt.id)}>
                        <div className="w-8 h-8 rounded-xl flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                          style={{ background: appt.service?.colour || '#29ABE2' }}>
                          {appt.patient?.firstName?.[0]}{appt.patient?.lastName?.[0]}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-gray-800 dark:text-white">{appt.patient?.firstName} {appt.patient?.lastName}</p>
                          <p className="text-xs text-gray-400">{time} · {appt.service?.name}</p>
                        </div>
                        <span className="text-[10px] font-black px-2 py-0.5 rounded-lg text-white" style={{ background: checkinMode === 'in' ? '#29ABE2' : '#10B981' }}>
                          {checkinMode === 'in' ? 'Check In' : 'Check Out'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Hero: greeting + quick actions (left) + small decorative dental
          art (right). Compact by design — the illustration is a small
          accent beside the greeting, not a dominant hero element, so the
          dashboard cards below start right away with no dead vertical
          space. Action pills mirror the Admin dashboard's own greeting-row
          buttons: one brand-gradient primary + restrained outlined
          secondaries, not bright solid-color fills. ─────────────────── */}
      <div className="relative flex items-center gap-3 px-1">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg sm:text-xl font-black text-gray-800 dark:text-white truncate">
            {greeting()}, <span style={{ color: '#29ABE2' }}>{user?.firstName}</span>! 👋
          </h1>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <button
              onClick={() => { setCheckinMode('in'); setShowCheckin(true) }}
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm transition hover:-translate-y-0.5"
              style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
              <LogIn size={12} /> Check In
            </button>
            <button
              onClick={() => { setCheckinMode('out'); setShowCheckin(true) }}
              className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-clinic-navy transition hover:-translate-y-0.5 dark:border-white/10 dark:bg-white/5 dark:text-white">
              <LogOut size={12} /> Check Out
            </button>
            <button
              onClick={() => setShowBooking(true)}
              className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-clinic-navy transition hover:-translate-y-0.5 dark:border-white/10 dark:bg-white/5 dark:text-white">
              <Plus size={12} /> Book Appointment
            </button>
            <button
              onClick={() => { setNewPatient(EMPTY_PATIENT_FORM); setAddPatientError(''); setShowAddPatient(true) }}
              className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-clinic-navy transition hover:-translate-y-0.5 dark:border-white/10 dark:bg-white/5 dark:text-white">
              <UserPlus size={12} /> Add Patient
            </button>
          </div>
        </div>

        {/* Small decorative dental art — same exact asset, substantially
            reduced (was clamp(170px,20vw,280px), dominating the hero and
            pushing the dashboard cards far down the page). Still
            object-contain/never cropped, still hidden below sm. */}
        <div className="hidden flex-shrink-0 select-none sm:block" style={{ width: 'clamp(110px, 12vw, 170px)' }} aria-hidden="true">
          <Image src="/images/receptionist-dental-hero.png" alt="" width={1164} height={1034} priority
            style={{ width: '100%', height: 'auto', objectFit: 'contain', filter: 'drop-shadow(0 6px 16px rgba(41,171,226,0.25))' }} />
        </div>
      </div>

      {/* ═══ ROW 1 — Appointments This Week | Treatment Pipeline | Patient Live Flow Summary ═══ */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* Appointments This Week — identical presentation to the Admin
            dashboard's equivalent card, same GET /scheduling/appointments endpoint. */}
        <div className="min-w-0 rounded-2xl border border-gray-100 bg-white p-3.5 shadow-sm dark:border-white/10 dark:bg-white/[0.04]">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-wide text-gray-700 dark:text-slate-200">Appointments This Week</p>
            <span className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-lg bg-cyan-50 text-cyan-600 dark:bg-cyan-400/10 dark:text-cyan-300"><Calendar size={13} /></span>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <p className="text-3xl font-extrabold leading-none text-clinic-navy dark:text-white">{weekAppts ? weekTotal : '—'}</p>
            <div className="h-8 w-px flex-shrink-0 bg-gray-100 dark:bg-white/10" />
            <DistributionBar segments={weekCounts} total={weekTotal} />
          </div>
          <ChipLegend items={weekCounts} loading={!weekAppts} />
        </div>

        {/* Treatment Pipeline · All time — identical presentation to the
            Admin dashboard's equivalent card, same all-time aggregate. */}
        <div className="min-w-0 rounded-2xl border border-gray-100 bg-white p-3.5 shadow-sm dark:border-white/10 dark:bg-white/[0.04]">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-wide text-gray-700 dark:text-slate-200">Treatment Pipeline <span className="font-normal normal-case text-gray-400 dark:text-white/30">· All time</span></p>
            <Link href="/receptionist/treatment-pipeline" className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-400/10 dark:text-blue-300"><ArrowUpRight size={13} /></Link>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <p className="text-3xl font-extrabold leading-none text-clinic-navy dark:text-white">{dentalData ? pipelineTotal : '—'}</p>
            <div className="h-8 w-px flex-shrink-0 bg-gray-100 dark:bg-white/10" />
            <DistributionBar segments={pipelineCounts} total={pipelineTotal} />
          </div>
          <ChipLegend items={pipelineCounts} loading={!dentalData} />
        </div>

        {/* Patient Live Flow · Live now — SUMMARY ONLY (circles + connecting
            lines), identical presentation to the Admin dashboard's
            equivalent card. The detailed, draggable board lives in Row 2 —
            these two are intentionally separate and never merged. Excludes
            COMPLETED patients: they are not "active" any more. */}
        <div className="min-w-0 rounded-2xl border border-gray-100 bg-white p-3.5 shadow-sm dark:border-white/10 dark:bg-white/[0.04]">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-wide text-gray-700 dark:text-slate-200">Patient Live Flow <span className="font-normal normal-case text-gray-400 dark:text-white/30">· Live now</span></p>
            <span className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-400/10 dark:text-emerald-300"><UserCheck size={13} /></span>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <p className="text-3xl font-extrabold leading-none text-clinic-navy dark:text-white">{!sk ? flowTotal : '—'}</p>
            <div className="h-8 w-px flex-shrink-0 bg-gray-100 dark:bg-white/10" />
            <p className="text-[10px] font-medium leading-tight text-gray-500 dark:text-slate-400">active in<br />clinic now</p>
          </div>
          <div className="mt-3.5 flex items-center">
            {flowCounts.map((s, i) => (
              <div key={s.key} className="flex flex-1 items-center last:flex-none">
                <div className="flex flex-col items-center gap-1">
                  <div className="grid h-7 w-7 place-items-center rounded-full text-[11px] font-bold text-white" style={{ background: !sk && s.count > 0 ? s.color : '#D1D5DB' }}>
                    {!sk ? s.count : '—'}
                  </div>
                  <span className="whitespace-nowrap text-[9px] font-medium text-gray-500 dark:text-slate-400">{s.label}</span>
                </div>
                {i < flowCounts.length - 1 && <div className="mx-1 mb-4 h-0.5 flex-1 rounded-full" style={{ background: s.color, opacity: 0.25 }} />}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ═══ ROW 2 — Patient Satisfaction | Detailed Live Flow (draggable) | Growth & CRM ═══ */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.85fr_1.6fr_0.85fr]">
        <PatientSatisfactionCard />
        {/* Detailed, operational Live Flow board — the real Receptionist
            board (same data/statuses/transitions as /receptionist/flow),
            embedded compact with drag-and-drop to the next stage. This is
            intentionally distinct from the Row 1 summary above it. */}
        <ReceptionistLiveFlow compact refreshInterval={20000} />
        <GrowthCrmCard />
      </div>

      {/* ═══ ROW 3 — Patients Overview | Upcoming Appointments | Today's AI Activity ═══ */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.05fr_1.3fr_0.85fr]">
        <PatientsOverviewCard />

        {/* Upcoming Appointments — copied verbatim from the Admin dashboard's
            equivalent card (same pixel-hour timeline, same time labels, same
            appointment pill blocks, same "now" marker, same horizontal
            scroll, same dark-mode treatment), fed by the real
            GET /receptionist/upcoming-appointments data. This replaces the
            wider grouped-card presentation from the previous pass, which
            was a new design rather than a match to Admin's existing one. */}
        <CompactCard title="Upcoming Appointments" action={<Link href="/receptionist/appointments" className="text-[11px] font-bold text-clinic-blue hover:underline dark:text-cyan-400">View all</Link>}>
          {loading ? (
            <div className="h-36 animate-pulse rounded-xl bg-gray-50 dark:bg-white/5" />
          ) : futureAppts.length === 0 && nextBeyondToday ? (
            // Truthful tail state: today's timeline is genuinely empty, but the
            // real endpoint data does contain a later appointment — say so
            // instead of implying there's nothing upcoming at all.
            <div className="flex h-36 flex-col items-center justify-center gap-1.5 text-center">
              <Calendar size={20} className="text-gray-200 dark:text-white/15" />
              <p className="text-xs font-medium text-gray-400 dark:text-slate-500">No more appointments today</p>
              <p className="text-[11px] font-semibold text-clinic-blue dark:text-cyan-400">
                Next: {nextBeyondTodayWhen} · {nextBeyondToday.patient.firstName} {nextBeyondToday.patient.lastName}
              </p>
            </div>
          ) : futureAppts.length === 0 ? (
            <div className="flex h-36 flex-col items-center justify-center gap-1 text-center">
              <Calendar size={20} className="text-gray-200 dark:text-white/15" />
              <p className="text-xs font-medium text-gray-400 dark:text-slate-500">No upcoming appointments</p>
            </div>
          ) : (
            <div className="no-scrollbar w-full overflow-x-auto">
              <div style={{ width: timelineWidth, minWidth: '100%' }} className="relative">
                <div className="relative h-4">
                  {hourMarks.map(h => (
                    <span key={h} className="absolute -translate-x-1/2 whitespace-nowrap text-[9px] font-medium text-gray-500 dark:text-slate-400" style={{ left: (h - DAY_START_HOUR) * HOUR_PX }}>
                      {h > 12 ? h - 12 : h}{h >= 12 ? 'PM' : 'AM'}
                    </span>
                  ))}
                </div>
                <div className="relative mt-1 rounded-xl bg-gray-50 dark:bg-white/5" style={{ height: 112 }}>
                  {hourMarks.map(h => (
                    <div key={h} className="absolute top-0 bottom-0 border-l border-gray-200/70 dark:border-white/5" style={{ left: (h - DAY_START_HOUR) * HOUR_PX }} />
                  ))}
                  {nowPx >= 0 && nowPx <= timelineWidth && (
                    <div className="absolute top-0 bottom-0 z-10 w-px bg-clinic-blue dark:bg-cyan-400" style={{ left: nowPx }}>
                      <span className="absolute -top-1.5 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-clinic-blue dark:bg-cyan-400" />
                    </div>
                  )}
                  {futureAppts.map((a, i) => {
                    const left = pxOf(new Date(a.startAt).getTime())
                    const right = a.endAt ? pxOf(new Date(a.endAt).getTime()) : left + 84
                    const width = Math.max(right - left, 76)
                    const top = 8 + (i % 3) * 33
                    const time = new Date(a.startAt).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })
                    const isNearest = i === 0
                    return (
                      <div key={a.id} className={cn('absolute flex items-center gap-1.5 overflow-hidden rounded-full py-1 pl-1 pr-2.5 text-white shadow-sm', isNearest && 'ring-2 ring-clinic-blue ring-offset-1 dark:ring-cyan-400 dark:ring-offset-slate-900')} style={{ left, top, width, background: a.service?.colour || '#29ABE2' }} title={`${time} · ${a.patient.firstName} ${a.patient.lastName} · ${a.service.name}`}>
                        <Avatar firstName={a.patient.firstName} lastName={a.patient.lastName} size="xs" colour="rgba(255,255,255,0.3)" />
                        <span className="truncate text-[10px] font-bold">{a.patient.firstName}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </CompactCard>

        <AiSuiteSnapshotCard />
      </div>

      {/* ── Book Appointment Drawer ──────────────────────────── */}
      <BookingDrawer open={showBooking} onClose={() => setShowBooking(false)} onBooked={() => { setShowBooking(false); fetchAll(true) }} />

      {/* ── Add Patient Modal — full real patient form, same shared
          PatientFormFields component and POST /patients contract as the
          Admin "Add Patient" modal and BookingDrawer's New Patient section
          (see components/patients/PatientFormFields.tsx), replacing the
          previous 5-field version that skipped residence, next of kin,
          allergies, medical history, referral source, patient type and
          comms consent. ────────────────────────────────────────────── */}
      {showAddPatient && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#0e2045] rounded-3xl shadow-2xl border border-gray-100 dark:border-white/10 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 z-10 flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100 dark:border-white/8 bg-white dark:bg-[#0e2045]">
              <h3 className="text-base font-bold text-gray-800 dark:text-white flex items-center gap-2">
                <UserPlus size={16} className="text-purple-500" /> Add New Patient
              </h3>
              <button onClick={() => setShowAddPatient(false)} className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-gray-100 dark:hover:bg-white/8">
                <X size={16} className="text-gray-400" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <PatientFormFields form={newPatient} setForm={setNewPatient} />

              {addPatientError && <p className="text-xs text-red-500 font-medium">{addPatientError}</p>}

              <div className="flex gap-2 pt-1">
                <button onClick={() => setShowAddPatient(false)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold border border-gray-200 dark:border-white/10 text-gray-600 dark:text-white/60">
                  Cancel
                </button>
                <button
                  disabled={addingPatient}
                  onClick={async () => {
                    if (!newPatient.firstName || !newPatient.lastName || !newPatient.phone) { setAddPatientError('First name, last name and phone are required'); return }
                    setAddingPatient(true); setAddPatientError('')
                    try {
                      const body = buildPatientRequestBody(newPatient)
                      const res = await fetch(`${API}/patients`, { method: 'POST', headers: { ...authH, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
                      if (!res.ok) { const d = await res.json(); setAddPatientError(d.error || 'Failed to add patient'); return }
                      setShowAddPatient(false)
                      setNewPatient(EMPTY_PATIENT_FORM)
                      fetchAll(true)
                    } catch { setAddPatientError('Network error. Please try again.') }
                    finally { setAddingPatient(false) }
                  }}
                  className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-1.5 disabled:opacity-60"
                  style={{ background: 'linear-gradient(135deg,#7c3aed,#8b5cf6)' }}>
                  {addingPatient ? <><span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> Saving...</> : <><UserPlus size={14} /> Add Patient</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
