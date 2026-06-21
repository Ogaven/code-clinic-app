'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  Search, Download, Upload, Plus, X, Loader2, CalendarDays,
  ChevronLeft, ChevronRight, MoreHorizontal, Check, XCircle,
  Edit2, Phone, User,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import BookingDrawer from '@/components/scheduling/BookingDrawer'
import ImportTab from '@/components/scheduling/ImportTab'

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' })
}
function plusDaysStr(n: number) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' })
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Africa/Nairobi',
  })
}
function fmtDateShort(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Africa/Nairobi',
  }).replace(/\//g, '-')
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-UG', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Nairobi',
  })
}
function sbCode(notes: string | null): string {
  if (!notes) return ''
  const m = notes.match(/SimplyBook ref:\s*(\S+)/)
  return m?.[1] ?? ''
}
function displayCode(appt: Appt): string {
  return sbCode(appt.notes) || appt.id.slice(-8).toUpperCase()
}

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  PENDING:          { label: 'Pending',    cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  CONFIRMED:        { label: 'Confirmed',  cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  COMPLETED:        { label: 'Completed',  cls: 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/50' },
  CANCELLED:        { label: 'Cancelled',  cls: 'bg-red-100 text-red-600 dark:bg-red-900/20 dark:text-red-400' },
  IMPORTED:         { label: 'Imported',   cls: 'bg-blue-100 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400' },
  NO_SHOW:          { label: 'No Show',    cls: 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/50' },
  RESCHEDULED:      { label: 'Rescheduled',cls: 'bg-purple-100 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400' },
  ARRIVED:          { label: 'Arrived',    cls: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300' },
  WAITING:          { label: 'Waiting',    cls: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' },
  WITH_PROVIDER:    { label: 'With Dr.',   cls: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300' },
  SESSION_COMPLETE: { label: 'Done',       cls: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400' },
  CHECKOUT:         { label: 'Checkout',   cls: 'bg-purple-100 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400' },
  DEPARTED:         { label: 'Departed',   cls: 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/50' },
}
const STATUS_FILTER_OPTIONS = [
  { value: '',          label: 'All statuses' },
  { value: 'CONFIRMED', label: 'Confirmed' },
  { value: 'PENDING',   label: 'Pending' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'IMPORTED',  label: 'Imported' },
  { value: 'NO_SHOW',   label: 'No Show' },
]

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] ?? { label: status, cls: 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/50' }
  return (
    <span className={cn('inline-flex items-center text-[11px] font-bold px-2.5 py-0.5 rounded-full whitespace-nowrap', cfg.cls)}>
      {cfg.label}
    </span>
  )
}

// ── CSV Export ────────────────────────────────────────────────────────────────

function exportCSV(appts: Appt[]) {
  const headers = ['Date', 'Time', 'Status', 'Patient', 'Phone', 'Service', 'Doctor', 'Code', 'Notes', 'Created']
  const rows = appts.map(a => [
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
  const csv = [headers, ...rows]
    .map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
  a.download = `appointments_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
}

// ── Main page ─────────────────────────────────────────────────────────────────

const LIMIT = 25

function getTokenRole(): string {
  try {
    const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
    if (!token) return ''
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload.role || ''
  } catch { return '' }
}

export default function AppointmentsPage() {
  const router = useRouter()

  // Filters
  const [startDate,    setStartDate]    = useState(() => plusDaysStr(-90))
  const [endDate,      setEndDate]      = useState(() => plusDaysStr(90))
  const [statusFilter, setStatusFilter] = useState('')
  const [searchInput,  setSearchInput]  = useState('')
  const [search,       setSearch]       = useState('')
  const [page,         setPage]         = useState(1)

  // Data
  const [appts,   setAppts]   = useState<Appt[]>([])
  const [total,   setTotal]   = useState(0)
  const [loading, setLoading] = useState(true)

  // UI state
  const [selected,    setSelected]    = useState<Appt | null>(null)
  const [drawerOpen,  setDrawerOpen]  = useState(false)
  const [importOpen,  setImportOpen]  = useState(false)
  const [menuOpen,    setMenuOpen]    = useState<string | null>(null)
  const [cancelling,  setCancelling]  = useState(false)
  const [refreshKey,  setRefreshKey]  = useState(0)
  const [deleteConfirm, setDeleteConfirm] = useState<Appt | null>(null)
  const [deleting,    setDeleting]    = useState(false)
  const isAdmin = getTokenRole() === 'ADMIN'

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleSearchChange(val: string) {
    setSearchInput(val)
    clearTimeout(searchTimer.current!)
    searchTimer.current = setTimeout(() => { setSearch(val); setPage(1) }, 350)
  }

  // Reset page when filter-type controls change
  useEffect(() => { setPage(1) }, [startDate, endDate, statusFilter, search])

  // Fetch
  useEffect(() => {
    const controller = new AbortController()
    const token = (typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null) ?? ''

    setLoading(true)
    const params = new URLSearchParams({
      startDate, endDate,
      page:  String(page),
      limit: String(LIMIT),
    })
    if (statusFilter) params.set('status', statusFilter)
    if (search)       params.set('search', search)

    fetch(`/api-proxy/scheduling/appointments?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return
        if (Array.isArray(data)) {
          setAppts(data); setTotal(data.length)
        } else {
          setAppts(data.appointments ?? []); setTotal(data.total ?? 0)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))

    return () => controller.abort()
  }, [startDate, endDate, statusFilter, search, page, refreshKey])

  // Close 3-dot menu on outside click
  useEffect(() => {
    function close() { setMenuOpen(null) }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [])

  async function handleCancel(id: string) {
    setCancelling(true)
    const token = (typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null) ?? ''
    try {
      const res = await fetch(`/api-proxy/scheduling/appointments/${id}/status`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'CANCELLED' }),
      })
      if (res.ok) { setSelected(null); setRefreshKey(k => k + 1) }
    } finally { setCancelling(false) }
  }

  async function handleDelete(id: string) {
    setDeleting(true)
    const token = (typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null) ?? ''
    try {
      const res = await fetch(`/api-proxy/scheduling/appointments/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        setDeleteConfirm(null)
        setSelected(null)
        setRefreshKey(k => k + 1)
      }
    } finally { setDeleting(false) }
  }

  const totalPages = Math.ceil(total / LIMIT)

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-[#070f23]">

      {/* ── Header ────────────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 bg-white dark:bg-[#0a1520] border-b border-gray-100 dark:border-white/8 px-4 sm:px-6 py-4 space-y-3">

        {/* Title row */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-black text-gray-800 dark:text-white">Appointments</h1>
            {!loading && (
              <span className="bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-400 text-xs font-bold px-2.5 py-0.5 rounded-full">
                {total.toLocaleString()}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => exportCSV(appts)}
              className="hidden sm:flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-gray-600 dark:text-white/70 border border-gray-200 dark:border-white/10 rounded-xl hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
              <Download size={14} /> Export CSV
            </button>
            <button
              onClick={() => setImportOpen(true)}
              className="hidden sm:flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-gray-600 dark:text-white/70 border border-gray-200 dark:border-white/10 rounded-xl hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
              <Upload size={14} /> Import
            </button>
            <button
              onClick={() => setDrawerOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5 hover:shadow-lg"
              style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)', boxShadow: '0 4px 12px rgba(41,171,226,0.2)' }}>
              <Plus size={14} />
              <span className="hidden sm:inline">Book Appointment</span>
              <span className="sm:hidden">Book</span>
            </button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-white/40 font-semibold">
            <CalendarDays size={13} />
          </div>
          <input
            type="date" value={startDate}
            onChange={e => setStartDate(e.target.value)}
            className="px-3 py-1.5 text-xs border border-gray-200 dark:border-white/10 rounded-lg bg-white dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20" />
          <span className="text-xs text-gray-400">–</span>
          <input
            type="date" value={endDate}
            onChange={e => setEndDate(e.target.value)}
            className="px-3 py-1.5 text-xs border border-gray-200 dark:border-white/10 rounded-lg bg-white dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20" />

          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 text-xs border border-gray-200 dark:border-white/10 rounded-lg bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20">
            {STATUS_FILTER_OPTIONS.map(o => (
              <option key={o.value} value={o.value} className="dark:bg-gray-800">{o.label}</option>
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

      {/* ── Table area ────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 size={24} className="animate-spin text-cyan-500" />
          </div>
        ) : appts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <CalendarDays size={40} className="text-gray-200 dark:text-white/10" />
            <p className="font-semibold text-gray-400 dark:text-white/40">No appointments found</p>
            <p className="text-sm text-gray-300 dark:text-white/20">Try adjusting your date range or filters</p>
          </div>
        ) : (
          <>
            {/* ── Desktop table ───────────────────────────────────────────── */}
            <div className="hidden md:block overflow-x-auto">
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
                <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                  {appts.map(appt => (
                    <tr key={appt.id}
                      onClick={() => setSelected(appt)}
                      className="hover:bg-white dark:hover:bg-white/5 transition-colors cursor-pointer">

                      {/* Date & Time */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <p className="text-sm font-bold text-gray-800 dark:text-white">{fmtDate(appt.startAt)}</p>
                        <p className="text-xs text-gray-500 dark:text-white/40 mt-0.5">{fmtTime(appt.startAt)} – {fmtTime(appt.endAt)}</p>
                        <p className="text-[10px] text-gray-400 dark:text-white/25 mt-0.5">Created: {fmtDateShort(appt.createdAt)}</p>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <StatusBadge status={appt.status} />
                      </td>

                      {/* Patient */}
                      <td className="px-4 py-3.5">
                        <p className="text-sm font-bold text-gray-800 dark:text-white leading-tight">
                          {appt.patient.firstName} {appt.patient.lastName}
                        </p>
                        <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">{appt.patient.phone}</p>
                      </td>

                      {/* Service */}
                      <td className="px-4 py-3.5">
                        <span className="text-sm text-gray-700 dark:text-white/70">{appt.service.name}</span>
                      </td>

                      {/* Doctor */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <span className="text-sm text-gray-600 dark:text-white/60">
                          Dr. {appt.doctor.user.firstName} {appt.doctor.user.lastName}
                        </span>
                      </td>

                      {/* Code */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <code className="text-[11px] font-mono text-gray-400 dark:text-white/30 bg-gray-100 dark:bg-white/8 px-2 py-0.5 rounded">
                          {displayCode(appt)}
                        </code>
                      </td>

                      {/* Actions (3-dot menu) */}
                      <td className="px-4 py-3.5 text-right" onClick={e => e.stopPropagation()}>
                        <div className="relative inline-block">
                          <button
                            onClick={e => { e.stopPropagation(); setMenuOpen(menuOpen === appt.id ? null : appt.id) }}
                            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 transition-colors text-gray-400 hover:text-gray-700 dark:hover:text-white">
                            <MoreHorizontal size={15} />
                          </button>
                          {menuOpen === appt.id && (
                            <div className="absolute right-0 top-full mt-1 w-40 bg-white dark:bg-[#0f1729] border border-gray-100 dark:border-white/10 rounded-xl shadow-lg z-20 py-1 overflow-hidden">
                              <button onClick={() => { setSelected(appt); setMenuOpen(null) }}
                                className="w-full text-left px-4 py-2 text-xs font-semibold text-gray-700 dark:text-white/80 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                                View details
                              </button>
                              <button onClick={() => { setSelected(appt); setMenuOpen(null) }}
                                className="w-full text-left px-4 py-2 text-xs font-semibold text-gray-700 dark:text-white/80 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                                Edit
                              </button>
                              {appt.status !== 'CANCELLED' && (
                                <button onClick={() => { handleCancel(appt.id); setMenuOpen(null) }}
                                  className="w-full text-left px-4 py-2 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                                  Cancel
                                </button>
                              )}
                              {isAdmin && (
                                <button onClick={() => { setDeleteConfirm(appt); setMenuOpen(null) }}
                                  className="w-full text-left px-4 py-2 text-xs font-semibold text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors border-t border-gray-100 dark:border-white/8">
                                  Delete
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* ── Mobile cards ─────────────────────────────────────────────── */}
            <div className="md:hidden divide-y divide-gray-100 dark:divide-white/5">
              {appts.map(appt => (
                <div key={appt.id}
                  onClick={() => setSelected(appt)}
                  className="flex items-start gap-3 px-4 py-4 cursor-pointer hover:bg-white dark:hover:bg-white/5 transition-colors">
                  <div className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-white text-xs font-black"
                    style={{ background: appt.service.colour || '#29ABE2' }}>
                    {(appt.patient.firstName || '?')[0]}{(appt.patient.lastName || '?')[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <p className="text-sm font-bold text-gray-800 dark:text-white truncate">
                        {appt.patient.firstName} {appt.patient.lastName}
                      </p>
                      <StatusBadge status={appt.status} />
                    </div>
                    <p className="text-xs text-cyan-600 dark:text-cyan-400 font-medium">{appt.service.name}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      {fmtDate(appt.startAt)} · {fmtTime(appt.startAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* ── Pagination ───────────────────────────────────────────────── */}
            <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-t border-gray-100 dark:border-white/8 bg-white dark:bg-[#0a1520]">
              <p className="text-xs text-gray-400 dark:text-white/30">
                {((page - 1) * LIMIT) + 1}–{Math.min(page * LIMIT, total)} of {total.toLocaleString()}
              </p>
              <div className="flex items-center gap-1">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage(p => p - 1)}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-gray-600 dark:text-white/60 border border-gray-200 dark:border-white/10 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                  <ChevronLeft size={13} /> Prev
                </button>
                {/* Page number pills */}
                {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                  const p = Math.max(1, Math.min(page - 2, totalPages - 4)) + i
                  return (
                    <button key={p} onClick={() => setPage(p)}
                      className={cn(
                        'w-7 h-7 text-xs font-bold rounded-lg transition-colors',
                        p === page
                          ? 'bg-cyan-500 text-white'
                          : 'text-gray-500 dark:text-white/50 hover:bg-gray-100 dark:hover:bg-white/10',
                      )}>
                      {p}
                    </button>
                  )
                })}
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage(p => p + 1)}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-gray-600 dark:text-white/60 border border-gray-200 dark:border-white/10 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                  Next <ChevronRight size={13} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Detail modal ──────────────────────────────────────────────────────── */}
      {selected && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setSelected(null)} />
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <div className="w-full max-w-lg bg-white dark:bg-[#0f1729] rounded-2xl shadow-2xl border border-gray-100 dark:border-white/10 overflow-hidden flex flex-col max-h-[92vh]">

              {/* Modal header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/8">
                <h3 className="font-black text-gray-800 dark:text-white">Booking Details</h3>
                <button onClick={() => setSelected(null)}
                  className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-white/8 transition-colors">
                  <X size={16} className="text-gray-400" />
                </button>
              </div>

              {/* Modal body */}
              <div className="flex-1 overflow-y-auto p-5 space-y-4">

                {/* Date card */}
                <div className="rounded-xl overflow-hidden border border-cyan-200 dark:border-cyan-800/40">
                  <div className="px-4 py-3 text-white text-center" style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
                    <p className="text-lg font-black">{fmtDate(selected.startAt)}</p>
                    <p className="text-sm text-blue-100 mt-0.5">{fmtTime(selected.startAt)} – {fmtTime(selected.endAt)}</p>
                  </div>
                  <div className="flex items-center justify-between px-4 py-2 bg-gray-50 dark:bg-white/5">
                    <span className="text-[11px] font-black text-gray-400 dark:text-white/30 uppercase tracking-wider">Booking ref</span>
                    <code className="text-xs font-mono font-bold text-gray-700 dark:text-white/70">{displayCode(selected)}</code>
                  </div>
                </div>

                {/* Status + service */}
                <div className="flex items-center gap-3">
                  <StatusBadge status={selected.status} />
                  <span className="text-sm font-bold text-gray-800 dark:text-white">{selected.service.name}</span>
                </div>

                {/* Details grid */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-gray-50 dark:bg-white/5 rounded-xl p-3">
                    <p className="text-[10px] font-black text-gray-400 dark:text-white/30 uppercase tracking-wider mb-1">Doctor</p>
                    <p className="text-sm font-semibold text-gray-700 dark:text-white/80">
                      Dr. {selected.doctor.user.firstName} {selected.doctor.user.lastName}
                    </p>
                  </div>
                  <div className="bg-gray-50 dark:bg-white/5 rounded-xl p-3">
                    <p className="text-[10px] font-black text-gray-400 dark:text-white/30 uppercase tracking-wider mb-1">Created</p>
                    <p className="text-sm font-semibold text-gray-700 dark:text-white/80">{fmtDateShort(selected.createdAt)}</p>
                  </div>
                </div>

                {/* Patient card */}
                <div className="flex items-center gap-3 bg-gray-50 dark:bg-white/5 rounded-xl p-4">
                  <div className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-white text-sm font-black"
                    style={{ background: selected.service.colour || '#29ABE2' }}>
                    {(selected.patient.firstName || '?')[0]}{(selected.patient.lastName || '?')[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-gray-800 dark:text-white text-sm">
                      {selected.patient.firstName} {selected.patient.lastName}
                    </p>
                    <a href={`tel:${selected.patient.phone}`}
                      className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 mt-0.5 hover:underline">
                      <Phone size={11} /> {selected.patient.phone}
                    </a>
                  </div>
                  <button
                    onClick={() => { setSelected(null); router.push(`/receptionist/patients/${selected.patient.id}`) }}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-cyan-600 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-900/20 rounded-lg hover:bg-cyan-100 dark:hover:bg-cyan-900/30 transition-colors">
                    <User size={11} /> Profile
                  </button>
                </div>

                {/* Notes */}
                {selected.notes && (
                  <div className="bg-amber-50 dark:bg-amber-900/15 border border-amber-100 dark:border-amber-800/30 rounded-xl px-4 py-3">
                    <p className="text-[10px] font-black text-amber-600 dark:text-amber-400 uppercase tracking-wider mb-1">Notes</p>
                    <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
                      {selected.notes.replace(/SimplyBook ref:\s*\S+/g, '').trim() || selected.notes}
                    </p>
                  </div>
                )}
              </div>

              {/* Modal actions */}
              <div className="flex-shrink-0 px-5 py-4 border-t border-gray-100 dark:border-white/8 flex flex-wrap gap-2">
                {selected.status !== 'CANCELLED' && selected.status !== 'COMPLETED' && (
                  <button
                    onClick={() => handleCancel(selected.id)}
                    disabled={cancelling}
                    className="flex items-center gap-1.5 px-4 py-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-xs font-bold rounded-xl hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors disabled:opacity-60">
                    {cancelling ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
                    Cancel booking
                  </button>
                )}
                <button
                  onClick={() => setSelected(null)}
                  className="ml-auto px-4 py-2 text-xs font-bold text-gray-500 dark:text-white/50 hover:bg-gray-50 dark:hover:bg-white/5 rounded-xl transition-colors">
                  Close
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Import modal ──────────────────────────────────────────────────────── */}
      {importOpen && (
        <>
          <div className="fixed inset-0 bg-black/50 z-40" onClick={() => setImportOpen(false)} />
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <div className="w-full max-w-2xl bg-white dark:bg-[#0f1729] rounded-2xl shadow-2xl border border-gray-100 dark:border-white/10 overflow-hidden max-h-[90vh] flex flex-col">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/8">
                <h3 className="font-bold text-gray-800 dark:text-white">Import Appointments</h3>
                <button onClick={() => setImportOpen(false)}
                  className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-white/8 transition-colors">
                  <X size={15} className="text-gray-400" />
                </button>
              </div>
              <div className="overflow-y-auto flex-1">
                <ImportTab />
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Booking Drawer ────────────────────────────────────────────────────── */}
      <BookingDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onBooked={() => { setDrawerOpen(false); setRefreshKey(k => k + 1) }}
      />

      {/* ── Delete confirmation dialog (admin only) ───────────────────────────── */}
      {deleteConfirm && (
        <>
          <div className="fixed inset-0 bg-black/50 z-50" onClick={() => setDeleteConfirm(null)} />
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4 pointer-events-none">
            <div className="pointer-events-auto w-full max-w-sm bg-white dark:bg-[#0f1729] rounded-2xl shadow-2xl border border-gray-100 dark:border-white/10 p-6 space-y-4">
              <h3 className="text-base font-black text-gray-800 dark:text-white">Delete Appointment?</h3>
              <p className="text-sm text-gray-500 dark:text-white/60">
                This will permanently delete the appointment for{' '}
                <span className="font-semibold text-gray-700 dark:text-white/80">
                  {deleteConfirm.patient.firstName} {deleteConfirm.patient.lastName}
                </span>{' '}
                on <span className="font-semibold">{fmtDate(deleteConfirm.startAt)}</span>. This cannot be undone.
              </p>
              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => handleDelete(deleteConfirm.id)}
                  disabled={deleting}
                  className="flex-1 py-2.5 text-sm font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
                  {deleting ? <Loader2 size={14} className="animate-spin" /> : null}
                  {deleting ? 'Deleting…' : 'Yes, Delete'}
                </button>
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="px-4 py-2.5 text-sm font-semibold text-gray-600 dark:text-white/60 hover:bg-gray-100 dark:hover:bg-white/8 rounded-xl transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
