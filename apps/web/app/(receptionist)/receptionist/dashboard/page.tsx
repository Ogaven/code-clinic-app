'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Calendar, AlertTriangle, Zap,
  Plus, X, Send, Mic, MicOff,
  Minimize2, Maximize2, LogIn, LogOut, Search, UserPlus,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { fetchWithAuth } from '@/lib/api'
import BookingDrawer from '@/components/scheduling/BookingDrawer'
import PatientsOverviewCard from '@/components/receptionist/PatientsOverviewCard'
import PatientSatisfactionCard from '@/components/receptionist/PatientSatisfactionCard'
import GrowthCrmCard from '@/components/receptionist/GrowthCrmCard'
import AiSuiteSnapshotCard from '@/components/receptionist/AiSuiteSnapshotCard'

// Same stage grouping as ReceptionistLiveFlow's STAGES, kept in sync
// deliberately so the "Live now" summary card here never disagrees with
// the actual board at /receptionist/flow.
const LIVE_STAGE_STATUSES = {
  arrived:  ['ARRIVED', 'CHECKED_IN'],
  waiting:  ['WAITING'],
  session:  ['IN_OPERATORY', 'IN_CHAIR', 'WITH_PROVIDER'],
  checkout: ['READY_CHECKOUT'],
}

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

function DistributionBar({ segments, total }: { segments: { color: string; count: number }[]; total: number }) {
  const denom = Math.max(total, 1)
  return (
    <div className="flex h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-white/10">
      {segments.filter(s => s.count > 0).map((s, i) => (
        <div key={i} style={{ width: `${(s.count / denom) * 100}%`, background: s.color }} />
      ))}
    </div>
  )
}

function ChipLegend({ items, loading }: { items: { label: string; count: number; color: string }[]; loading: boolean }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5">
      {items.map(it => (
        <span key={it.label} className="inline-flex items-center gap-1 text-[10px]">
          <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: it.color }} />
          <span className="text-gray-500 dark:text-slate-400">{it.label}</span>
          <span className="font-bold text-gray-700 dark:text-slate-200">{loading ? '—' : it.count}</span>
        </span>
      ))}
    </div>
  )
}

// ── Compact stat tile (Live now) ──────────
function OperationalCard({ icon, iconBg, title, badge, breakdown, loading }: {
  icon: React.ReactNode; iconBg: string; title: string; badge?: string
  breakdown: { label: string; value: number; color: string }[]
  loading: boolean
}) {
  const total = breakdown.reduce((s, b) => s + b.value, 0)
  return (
    <div className="bg-white dark:bg-white/[0.04] rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm p-4">
      <div className="flex items-start justify-between mb-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: iconBg }}>
          {icon}
        </div>
        {badge && !loading && (
          <span className="text-xs font-bold bg-cyan-50 dark:bg-cyan-900/20 text-cyan-600 dark:text-cyan-400 px-2 py-0.5 rounded-full">{badge}</span>
        )}
        {loading && <div className="h-5 w-12 bg-gray-100 dark:bg-white/10 rounded-full animate-pulse" />}
      </div>
      {loading ? (
        <div className="space-y-2">
          <div className="h-8 w-14 bg-gray-200 dark:bg-white/10 rounded-lg animate-pulse" />
          <div className="h-4 w-32 bg-gray-100 dark:bg-white/5 rounded animate-pulse" />
        </div>
      ) : (
        <>
          <p className="text-sm font-bold text-gray-800 dark:text-white mb-2">{title}</p>
          <p className="text-3xl font-black text-gray-800 dark:text-white leading-none mb-2">{total}</p>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {breakdown.map(b => (
              <span key={b.label} className="text-[11px] font-semibold" style={{ color: b.color }}>
                {b.value} {b.label}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────
export default function ReceptionistDashboard() {
  const router  = useRouter()
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
  const [showBooking, setShowBooking]   = useState(false)
  const [showAddPatient, setShowAddPatient] = useState(false)
  const [newPatient, setNewPatient]     = useState({ firstName: '', lastName: '', phone: '', email: '', gender: 'UNKNOWN' })
  const [addingPatient, setAddingPatient] = useState(false)
  const [addPatientError, setAddPatientError] = useState('')

  // Sarah chatbot state
  type Msg = { from: 'sarah' | 'user'; text: string; time: string }
  const [chatOpen, setChatOpen]     = useState(false)
  const [chatMin, setChatMin]       = useState(false)
  const [msgs, setMsgs]             = useState<Msg[]>([])
  const [chatInput, setChatInput]   = useState('')
  const [typing, setTyping]         = useState(false)
  const [recording, setRec]         = useState(false)
  const [dragging, setDrag]         = useState(false)
  const [chatPos, setChatPos]       = useState({ x: 0, y: 0 })
  const [hasMoved, setHasMoved]     = useState(false)
  const [chatMessages, setChatMsgs] = useState<any[]>([])
  const messagesEnd = useRef<HTMLDivElement>(null)
  const recRef      = useRef<any>(null)
  const dragStart   = useRef({ mx: 0, my: 0, bx: 0, by: 0 })
  const bubbleRef   = useRef<HTMLDivElement>(null)

  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const authH = { Authorization: `Bearer ${token}` }

  useEffect(() => {
    const stored = localStorage.getItem('cc_user')
    if (stored) {
      const u = JSON.parse(stored)
      setUser(u)
      setMsgs([{
        from: 'sarah',
        text: `Hello ${u.firstName}! 😊 I'm Sarah, your AI assistant. How can I help you today?`,
        time: nowTime(),
      }])
    }
    fetchAll(true)
    const t = setInterval(() => fetchAll(), 30000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs, typing])

  // Drag logic for chat bubble
  function onBubbleMouseDown(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest('button, input, textarea')) return
    e.preventDefault()
    setDrag(true)
    dragStart.current = { mx: e.clientX, my: e.clientY, bx: chatPos.x, by: chatPos.y }
  }
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging) return
      const dx = e.clientX - dragStart.current.mx
      const dy = e.clientY - dragStart.current.my
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) setHasMoved(true)
      setChatPos({ x: dragStart.current.bx + dx, y: dragStart.current.by + dy })
    }
    const onUp = () => { if (dragging) { setDrag(false); setTimeout(() => setHasMoved(false), 100) } }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
  }, [dragging])

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function nowTime() {
    return new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' })
  }

  async function sendChat(text?: string) {
    const msg = text || chatInput.trim()
    if (!msg) return
    setChatInput('')
    const userMsg: Msg = { from: 'user', text: msg, time: nowTime() }
    setMsgs(m => [...m, userMsg])
    setTyping(true)

    const newMessages = [...chatMessages, { role: 'user', content: msg }]
    setChatMsgs(newMessages)

    try {
      const res = await fetch(`${API}/assistant/chat`, {
        method: 'POST',
        headers: { ...authH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages, context: { page: 'Dashboard' } }),
      })
      const data = await res.json()
      const reply = data.content || data.error || 'Sorry, I had trouble with that.'
      setChatMsgs(m => [...m, { role: 'assistant', content: reply }])
      setMsgs(m => [...m, { from: 'sarah', text: reply, time: nowTime() }])

      // Handle client-side actions
      if (data.clientActions?.length) {
        for (const action of data.clientActions) {
          if (action.type === 'open_page') router.push(action.route)
        }
      }
    } catch {
      setMsgs(m => [...m, { from: 'sarah', text: "Sorry, I couldn't connect right now. Please try again! 🙏", time: nowTime() }])
    } finally { setTyping(false) }
  }

  function toggleRecording() {
    if (recording) { recRef.current?.stop(); setRec(false); return }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) { sendChat("Voice input isn't supported in this browser."); return }
    const rec = new SR(); rec.lang = 'en-GB'; rec.interimResults = false
    rec.onresult = (e: any) => { const t = e.results[0][0].transcript; setChatInput(t); sendChat(t) }
    rec.onend = () => setRec(false); rec.onerror = () => setRec(false)
    recRef.current = rec; rec.start(); setRec(true)
  }

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

  const quickChips = [
    "Today's schedule", 'AI agent status', 'Any escalations?', 'Add patient',
  ]

  const sk = stats === null

  const weekCounts = WEEK_STATUSES.map(s => ({ ...s, count: (weekAppts ?? []).filter(a => a.status === s.key).length }))
  const weekTotal  = weekAppts ? weekAppts.length : 0

  const liveBreakdown = [
    { label: 'arrived',  value: appointments.filter(a => LIVE_STAGE_STATUSES.arrived.includes(a.status)).length,  color: '#3B82F6' },
    { label: 'waiting',  value: appointments.filter(a => LIVE_STAGE_STATUSES.waiting.includes(a.status)).length,  color: '#D97706' },
    { label: 'in session', value: appointments.filter(a => LIVE_STAGE_STATUSES.session.includes(a.status)).length, color: '#0D9488' },
    { label: 'checkout', value: appointments.filter(a => LIVE_STAGE_STATUSES.checkout.includes(a.status)).length, color: '#7C3AED' },
  ]

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

      {/* ── Header: greeting + dental illustration + compact quick actions ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <div className="flex items-center gap-2.5 min-w-0">
          <Image src="/dental30.png" alt="" width={34} height={26} className="hidden sm:block flex-shrink-0"
            style={{ objectFit: 'contain', filter: 'drop-shadow(0 4px 12px rgba(41,171,226,0.35))' }} />
          <h1 className="text-lg sm:text-xl font-black text-gray-800 dark:text-white truncate">
            {greeting()}, <span style={{ color: '#29ABE2' }}>{user?.firstName}</span>! 👋
          </h1>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => { setCheckinMode('in'); setShowCheckin(true) }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-white hover:-translate-y-0.5 transition-all"
            style={{ background: 'linear-gradient(135deg,#0891b2,#06b6d4)' }}>
            <LogIn size={13} /> Check In
          </button>
          <button
            onClick={() => { setCheckinMode('out'); setShowCheckin(true) }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-white hover:-translate-y-0.5 transition-all"
            style={{ background: 'linear-gradient(135deg,#059669,#10b981)' }}>
            <LogOut size={13} /> Check Out
          </button>
          <button
            onClick={() => setShowBooking(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold hover:-translate-y-0.5 transition-all border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-gray-700 dark:text-white">
            <Plus size={13} className="text-cyan-500" /> Book
          </button>
          <button
            onClick={() => { setNewPatient({ firstName: '', lastName: '', phone: '', email: '', gender: 'UNKNOWN' }); setAddPatientError(''); setShowAddPatient(true) }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold hover:-translate-y-0.5 transition-all border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-gray-700 dark:text-white">
            <UserPlus size={13} className="text-purple-500" /> Add Patient
          </button>
        </div>
      </div>

      {/* ── Row 1: Appointments This Week / Patient Live Flow / Upcoming ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Appointments This Week — same visual language as the Admin
            dashboard's equivalent card (number + distribution bar + chip
            legend), reusing the same GET /scheduling/appointments endpoint. */}
        <div className="bg-white dark:bg-white/[0.04] rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm p-3.5">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-wide text-gray-700 dark:text-slate-200">Appointments This Week</p>
            <span className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-lg bg-cyan-50 text-cyan-600 dark:bg-cyan-400/10 dark:text-cyan-300"><Calendar size={13} /></span>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <p className="text-3xl font-extrabold leading-none text-gray-800 dark:text-white">{weekAppts ? weekTotal : '—'}</p>
            <div className="h-8 w-px flex-shrink-0 bg-gray-100 dark:bg-white/10" />
            <DistributionBar segments={weekCounts} total={weekTotal} />
          </div>
          <ChipLegend items={weekCounts} loading={!weekAppts} />
        </div>

        <OperationalCard
          icon={<Zap size={18} className="text-white" />}
          iconBg="linear-gradient(135deg, #0d9488, #14b8a6)"
          title="Patient Live Flow"
          badge="Live now"
          breakdown={liveBreakdown}
          loading={sk}
        />

        {/* Upcoming Appointments */}
        <div className="bg-white dark:bg-white/[0.04] rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50 dark:border-white/5">
            <h3 className="text-sm font-bold text-gray-800 dark:text-white">Upcoming Appointments</h3>
            <Link href="/receptionist/appointments" className="text-xs text-cyan-600 dark:text-cyan-400 font-semibold hover:underline">View all</Link>
          </div>
          <div className="divide-y divide-gray-50 dark:divide-white/5 max-h-[220px] overflow-y-auto">
            {upcoming.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <p className="text-xs text-gray-400">No upcoming appointments</p>
              </div>
            ) : upcoming.slice(0, 6).map(a => {
              const t = new Date(a.startAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi' })
              const date = new Date(a.startAt).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Nairobi' })
              return (
                <div key={a.id} className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: a.service?.colour || '#29ABE2' }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 truncate">{a.patient?.firstName} {a.patient?.lastName}</p>
                      <p className="text-[10px] text-gray-400 truncate">Dr. {a.doctor?.user?.firstName} · {a.service?.name}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-[10px] font-bold text-cyan-600 dark:text-cyan-400">{t}</p>
                      <p className="text-[9px] text-gray-400">{date}</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── Row 2: Patients Overview / Patient Satisfaction / Growth & CRM ──── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <PatientsOverviewCard newToday={stats?.newPatients?.count ?? 0} returningToday={stats?.returningPatients?.count ?? 0} loading={sk} />
        <PatientSatisfactionCard />
        <GrowthCrmCard />
      </div>

      {/* ── Row 3: AI Suite Activity (compact) ─────────────────── */}
      <AiSuiteSnapshotCard />

      {/* ── Book Appointment Drawer ──────────────────────────── */}
      <BookingDrawer open={showBooking} onClose={() => setShowBooking(false)} onBooked={() => { setShowBooking(false); fetchAll(true) }} />

      {/* ── Add Patient Modal ────────────────────────────────── */}
      {showAddPatient && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#0e2045] rounded-3xl shadow-2xl border border-gray-100 dark:border-white/10 w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100 dark:border-white/8">
              <h3 className="text-base font-bold text-gray-800 dark:text-white flex items-center gap-2">
                <UserPlus size={16} className="text-purple-500" /> Add New Patient
              </h3>
              <button onClick={() => setShowAddPatient(false)} className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-gray-100 dark:hover:bg-white/8">
                <X size={16} className="text-gray-400" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-gray-500 mb-1 block">First Name *</label>
                  <input value={newPatient.firstName} onChange={e => setNewPatient(p => ({ ...p, firstName: e.target.value }))}
                    placeholder="e.g. Sarah" className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 dark:text-white focus:outline-none focus:border-cyan-500" />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500 mb-1 block">Last Name *</label>
                  <input value={newPatient.lastName} onChange={e => setNewPatient(p => ({ ...p, lastName: e.target.value }))}
                    placeholder="e.g. Nakato" className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 dark:text-white focus:outline-none focus:border-cyan-500" />
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-500 mb-1 block">Phone *</label>
                <input value={newPatient.phone} onChange={e => setNewPatient(p => ({ ...p, phone: e.target.value }))}
                  placeholder="+256 7xx xxx xxx" className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 dark:text-white focus:outline-none focus:border-cyan-500" />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-500 mb-1 block">Email</label>
                <input type="email" value={newPatient.email} onChange={e => setNewPatient(p => ({ ...p, email: e.target.value }))}
                  placeholder="patient@email.com" className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 dark:text-white focus:outline-none focus:border-cyan-500" />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-500 mb-1 block">Gender</label>
                <select value={newPatient.gender} onChange={e => setNewPatient(p => ({ ...p, gender: e.target.value }))}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-800 dark:text-white focus:outline-none focus:border-cyan-500">
                  <option value="UNKNOWN" className="dark:bg-gray-800">Prefer not to say</option>
                  <option value="MALE" className="dark:bg-gray-800">Male</option>
                  <option value="FEMALE" className="dark:bg-gray-800">Female</option>
                </select>
              </div>
              {addPatientError && <p className="text-xs text-red-500 font-semibold">{addPatientError}</p>}
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
                      const res = await fetch(`${API}/patients`, { method: 'POST', headers: { ...authH, 'Content-Type': 'application/json' }, body: JSON.stringify(newPatient) })
                      if (!res.ok) { const d = await res.json(); setAddPatientError(d.error || 'Failed to add patient'); return }
                      setShowAddPatient(false)
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

      {/* ── Sarah Chatbot ─────────────────────────────────────── */}
      <div
        ref={bubbleRef}
        style={{
          position: 'fixed',
          right: `${-chatPos.x + 24}px`,
          bottom: `${-chatPos.y + 24}px`,
          zIndex: 9999,
          cursor: dragging ? 'grabbing' : 'grab',
          userSelect: 'none',
          transition: dragging ? 'none' : 'right 0.2s, bottom 0.2s',
        }}
        onMouseDown={onBubbleMouseDown}
      >
        {/* Chat panel */}
        {chatOpen && !chatMin && (
          <div className="mb-4 rounded-3xl shadow-2xl overflow-hidden animate-slide-right"
            style={{ width: 360, background: 'linear-gradient(165deg, #0c1e50, #1a3a8f)', border: '1px solid rgba(255,255,255,0.12)', cursor: 'default' }}
            onMouseDown={e => e.stopPropagation()}>

            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10"
              style={{ background: 'rgba(255,255,255,0.07)' }}>
              <div className="flex items-center gap-3">
                <div className="relative w-9 h-9 rounded-full overflow-hidden border-2 border-white/30">
                  <Image src="/sarah.jpg" alt="Sarah" fill style={{ objectFit: 'cover', objectPosition: 'center top' }} />
                </div>
                <div>
                  <p className="text-white text-sm font-bold">Sarah</p>
                  <div className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-dot" />
                    <p className="text-[10px] text-emerald-300">AI Assistant · Online</p>
                  </div>
                </div>
              </div>
              <div className="flex gap-1">
                <button onClick={() => setChatMin(true)} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-white/10 transition-colors">
                  <Minimize2 size={13} color="rgba(255,255,255,0.6)" />
                </button>
                <button onClick={() => setChatOpen(false)} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-white/10 transition-colors">
                  <X size={13} color="rgba(255,255,255,0.6)" />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="space-y-3 px-4 py-4 overflow-y-auto" style={{ maxHeight: 320 }}>
              {msgs.map((m, i) => (
                <div key={i} className={`flex ${m.from === 'user' ? 'justify-end' : 'items-start gap-2'}`}>
                  {m.from === 'sarah' && (
                    <div className="w-7 h-7 rounded-full overflow-hidden flex-shrink-0 border border-white/20">
                      <Image src="/sarah.jpg" alt="Sarah" width={28} height={28} style={{ objectFit: 'cover', objectPosition: 'center top' }} />
                    </div>
                  )}
                  <div>
                    <div className="rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed max-w-[230px] whitespace-pre-line"
                      style={{
                        background: m.from === 'sarah' ? 'rgba(255,255,255,0.1)' : 'linear-gradient(135deg,#29ABE2,#1A237E)',
                        color: 'white',
                        borderRadius: m.from === 'sarah' ? '4px 16px 16px 16px' : '16px 4px 16px 16px',
                      }}>
                      {m.text}
                    </div>
                    <p className="text-[9px] text-blue-300/40 mt-1 px-1">{m.time}</p>
                  </div>
                </div>
              ))}
              {typing && (
                <div className="flex items-start gap-2">
                  <div className="w-7 h-7 rounded-full overflow-hidden border border-white/20">
                    <Image src="/sarah.jpg" alt="" width={28} height={28} style={{ objectFit: 'cover', objectPosition: 'center top' }} />
                  </div>
                  <div className="rounded-2xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.1)', borderRadius: '4px 16px 16px 16px' }}>
                    <div className="flex gap-1 items-center h-3">
                      {[0,1,2].map(j => <span key={j} className="w-1.5 h-1.5 rounded-full bg-blue-300 animate-bounce" style={{ animationDelay: `${j*0.15}s` }} />)}
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEnd} />
            </div>

            {/* Quick chips */}
            <div className="px-4 pb-2 flex flex-wrap gap-1.5">
              {quickChips.map(q => (
                <button key={q} onClick={() => sendChat(q)}
                  className="text-[10px] font-medium px-2.5 py-1 rounded-full transition-all hover:bg-white/20"
                  style={{ background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.8)', border: '1px solid rgba(255,255,255,0.15)' }}>
                  {q}
                </button>
              ))}
            </div>

            {/* Input */}
            <div className="flex items-center gap-2 px-4 py-3 border-t border-white/10">
              <input
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendChat()}
                placeholder={recording ? '🎙 Listening...' : 'Ask Sarah anything...'}
                className="flex-1 text-xs py-2.5 px-3.5 rounded-xl outline-none placeholder-blue-300/50 text-white"
                style={{ background: 'rgba(255,255,255,0.08)', border: `1px solid ${recording ? 'rgba(236,72,153,0.5)' : 'rgba(255,255,255,0.14)'}` }}
                onMouseDown={e => e.stopPropagation()}
              />
              <button onClick={toggleRecording}
                className="w-9 h-9 rounded-xl flex items-center justify-center transition-all hover:scale-110 flex-shrink-0"
                style={{ background: recording ? 'rgba(236,72,153,0.4)' : 'rgba(255,255,255,0.1)', border: `1px solid ${recording ? 'rgba(236,72,153,0.5)' : 'rgba(255,255,255,0.15)'}` }}>
                {recording ? <MicOff size={14} color="#EC4899" className="animate-pulse" /> : <Mic size={14} color="rgba(255,255,255,0.7)" />}
              </button>
              <button onClick={() => sendChat()}
                className="w-9 h-9 rounded-xl flex items-center justify-center transition-all hover:scale-110 flex-shrink-0"
                style={{ background: 'linear-gradient(135deg,#29ABE2,#1A237E)' }}>
                <Send size={14} color="white" />
              </button>
            </div>
          </div>
        )}

        {/* Minimised bar */}
        {chatOpen && chatMin && (
          <div className="mb-4 flex items-center gap-3 px-4 py-2.5 rounded-2xl shadow-xl cursor-pointer"
            style={{ background: 'linear-gradient(135deg, #0c1e50, #1a3a8f)', border: '1px solid rgba(255,255,255,0.15)' }}
            onClick={() => setChatMin(false)} onMouseDown={e => e.stopPropagation()}>
            <div className="relative w-7 h-7 rounded-full overflow-hidden border border-white/30">
              <Image src="/sarah.jpg" alt="Sarah" fill style={{ objectFit: 'cover', objectPosition: 'center top' }} />
            </div>
            <span className="text-white text-xs font-semibold">Sarah AI</span>
            <Maximize2 size={12} color="rgba(255,255,255,0.5)" />
          </div>
        )}

        {/* Floating bubble */}
        <div
          onClick={() => { if (!hasMoved) setChatOpen(o => !o) }}
          className={`select-none cursor-pointer ${!dragging && !chatOpen ? 'animate-float' : ''}`}
          style={{ position: 'relative', width: 64, height: 64 }}
        >
          <div className="absolute rounded-full animate-pulse pointer-events-none"
            style={{ inset: -8, background: 'radial-gradient(circle,rgba(41,171,226,0.5),transparent)', opacity: 0.7 }} />
          <div style={{ width: 64, height: 64, borderRadius: '50%', overflow: 'hidden', border: '3px solid rgba(255,255,255,0.35)', boxShadow: '0 8px 32px rgba(0,0,0,0.3)', position: 'relative' }}>
            <Image src="/sarah.jpg" alt="Sarah" fill sizes="64px" style={{ objectFit: 'cover', objectPosition: 'center top' }} />
          </div>
          <span className="absolute animate-pulse-dot"
            style={{ bottom: 2, right: 2, width: 14, height: 14, borderRadius: '50%', background: '#34D399', border: '2.5px solid white', display: 'block' }} />
        </div>
      </div>
    </div>
  )
}
