'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Calendar, Users, UserCheck, Bot, TrendingUp, TrendingDown,
  ChevronRight, Clock, AlertTriangle, CheckCircle2, Zap,
  MessageSquare, Phone, StickyNote, Plus, X, Send, Mic, MicOff,
  Minimize2, Maximize2,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Analog Clock ──────────────────────────────────────────────
function AnalogClock() {
  const [time, setTime] = useState(new Date())
  useEffect(() => { const t = setInterval(() => setTime(new Date()), 1000); return () => clearInterval(t) }, [])
  const kla  = new Date(time.toLocaleString('en-US', { timeZone: 'Africa/Kampala' }))
  const h = kla.getHours() % 12, m = kla.getMinutes(), s = kla.getSeconds()
  const hDeg = h / 12 * 360 + m / 60 * 30
  const mDeg = m / 60 * 360 + s / 60 * 6
  const sDeg = s / 60 * 360
  const cx = 44, cy = 44, r = 40
  const hand = (deg: number, len: number) => ({
    x2: cx + Math.cos((deg - 90) * Math.PI / 180) * len,
    y2: cy + Math.sin((deg - 90) * Math.PI / 180) * len,
  })
  const timeStr = kla.toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit', hour12: true })
  const dateStr = kla.toLocaleDateString('en-UG', { weekday: 'short', day: 'numeric', month: 'long' })
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="88" height="88" viewBox="0 0 88 88">
        <circle cx={cx} cy={cy} r={r} fill="rgba(255,255,255,0.15)" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5"/>
        <circle cx={cx} cy={cy} r={r-4} fill="rgba(255,255,255,0.05)"/>
        {Array.from({ length: 12 }).map((_, i) => {
          const a = (i / 12) * 360 - 90
          return <line key={i} x1={cx + Math.cos(a * Math.PI/180) * (r-6)} y1={cy + Math.sin(a * Math.PI/180) * (r-6)}
            x2={cx + Math.cos(a * Math.PI/180) * (r-2)} y2={cy + Math.sin(a * Math.PI/180) * (r-2)}
            stroke="rgba(255,255,255,0.5)" strokeWidth={i % 3 === 0 ? 2 : 1} strokeLinecap="round"/>
        })}
        <line x1={cx} y1={cy} {...hand(hDeg,22)} stroke="white" strokeWidth="3" strokeLinecap="round"/>
        <line x1={cx} y1={cy} {...hand(mDeg,30)} stroke="#29ABE2" strokeWidth="2" strokeLinecap="round"/>
        <line x1={cx} y1={cy} {...hand(sDeg,34)} stroke="#EC4899" strokeWidth="1.2" strokeLinecap="round"/>
        <circle cx={cx} cy={cy} r="3.5" fill="white"/><circle cx={cx} cy={cy} r="1.5" fill="#29ABE2"/>
      </svg>
      <p className="text-white/90 text-[11px] font-bold tracking-wide">{timeStr} EAT</p>
      <p className="text-blue-200 text-[9px] font-semibold tracking-wider uppercase">{dateStr}</p>
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
        <span className="text-sm font-bold text-gray-800">{monthName}</span>
        <div className="flex gap-1">
          <button onClick={() => setView(new Date(year, month - 1, 1))}
            className="w-6 h-6 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 text-xs font-bold">‹</button>
          <button onClick={() => setView(new Date(year, month + 1, 1))}
            className="w-6 h-6 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 text-xs font-bold">›</button>
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
                isToday ? 'bg-blue-50 text-blue-700 font-bold' :
                'text-gray-700 hover:bg-gray-100',
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

// ── Patient row ───────────────────────────────────────────────
function PatientRow({ appt, onRefresh }: { appt: any; onRefresh: () => void }) {
  const isActive = appt.status === 'IN_PROGRESS'
  const time = new Date(appt.startAt).toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Kampala' })
  const statusColor: Record<string, string> = {
    CONFIRMED: 'bg-blue-100 text-blue-700',
    PENDING: 'bg-amber-100 text-amber-700',
    IN_PROGRESS: 'bg-emerald-100 text-emerald-700',
    COMPLETED: 'bg-gray-100 text-gray-500',
    CANCELLED: 'bg-red-100 text-red-600',
    NO_SHOW: 'bg-orange-100 text-orange-600',
  }

  async function changeStatus(status: string) {
    const token = localStorage.getItem('cc_token')
    await fetch(`/api-proxy/scheduling/appointments/${appt.id}/status`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    onRefresh()
  }

  return (
    <div className={cn(
      'group flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0',
      isActive && 'border-l-4 border-l-cyan-500 bg-cyan-50/40',
    )}>
      <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
        style={{ background: appt.service?.colour || '#29ABE2' }}>
        {appt.patient?.firstName?.[0]}{appt.patient?.lastName?.[0]}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-800 truncate">{appt.patient?.firstName} {appt.patient?.lastName}</p>
        <p className="text-xs text-gray-400 truncate">{appt.service?.name} · Dr. {appt.doctor?.user?.firstName} {appt.doctor?.user?.lastName}</p>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold bg-cyan-500 text-white px-2 py-0.5 rounded-full whitespace-nowrap">{time}</span>
        <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded-full', statusColor[appt.status] || 'bg-gray-100 text-gray-500')}>
          {appt.status.replace('_', ' ')}
        </span>
        {/* Quick actions - visible on hover */}
        <div className="hidden group-hover:flex items-center gap-1 ml-1">
          {appt.status === 'PENDING' && (
            <button onClick={() => changeStatus('CONFIRMED')}
              className="text-[10px] font-bold bg-blue-500 text-white px-2 py-0.5 rounded-lg hover:bg-blue-600 transition-colors">
              Confirm
            </button>
          )}
          {appt.status === 'CONFIRMED' && (
            <button onClick={() => changeStatus('IN_PROGRESS')}
              className="text-[10px] font-bold bg-emerald-500 text-white px-2 py-0.5 rounded-lg hover:bg-emerald-600 transition-colors">
              Check In
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
  const [selectedDate, setSelDate]  = useState(new Date())
  const [notes, setNotes]           = useState<string[]>(() => {
    if (typeof window === 'undefined') return []
    return JSON.parse(localStorage.getItem('rec_notes') || '[]')
  })
  const [newNote, setNewNote]       = useState('')
  const [agentActive, setAgentActive] = useState(true)
  const [loading, setLoading]       = useState(true)

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
    fetchAll()
    const t = setInterval(fetchAll, 30000)
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

  async function fetchAll() {
    try {
      const [s, a, u, ac, e] = await Promise.all([
        fetch(`${API}/receptionist/dashboard-stats`, { headers: authH }).then(r => r.json()),
        fetch(`${API}/receptionist/today-appointments`, { headers: authH }).then(r => r.json()),
        fetch(`${API}/receptionist/upcoming-appointments`, { headers: authH }).then(r => r.json()),
        fetch(`${API}/receptionist/active-consultation`, { headers: authH }).then(r => r.json()),
        fetch(`${API}/receptionist/escalations`, { headers: authH }).then(r => r.json()),
      ])
      setStats(s); setAppts(Array.isArray(a) ? a : [])
      setUpcoming(Array.isArray(u) ? u : [])
      setActive(ac); setEscalations(Array.isArray(e) ? e : [])
      setAgentActive(s?.aiAgents?.active ?? true)
    } catch {} finally { setLoading(false) }
  }

  async function fetchForDate(d: Date) {
    setSelDate(d)
    const iso = d.toISOString().slice(0, 10)
    const res = await fetch(`${API}/receptionist/today-appointments?date=${iso}`, { headers: authH })
    if (res.ok) setAppts(await res.json())
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

  function addNote() {
    if (!newNote.trim()) return
    const updated = [newNote.trim(), ...notes].slice(0, 10)
    setNotes(updated)
    localStorage.setItem('rec_notes', JSON.stringify(updated))
    setNewNote('')
  }
  function removeNote(i: number) {
    const updated = notes.filter((_, idx) => idx !== i)
    setNotes(updated)
    localStorage.setItem('rec_notes', JSON.stringify(updated))
  }

  const greeting = () => {
    const h = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Kampala' })).getHours()
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  }

  const quickChips = [
    "Today's schedule", 'AI agent status', 'Any escalations?', 'Add patient',
  ]

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-gray-400 font-medium">Loading dashboard...</p>
      </div>
    </div>
  )

  return (
    <div className="p-5 space-y-5 max-w-[1600px] mx-auto">

      {/* ── Hero — no card, floating elements ─────────────────── */}
      <div className="relative flex items-start justify-between gap-4 px-1 pt-1 pb-2">
        {/* Greeting text — independent, no card */}
        <div className="flex-1">
          <p className="text-gray-400 text-sm font-medium mb-1">
            {new Date().toLocaleDateString('en-UG', { weekday:'long', day:'numeric', month:'long', year:'numeric', timeZone:'Africa/Kampala' })}
          </p>
          <h1 className="text-3xl font-black text-gray-800 mb-1">
            {greeting()}, <span style={{ color: '#0c1e50' }}>{user?.firstName}!</span> 👋
          </h1>
          <p className="text-gray-500 text-sm">
            <span className="font-bold text-cyan-600">{stats?.appointments?.total || 0}</span> appointments today ·{' '}
            <span className="font-bold text-green-600">{stats?.appointments?.confirmed || 0}</span> confirmed ·{' '}
            <span className="font-bold text-amber-600">{stats?.appointments?.pending || 0}</span> pending
          </p>
        </div>

        {/* Clock — independent floating card */}
        <div className="rounded-2xl p-3 flex-shrink-0 shadow-md"
          style={{ background: 'linear-gradient(135deg,#0c1e50,#1565C0)', border:'1px solid rgba(255,255,255,0.12)' }}>
          <AnalogClock />
        </div>

        {/* Dental image — independent, floating right */}
        <div className="hidden lg:flex items-end flex-shrink-0" style={{ width:160, height:120 }}>
          <Image src="/dental40.png" alt="" width={160} height={120}
            style={{ objectFit:'contain', objectPosition:'bottom', filter:'drop-shadow(0 8px 24px rgba(41,171,226,0.35))' }}/>
        </div>
      </div>

      {/* ── Stats Row ──────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-4">
        {/* Today's Appointments */}
        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm hover:shadow-md transition-all">
          <div className="flex items-start justify-between mb-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #0891b2, #06b6d4)' }}>
              <Calendar size={18} className="text-white" />
            </div>
            <span className="text-xs font-bold bg-cyan-50 text-cyan-600 px-2 py-0.5 rounded-full">Today</span>
          </div>
          <p className="text-3xl font-black text-gray-800">{stats?.appointments?.total || 0}</p>
          <p className="text-xs text-gray-500 mt-1">
            <span className="text-blue-600 font-bold">{stats?.appointments?.confirmed || 0} confirmed</span>
            {' · '}
            <span className="text-amber-600 font-bold">{stats?.appointments?.pending || 0} pending</span>
          </p>
        </div>

        {/* New Patients */}
        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm hover:shadow-md transition-all">
          <div className="flex items-start justify-between mb-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #2563eb, #3b82f6)' }}>
              <Users size={18} className="text-white" />
            </div>
            {(stats?.newPatients?.pctChange ?? 0) >= 0 ? (
              <span className="text-xs font-bold bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full flex items-center gap-0.5">
                <TrendingUp size={10} /> {stats?.newPatients?.pctChange || 0}%
              </span>
            ) : (
              <span className="text-xs font-bold bg-red-50 text-red-500 px-2 py-0.5 rounded-full flex items-center gap-0.5">
                <TrendingDown size={10} /> {Math.abs(stats?.newPatients?.pctChange || 0)}%
              </span>
            )}
          </div>
          <p className="text-3xl font-black text-gray-800">{stats?.newPatients?.count || 0}</p>
          <p className="text-xs text-gray-400 mt-1">New patients today</p>
        </div>

        {/* Returning Patients */}
        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm hover:shadow-md transition-all">
          <div className="flex items-start justify-between mb-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #7c3aed, #8b5cf6)' }}>
              <UserCheck size={18} className="text-white" />
            </div>
            {(stats?.returningPatients?.pctChange ?? 0) >= 0 ? (
              <span className="text-xs font-bold bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full flex items-center gap-0.5">
                <TrendingUp size={10} /> {stats?.returningPatients?.pctChange || 0}%
              </span>
            ) : (
              <span className="text-xs font-bold bg-red-50 text-red-500 px-2 py-0.5 rounded-full flex items-center gap-0.5">
                <TrendingDown size={10} /> {Math.abs(stats?.returningPatients?.pctChange || 0)}%
              </span>
            )}
          </div>
          <p className="text-3xl font-black text-gray-800">{stats?.returningPatients?.count || 0}</p>
          <p className="text-xs text-gray-400 mt-1">Returning patients today</p>
        </div>

        {/* AI Agent Status */}
        <div className={cn(
          'rounded-2xl p-4 border shadow-sm hover:shadow-md transition-all',
          agentActive ? 'bg-white border-gray-100' : 'bg-red-50 border-red-100',
        )}>
          <div className="flex items-start justify-between mb-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: agentActive ? 'linear-gradient(135deg, #059669, #10b981)' : 'linear-gradient(135deg, #dc2626, #ef4444)' }}>
              <Bot size={18} className="text-white" />
            </div>
            <div className="flex items-center gap-1">
              <span className={cn('w-2 h-2 rounded-full animate-pulse', agentActive ? 'bg-emerald-500' : 'bg-red-500')} />
              <span className={cn('text-xs font-bold', agentActive ? 'text-emerald-600' : 'text-red-500')}>
                {agentActive ? 'Active' : 'Paused'}
              </span>
            </div>
          </div>
          <p className="text-3xl font-black text-gray-800">{stats?.aiAgents?.count || 0}</p>
          <p className="text-xs text-gray-400 mt-1">
            {stats?.aiAgents?.escalationsToday || 0} escalations today
          </p>
        </div>
      </div>

      {/* ── Main 3-column grid ─────────────────────────────────── */}
      <div className="grid gap-4" style={{ gridTemplateColumns: '40fr 35fr 25fr' }}>

        {/* ── LEFT COLUMN ─────────────────────────────────────── */}
        <div className="space-y-4">

          {/* Today's Patient List */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50">
              <div>
                <h3 className="text-sm font-bold text-gray-800">Today's Patients</h3>
                <p className="text-xs text-gray-400">{appointments.length} scheduled</p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  onChange={e => {
                    const d = new Date()
                    if (e.target.value === 'tomorrow') d.setDate(d.getDate() + 1)
                    else if (e.target.value === 'week') d.setDate(d.getDate() + 7)
                    fetchForDate(d)
                  }}
                  className="text-xs border border-gray-200 rounded-lg px-2 py-1 text-gray-600 focus:outline-none">
                  <option value="today">Today</option>
                  <option value="tomorrow">Tomorrow</option>
                  <option value="week">This week</option>
                </select>
              </div>
            </div>

            <div>
              {appointments.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <Calendar size={28} className="mx-auto mb-2 text-gray-200" />
                  <p className="text-sm text-gray-400">No appointments scheduled</p>
                </div>
              ) : (
                appointments.slice(0, 6).map(appt => <PatientRow key={appt.id} appt={appt} onRefresh={fetchAll} />)
              )}
            </div>

            {appointments.length > 6 && (
              <div className="px-4 py-2 border-t border-gray-50">
                <Link href="/receptionist/scheduling"
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
        <div className="space-y-4">

          {/* Active Consultation */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50">
              <div className="flex items-center gap-2">
                <span className={cn('w-2 h-2 rounded-full', active ? 'bg-emerald-500 animate-pulse' : 'bg-gray-300')} />
                <h3 className="text-sm font-bold text-gray-800">Active Consultation</h3>
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
                    <p className="font-bold text-gray-800">{active.patient?.firstName} {active.patient?.lastName}</p>
                    <p className="text-xs text-gray-400">{active.patient?.gender} · {active.patient?.dob ? new Date().getFullYear() - new Date(active.patient.dob).getFullYear() + ' yrs' : ''}</p>
                    <p className="text-xs text-cyan-600 font-semibold">{active.service?.name}</p>
                  </div>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Doctor</p>
                  <p className="text-sm font-semibold text-gray-700">Dr. {active.doctor?.user?.firstName} {active.doctor?.user?.lastName}</p>
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
              <div className="px-4 py-8 text-center">
                <Clock size={28} className="mx-auto mb-2 text-gray-200" />
                <p className="text-sm text-gray-400">No active consultation</p>
                <p className="text-xs text-gray-300 mt-1">Appointments will appear here when started</p>
              </div>
            )}
          </div>

          {/* WhatsApp Live Feed */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50">
              <div className="flex items-center gap-2">
                <MessageSquare size={15} className="text-emerald-500" />
                <h3 className="text-sm font-bold text-gray-800">WhatsApp Live Feed</h3>
              </div>
              <Link href="/receptionist/communications"
                className="text-xs text-cyan-600 font-semibold hover:underline">View all</Link>
            </div>
            <div className="px-4 py-8 text-center">
              <MessageSquare size={28} className="mx-auto mb-2 text-gray-200" />
              <p className="text-sm text-gray-400">No active WhatsApp conversations</p>
              <p className="text-xs text-gray-300 mt-1">AI-handled chats will appear here</p>
            </div>
          </div>
        </div>

        {/* ── RIGHT COLUMN ────────────────────────────────────── */}
        <div className="space-y-4">

          {/* Mini Calendar */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <MiniCalendar onDateSelect={fetchForDate} selectedDate={selectedDate} />
          </div>

          {/* Upcoming Appointments */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50">
              <h3 className="text-sm font-bold text-gray-800">Upcoming</h3>
              <Link href="/receptionist/scheduling" className="text-xs text-cyan-600 font-semibold hover:underline">All</Link>
            </div>
            <div className="divide-y divide-gray-50">
              {upcoming.length === 0 ? (
                <div className="px-4 py-4 text-center">
                  <p className="text-xs text-gray-400">No upcoming appointments</p>
                </div>
              ) : upcoming.slice(0, 4).map(a => {
                const t = new Date(a.startAt).toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Kampala' })
                const date = new Date(a.startAt).toLocaleDateString('en-UG', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Kampala' })
                return (
                  <div key={a.id} className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: a.service?.colour || '#29ABE2' }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-gray-700 truncate">{a.patient?.firstName} {a.patient?.lastName}</p>
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

          {/* Quick Notes */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50">
              <div className="flex items-center gap-2">
                <StickyNote size={14} className="text-amber-500" />
                <h3 className="text-sm font-bold text-gray-800">Quick Notes</h3>
              </div>
            </div>
            <div className="p-3 space-y-2">
              <div className="flex gap-2">
                <input value={newNote} onChange={e => setNewNote(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addNote()}
                  placeholder="Add a note..."
                  className="flex-1 text-xs px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-cyan-400 transition-colors" />
                <button onClick={addNote}
                  className="w-8 h-8 flex items-center justify-center bg-cyan-500 text-white rounded-xl hover:bg-cyan-600 transition-colors">
                  <Plus size={14} />
                </button>
              </div>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {notes.map((n, i) => (
                  <div key={i} className="flex items-start gap-2 bg-amber-50 rounded-xl px-3 py-2 border border-amber-100">
                    <p className="flex-1 text-xs text-gray-700 leading-relaxed">{n}</p>
                    <button onClick={() => removeNote(i)} className="text-gray-300 hover:text-red-400 transition-colors flex-shrink-0">
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

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
