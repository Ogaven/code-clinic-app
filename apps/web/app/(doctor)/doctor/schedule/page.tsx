'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, Plus, Trash2, CalendarDays, Clock, Ban, List } from 'lucide-react'
import { cn } from '@/lib/utils'

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
function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('en-UG', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Kampala' })
}

type Tab = 'calendar' | 'today'

export default function DoctorSchedulePage() {
  const [tab, setTab]             = useState<Tab>('today')
  const [appointments, setAppts]  = useState<any[]>([])
  const [blocks, setBlocks]       = useState<any[]>([])
  const [doctor, setDoctor]       = useState<any>(null)
  const [loading, setLoading]     = useState(true)
  const [viewDate, setViewDate]   = useState(() => new Date().toISOString().slice(0, 10))

  // Block form state
  const [blockDate, setBlockDate]     = useState(() => new Date().toISOString().slice(0, 10))
  const [blockStart, setBlockStart]   = useState('12:00')
  const [blockEnd, setBlockEnd]       = useState('13:00')
  const [blockReason, setBlockReason] = useState('Lunch Break')
  const [blockAllDay, setBlockAllDay] = useState(false)
  const [blockNote, setBlockNote]     = useState('')
  const [blockSaving, setBlockSaving] = useState(false)
  const [toast, setToast]             = useState('')

  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const today = new Date().toISOString().slice(0, 10)

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
      const dateToFetch = tab === 'today' ? today : viewDate
      const apptRes = await fetch(`/api-proxy/scheduling/appointments?startDate=${dateToFetch}&endDate=${dateToFetch}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const all = await apptRes.json()
      setAppts(Array.isArray(all) ? all.filter((a: any) => a.doctorId === me.id) : [])
      const bRes = await fetch(`/api-proxy/scheduling/doctors/${me.id}/blocked-times`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (bRes.ok) setBlocks(await bRes.json())
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }, [token, viewDate, tab, today])

  useEffect(() => { fetchAll() }, [fetchAll])

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
        setToast('Time blocked successfully!')
        setTimeout(() => setToast(''), 3000)
        setBlockNote('')
        fetchAll()
      }
    } catch {} finally { setBlockSaving(false) }
  }

  async function deleteBlock(blockId: string) {
    if (!doctor || !token) return
    await fetch(`/api-proxy/scheduling/doctors/${doctor.id}/block-time/${blockId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    fetchAll()
  }

  const sortedAppts = appointments
    .slice()
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())

  return (
    <div className="space-y-5 p-4 md:p-6 animate-fade-in pb-24 md:pb-6">
      {toast && (
        <div className="fixed top-4 right-4 z-[99999] bg-emerald-600 text-white px-5 py-3 rounded-2xl shadow-2xl text-sm font-semibold">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/doctor/dashboard"
          className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-white/10 text-gray-400 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center">
          <ArrowLeft size={16} />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-800 dark:text-white">My Schedule</h1>
          <p className="text-sm text-gray-400 mt-0.5">Appointments and blocked time</p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex rounded-2xl bg-gray-100 dark:bg-white/5 p-1 gap-1">
        <button
          onClick={() => setTab('today')}
          className={cn(
            'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all min-h-[44px]',
            tab === 'today'
              ? 'bg-white dark:bg-white/10 text-blue-600 dark:text-blue-300 shadow-sm'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200',
          )}>
          <List size={15} />
          Today&apos;s List
        </button>
        <button
          onClick={() => setTab('calendar')}
          className={cn(
            'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all min-h-[44px]',
            tab === 'calendar'
              ? 'bg-white dark:bg-white/10 text-blue-600 dark:text-blue-300 shadow-sm'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200',
          )}>
          <CalendarDays size={15} />
          Calendar
        </button>
      </div>

      {/* ── TODAY TAB ───────────────────────────────────────────────────────── */}
      {tab === 'today' && (
        <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-50 dark:border-white/[0.06] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CalendarDays size={16} className="text-blue-500" />
              <div>
                <h2 className="font-bold text-gray-800 dark:text-white">
                  {new Date().toLocaleDateString('en-UG', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Kampala' })}
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">Today&apos;s appointments</p>
              </div>
            </div>
            <span className="text-xs font-bold bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 px-2.5 py-1 rounded-full">
              {appointments.length}
            </span>
          </div>

          {loading ? (
            <div className="p-5 space-y-2">
              {[1,2,3,4].map(i => <div key={i} className="h-16 bg-gray-100 dark:bg-white/5 rounded-xl animate-pulse" />)}
            </div>
          ) : sortedAppts.length === 0 ? (
            <div className="py-14 text-center text-gray-400">
              <CalendarDays size={36} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">No appointments today</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50 dark:divide-white/[0.04]">
              {sortedAppts.map((a) => {
                const cfg = STATUS_CFG[a.status] || { label: a.status, color: '#6B7280', bg: '#F3F4F6' }
                return (
                  <div key={a.id} className="flex items-center gap-3 px-4 sm:px-5 py-4 hover:bg-blue-50/20 dark:hover:bg-white/[0.03] transition-colors">
                    <div className="w-14 text-right flex-shrink-0">
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
                    <Link href={`/patients/${a.patient?.id}?tab=dental`}
                      className="text-[10px] font-semibold text-blue-500 hover:underline flex-shrink-0 hidden sm:block">
                      Chart
                    </Link>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── CALENDAR TAB ────────────────────────────────────────────────────── */}
      {tab === 'calendar' && (
        <>
          {/* Date picker */}
          <div className="flex items-center gap-3">
            <CalendarDays size={16} className="text-blue-500 flex-shrink-0" />
            <input type="date" value={viewDate} onChange={e => setViewDate(e.target.value)}
              className="flex-1 text-sm bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-4 py-3 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]" />
          </div>

          {/* Appointments for chosen date */}
          <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-50 dark:border-white/[0.06] flex items-center justify-between">
              <h2 className="font-bold text-gray-800 dark:text-white">
                {new Date(viewDate + 'T12:00').toLocaleDateString('en-UG', { weekday: 'long', day: 'numeric', month: 'long' })}
              </h2>
              <span className="text-xs font-bold bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 px-2.5 py-1 rounded-full">
                {appointments.length} appointments
              </span>
            </div>
            {loading ? (
              <div className="p-5 space-y-2">
                {[1,2,3].map(i => <div key={i} className="h-14 bg-gray-100 dark:bg-white/5 rounded-xl animate-pulse" />)}
              </div>
            ) : sortedAppts.length === 0 ? (
              <div className="py-10 text-center text-gray-400">
                <CalendarDays size={32} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm">No appointments on this date</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50 dark:divide-white/[0.04]">
                {sortedAppts.map((a) => {
                  const cfg = STATUS_CFG[a.status] || { label: a.status, color: '#6B7280', bg: '#F3F4F6' }
                  return (
                    <div key={a.id} className="flex items-center gap-3 px-4 sm:px-5 py-3.5 hover:bg-blue-50/20 dark:hover:bg-white/[0.03] transition-colors">
                      <div className="w-14 text-right flex-shrink-0">
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
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Block Time Off */}
          <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-50 dark:border-white/[0.06] flex items-center gap-2">
              <Ban size={16} className="text-orange-500" />
              <h2 className="font-bold text-gray-800 dark:text-white">Block Time Off</h2>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5 block">Date</label>
                  <input type="date" value={blockDate} onChange={e => setBlockDate(e.target.value)}
                    className="w-full px-3 py-3 text-base border border-gray-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5 block">Reason</label>
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
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5 block">Start Time</label>
                    <input type="time" value={blockStart} onChange={e => setBlockStart(e.target.value)}
                      className="w-full px-3 py-3 text-base border border-gray-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5 block">End Time</label>
                    <input type="time" value={blockEnd} onChange={e => setBlockEnd(e.target.value)}
                      className="w-full px-3 py-3 text-base border border-gray-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                  </div>
                </div>
              )}

              <div>
                <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5 block">Note (optional)</label>
                <input value={blockNote} onChange={e => setBlockNote(e.target.value)}
                  placeholder="e.g. Dental conference Sheraton"
                  className="w-full px-3 py-3 text-base border border-gray-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none" />
              </div>

              <button onClick={handleBlock} disabled={blockSaving}
                className="flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-sm bg-orange-500 hover:bg-orange-600 text-white disabled:opacity-50 transition-colors min-h-[44px]">
                <Plus size={15} /> {blockSaving ? 'Blocking…' : 'Block This Time'}
              </button>
            </div>

            {blocks.length > 0 && (
              <div className="border-t border-gray-50 dark:border-white/[0.06]">
                <p className="text-xs font-bold uppercase tracking-wide text-gray-400 px-5 pt-4 pb-2">Existing Blocks</p>
                <div className="divide-y divide-gray-50 dark:divide-white/[0.04]">
                  {blocks.slice(0, 10).map((b) => (
                    <div key={b.id} className="flex items-center gap-3 px-5 py-3 hover:bg-orange-50/30 dark:hover:bg-white/[0.03] transition-colors">
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-gray-700 dark:text-white">{b.reason}</p>
                        <p className="text-xs text-gray-400">{fmtDate(b.startAt)} · {fmtTime(b.startAt)} – {fmtTime(b.endAt)}</p>
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
        </>
      )}
    </div>
  )
}
