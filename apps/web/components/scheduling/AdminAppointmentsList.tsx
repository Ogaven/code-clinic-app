'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Search, Download, Loader2, CalendarDays, ChevronLeft, ChevronRight,
  MoreHorizontal, Phone, User,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import AppointmentModal from '@/components/scheduling/AppointmentModal'

// ── Admin-only appointments operational list ──────────────────────────────────
// Deliberately a SEPARATE component from apps/web/app/(receptionist)/receptionist/
// appointments/page.tsx (which the admin scheduling page previously re-exported
// directly) — the Receptionist app is out of scope for this redesign and must
// not be touched, so this reuses the same backend endpoints and general visual
// language without importing or modifying that file.

// ── Types ─────────────────────────────────────────────────────────────────────
type Appt = {
  id: string
  startAt: string
  endAt: string
  status: string
  notes: string | null
  createdAt: string
  patient: { id: string; firstName: string; lastName: string; phone: string }
  doctor: { id: string; user: { firstName: string; lastName: string } }
  service: { id: string; name: string; colour: string; durationMins: number; priceUGX: number }
}
type Doctor = { id: string; firstName: string; lastName: string }
type StatusCounts = { ALL: number; CONFIRMED: number; PENDING: number; NO_SHOW: number; CANCELLED: number; RESCHEDULED: number; COMPLETED: number }

// ── Real AppointmentStatus mapping (packages/database/prisma/schema.prisma) ──
// Only PENDING, CONFIRMED, NO_SHOW, CANCELLED, RESCHEDULED, COMPLETED get a
// dedicated tab, per the approved design. Deliberate, documented handling of
// the rest of the real enum:
//   - CANCELLED_RESCHEDULED is bucketed into the "Cancelled" tab (both
//     represent a slot that no longer stands), matching how the backend's
//     /appointments/status-counts endpoint groups them.
//   - IMPORTED (bulk SimplyBook-migration records) and the live clinical-flow
//     stages (IN_PROGRESS, ARRIVED, WAITING, IN_OPERATORY, WITH_PROVIDER,
//     SESSION_COMPLETE, CHECKOUT, DEPARTED, CHECKED_IN, IN_CHAIR,
//     READY_CHECKOUT) do NOT map cleanly onto any of the 7 requested tabs —
//     they only appear under "All", not double-counted into any status tab.
type StatusTab = 'ALL' | 'CONFIRMED' | 'PENDING' | 'NO_SHOW' | 'CANCELLED' | 'RESCHEDULED' | 'COMPLETED'
const STATUS_TABS: { key: StatusTab; label: string; apiStatus?: string }[] = [
  { key: 'ALL',         label: 'All' },
  { key: 'CONFIRMED',   label: 'Confirmed',   apiStatus: 'CONFIRMED' },
  { key: 'PENDING',     label: 'Pending',     apiStatus: 'PENDING' },
  { key: 'NO_SHOW',     label: 'No-show',     apiStatus: 'NO_SHOW' },
  { key: 'CANCELLED',   label: 'Cancelled',   apiStatus: 'CANCELLED,CANCELLED_RESCHEDULED' },
  { key: 'RESCHEDULED', label: 'Rescheduled', apiStatus: 'RESCHEDULED' },
  { key: 'COMPLETED',   label: 'Completed',   apiStatus: 'COMPLETED' },
]
// Tabs representing still-actionable/upcoming work sort nearest-first;
// resolved/historical tabs sort most-recent-first. See report for rationale.
const UPCOMING_FIRST_TABS = new Set<StatusTab>(['ALL', 'CONFIRMED', 'PENDING', 'RESCHEDULED'])

const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  PENDING:               { label: 'Pending',     cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  CONFIRMED:             { label: 'Confirmed',   cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  COMPLETED:             { label: 'Completed',   cls: 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/50' },
  CANCELLED:             { label: 'Cancelled',   cls: 'bg-red-100 text-red-600 dark:bg-red-900/20 dark:text-red-400' },
  CANCELLED_RESCHEDULED: { label: 'Cancelled',   cls: 'bg-red-100 text-red-600 dark:bg-red-900/20 dark:text-red-400' },
  IMPORTED:              { label: 'Imported',    cls: 'bg-blue-100 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400' },
  NO_SHOW:               { label: 'No Show',     cls: 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/50' },
  RESCHEDULED:           { label: 'Rescheduled', cls: 'bg-purple-100 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400' },
  ARRIVED:               { label: 'Arrived',     cls: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300' },
  CHECKED_IN:            { label: 'Checked In',  cls: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300' },
  WAITING:               { label: 'Waiting',     cls: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' },
  WITH_PROVIDER:         { label: 'With Dr.',    cls: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300' },
  IN_CHAIR:              { label: 'With Dr.',    cls: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300' },
  SESSION_COMPLETE:      { label: 'Done',        cls: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400' },
  CHECKOUT:              { label: 'Checkout',    cls: 'bg-purple-100 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400' },
  READY_CHECKOUT:        { label: 'Checkout',    cls: 'bg-purple-100 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400' },
  DEPARTED:              { label: 'Departed',    cls: 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/50' },
  IN_PROGRESS:           { label: 'In Progress', cls: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300' },
  IN_OPERATORY:          { label: 'In Operatory',cls: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300' },
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] ?? { label: status, cls: 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/50' }
  return (
    <span className={cn('inline-flex items-center text-[11px] font-bold px-2.5 py-0.5 rounded-full whitespace-nowrap', cfg.cls)}>
      {cfg.label}
    </span>
  )
}

// ── Date helpers — Africa/Kampala explicit, never server/browser-ambient ─────
function kampalaToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Kampala' })
}
function kampalaWeekRange(): { start: string; end: string } {
  const now = new Date()
  // Weekday in Kampala, Monday-Sunday week
  const wd = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Kampala' })).getDay()
  const mondayOffset = wd === 0 ? -6 : 1 - wd
  const monday = new Date(now); monday.setDate(now.getDate() + mondayOffset)
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6)
  const iso = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Africa/Kampala' })
  return { start: iso(monday), end: iso(sunday) }
}
function kampalaMonthRange(): { start: string; end: string } {
  const todayStr = kampalaToday()
  const [y, m] = todayStr.split('-').map(Number)
  const start = `${y}-${String(m).padStart(2, '0')}-01`
  const lastDay = new Date(y, m, 0).getDate()
  const end = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  return { start, end }
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Africa/Kampala' })
}
function fmtDateShort(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Africa/Kampala' }).replace(/\//g, '-')
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Kampala' })
}
function sbCode(notes: string | null): string {
  if (!notes) return ''
  const m = notes.match(/SimplyBook ref:\s*(\S+)/)
  return m?.[1] ?? ''
}
function displayCode(appt: Appt): string {
  return sbCode(appt.notes) || appt.id.slice(-8).toUpperCase()
}

const LIMIT = 25
const API = '/api-proxy'

export default function AdminAppointmentsList({ userRole = 'ADMIN' }: { userRole?: string } = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const authH = { Authorization: `Bearer ${token}` }

  // Date period — defaults to "today" (Phase 3 correction). A single
  // orderBy direction across a whole month/custom range can't put "today
  // onward, nearest first" ahead of "everything before today, most recent
  // first" without raw SQL (Prisma's findMany has no CASE-based ORDER BY),
  // which would be a materially bigger backend change than this UI problem
  // warrants. Defaulting to Today gives staff exactly what's operationally
  // relevant immediately, with zero ordering ambiguity, while This
  // Week/Month/Custom remain one click away — nothing is hidden.
  type Period = 'today' | 'week' | 'month' | 'custom'
  const [period, setPeriod] = useState<Period>('today')
  const [customStart, setCustomStart] = useState(() => kampalaMonthRange().start)
  const [customEnd,   setCustomEnd]   = useState(() => kampalaMonthRange().end)

  const { startDate, endDate } = useMemo(() => {
    if (period === 'today') { const t = kampalaToday(); return { startDate: t, endDate: t } }
    if (period === 'week')  { const r = kampalaWeekRange();  return { startDate: r.start, endDate: r.end } }
    if (period === 'month') { const r = kampalaMonthRange(); return { startDate: r.start, endDate: r.end } }
    return { startDate: customStart, endDate: customEnd }
  }, [period, customStart, customEnd])

  // Filters
  const [statusTab,    setStatusTab]    = useState<StatusTab>('ALL')
  const [doctorId,     setDoctorId]     = useState('')
  const [searchInput,  setSearchInput]  = useState('')
  const [search,       setSearch]       = useState('')
  const [page,         setPage]         = useState(1)

  // Data
  const [appts,   setAppts]   = useState<Appt[]>([])
  const [total,   setTotal]   = useState(0)
  const [counts,  setCounts]  = useState<StatusCounts | null>(null)
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  // UI state
  const [selected,   setSelected]   = useState<Appt | null>(null)
  const [editAppt,   setEditAppt]   = useState<Appt | null>(null)
  const [menuOpen,   setMenuOpen]   = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function handleSearchChange(val: string) {
    setSearchInput(val)
    clearTimeout(searchTimer.current!)
    searchTimer.current = setTimeout(() => { setSearch(val); setPage(1) }, 350)
  }

  useEffect(() => { setPage(1) }, [startDate, endDate, statusTab, doctorId, search])

  useEffect(() => {
    fetch(`${API}/doctors`, { headers: authH }).then(r => r.ok ? r.json() : []).then(d => setDoctors(Array.isArray(d) ? d : [])).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fetch list
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    const tab = STATUS_TABS.find(t => t.key === statusTab)
    const params = new URLSearchParams({
      startDate, endDate,
      page: String(page), limit: String(LIMIT),
      sort: UPCOMING_FIRST_TABS.has(statusTab) ? 'asc' : 'desc',
    })
    if (tab?.apiStatus) params.set('status', tab.apiStatus)
    if (doctorId) params.set('doctorId', doctorId)
    if (search)   params.set('search', search)

    fetch(`${API}/scheduling/appointments?${params}`, { headers: authH, signal: controller.signal })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return
        if (Array.isArray(data)) { setAppts(data); setTotal(data.length) }
        else { setAppts(data.appointments ?? []); setTotal(data.total ?? 0) }
      })
      .catch(() => {})
      .finally(() => setLoading(false))

    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate, statusTab, doctorId, search, page, refreshKey])

  // Fetch real status counts for the current date/doctor/search filters
  // (not the status tab itself — counts always show all 7 buckets).
  useEffect(() => {
    const params = new URLSearchParams({ startDate, endDate })
    if (doctorId) params.set('doctorId', doctorId)
    if (search)   params.set('search', search)
    fetch(`${API}/scheduling/appointments/status-counts?${params}`, { headers: authH })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setCounts(d) })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate, doctorId, search, refreshKey])

  useEffect(() => {
    function close() { setMenuOpen(null) }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [])

  useEffect(() => {
    function onUpdated() { setRefreshKey(k => k + 1) }
    window.addEventListener('appointment-updated', onUpdated)
    return () => window.removeEventListener('appointment-updated', onUpdated)
  }, [])

  // Export respects the active filters by fetching the FULL matching set
  // (not just the current 25-row page) via the same filtered query, unpaginated.
  async function handleExport() {
    setExporting(true)
    try {
      const tab = STATUS_TABS.find(t => t.key === statusTab)
      const params = new URLSearchParams({ startDate, endDate, sort: 'asc' })
      if (tab?.apiStatus) params.set('status', tab.apiStatus)
      if (doctorId) params.set('doctorId', doctorId)
      if (search)   params.set('search', search)
      const res = await fetch(`${API}/scheduling/appointments?${params}`, { headers: authH })
      const data = await res.json()
      const rows: Appt[] = Array.isArray(data) ? data : (data.appointments ?? [])

      const headers = ['Date', 'Time', 'Status', 'Patient', 'Phone', 'Service', 'Doctor', 'Code', 'Notes', 'Created']
      const csvRows = rows.map(a => [
        fmtDateShort(a.startAt),
        `${fmtTime(a.startAt)} - ${fmtTime(a.endAt)}`,
        STATUS_CFG[a.status]?.label ?? a.status,
        `${a.patient.firstName} ${a.patient.lastName}`,
        a.patient.phone,
        a.service.name,
        `Dr. ${a.doctor.user.firstName} ${a.doctor.user.lastName}`,
        displayCode(a),
        (a.notes ?? '').replace(/SimplyBook ref:\s*\S+/g, '').trim(),
        fmtDateShort(a.createdAt),
      ])
      const csv = [headers, ...csvRows].map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
      const link = document.createElement('a')
      link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
      link.download = `appointments_${statusTab.toLowerCase()}_${startDate}_to_${endDate}.csv`
      link.click()
    } finally {
      setExporting(false)
    }
  }

  const totalPages = Math.ceil(total / LIMIT)

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-[#070f23]">
      {/* Header */}
      <div className="flex-shrink-0 bg-white dark:bg-[#0a1520] border-b border-gray-100 dark:border-white/8 px-4 sm:px-6 py-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-lg font-black text-gray-800 dark:text-white">Appointments</h1>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-gray-600 dark:text-white/70 border border-gray-200 dark:border-white/10 rounded-xl hover:bg-gray-50 dark:hover:bg-white/5 transition-colors disabled:opacity-50">
            {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            Export CSV
          </button>
        </div>

        {/* Status tab navigation with real counts */}
        <div className="flex flex-wrap gap-1.5">
          {STATUS_TABS.map(t => {
            const count = counts ? counts[t.key] : null
            const active = statusTab === t.key
            return (
              <button
                key={t.key}
                onClick={() => setStatusTab(t.key)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-colors',
                  active
                    ? 'bg-clinic-navy text-white dark:bg-cyan-600'
                    : 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-white/60 hover:bg-gray-200 dark:hover:bg-white/10',
                )}>
                {t.label}
                <span className={cn('px-1.5 py-0.5 rounded-full text-[10px]', active ? 'bg-white/20' : 'bg-white dark:bg-white/10')}>
                  {count === null ? '…' : count.toLocaleString()}
                </span>
              </button>
            )
          })}
        </div>

        {/* Date period + doctor + search */}
        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex items-center gap-1 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 p-1">
            {(['today', 'week', 'month', 'custom'] as Period[]).map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className={cn('px-2.5 py-1 rounded-lg text-[11px] font-bold capitalize transition-colors',
                  period === p ? 'bg-clinic-navy text-white dark:bg-cyan-600' : 'text-gray-500 dark:text-white/50 hover:bg-gray-100 dark:hover:bg-white/10')}>
                {p === 'today' ? 'Today' : p === 'week' ? 'This Week' : p === 'month' ? 'This Month' : 'Custom'}
              </button>
            ))}
          </div>
          {period === 'custom' && (
            <>
              <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
                className="px-3 py-1.5 text-xs border border-gray-200 dark:border-white/10 rounded-lg bg-white dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20" />
              <span className="text-xs text-gray-400">–</span>
              <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
                className="px-3 py-1.5 text-xs border border-gray-200 dark:border-white/10 rounded-lg bg-white dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20" />
            </>
          )}

          <select
            value={doctorId}
            onChange={e => setDoctorId(e.target.value)}
            className="px-3 py-1.5 text-xs border border-gray-200 dark:border-white/10 rounded-lg bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20">
            <option value="" className="dark:bg-gray-800">All doctors</option>
            {doctors.map(d => (
              <option key={d.id} value={d.id} className="dark:bg-gray-800">Dr. {d.firstName} {d.lastName}</option>
            ))}
          </select>

          <div className="relative flex-1 min-w-[180px]">
            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              value={searchInput}
              onChange={e => handleSearchChange(e.target.value)}
              placeholder="Search patient name or phone…"
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 dark:border-white/10 rounded-lg bg-white dark:bg-white/5 dark:text-white dark:placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-cyan-500/20" />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 size={24} className="animate-spin text-cyan-500" />
          </div>
        ) : appts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <CalendarDays size={40} className="text-gray-200 dark:text-white/10" />
            <p className="font-semibold text-gray-400 dark:text-white/40">No appointments found</p>
            <p className="text-sm text-gray-300 dark:text-white/20">Try adjusting your date range, status, or doctor filter</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px]">
              <thead className="sticky top-0 z-10 bg-gray-50 dark:bg-[#0a1f3a]/95 backdrop-blur-sm">
                <tr className="border-b border-gray-100 dark:border-white/8">
                  {['Date & Time', 'Status', 'Patient', 'Service', 'Doctor', 'Code', ''].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-[11px] font-black text-gray-400 dark:text-white/30 uppercase tracking-wider whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {appts.map(a => (
                  <tr key={a.id}
                    onClick={() => setSelected(a)}
                    className="border-b border-gray-50 dark:border-white/5 hover:bg-gray-50 dark:hover:bg-white/[0.03] cursor-pointer transition-colors">
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-white/80 whitespace-nowrap">
                      <div className="font-semibold">{fmtDate(a.startAt)}</div>
                      <div className="text-xs text-gray-400">{fmtTime(a.startAt)} – {fmtTime(a.endAt)}</div>
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={a.status} /></td>
                    <td className="px-4 py-3 text-sm">
                      <div className="font-semibold text-gray-800 dark:text-white flex items-center gap-1"><User size={12} className="text-gray-300" />{a.patient.firstName} {a.patient.lastName}</div>
                      <div className="text-xs text-gray-400 flex items-center gap-1"><Phone size={10} />{a.patient.phone}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-white/60">{a.service.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-white/60 whitespace-nowrap">Dr. {a.doctor.user.firstName} {a.doctor.user.lastName}</td>
                    <td className="px-4 py-3 text-xs text-gray-400 font-mono">{displayCode(a)}</td>
                    <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                      <div className="relative inline-block">
                        <button onClick={() => setMenuOpen(menuOpen === a.id ? null : a.id)}
                          className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 text-gray-400">
                          <MoreHorizontal size={16} />
                        </button>
                        {menuOpen === a.id && (
                          <div className="absolute right-0 mt-1 w-36 bg-white dark:bg-[#111a35] border border-gray-100 dark:border-white/10 rounded-xl shadow-lg z-20 py-1">
                            <button onClick={() => { setEditAppt(a); setMenuOpen(null) }}
                              className="w-full text-left px-3 py-2 text-xs font-semibold text-gray-600 dark:text-white/70 hover:bg-gray-50 dark:hover:bg-white/5">
                              View / Edit
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex-shrink-0 flex items-center justify-between px-4 sm:px-6 py-3 border-t border-gray-100 dark:border-white/8 bg-white dark:bg-[#0a1520]">
          <p className="text-xs text-gray-400">Page {page} of {totalPages} · {total.toLocaleString()} total</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
              className="p-2 rounded-lg border border-gray-200 dark:border-white/10 text-gray-500 dark:text-white/50 disabled:opacity-30 hover:bg-gray-50 dark:hover:bg-white/5">
              <ChevronLeft size={14} />
            </button>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
              className="p-2 rounded-lg border border-gray-200 dark:border-white/10 text-gray-500 dark:text-white/50 disabled:opacity-30 hover:bg-gray-50 dark:hover:bg-white/5">
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {(selected || editAppt) && (
        <AppointmentModal
          appointment={editAppt || selected}
          onClose={() => { setSelected(null); setEditAppt(null) }}
          onStatusChange={() => { setRefreshKey(k => k + 1); setSelected(null); setEditAppt(null) }}
          userRole={userRole}
          autoEdit={!!editAppt}
        />
      )}
    </div>
  )
}
