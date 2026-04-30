'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Calendar, Users, UserCheck, Bot, TrendingUp, TrendingDown,
  ChevronRight, Clock, AlertTriangle, CheckCircle2,
  Plus, X, Send, Mic, MicOff,
  Minimize2, Maximize2, LogIn, LogOut, Search, UserPlus,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { fetchWithAuth } from '@/lib/api'
import LivePatientFlow from '@/components/scheduling/LivePatientFlow'
import BookingDrawer from '@/components/scheduling/BookingDrawer'

// ── Analog Clock ──────────────────────────────────────────────
function AnalogClock() {
  const [time, setTime] = useState(() =>
    new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Kampala' }))
  )
  useEffect(() => {
    const t = setInterval(() => {
      setTime(new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Kampala' })))
    }, 1000)
    return () => clearInterval(t)
  }, [])

  const s = time.getSeconds()
  const m = time.getMinutes()
  const h = time.getHours() % 12
  const secDeg = s * 6
  const minDeg = m * 6 + s * 0.1
  const hrDeg  = h * 30 + m * 0.5

  function hand(deg: number, len: number, width: number, color: string) {
    const rad = (deg - 90) * (Math.PI / 180)
    return (
      <line
        x1="50" y1="50"
        x2={50 + len * Math.cos(rad)}
        y2={50 + len * Math.sin(rad)}
        stroke={color} strokeWidth={width} strokeLinecap="round"
      />
    )
  }

  const ticks = Array.from({ length: 60 }, (_, i) => {
    const rad = (i * 6 - 90) * Math.PI / 180
    const isHour = i % 5 === 0
    const r1 = isHour ? 37 : 41
    return (
      <line key={i}
        x1={50 + r1 * Math.cos(rad)}     y1={50 + r1 * Math.sin(rad)}
        x2={50 + 44.5 * Math.cos(rad)}   y2={50 + 44.5 * Math.sin(rad)}
        stroke={isHour ? '#29ABE2' : '#CBD5E1'}
        strokeWidth={isHour ? 2.2 : 0.8} strokeLinecap="round"
      />
    )
  })

  const label = time.toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })

  return (
    <div className="flex flex-col items-center gap-1 select-none">
      <svg width="110" height="110" viewBox="0 0 100 100"
        style={{ filter: 'drop-shadow(0 6px 20px rgba(41,171,226,0.35))' }}>
        {/* Face */}
        <circle cx="50" cy="50" r="48" className="clock-face" />
        {/* Subtle inner ring */}
        <circle cx="50" cy="50" r="43" fill="none" stroke="rgba(41,171,226,0.12)" strokeWidth="1" />
        {/* Tick marks */}
        {ticks}
        {/* Hour numbers */}
        {[12,1,2,3,4,5,6,7,8,9,10,11].map((n, i) => {
          const rad = (i * 30 - 90) * Math.PI / 180
          return (
            <text key={n}
              x={50 + 32 * Math.cos(rad)} y={50 + 32 * Math.sin(rad)}
              textAnchor="middle" dominantBaseline="central"
              fontSize="7" fontWeight="700" fill="#64748B"
              style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
              {n}
            </text>
          )
        })}
        {/* Hands */}
        {hand(hrDeg, 24, 3.5, '#1A237E')}
        {hand(minDeg, 33, 2.5, '#29ABE2')}
        {hand(secDeg, 39, 1.2, '#ef4444')}
        {/* Center cap */}
        <circle cx="50" cy="50" r="3" fill="#29ABE2" />
        <circle cx="50" cy="50" r="1.5" fill="white" />
      </svg>
      <span className="text-[10px] font-bold tracking-wide text-gray-400 dark:text-white/40">{label}</span>
      <span className="text-[9px] text-gray-300 dark:text-white/20 font-medium">Kampala · EAT</span>
    </div>
  )
}

// ── Mini Calendar ─────────────────────────────────────────────
function MiniCalendar({ onDateSelect, selectedDate }: { onDateSelect: (d: Date) => void; selectedDate: Date }) {
  const [view, setView] = useState(new Date())
  const [dates, setDates] = useState<Record<string, number>>({})
  const API = '/api-proxy'

  useEffect(() => {
    const token = localStorage.getItem('cc_token')
    fetch(`${API}/receptionist/calendar-dates?year=${view.getFullYear()}&month=${view.getMonth()}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json()).then(setDates).catch(() => {})
  }, [view])

  const year = view.getFullYear(), month = view.getMonth()
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const monthName = view.toLocaleDateString('en-UG', { month: 'long', year: 'numeric' })

  const cells: (number | null)[] = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-bold text-gray-800 dark:text-white">{monthName}</span>
        <div className="flex gap-1">
          <button onClick={() => setView(new Date(year, month - 1, 1))}
            className="w-6 h-6 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10 text-xs font-bold">‹</button>
          <button onClick={() => setView(new Date(year, month + 1, 1))}
            className="w-6 h-6 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10 text-xs font-bold">›</button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {['S','M','T','W','T','F','S'].map((d, i) => (
          <div key={i} className="text-center text-[9px] font-black text-gray-400 uppercase py-1">{d}</div>
        ))}
        {cells.map((day, i) => {
          if (!day) return <div key={i} />
          const key = `${year}-${String(month + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
          const count = dates[key] || 0
          const isSel = selectedDate.getDate() === day && selectedDate.getMonth() === month && selectedDate.getFullYear() === year
          const isToday = new Date().getDate() === day && new Date().getMonth() === month && new Date().getFullYear() === year
          return (
            <button key={i} onClick={() => onDateSelect(new Date(year, month, day))}
              className={cn(
                'relative aspect-square flex items-center justify-center text-xs rounded-lg transition-all',
                isSel ? 'bg-cyan-500 text-white font-bold' :
                isToday ? 'bg-blue-50 dark:bg-cyan-900/20 text-blue-700 dark:text-cyan-400 font-bold' :
                'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10',
              )}>
              {day}
              {count > 0 && !isSel && (
                <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-cyan-500" />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Status config ─────────────────────────────────────────────
const STATUS_COLOR: Record<string, string> = {
  PENDING:        'bg-slate-100 text-slate-600',
  CONFIRMED:      'bg-blue-100 text-blue-700',
  CHECKED_IN:     'bg-yellow-100 text-yellow-700',
  IN_CHAIR:       'bg-orange-100 text-orange-700',
  WITH_PROVIDER:  'bg-teal-100 text-teal-700',
  READY_CHECKOUT: 'bg-purple-100 text-purple-700',
  COMPLETED:      'bg-green-100 text-green-700',
  CANCELLED:      'bg-red-100 text-red-600',
  NO_SHOW:        'bg-gray-100 text-gray-500',
}
const STATUS_LABEL: Record<string, string> = {
  PENDING:'Scheduled', CONFIRMED:'Confirmed', CHECKED_IN:'Checked In',
  IN_CHAIR:'In Chair', WITH_PROVIDER:'With Provider', READY_CHECKOUT:'Ready Checkout',
  COMPLETED:'Done', CANCELLED:'Cancelled', NO_SHOW:'No Show',
}
const STATUS_NEXT: Record<string, { status: string; label: string }> = {
  PENDING:        { status: 'CONFIRMED',      label: 'Confirm' },
  CONFIRMED:      { status: 'CHECKED_IN',     label: 'Check In' },
  CHECKED_IN:     { status: 'IN_CHAIR',       label: 'Seat' },
  IN_CHAIR:       { status: 'WITH_PROVIDER',  label: 'To Provider' },
  WITH_PROVIDER:  { status: 'READY_CHECKOUT', label: 'Ready ✓' },
  READY_CHECKOUT: { status: 'COMPLETED',      label: 'Checkout' },
}

// ── Patient row ───────────────────────────────────────────────
function PatientRow({ appt, onRefresh }: { appt: any; onRefresh: () => void }) {
  const isActive = ['CHECKED_IN','IN_CHAIR','WITH_PROVIDER'].includes(appt.status)
  const time = new Date(appt.startAt).toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Kampala' })

  async function changeStatus(status: string) {
    const token = localStorage.getItem('cc_token')
    await fetch(`/api-proxy/scheduling/appointments/${appt.id}/status`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    onRefresh()
  }

  const next = STATUS_NEXT[appt.status]

  return (
    <div className={cn(
      'group flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors border-b border-gray-50 dark:border-white/5 last:border-0',
      isActive && 'border-l-4 border-l-cyan-500 bg-cyan-50/40 dark:bg-cyan-900/10',
    )}>
      <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
        style={{ background: appt.service?.colour || '#29ABE2' }}>
        {appt.patient?.firstName?.[0]}{appt.patient?.lastName?.[0]}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">{appt.patient?.firstName} {appt.patient?.lastName}</p>
        <p className="text-xs text-gray-400 truncate">{appt.service?.name} · Dr. {appt.doctor?.user?.firstName} {appt.doctor?.user?.lastName}</p>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold bg-cyan-500 text-white px-2 py-0.5 rounded-full whitespace-nowrap">{time}</span>
        <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded-full', STATUS_COLOR[appt.status] || 'bg-gray-100 text-gray-500')}>
          {STATUS_LABEL[appt.status] || appt.status}
        </span>
        {/* Quick advance — visible on hover */}
        <div className="hidden group-hover:flex items-center gap-1 ml-1">
          {next && (
            <button onClick={() => changeStatus(next.status)}
              className="text-[10px] font-bold bg-cyan-500 text-white px-2 py-0.5 rounded-lg hover:bg-cyan-600 transition-colors">
              {next.label}
            </button>
          )}
          {(appt.status === 'PENDING' || appt.status === 'CONFIRMED') && (
            <button onClick={() => changeStatus('CANCELLED')}
              className="text-[10px] font-bold bg-red-100 text-red-600 px-2 py-0.5 rounded-lg hover:bg-red-200 transition-colors">
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Patient Flow Panel ─────────────────────────────────────────
function PatientFlowPanel({ appointments, onRefresh }: { appointments: any[]; onRefresh: () => void }) {
  const groups: Record<string, { label: string; color: string; statuses: string[] }> = {
    waiting:  { label: 'In Waiting Room', color: '#3B82F6', statuses: ['CONFIRMED', 'CHECKED_IN'] },
    active:   { label: 'In Session with Doctor', color: '#14B8A6', statuses: ['IN_CHAIR', 'WITH_PROVIDER'] },
    checkout: { label: 'Checkout & Billing', color: '#8B5CF6', statuses: ['READY_CHECKOUT'] },
  }

  async function advanceStatus(apptId: string, status: string) {
    const token = localStorage.getItem('cc_token')
    await fetch(`/api-proxy/scheduling/appointments/${apptId}/status`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    onRefresh()
  }

  const hasAny = Object.values(groups).some(g =>
    appointments.some(a => g.statuses.includes(a.status))
  )

  return (
    <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-50 dark:border-white/5">
        <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
        <h3 className="text-sm font-bold text-gray-800 dark:text-white">Patient Flow</h3>
        <span className="ml-auto text-xs text-gray-400">{appointments.filter(a => !['COMPLETED','CANCELLED','NO_SHOW'].includes(a.status)).length} active</span>
      </div>
      {!hasAny ? (
        <div className="px-4 py-6 text-center">
          <p className="text-xs text-gray-400">No patients in clinic right now</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-50 dark:divide-white/5">
          {Object.entries(groups).map(([key, g]) => {
            const patients = appointments.filter(a => g.statuses.includes(a.status))
            if (patients.length === 0) return null
            return (
              <div key={key}>
                <div className="flex items-center gap-2 px-4 py-1.5" style={{ background: g.color + '10' }}>
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: g.color }} />
                  <span className="text-[10px] font-black uppercase tracking-wider" style={{ color: g.color }}>{g.label}</span>
                  <span className="text-[10px] font-bold text-gray-400 ml-auto">{patients.length}</span>
                </div>
                {patients.map(appt => {
                  const next = STATUS_NEXT[appt.status]
                  return (
                    <div key={appt.id} className="flex items-center gap-3 px-4 py-2 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0"
                        style={{ background: appt.service?.colour || g.color }}>
                        {appt.patient?.firstName?.[0]}{appt.patient?.lastName?.[0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate">
                          {appt.patient?.firstName} {appt.patient?.lastName}
                        </p>
                        <p className="text-[10px] text-gray-400 truncate">{appt.service?.name}</p>
                      </div>
                      {next && (
                        <button onClick={() => advanceStatus(appt.id, next.status)}
                          className="text-[10px] font-bold px-2 py-1 rounded-lg text-white transition-colors hover:opacity-90"
                          style={{ background: g.color }}>
                          {next.label}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
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
  const [upcoming, setUpcoming]     = useState<any[]>([])
  const [active, setActive]         = useState<any>(null)
  const [escalations, setEscalations] = useState<any[]>([])
  const [agentActive, setAgentActive] = useState(true)
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
      const [s, a, u, ac, e] = await Promise.all([
        fetch(`${API}/receptionist/dashboard-stats`, { headers: authH }).then(r => r.json()),
        fetch(`${API}/receptionist/today-appointments`, { headers: authH }).then(r => r.json()),
        fetch(`${API}/receptionist/upcoming-appointments`, { headers: authH }).then(r => r.json()),
        fetch(`${API}/receptionist/active-consultation`, { headers: authH }).then(r => r.json()),
        fetch(`${API}/receptionist/escalations`, { headers: authH }).then(r => r.json()),
      ])
      lastFetch.current = Date.now()
      setStats(s); setAppts(Array.isArray(a) ? a : [])
      setUpcoming(Array.isArray(u) ? u : [])
      setActive(ac); setEscalations(Array.isArray(e) ? e : [])
      setAgentActive(s?.aiAgents?.active ?? true)
    } catch {} finally { setLoading(false) }
  }

  function nowTime() {
    return new Date().toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kampala' })
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
    const rec = new SR(); rec.lang = 'en-UG'; rec.interimResults = false
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
    const h = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Kampala' })).getHours()
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  }

  const quickChips = [
    "Today's schedule", 'AI agent status', 'Any escalations?', 'Add patient',
  ]

  const sk = stats === null

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
                  const time = new Date(appt.startAt).toLocaleTimeString('en-UG', { hour:'2-digit', minute:'2-digit', hour12:true, timeZone:'Africa/Kampala' })
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
                    const time = new Date(appt.startAt).toLocaleTimeString('en-UG', { hour:'2-digit', minute:'2-digit', hour12:true, timeZone:'Africa/Kampala' })
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

      {/* ── Hero ────────────────────────────────────────────────── */}
      <div className="relative flex items-center justify-between gap-4 px-1 pt-1 pb-2">
        {/* Greeting text */}
        <div className="flex-1">
          <p className="text-gray-400 dark:text-white/40 text-sm font-medium mb-1">
            {new Date().toLocaleDateString('en-UG', { weekday:'long', day:'numeric', month:'long', year:'numeric', timeZone:'Africa/Kampala' })}
          </p>
          <h1 className="text-3xl font-black text-gray-800 dark:text-white mb-1">
            {greeting()}, <span style={{ color: '#29ABE2' }}>{user?.firstName}!</span> 👋
          </h1>
          <p className="text-gray-500 dark:text-white/50 text-sm">
            <span className="font-bold text-cyan-600">{stats?.appointments?.total || 0}</span> appointments today ·{' '}
            <span className="font-bold text-green-500">{stats?.appointments?.confirmed || 0}</span> confirmed ·{' '}
            <span className="font-bold text-amber-500">{stats?.appointments?.pending || 0}</span> pending
          </p>
        </div>

        {/* Clock + dental image */}
        <div className="hidden lg:flex items-center gap-6 flex-shrink-0">
          <AnalogClock />
          <Image src="/dental30.png" alt="" width={160} height={120}
            style={{ objectFit:'contain', filter:'drop-shadow(0 8px 28px rgba(41,171,226,0.4))' }}/>
        </div>
      </div>

      {/* ── Quick Actions ──────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => { setCheckinMode('in'); setShowCheckin(true) }}
          className="flex items-center gap-2 px-5 py-3 rounded-2xl text-sm font-black text-white hover:-translate-y-0.5 transition-all shadow-lg"
          style={{ background: 'linear-gradient(135deg,#0891b2,#06b6d4)', boxShadow: '0 4px 20px rgba(6,182,212,0.4)' }}>
          <LogIn size={16} /> Check In Patient
        </button>
        <button
          onClick={() => { setCheckinMode('out'); setShowCheckin(true) }}
          className="flex items-center gap-2 px-5 py-3 rounded-2xl text-sm font-black text-white hover:-translate-y-0.5 transition-all shadow-lg"
          style={{ background: 'linear-gradient(135deg,#059669,#10b981)', boxShadow: '0 4px 20px rgba(16,185,129,0.4)' }}>
          <LogOut size={16} /> Check Out Patient
        </button>
        <button
          onClick={() => setShowBooking(true)}
          className="flex items-center gap-2 px-5 py-3 rounded-2xl text-sm font-black hover:-translate-y-0.5 transition-all border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-gray-700 dark:text-white">
          <Plus size={16} className="text-cyan-500" /> Book Appointment
        </button>
        <button
          onClick={() => { setNewPatient({ firstName: '', lastName: '', phone: '', email: '', gender: 'UNKNOWN' }); setAddPatientError(''); setShowAddPatient(true) }}
          className="flex items-center gap-2 px-5 py-3 rounded-2xl text-sm font-black hover:-translate-y-0.5 transition-all border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-gray-700 dark:text-white">
          <UserPlus size={16} className="text-purple-500" /> Add Patient
        </button>
      </div>

      {/* ── Stats Row ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Today's Appointments */}
        <div className="dark-pop stat-card-cyan bg-white dark:bg-white/5 rounded-2xl p-4 border border-gray-100 dark:border-white/8 shadow-sm hover:shadow-md">
          <div className="flex items-start justify-between mb-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #0891b2, #06b6d4)' }}>
              <Calendar size={18} className="text-white" />
            </div>
            {sk ? <div className="h-5 w-12 bg-gray-100 dark:bg-white/10 rounded-full animate-pulse" />
              : <span className="text-xs font-bold bg-cyan-50 dark:bg-cyan-900/20 text-cyan-600 dark:text-cyan-400 px-2 py-0.5 rounded-full">Today</span>}
          </div>
          {sk ? (
            <div className="space-y-2">
              <div className="h-8 w-16 bg-gray-200 dark:bg-white/10 rounded-lg animate-pulse" />
              <div className="h-4 w-28 bg-gray-100 dark:bg-white/5 rounded animate-pulse" />
            </div>
          ) : (
            <>
              <p className="text-3xl font-black text-gray-800 dark:text-white">{stats?.appointments?.total || 0}</p>
              <p className="text-xs text-gray-500 dark:text-white/40 mt-1">
                <span className="text-blue-500 font-bold">{stats?.appointments?.confirmed || 0} confirmed</span>
                {' · '}
                <span className="text-amber-500 font-bold">{stats?.appointments?.pending || 0} pending</span>
              </p>
            </>
          )}
        </div>

        {/* New Patients */}
        <div className="dark-pop stat-card-purple bg-white dark:bg-white/5 rounded-2xl p-4 border border-gray-100 dark:border-white/8 shadow-sm hover:shadow-md">
          <div className="flex items-start justify-between mb-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #2563eb, #3b82f6)' }}>
              <Users size={18} className="text-white" />
            </div>
            {sk ? <div className="h-5 w-10 bg-gray-100 dark:bg-white/10 rounded-full animate-pulse" />
              : (stats?.newPatients?.pctChange ?? 0) >= 0 ? (
                <span className="text-xs font-bold bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 px-2 py-0.5 rounded-full flex items-center gap-0.5">
                  <TrendingUp size={10} /> {stats?.newPatients?.pctChange || 0}%
                </span>
              ) : (
                <span className="text-xs font-bold bg-red-50 dark:bg-red-900/20 text-red-500 px-2 py-0.5 rounded-full flex items-center gap-0.5">
                  <TrendingDown size={10} /> {Math.abs(stats?.newPatients?.pctChange || 0)}%
                </span>
              )}
          </div>
          {sk ? (
            <div className="space-y-2">
              <div className="h-8 w-10 bg-gray-200 dark:bg-white/10 rounded-lg animate-pulse" />
              <div className="h-4 w-24 bg-gray-100 dark:bg-white/5 rounded animate-pulse" />
            </div>
          ) : (
            <>
              <p className="text-3xl font-black text-gray-800 dark:text-white">{stats?.newPatients?.count || 0}</p>
              <p className="text-xs text-gray-400 dark:text-white/40 mt-1">New patients today</p>
            </>
          )}
        </div>

        {/* Returning Patients */}
        <div className="dark-pop stat-card-green bg-white dark:bg-white/5 rounded-2xl p-4 border border-gray-100 dark:border-white/8 shadow-sm hover:shadow-md">
          <div className="flex items-start justify-between mb-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #7c3aed, #8b5cf6)' }}>
              <UserCheck size={18} className="text-white" />
            </div>
            {sk ? <div className="h-5 w-10 bg-gray-100 dark:bg-white/10 rounded-full animate-pulse" />
              : (stats?.returningPatients?.pctChange ?? 0) >= 0 ? (
                <span className="text-xs font-bold bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 px-2 py-0.5 rounded-full flex items-center gap-0.5">
                  <TrendingUp size={10} /> {stats?.returningPatients?.pctChange || 0}%
                </span>
              ) : (
                <span className="text-xs font-bold bg-red-50 dark:bg-red-900/20 text-red-500 px-2 py-0.5 rounded-full flex items-center gap-0.5">
                  <TrendingDown size={10} /> {Math.abs(stats?.returningPatients?.pctChange || 0)}%
                </span>
              )}
          </div>
          {sk ? (
            <div className="space-y-2">
              <div className="h-8 w-10 bg-gray-200 dark:bg-white/10 rounded-lg animate-pulse" />
              <div className="h-4 w-28 bg-gray-100 dark:bg-white/5 rounded animate-pulse" />
            </div>
          ) : (
            <>
              <p className="text-3xl font-black text-gray-800 dark:text-white">{stats?.returningPatients?.count || 0}</p>
              <p className="text-xs text-gray-400 dark:text-white/40 mt-1">Returning patients today</p>
            </>
          )}
        </div>

        {/* AI Agent Status */}
        <div className={cn(
          'dark-pop stat-card-orange rounded-2xl p-4 border shadow-sm hover:shadow-md',
          sk ? 'bg-white dark:bg-white/5 border-gray-100 dark:border-white/8'
            : agentActive ? 'bg-white dark:bg-white/5 border-gray-100 dark:border-white/8' : 'bg-red-50 dark:bg-red-900/10 border-red-100 dark:border-red-500/20',
        )}>
          <div className="flex items-start justify-between mb-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: sk ? 'linear-gradient(135deg,#9CA3AF,#D1D5DB)' : agentActive ? 'linear-gradient(135deg, #059669, #10b981)' : 'linear-gradient(135deg, #dc2626, #ef4444)' }}>
              <Bot size={18} className="text-white" />
            </div>
            {sk ? <div className="h-5 w-14 bg-gray-100 dark:bg-white/10 rounded-full animate-pulse" />
              : (
                <div className="flex items-center gap-1">
                  <span className={cn('w-2 h-2 rounded-full animate-pulse', agentActive ? 'bg-emerald-500' : 'bg-red-500')} />
                  <span className={cn('text-xs font-bold', agentActive ? 'text-emerald-500' : 'text-red-500')}>
                    {agentActive ? 'Active' : 'Paused'}
                  </span>
                </div>
              )}
          </div>
          {sk ? (
            <div className="space-y-2">
              <div className="h-8 w-10 bg-gray-200 dark:bg-white/10 rounded-lg animate-pulse" />
              <div className="h-4 w-24 bg-gray-100 dark:bg-white/5 rounded animate-pulse" />
            </div>
          ) : (
            <>
              <p className="text-3xl font-black text-gray-800 dark:text-white">{stats?.aiAgents?.count || 0}</p>
              <p className="text-xs text-gray-400 dark:text-white/40 mt-1">
                {stats?.aiAgents?.escalationsToday || 0} escalations today
              </p>
            </>
          )}
        </div>
      </div>

      {/* ── Live Patient Flow — full width, right after stats ─── */}
      <LivePatientFlow />

      {/* ── Main 2-column grid ─────────────────────────────────── */}
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-2 min-w-0">

        {/* ── LEFT COLUMN ─────────────────────────────────────── */}
        <div className="space-y-4 min-w-0">

          {/* Today's Patient List */}
          <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/8 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50 dark:border-white/8">
              <div>
                <h3 className="text-sm font-bold text-gray-800 dark:text-white">Today's Patients</h3>
                <p className="text-xs text-gray-400 dark:text-white/40">{appointments.length} scheduled</p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  onChange={async e => {
                    const d = new Date()
                    if (e.target.value === 'tomorrow') d.setDate(d.getDate() + 1)
                    else if (e.target.value === 'week') d.setDate(d.getDate() + 7)
                    const iso = d.toISOString().slice(0, 10)
                    const res = await fetch(`${API}/receptionist/today-appointments?date=${iso}`, { headers: authH })
                    if (res.ok) setAppts(await res.json())
                  }}
                  className="text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1 text-gray-600 dark:text-white dark:bg-gray-800 focus:outline-none">
                  <option value="today" className="dark:bg-gray-800">Today</option>
                  <option value="tomorrow" className="dark:bg-gray-800">Tomorrow</option>
                  <option value="week" className="dark:bg-gray-800">This week</option>
                </select>
              </div>
            </div>

            <div>
              {appointments.length === 0 ? (
                <div className="px-4 py-3 text-center">
                  <Calendar size={22} className="mx-auto mb-1.5 text-gray-200" />
                  <p className="text-sm text-gray-400">No appointments scheduled</p>
                </div>
              ) : (
                appointments.slice(0, 6).map(appt => <PatientRow key={appt.id} appt={appt} onRefresh={fetchAll} />)
              )}
            </div>

            {appointments.length > 6 && (
              <div className="px-4 py-2 border-t border-gray-50">
                <Link href="/receptionist/appointments"
                  className="text-xs font-semibold text-cyan-600 hover:text-cyan-700 flex items-center gap-1">
                  View all {appointments.length} appointments <ChevronRight size={12} />
                </Link>
              </div>
            )}
          </div>

          {/* Escalation Alerts */}
          {escalations.length > 0 && (
            <div className="bg-white rounded-2xl border-2 border-red-200 shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border-b border-red-100">
                <AlertTriangle size={15} className="text-red-500 animate-pulse" />
                <h3 className="text-sm font-bold text-red-700">AI Escalation — Action Required</h3>
                <span className="ml-auto text-xs font-black bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center">
                  {escalations.length}
                </span>
              </div>
              {escalations.map((e: any) => (
                <div key={e.id} className="flex items-start gap-3 px-4 py-3 border-b border-red-50 last:border-0">
                  <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center text-red-600 text-xs font-bold flex-shrink-0">
                    {e.patient?.firstName?.[0]}{e.patient?.lastName?.[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800">{e.patient?.firstName} {e.patient?.lastName}</p>
                    <p className="text-xs text-gray-400 truncate">{e.type} · {e.channel}</p>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <Link href="/receptionist/communications"
                      className="text-xs font-bold bg-red-500 text-white px-2.5 py-1.5 rounded-lg hover:bg-red-600 transition-colors">
                      Handle
                    </Link>
                    <button
                      onClick={async () => {
                        const token = localStorage.getItem('cc_token')
                        await fetch(`${API}/receptionist/escalations/${e.id}/resolve`, {
                          method: 'POST', headers: { Authorization: `Bearer ${token}` },
                        })
                        fetchAll()
                      }}
                      className="text-xs font-bold bg-gray-100 text-gray-600 px-2.5 py-1.5 rounded-lg hover:bg-gray-200 transition-colors">
                      Dismiss
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── MIDDLE COLUMN ───────────────────────────────────── */}
        <div className="space-y-4 min-w-0">

          {/* Active Consultation */}
          <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50 dark:border-white/5">
              <div className="flex items-center gap-2">
                <span className={cn('w-2 h-2 rounded-full', active ? 'bg-emerald-500 animate-pulse' : 'bg-gray-300')} />
                <h3 className="text-sm font-bold text-gray-800 dark:text-white">Active Consultation</h3>
              </div>
            </div>

            {active ? (
              <div className="p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-white text-lg font-black flex-shrink-0"
                    style={{ background: active.service?.colour || '#29ABE2' }}>
                    {active.patient?.firstName?.[0]}{active.patient?.lastName?.[0]}
                  </div>
                  <div>
                    <p className="font-bold text-gray-800 dark:text-white">{active.patient?.firstName} {active.patient?.lastName}</p>
                    <p className="text-xs text-gray-400">{active.patient?.gender} · {active.patient?.dob ? new Date().getFullYear() - new Date(active.patient.dob).getFullYear() + ' yrs' : ''}</p>
                    <p className="text-xs text-cyan-600 font-semibold">{active.service?.name}</p>
                  </div>
                </div>
                <div className="bg-gray-50 dark:bg-white/5 rounded-xl p-3">
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Doctor</p>
                  <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Dr. {active.doctor?.user?.firstName} {active.doctor?.user?.lastName}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      const token = localStorage.getItem('cc_token')
                      await fetch(`${API}/scheduling/appointments/${active.id}/status`, {
                        method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ status: 'COMPLETED' }),
                      })
                      fetchAll()
                    }}
                    className="flex-1 text-xs font-bold bg-emerald-500 text-white py-2 rounded-xl hover:bg-emerald-600 transition-colors flex items-center justify-center gap-1">
                    <CheckCircle2 size={12} /> Mark Completed
                  </button>
                  <button
                    onClick={async () => {
                      const token = localStorage.getItem('cc_token')
                      await fetch(`${API}/scheduling/appointments/${active.id}/status`, {
                        method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ status: 'NO_SHOW' }),
                      })
                      fetchAll()
                    }}
                    className="flex-1 text-xs font-bold bg-gray-100 text-gray-600 py-2 rounded-xl hover:bg-gray-200 transition-colors">
                    No Show
                  </button>
                </div>
              </div>
            ) : (
              <div className="px-4 py-3 text-center">
                <Clock size={22} className="mx-auto mb-1.5 text-gray-200" />
                <p className="text-sm text-gray-400">No active consultation</p>
              </div>
            )}
          </div>

        </div>

        {/* ── RIGHT COLUMN ────────────────────────────────────── */}
        <div className="space-y-4 min-w-0">

          {/* Upcoming Appointments */}
          <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50 dark:border-white/5">
              <h3 className="text-sm font-bold text-gray-800 dark:text-white">Upcoming</h3>
              <Link href="/receptionist/appointments" className="text-xs text-cyan-600 font-semibold hover:underline">All</Link>
            </div>
            <div className="divide-y divide-gray-50 dark:divide-white/5">
              {upcoming.length === 0 ? (
                <div className="px-4 py-4 text-center">
                  <p className="text-xs text-gray-400">No upcoming appointments</p>
                </div>
              ) : upcoming.slice(0, 6).map(a => {
                const t = new Date(a.startAt).toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Kampala' })
                const date = new Date(a.startAt).toLocaleDateString('en-UG', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Kampala' })
                return (
                  <div key={a.id} className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: a.service?.colour || '#29ABE2' }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 truncate">{a.patient?.firstName} {a.patient?.lastName}</p>
                        <p className="text-[10px] text-gray-400 truncate">Dr. {a.doctor?.user?.firstName} · {a.service?.name}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-[10px] font-bold text-cyan-600">{t}</p>
                        <p className="text-[9px] text-gray-400">{date}</p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

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
