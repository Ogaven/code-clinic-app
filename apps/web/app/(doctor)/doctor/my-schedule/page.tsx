'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import {
  ChevronLeft, ChevronRight, Ban, Users,
  CalendarDays, Clock, CheckCircle, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type ViewMode = 'day' | 'week' | 'month'

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

function fmt(s: string) {
  return new Date(s).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi' })
}

function fmtDate(d: Date) {
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Nairobi' })
}

function startOfWeek(d: Date) {
  const dt = new Date(d)
  const day = dt.getDay()
  const diff = day === 0 ? -6 : 1 - day
  dt.setDate(dt.getDate() + diff)
  dt.setHours(0, 0, 0, 0)
  return dt
}

function addDays(d: Date, n: number) {
  const dt = new Date(d)
  dt.setDate(dt.getDate() + n)
  return dt
}

const EAT_OFFSET = 3 * 60 * 60 * 1000 // Uganda UTC+3

function ugandaDateStr(date: Date): string {
  return new Date(date.getTime() + EAT_OFFSET).toISOString().slice(0, 10)
}

function getUgandaDateBounds(date: Date) {
  const str = ugandaDateStr(date)
  return { start: str + 'T00:00:00+03:00', end: str + 'T23:59:59+03:00' }
}

function groupOverlapping(appts: any[]): Record<string, { colIndex: number; totalCols: number }> {
  const sorted = [...appts].sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
  const columns: any[][] = []
  for (const appt of sorted) {
    const apptStart = new Date(appt.startAt)
    let placed = false
    for (let col = 0; col < columns.length; col++) {
      const last    = columns[col][columns[col].length - 1]
      const lastEnd = new Date(last.endAt || new Date(new Date(last.startAt).getTime() + 3600000).toISOString())
      if (lastEnd <= apptStart) { columns[col].push(appt); placed = true; break }
    }
    if (!placed) columns.push([appt])
  }
  const result: Record<string, { colIndex: number; totalCols: number }> = {}
  columns.forEach((col, colIndex) => {
    col.forEach(appt => { result[appt.id] = { colIndex, totalCols: columns.length } })
  })
  return result
}

async function fetchWithRetry(url: string, options: RequestInit, retries = 3): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options)
      if ((res.status === 502 || res.status === 503) && i < retries - 1) {
        await new Promise(r => setTimeout(r, 2000)); continue
      }
      return res
    } catch (e) {
      if (i === retries - 1) throw e
      await new Promise(r => setTimeout(r, 2000))
    }
  }
  throw new Error('All retries failed')
}

const HOURS = Array.from({ length: 13 }, (_, i) => i + 7) // 7am – 7pm
const SLOT_H = 52

function timeToTop(dateStr: string) {
  const ugandaMs = new Date(dateStr).getTime() + EAT_OFFSET
  const ug = new Date(ugandaMs)
  const h = ug.getUTCHours() + ug.getUTCMinutes() / 60
  return Math.max(0, (h - 7) * SLOT_H)
}

function durationToHeight(startAt: string, endAt: string) {
  const diff = (new Date(endAt).getTime() - new Date(startAt).getTime()) / 60000
  return Math.max(24, (diff / 60) * SLOT_H)
}

export default function MySchedulePage() {
  const [view, setView]       = useState<ViewMode>('day')
  const [anchor, setAnchor]   = useState(() => { const d = new Date(); d.setHours(0,0,0,0); return d })
  const [appts, setAppts]     = useState<any[]>([])
  const [doctor, setDoctor]   = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [blockOpen, setBlockOpen] = useState(false)
  const [blockDate, setBlockDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [blockStart, setBlockStart] = useState('12:00')
  const [blockEnd, setBlockEnd]     = useState('13:00')
  const [blockReason, setBlockReason] = useState('Lunch Break')
  const [blockSaving, setBlockSaving] = useState(false)
  const [toast, setToast]       = useState('')
  const [connecting, setConnecting] = useState(false)
  const gridRef = useRef<HTMLDivElement>(null)

  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null

  function getRange() {
    if (view === 'day') {
      return { start: anchor, end: anchor }
    } else if (view === 'week') {
      const s = startOfWeek(anchor)
      return { start: s, end: addDays(s, 6) }
    } else {
      const s = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
      const e = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)
      return { start: s, end: e }
    }
  }

  const fetchData = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const u = JSON.parse(localStorage.getItem('cc_user') || '{}')
      // doctorId is stored in cc_user during login for DOCTOR-role users
      const myDoctorId = u.doctorId as string | undefined
      // Fetch doctor record (needed for block-time endpoint)
      const dr   = await fetch('/api-proxy/doctors', { headers: { Authorization: `Bearer ${token}` } })
      const docs = await dr.json()
      const me   = Array.isArray(docs) ? (docs.find((d: any) => d.id === myDoctorId) ?? null) : null
      setDoctor(me)
      if (!myDoctorId) return
      const { start, end } = getRange()
      const { start: startStr } = getUgandaDateBounds(start)
      const { end: endStr }     = getUgandaDateBounds(end)
      setConnecting(true)
      const r = await fetchWithRetry(
        `/api-proxy/scheduling/appointments?startDate=${encodeURIComponent(startStr)}&endDate=${encodeURIComponent(endStr)}&doctorId=${myDoctorId}`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      setConnecting(false)
      const all = await r.json()
      setAppts(Array.isArray(all) ? all : [])
    } catch { setConnecting(false) } finally { setLoading(false) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, anchor, view])

  useEffect(() => { fetchData() }, [fetchData])

  useEffect(() => {
    if (view === 'day' && gridRef.current) {
      const now = new Date()
      const top = timeToTop(now.toISOString())
      gridRef.current.scrollTop = Math.max(0, top - 80)
    }
  }, [view, anchor])

  function navigate(dir: 1 | -1) {
    setAnchor(prev => {
      const d = new Date(prev)
      if (view === 'day') d.setDate(d.getDate() + dir)
      else if (view === 'week') d.setDate(d.getDate() + dir * 7)
      else d.setMonth(d.getMonth() + dir)
      return d
    })
  }

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 3500) }

  async function handleBlockTime() {
    if (!doctor || !token) return
    setBlockSaving(true)
    try {
      const r = await fetch(`/api-proxy/scheduling/doctors/${doctor.id}/block-time`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ startAt: `${blockDate}T${blockStart}:00`, endAt: `${blockDate}T${blockEnd}:00`, reason: blockReason }),
      })
      if (r.ok) { setBlockOpen(false); showToast('Time blocked successfully!') }
      else { const d = await r.json(); showToast(d.error || 'Failed to block time') }
    } catch { showToast('Failed to block time') } finally { setBlockSaving(false) }
  }

  const { start: rangeStart, end: rangeEnd } = getRange()

  const headerLabel = view === 'day'
    ? anchor.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : view === 'week'
      ? `${fmtDate(startOfWeek(anchor))} – ${fmtDate(addDays(startOfWeek(anchor), 6))}`
      : anchor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

  const todayStr = ugandaDateStr(new Date())

  // Day view appointments
  const dayAppts = appts.filter(a => ugandaDateStr(new Date(a.startAt)) === ugandaDateStr(anchor))

  // Week view days
  const weekDays = view === 'week' ? Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i)) : []

  // Month view
  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const monthEnd   = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)
  const firstDow   = monthStart.getDay() === 0 ? 6 : monthStart.getDay() - 1
  const monthDays  = Array.from({ length: firstDow + monthEnd.getDate() }, (_, i) => {
    if (i < firstDow) return null
    return new Date(anchor.getFullYear(), anchor.getMonth(), i - firstDow + 1)
  })

  return (
    <div className="h-[calc(100vh-3.5rem)] flex flex-col">

      {toast && (
        <div className="fixed top-4 right-4 z-[99999] bg-emerald-600 text-white px-5 py-3 rounded-2xl shadow-2xl text-sm font-semibold flex items-center gap-2">
          <CheckCircle size={15} /> {toast}
        </div>
      )}

      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex flex-wrap items-center gap-2 px-3 py-2.5 bg-white dark:bg-white/5 border-b border-gray-100 dark:border-white/8">
        {/* View tabs */}
        <div className="flex gap-1 bg-gray-100 dark:bg-white/10 rounded-xl p-1">
          {(['day', 'week', 'month'] as ViewMode[]).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={cn('px-2.5 py-1.5 rounded-lg text-xs font-bold capitalize transition-all min-h-[36px]',
                view === v ? 'bg-white dark:bg-blue-600 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700')}>
              {v}
            </button>
          ))}
        </div>

        {/* Navigation */}
        <button onClick={() => navigate(-1)} className="w-9 h-9 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">
          <ChevronLeft size={16} />
        </button>
        <button onClick={() => { const d = new Date(); d.setHours(0,0,0,0); setAnchor(d) }}
          className="px-3 py-2 rounded-lg text-xs font-bold text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors min-h-[36px]">
          Today
        </button>
        <button onClick={() => navigate(1)} className="w-9 h-9 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">
          <ChevronRight size={16} />
        </button>

        <h2 className="flex-1 text-sm font-bold text-gray-800 dark:text-white truncate text-center px-1 min-w-0">
          {headerLabel}
          {connecting && <span className="ml-2 text-[10px] font-normal text-blue-500 animate-pulse">Connecting…</span>}
        </h2>

        {/* Block time */}
        <button onClick={() => setBlockOpen(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-white transition-all"
          style={{ background: 'linear-gradient(135deg,#F97316,#EA580C)' }}>
          <Ban size={13} /> <span className="hidden sm:inline">Block Time</span><span className="sm:hidden">Block</span>
        </button>
      </div>

      {/* ── Content ─────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden">

        {/* DAY VIEW ─────────────────────────────────────────────────────────── */}
        {view === 'day' && (
          <div ref={gridRef} className="h-full overflow-y-auto">
            <div className="relative" style={{ minHeight: HOURS.length * SLOT_H + 40 }}>
              {/* Hour lines */}
              {HOURS.map(h => (
                <div key={h} className="absolute left-0 right-0 flex items-start" style={{ top: (h - 7) * SLOT_H }}>
                  <span className="w-14 text-right pr-3 text-[10px] text-gray-400 font-medium flex-shrink-0 -mt-2">
                    {h === 12 ? '12 PM' : h < 12 ? `${h} AM` : `${h - 12} PM`}
                  </span>
                  <div className="flex-1 border-t border-gray-100 dark:border-white/[0.06]" />
                </div>
              ))}

              {/* Current time indicator */}
              {ugandaDateStr(anchor) === todayStr && (() => {
                const now = new Date()
                const top = timeToTop(now.toISOString())
                return (
                  <div className="absolute left-14 right-0 flex items-center pointer-events-none" style={{ top }}>
                    <div className="w-2.5 h-2.5 rounded-full bg-red-500 -ml-1.5 flex-shrink-0" />
                    <div className="flex-1 h-px bg-red-500" />
                  </div>
                )
              })()}

              {/* Appointments — side-by-side when overlapping */}
              <div className="absolute left-16 right-3" style={{ top: 0 }}>
                {(() => {
                  const layout = groupOverlapping(dayAppts)
                  return dayAppts.map(a => {
                    const top    = timeToTop(a.startAt)
                    const height = durationToHeight(a.startAt, a.endAt || new Date(new Date(a.startAt).getTime() + 3600000).toISOString())
                    const cfg    = STATUS_CFG[a.status] || { label: a.status, color: '#6B7280', bg: '#F3F4F6' }
                    const { colIndex, totalCols } = layout[a.id] || { colIndex: 0, totalCols: 1 }
                    const pct    = 100 / totalCols
                    return (
                      <Link href={`/doctor/patients/${a.patient?.id}`} key={a.id}
                        className={cn('absolute rounded-xl overflow-hidden border-l-4 shadow-sm hover:shadow-md transition-shadow cursor-pointer', a.status === 'CANCELLED' && 'opacity-50')}
                        style={{ top, height: height - 3, left: `${colIndex * pct}%`, width: `${pct}%`, borderLeftColor: a.service?.colour || '#29ABE2', background: (a.service?.colour || '#29ABE2') + '18' }}>
                        <div className="px-2.5 py-1.5 h-full flex flex-col justify-center relative">
                          <p className={cn('text-xs font-bold text-gray-800 dark:text-white truncate', a.status === 'CANCELLED' && 'line-through')}>{a.patient?.firstName} {a.patient?.lastName}</p>
                          {height > 36 && <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate">{a.service?.name}</p>}
                          {height > 52 && <p className="text-[10px] text-gray-400">{fmt(a.startAt)} – {a.endAt ? fmt(a.endAt) : ''}</p>}
                          {height > 36 && (
                            <span className="absolute bottom-1 right-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full pointer-events-none" style={{ background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
                          )}
                        </div>
                      </Link>
                    )
                  })
                })()}
              </div>
            </div>
          </div>
        )}

        {/* WEEK VIEW ────────────────────────────────────────────────────────── */}
        {view === 'week' && (
          <div className="h-full flex flex-col">
            {/* Day headers */}
            <div className="flex border-b border-gray-100 dark:border-white/8 flex-shrink-0">
              <div className="w-14 flex-shrink-0" />
              {weekDays.map((d, i) => {
                const isToday = ugandaDateStr(d) === todayStr
                return (
                  <div key={i} className="flex-1 text-center py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5"
                    onClick={() => { setAnchor(d); setView('day') }}>
                    <p className={cn('text-[10px] font-semibold', isToday ? 'text-blue-600' : 'text-gray-400')}>
                      {d.toLocaleDateString('en-GB', { weekday: 'short' })}
                    </p>
                    <div className={cn('w-7 h-7 rounded-full flex items-center justify-center mx-auto text-sm font-bold',
                      isToday ? 'bg-blue-600 text-white' : 'text-gray-700 dark:text-gray-300')}>
                      {d.getDate()}
                    </div>
                  </div>
                )
              })}
            </div>
            {/* Time grid */}
            <div className="flex-1 overflow-y-auto">
              <div className="relative flex" style={{ minHeight: HOURS.length * SLOT_H }}>
                {/* Hour labels */}
                <div className="w-14 flex-shrink-0">
                  {HOURS.map(h => (
                    <div key={h} className="flex items-start justify-end pr-2" style={{ height: SLOT_H }}>
                      <span className="text-[9px] text-gray-400 font-medium -mt-2">
                        {h === 12 ? '12P' : h < 12 ? `${h}A` : `${h - 12}P`}
                      </span>
                    </div>
                  ))}
                </div>
                {/* Day columns */}
                {weekDays.map((d, i) => {
                  const ds = ugandaDateStr(d)
                  const dayA = appts.filter(a => ugandaDateStr(new Date(a.startAt)) === ds)
                  const isToday = ds === todayStr
                  return (
                    <div key={i} className="flex-1 relative border-l border-gray-100 dark:border-white/[0.06]"
                      style={{ minHeight: HOURS.length * SLOT_H }}>
                      {HOURS.map(h => (
                        <div key={h} className={cn('absolute left-0 right-0 border-t border-gray-100 dark:border-white/[0.06]',
                          isToday ? 'bg-blue-50/30 dark:bg-blue-900/5' : '')}
                          style={{ top: (h - 7) * SLOT_H, height: SLOT_H }} />
                      ))}
                      {isToday && (() => {
                        const now = new Date()
                        const top = timeToTop(now.toISOString())
                        return <div className="absolute left-0 right-0 h-px bg-red-500 pointer-events-none" style={{ top }} />
                      })()}
                      {dayA.map(a => {
                        const top = timeToTop(a.startAt)
                        const height = durationToHeight(a.startAt, a.endAt || new Date(new Date(a.startAt).getTime() + 3600000).toISOString())
                        return (
                          <Link href={`/doctor/patients/${a.patient?.id}`} key={a.id}
                            className={cn('absolute left-0.5 right-0.5 rounded-lg overflow-hidden border-l-2 shadow-sm hover:shadow-md transition-shadow', a.status === 'CANCELLED' && 'opacity-50')}
                            style={{ top, height: height - 2, borderLeftColor: a.service?.colour || '#29ABE2', background: (a.service?.colour || '#29ABE2') + '20' }}>
                            <div className="px-1.5 py-1">
                              <p className={cn('text-[9px] font-bold text-gray-800 dark:text-white truncate', a.status === 'CANCELLED' && 'line-through')}>{a.patient?.firstName} {a.patient?.lastName}</p>
                              {height > 36 && <p className="text-[8px] text-gray-500 truncate">{a.service?.name}</p>}
                            </div>
                          </Link>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* MONTH VIEW ───────────────────────────────────────────────────────── */}
        {view === 'month' && (
          <div className="h-full overflow-y-auto p-4">
            {/* Day of week headers */}
            <div className="grid grid-cols-7 mb-2">
              {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => (
                <div key={d} className="text-center text-[10px] font-bold text-gray-400 uppercase py-1">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-0.5 sm:gap-1">
              {monthDays.map((d, i) => {
                if (!d) return <div key={`empty-${i}`} className="h-16 sm:h-24 rounded-xl" />
                const ds = ugandaDateStr(d)
                const dayA = appts.filter(a => ugandaDateStr(new Date(a.startAt)) === ds)
                const isToday = ds === todayStr
                return (
                  <div key={ds}
                    className={cn('h-16 sm:h-24 rounded-xl p-1 sm:p-1.5 border transition-colors cursor-pointer hover:border-blue-300 dark:hover:border-blue-700',
                      isToday
                        ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-gray-100 dark:border-white/8 bg-white dark:bg-white/5')}
                    onClick={() => { setAnchor(d); setView('day') }}>
                    <span className={cn('text-[10px] sm:text-[11px] font-bold', isToday ? 'text-blue-600' : 'text-gray-600 dark:text-gray-400')}>
                      {d.getDate()}
                    </span>
                    <div className="space-y-0.5 mt-0.5 hidden sm:block">
                      {dayA.slice(0, 2).map(a => (
                        <div key={a.id} className="text-[8px] truncate font-medium rounded px-1 py-0.5 text-white"
                          style={{ background: a.service?.colour || '#29ABE2' }}>
                          {fmt(a.startAt)} {a.patient?.firstName}
                        </div>
                      ))}
                      {dayA.length > 2 && (
                        <div className="text-[8px] font-bold text-blue-500 px-1">+{dayA.length - 2}</div>
                      )}
                    </div>
                    {/* Mobile: just a dot if has appointments */}
                    {dayA.length > 0 && (
                      <div className="sm:hidden flex gap-0.5 mt-0.5 flex-wrap">
                        {dayA.slice(0,3).map(a => (
                          <div key={a.id} className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: a.service?.colour || '#29ABE2' }} />
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Summary bar for day view */}
      {view === 'day' && (
        <div className="flex-shrink-0 border-t border-gray-100 dark:border-white/8 bg-white dark:bg-white/5 px-4 py-3 flex items-center gap-6">
          {[
            { icon: CalendarDays, label: 'Total',     value: dayAppts.length,       color: '#29ABE2' },
            { icon: Clock,        label: 'Pending',   value: dayAppts.filter(a => ['PENDING','CONFIRMED'].includes(a.status)).length, color: '#F59E0B' },
            { icon: Users,        label: 'In Chair',  value: dayAppts.filter(a => ['WITH_PROVIDER','IN_OPERATORY','ARRIVED','WAITING'].includes(a.status)).length, color: '#14B8A6' },
            { icon: CheckCircle,  label: 'Done',      value: dayAppts.filter(a => ['COMPLETED','SESSION_COMPLETE','DEPARTED','CHECKOUT'].includes(a.status)).length, color: '#10B981' },
          ].map(({ icon: Icon, label, value, color }) => (
            <div key={label} className="flex items-center gap-2">
              <Icon size={14} style={{ color }} />
              <span className="text-xs text-gray-500 dark:text-gray-400">{label}:</span>
              <span className="text-sm font-bold" style={{ color }}>{loading ? '—' : value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Block Time Modal */}
      {blockOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-2xl shadow-2xl w-full sm:max-w-sm">
            <div className="w-10 h-1 bg-gray-300 dark:bg-gray-600 rounded-full mx-auto mt-3 mb-1 sm:hidden" />
            <div className="flex items-center justify-between px-5 py-4 border-b dark:border-white/10">
              <h2 className="font-bold text-gray-800 dark:text-white">Block Time Off</h2>
              <button onClick={() => setBlockOpen(false)} className="w-9 h-9 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1.5 block">Date</label>
                <input type="date" value={blockDate} onChange={e => setBlockDate(e.target.value)}
                  className="w-full px-3 py-3 text-base border border-gray-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded-xl focus:ring-2 focus:ring-orange-500 focus:outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1.5 block">Start Time</label>
                  <input type="time" value={blockStart} onChange={e => setBlockStart(e.target.value)}
                    className="w-full px-3 py-3 text-base border border-gray-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded-xl focus:ring-2 focus:ring-orange-500 focus:outline-none" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1.5 block">End Time</label>
                  <input type="time" value={blockEnd} onChange={e => setBlockEnd(e.target.value)}
                    className="w-full px-3 py-3 text-base border border-gray-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded-xl focus:ring-2 focus:ring-orange-500 focus:outline-none" />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1.5 block">Reason</label>
                <input value={blockReason} onChange={e => setBlockReason(e.target.value)}
                  className="w-full px-3 py-3 text-base border border-gray-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded-xl focus:ring-2 focus:ring-orange-500 focus:outline-none"
                  placeholder="e.g. Lunch Break, Training, Personal" />
              </div>
              <button onClick={handleBlockTime} disabled={blockSaving}
                className="w-full py-3.5 rounded-xl font-bold text-white text-sm disabled:opacity-60 flex items-center justify-center gap-2"
                style={{ background: 'linear-gradient(135deg,#F97316,#EA580C)' }}>
                {blockSaving
                  ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Blocking…</>
                  : <><Ban size={15} /> Block Time</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
