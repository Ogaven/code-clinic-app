'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { ArrowLeft, Plus, Trash2, CalendarDays, Ban, List, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import Avatar from '@/components/ui/Avatar'

const START_HOUR = 7
const END_HOUR   = 21
const TOTAL_HOURS = END_HOUR - START_HOUR
const HOUR_H     = 64 // px per hour

const REASONS = ['Lunch Break','Meeting','Training','Personal','Holiday','CME','On Call','Other']

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
function fmtDateLong(s: string) {
  return new Date(s + 'T12:00').toLocaleDateString('en-UG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}
function isoToday() { return new Date().toISOString().slice(0, 10) }

function apptTop(startAt: string) {
  const d = new Date(startAt)
  const localH = d.getHours() + d.getMinutes() / 60
  return (localH - START_HOUR) * HOUR_H
}
function apptHeight(startAt: string, endAt?: string) {
  if (!endAt) return HOUR_H
  const mins = (new Date(endAt).getTime() - new Date(startAt).getTime()) / 60000
  return Math.max((mins / 60) * HOUR_H, 32)
}
function nowLineTop() {
  const n = new Date()
  return (n.getHours() + n.getMinutes() / 60 - START_HOUR) * HOUR_H
}

type Tab = 'calendar' | 'list'

export default function DoctorSchedulePage() {
  const [tab, setTab]             = useState<Tab>('calendar')
  const [appointments, setAppts]  = useState<any[]>([])
  const [doctor, setDoctor]       = useState<any>(null)
  const [loading, setLoading]     = useState(true)
  const [viewDate, setViewDate]   = useState(isoToday)
  const [nowTop, setNowTop]       = useState(nowLineTop)
  const gridRef                   = useRef<HTMLDivElement>(null)

  const [blockDate, setBlockDate]     = useState(isoToday)
  const [blockStart, setBlockStart]   = useState('12:00')
  const [blockEnd, setBlockEnd]       = useState('13:00')
  const [blockReason, setBlockReason] = useState('Lunch Break')
  const [blockAllDay, setBlockAllDay] = useState(false)
  const [blockNote, setBlockNote]     = useState('')
  const [blockSaving, setBlockSaving] = useState(false)
  const [blocks, setBlocks]           = useState<any[]>([])
  const [blockOpen, setBlockOpen]     = useState(false)
  const [toast, setToast]             = useState('')

  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const today = isoToday()

  const fetchAll = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const u = JSON.parse(localStorage.getItem('cc_user') || '{}')
      const dr = await fetch('/api-proxy/doctors', { headers: { Authorization: `Bearer ${token}` } })
      const docs = await dr.json()
      const me = Array.isArray(docs) ? docs.find((d: any) => d.userId === u.id) : null
      setDoctor(me)
      if (!me) return
      const apptRes = await fetch(`/api-proxy/scheduling/appointments?startDate=${viewDate}&endDate=${viewDate}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const all = await apptRes.json()
      setAppts(Array.isArray(all) ? all.filter((a: any) => a.doctorId === me.id) : [])
      const bRes = await fetch(`/api-proxy/scheduling/doctors/${me.id}/blocked-times`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (bRes.ok) setBlocks(await bRes.json())
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }, [token, viewDate])

  useEffect(() => { fetchAll() }, [fetchAll])

  // Update now-line every minute
  useEffect(() => {
    const t = setInterval(() => setNowTop(nowLineTop()), 60000)
    return () => clearInterval(t)
  }, [])

  // Scroll calendar to current time on mount
  useEffect(() => {
    if (tab === 'calendar' && gridRef.current) {
      const offset = Math.max(0, nowTop - 100)
      gridRef.current.scrollTop = offset
    }
  }, [tab, nowTop])

  function navDate(delta: number) {
    const d = new Date(viewDate + 'T12:00')
    d.setDate(d.getDate() + delta)
    setViewDate(d.toISOString().slice(0, 10))
  }

  async function handleBlock() {
    if (!doctor || !token) return
    setBlockSaving(true)
    try {
      const startAt = blockAllDay ? `${blockDate}T00:00:00` : `${blockDate}T${blockStart}:00`
      const endAt   = blockAllDay ? `${blockDate}T23:59:59` : `${blockDate}T${blockEnd}:00`
      const res = await fetch(`/api-proxy/scheduling/doctors/${doctor.id}/block-time`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ startAt, endAt, reason: blockNote ? `${blockReason} — ${blockNote}` : blockReason }),
      })
      if (res.ok) {
        setToast('Time blocked!')
        setTimeout(() => setToast(''), 3000)
        setBlockNote(''); setBlockOpen(false); fetchAll()
      }
    } catch {} finally { setBlockSaving(false) }
  }

  async function deleteBlock(id: string) {
    if (!doctor || !token) return
    await fetch(`/api-proxy/scheduling/doctors/${doctor.id}/block-time/${id}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    })
    fetchAll()
  }

  const sorted = appointments.slice().sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
  const isToday = viewDate === today

  return (
    <div className="flex flex-col h-full">

      {toast && (
        <div className="fixed top-4 right-4 z-[99999] bg-emerald-600 text-white px-5 py-3 rounded-2xl shadow-2xl text-sm font-semibold">
          {toast}
        </div>
      )}

      {/* ── Top bar ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-white/5 border-b border-gray-100 dark:border-white/8 flex-shrink-0">
        <Link href="/doctor/dashboard"
          className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-white/10 text-gray-400 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center">
          <ArrowLeft size={16} />
        </Link>
        <h1 className="text-lg font-black text-gray-800 dark:text-white flex-1">Appointments</h1>
        <button onClick={() => setBlockOpen(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-orange-500 text-white text-xs font-bold hover:bg-orange-600 transition-colors min-h-[40px]">
          <Ban size={13} /> Block Time
        </button>
      </div>

      {/* ── Tab toggle ───────────────────────────────────────────────────────── */}
      <div className="flex gap-1 p-2 bg-gray-50 dark:bg-[#0A0F1E] border-b border-gray-100 dark:border-white/8 flex-shrink-0">
        <button onClick={() => setTab('calendar')}
          className={cn('flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all',
            tab === 'calendar' ? 'bg-white dark:bg-white/10 text-blue-600 dark:text-blue-300 shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200')}>
          <CalendarDays size={14} /> Calendar
        </button>
        <button onClick={() => setTab('list')}
          className={cn('flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all',
            tab === 'list' ? 'bg-white dark:bg-white/10 text-blue-600 dark:text-blue-300 shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200')}>
          <List size={14} /> List
        </button>
      </div>

      {/* ── CALENDAR TAB ─────────────────────────────────────────────────────── */}
      {tab === 'calendar' && (
        <div className="flex flex-col flex-1 min-h-0">

          {/* Date navigation */}
          <div className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-white/5 border-b border-gray-100 dark:border-white/8 flex-shrink-0">
            <button onClick={() => navDate(-1)}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 text-gray-500 transition-colors">
              <ChevronLeft size={16} />
            </button>
            <button onClick={() => setViewDate(today)}
              className={cn('px-3 py-1.5 rounded-lg text-xs font-bold transition-colors',
                isToday ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/20')}>
              Today
            </button>
            <button onClick={() => navDate(1)}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 text-gray-500 transition-colors">
              <ChevronRight size={16} />
            </button>
            <span className="flex-1 text-sm font-bold text-gray-800 dark:text-white text-center">{fmtDateLong(viewDate)}</span>
            <button onClick={fetchAll}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 text-gray-400 transition-colors">
              <RefreshCw size={13} />
            </button>
          </div>

          {/* Time grid — scrollable */}
          <div ref={gridRef} className="flex-1 overflow-y-auto overflow-x-hidden">
            <div className="flex min-h-full">

              {/* Time labels column */}
              <div className="w-14 flex-shrink-0 border-r border-gray-100 dark:border-white/8 bg-white dark:bg-[#0d1526]">
                {/* Spacer for doctor header */}
                <div className="h-[72px] border-b border-gray-100 dark:border-white/8" />
                {Array.from({ length: TOTAL_HOURS }).map((_, i) => (
                  <div key={i} className="flex items-start justify-end pr-2 pt-1"
                    style={{ height: HOUR_H }}>
                    <span className="text-[10px] font-medium text-gray-400 leading-none tabular-nums">
                      {String(START_HOUR + i).padStart(2,'0')}:00
                    </span>
                  </div>
                ))}
              </div>

              {/* Doctor column */}
              <div className="flex-1 bg-white dark:bg-[#0d1526]">
                {/* Doctor header */}
                <div className="h-[72px] border-b border-gray-100 dark:border-white/8 flex items-center justify-center gap-3 px-4 sticky top-0 z-10 bg-white dark:bg-[#0d1526]">
                  {doctor ? (
                    <>
                      <Avatar
                        firstName={doctor.user?.firstName || 'D'}
                        lastName={doctor.user?.lastName || 'r'}
                        avatarUrl={doctor.avatarUrl}
                        size="md"
                        colour="#1A237E"
                      />
                      <div>
                        <p className="text-sm font-bold text-gray-800 dark:text-white leading-tight">
                          Dr. {doctor.user?.firstName} {doctor.user?.lastName}
                        </p>
                        <p className="text-[11px] text-gray-400">{doctor.specialisation}</p>
                        <span className="text-[10px] font-bold bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 px-1.5 py-0.5 rounded-full">
                          {appointments.length} appt{appointments.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-white/5 animate-pulse" />
                  )}
                </div>

                {/* Hour rows + appointment blocks */}
                <div className="relative" style={{ height: TOTAL_HOURS * HOUR_H }}>
                  {/* Horizontal hour lines */}
                  {Array.from({ length: TOTAL_HOURS }).map((_, i) => (
                    <div key={i} className="absolute left-0 right-0 border-b border-gray-100 dark:border-white/[0.06]"
                      style={{ top: i * HOUR_H, height: HOUR_H }} />
                  ))}

                  {/* 30-min dashed lines */}
                  {Array.from({ length: TOTAL_HOURS }).map((_, i) => (
                    <div key={`half-${i}`} className="absolute left-0 right-0 border-b border-dashed border-gray-100/70 dark:border-white/[0.03]"
                      style={{ top: i * HOUR_H + HOUR_H / 2 }} />
                  ))}

                  {/* Current time line */}
                  {isToday && nowTop >= 0 && nowTop <= TOTAL_HOURS * HOUR_H && (
                    <div className="absolute left-0 right-0 z-20 pointer-events-none flex items-center gap-0"
                      style={{ top: nowTop }}>
                      <div className="w-2.5 h-2.5 rounded-full bg-red-500 flex-shrink-0 -ml-1.5 shadow-sm" />
                      <div className="flex-1 h-[1.5px] bg-red-500/80" />
                    </div>
                  )}

                  {/* Appointment blocks */}
                  {loading ? (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="text-sm text-gray-400 animate-pulse">Loading…</div>
                    </div>
                  ) : appointments.length === 0 ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-gray-300 dark:text-gray-600">
                      <CalendarDays size={36} className="opacity-30" />
                      <p className="text-sm">No appointments</p>
                    </div>
                  ) : (
                    appointments.map((a) => {
                      const top = apptTop(a.startAt)
                      const ht  = apptHeight(a.startAt, a.endAt)
                      const clr = a.service?.colour || '#29ABE2'
                      if (top < 0 || top > TOTAL_HOURS * HOUR_H) return null
                      const cfg = STATUS_CFG[a.status] || { label: a.status, color: '#6B7280', bg: '#F3F4F6' }
                      return (
                        <Link key={a.id} href={`/patients/${a.patient?.id}`}
                          className="absolute left-2 right-2 rounded-xl overflow-hidden shadow-md hover:shadow-lg hover:scale-[1.01] transition-all z-10 group"
                          style={{ top, height: ht, minHeight: 28, background: clr + 'E6' }}>
                          <div className="p-2 h-full flex flex-col justify-between">
                            <div>
                              <p className="text-[11px] font-bold text-white leading-tight truncate">
                                {a.patient?.firstName} {a.patient?.lastName}
                              </p>
                              {ht > 40 && (
                                <p className="text-[9px] text-white/80 truncate">{a.service?.name}</p>
                              )}
                            </div>
                            {ht > 52 && (
                              <div className="flex items-center gap-1 mt-1">
                                <span className="text-[9px] text-white/70">{fmtTime(a.startAt)}</span>
                                <span className="text-[8px] font-bold px-1 py-0.5 rounded-full bg-white/20 text-white">{cfg.label}</span>
                              </div>
                            )}
                          </div>
                        </Link>
                      )
                    })
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── LIST TAB ─────────────────────────────────────────────────────────── */}
      {tab === 'list' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Date picker */}
          <div className="flex items-center gap-3">
            <button onClick={() => navDate(-1)}
              className="w-10 h-10 flex items-center justify-center rounded-xl bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 text-gray-500 hover:bg-gray-50 dark:hover:bg-white/10 transition-colors">
              <ChevronLeft size={16} />
            </button>
            <div className="flex-1">
              <input type="date" value={viewDate} onChange={e => setViewDate(e.target.value)}
                className="w-full text-sm bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-4 py-2.5 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]" />
            </div>
            <button onClick={() => navDate(1)}
              className="w-10 h-10 flex items-center justify-center rounded-xl bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 text-gray-500 hover:bg-gray-50 dark:hover:bg-white/10 transition-colors">
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-50 dark:border-white/[0.06] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CalendarDays size={16} className="text-blue-500" />
                <div>
                  <h2 className="font-bold text-gray-800 dark:text-white">{fmtDateLong(viewDate)}</h2>
                  <p className="text-xs text-gray-400 mt-0.5">Appointments</p>
                </div>
              </div>
              <span className="text-xs font-bold bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 px-2.5 py-1 rounded-full">
                {appointments.length}
              </span>
            </div>

            {loading ? (
              <div className="p-5 space-y-2">
                {[1,2,3].map(i => <div key={i} className="h-16 bg-gray-100 dark:bg-white/5 rounded-xl animate-pulse" />)}
              </div>
            ) : sorted.length === 0 ? (
              <div className="py-14 text-center text-gray-400">
                <CalendarDays size={36} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm">No appointments on this date</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50 dark:divide-white/[0.04]">
                {sorted.map((a) => {
                  const cfg = STATUS_CFG[a.status] || { label: a.status, color: '#6B7280', bg: '#F3F4F6' }
                  return (
                    <Link key={a.id} href={`/patients/${a.patient?.id}`}
                      className="flex items-center gap-3 px-4 sm:px-5 py-4 hover:bg-blue-50/20 dark:hover:bg-white/[0.03] transition-colors">
                      <div className="w-16 text-right flex-shrink-0">
                        <p className="text-xs font-bold text-gray-700 dark:text-white">{fmtTime(a.startAt)}</p>
                        {a.endAt && <p className="text-[10px] text-gray-400">{fmtTime(a.endAt)}</p>}
                      </div>
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: a.service?.colour || '#29ABE2' }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800 dark:text-white truncate">{a.patient?.firstName} {a.patient?.lastName}</p>
                        <p className="text-xs text-gray-400 truncate">{a.service?.name}</p>
                      </div>
                      <span className="text-[10px] font-bold px-2.5 py-1 rounded-full flex-shrink-0"
                        style={{ background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
                    </Link>
                  )
                })}
              </div>
            )}
          </div>

          {/* Existing blocked times */}
          {blocks.length > 0 && (
            <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
              <p className="text-xs font-bold uppercase tracking-wide text-gray-400 px-5 pt-4 pb-2">Blocked Times</p>
              <div className="divide-y divide-gray-50 dark:divide-white/[0.04]">
                {blocks.slice(0, 8).map((b) => (
                  <div key={b.id} className="flex items-center gap-3 px-5 py-3 hover:bg-orange-50/30 dark:hover:bg-white/[0.03] transition-colors">
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-gray-700 dark:text-white">{b.reason}</p>
                      <p className="text-xs text-gray-400">{fmtTime(b.startAt)} – {fmtTime(b.endAt)}</p>
                    </div>
                    <button onClick={() => deleteBlock(b.id)}
                      className="w-9 h-9 flex items-center justify-center rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Block Time Modal ─────────────────────────────────────────────────── */}
      {blockOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-2xl shadow-2xl w-full sm:max-w-sm">
            <div className="w-10 h-1 bg-gray-300 dark:bg-gray-600 rounded-full mx-auto mt-3 mb-1 sm:hidden" />
            <div className="flex items-center justify-between px-5 py-4 border-b dark:border-white/10">
              <div className="flex items-center gap-2">
                <Ban size={16} className="text-orange-500" />
                <h2 className="font-bold text-gray-800 dark:text-white">Block Time Off</h2>
              </div>
              <button onClick={() => setBlockOpen(false)}
                className="w-9 h-9 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/10 text-lg transition-colors">
                ✕
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1.5 block">Date</label>
                  <input type="date" value={blockDate} onChange={e => setBlockDate(e.target.value)}
                    className="w-full px-3 py-3 text-base border border-gray-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1.5 block">Reason</label>
                  <select value={blockReason} onChange={e => setBlockReason(e.target.value)}
                    className="w-full px-3 py-3 text-base border border-gray-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none">
                    {REASONS.map(r => <option key={r}>{r}</option>)}
                  </select>
                </div>
              </div>

              <label className="flex items-center gap-3 cursor-pointer w-fit">
                <div onClick={() => setBlockAllDay(v => !v)}
                  className={cn('w-11 h-6 rounded-full transition-colors relative cursor-pointer', blockAllDay ? 'bg-blue-500' : 'bg-gray-200 dark:bg-white/20')}>
                  <div className={cn('absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all', blockAllDay ? 'left-[22px]' : 'left-0.5')} />
                </div>
                <span className="text-sm font-medium text-gray-600 dark:text-gray-300">All day</span>
              </label>

              {!blockAllDay && (
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
              )}

              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1.5 block">Note (optional)</label>
                <input value={blockNote} onChange={e => setBlockNote(e.target.value)}
                  placeholder="e.g. Dental conference Sheraton"
                  className="w-full px-3 py-3 text-base border border-gray-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none" />
              </div>
            </div>
            <div className="flex gap-3 px-5 pb-6 sm:pb-4 pt-0">
              <button onClick={() => setBlockOpen(false)}
                className="flex-1 px-4 py-3 text-sm text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-white/10 rounded-xl font-medium min-h-[44px]">
                Cancel
              </button>
              <button onClick={handleBlock} disabled={blockSaving}
                className="flex-1 flex items-center justify-center gap-2 px-5 py-3 text-sm font-bold text-white bg-orange-500 hover:bg-orange-600 rounded-xl disabled:opacity-50 transition-colors min-h-[44px]">
                <Plus size={14} /> {blockSaving ? 'Blocking…' : 'Block Time'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
