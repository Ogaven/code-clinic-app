'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  Search, Plus, Upload, Download, X, Loader2,
  ChevronRight, Edit2, XCircle, AlertTriangle, Check, Save,
  CalendarDays, Phone,
} from 'lucide-react'
import { cn, formatPhone, formatUGX } from '@/lib/utils'
import BookingDrawer from '@/components/scheduling/BookingDrawer'
import ImportTab from '@/components/scheduling/ImportTab'

// ── Types ──────────────────────────────────────────────────────────────────────
type Appointment = {
  id: string
  startAt: string
  endAt: string
  status: string
  notes: string | null
  patient: { id: string; firstName: string; lastName: string; phone: string; email?: string }
  doctor: { id: string; user: { firstName: string; lastName: string } }
  service: { id: string; name: string; colour: string; durationMins: number; priceUGX: number }
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Africa/Nairobi',
  }).replace(/\//g, '-')
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-UG', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Nairobi',
  })
}

function durationStr(startIso: string, endIso: string) {
  const mins = (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000
  if (mins <= 0) return ''
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h > 0 && m > 0) return `${h} hr. ${m} min.`
  if (h > 0) return `${h} hr.`
  return `${m} min.`
}

function bookingCode(id: string) {
  return id.slice(-10).toLowerCase()
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  PENDING:        { label: 'Pending',   cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  CONFIRMED:      { label: 'Approved',  cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  CHECKED_IN:     { label: 'Checked In',cls: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' },
  IN_CHAIR:       { label: 'In Chair',  cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' },
  WITH_PROVIDER:  { label: 'With Provider', cls: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300' },
  READY_CHECKOUT: { label: 'Checkout',  cls: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' },
  COMPLETED:      { label: 'Completed', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300' },
  NO_SHOW:        { label: 'No Show',   cls: 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/50' },
  CANCELLED:      { label: 'Cancelled', cls: 'bg-red-100 text-red-600 dark:bg-red-900/20 dark:text-red-400' },
  RESCHEDULED:    { label: 'Rescheduled', cls: 'bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400' },
}

const STATUS_NEXT: Record<string, { status: string; label: string; cls: string }> = {
  PENDING:        { status: 'CONFIRMED',      label: 'Confirm',          cls: 'bg-blue-600 hover:bg-blue-700' },
  CONFIRMED:      { status: 'CHECKED_IN',     label: 'Check In',         cls: 'bg-yellow-500 hover:bg-yellow-600' },
  CHECKED_IN:     { status: 'IN_CHAIR',       label: 'Seat in Chair',    cls: 'bg-orange-500 hover:bg-orange-600' },
  IN_CHAIR:       { status: 'WITH_PROVIDER',  label: 'With Provider',    cls: 'bg-teal-600 hover:bg-teal-700' },
  WITH_PROVIDER:  { status: 'READY_CHECKOUT', label: 'Checkout',         cls: 'bg-purple-600 hover:bg-purple-700' },
  READY_CHECKOUT: { status: 'COMPLETED',      label: 'Complete',         cls: 'bg-green-600 hover:bg-green-700' },
}

const EDIT_STATUSES = [
  'PENDING','CONFIRMED','CHECKED_IN','IN_CHAIR','WITH_PROVIDER',
  'READY_CHECKOUT','COMPLETED','CANCELLED','NO_SHOW','RESCHEDULED',
]

// ── Export CSV ─────────────────────────────────────────────────────────────────
function exportCSV(appts: Appointment[]) {
  const headers = ['Date','Time','Service','Doctor','Patient','Phone','Status']
  const rows = appts.map(a => [
    fmtDate(a.startAt),
    `${fmtTime(a.startAt)} - ${fmtTime(a.endAt)}`,
    a.service.name,
    `${a.doctor.user.firstName} ${a.doctor.user.lastName}`,
    `${a.patient.firstName} ${a.patient.lastName}`,
    a.patient.phone,
    STATUS_BADGE[a.status]?.label ?? a.status,
  ])
  const csv = [headers, ...rows]
    .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `appointments_${new Date().toISOString().slice(0,10)}.csv`
  link.click()
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function AppointmentsPage() {
  const API   = '/api-proxy'
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const authH = { Authorization: `Bearer ${token}` }

  const [viewTab,    setViewTab]    = useState<'upcoming' | 'recent'>('upcoming')
  const [appts,      setAppts]      = useState<Appointment[]>([])
  const [loading,    setLoading]    = useState(true)
  const [search,     setSearch]     = useState('')
  const [selected,   setSelected]   = useState<Appointment | null>(null)
  const [detailTab,  setDetailTab]  = useState<'booking' | 'patient'>('booking')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  // Edit state (inside detail modal)
  const [editMode,    setEditMode]    = useState(false)
  const [editStatus,  setEditStatus]  = useState('')
  const [editDate,    setEditDate]    = useState('')
  const [editTime,    setEditTime]    = useState('')
  const [editDoctorId,setEditDoctorId]= useState('')
  const [editNotes,   setEditNotes]   = useState('')
  const [saving,      setSaving]      = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [doctors,     setDoctors]     = useState<{ id: string; firstName: string; lastName: string }[]>([])

  useEffect(() => { fetchAppts() }, [refreshKey])

  const fetchAppts = useCallback(async () => {
    setLoading(true)
    const now   = new Date()
    const start = new Date(now); start.setDate(start.getDate() - 90)
    const end   = new Date(now); end.setDate(end.getDate() + 180)
    const s = start.toISOString().slice(0,10)
    const e = end.toISOString().slice(0,10)
    try {
      const res = await fetch(`${API}/scheduling/appointments?startDate=${s}&endDate=${e}`, { headers: authH })
      if (res.ok) setAppts(await res.json())
    } catch {} finally { setLoading(false) }
  }, [])

  // Tab filtering + sorting
  const todayStr = new Date().toISOString().slice(0,10)
  const sorted: Appointment[] = viewTab === 'upcoming'
    ? [...appts]
        .filter(a => a.startAt.slice(0,10) >= todayStr)
        .sort((a, b) => a.startAt.localeCompare(b.startAt))
    : [...appts]
        .sort((a, b) => b.startAt.localeCompare(a.startAt))

  const filtered = sorted.filter(a => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      `${a.patient.firstName} ${a.patient.lastName}`.toLowerCase().includes(q) ||
      a.patient.phone.includes(q) ||
      `${a.doctor.user.firstName} ${a.doctor.user.lastName}`.toLowerCase().includes(q) ||
      a.service.name.toLowerCase().includes(q)
    )
  })

  function openDetail(appt: Appointment) {
    setSelected(appt)
    setDetailTab('booking')
    setEditMode(false)
  }

  function openEdit(appt: Appointment) {
    const d = new Date(appt.startAt)
    setEditDate(d.toISOString().slice(0,10))
    setEditTime(`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`)
    setEditDoctorId(appt.doctor.id)
    setEditStatus(appt.status)
    setEditNotes(appt.notes || '')
    setEditMode(true)
    if (doctors.length === 0) {
      fetch(`${API}/doctors`, { headers: authH })
        .then(r => r.ok ? r.json() : [])
        .then(d => setDoctors(Array.isArray(d) ? d : []))
        .catch(() => {})
    }
  }

  async function saveEdit() {
    if (!selected) return
    setSaving(true)
    try {
      const startAt = new Date(`${editDate}T${editTime}:00`).toISOString()
      const res = await fetch(`${API}/scheduling/appointments/${selected.id}`, {
        method: 'PATCH',
        headers: { ...authH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ startAt, doctorId: editDoctorId, status: editStatus, notes: editNotes }),
      })
      if (res.ok) { setSelected(null); setRefreshKey(k => k+1) }
    } catch {} finally { setSaving(false) }
  }

  async function changeStatus(status: string) {
    if (!selected) return
    setActionLoading(status)
    try {
      const res = await fetch(`${API}/scheduling/appointments/${selected.id}/status`, {
        method: 'PATCH',
        headers: { ...authH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (res.ok) {
        setSelected(null)
        setRefreshKey(k => k+1)
      }
    } catch {} finally { setActionLoading(null) }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-[#070f23]">

      {/* ── Top bar ──────────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 bg-white dark:bg-[#0a1520] border-b border-gray-100 dark:border-white/8 px-4 sm:px-6 pt-4 pb-0">

        {/* Row 1: title + action buttons */}
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="relative flex-1 max-w-sm">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search patient, doctor, service…"
              className="w-full pl-9 pr-4 py-2 text-sm bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all dark:text-white dark:placeholder-white/40"
            />
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setImportOpen(true)}
              className="hidden sm:flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-gray-600 dark:text-white/70 border border-gray-200 dark:border-white/10 rounded-xl hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
              <Upload size={14} /> Import
            </button>
            <button onClick={() => exportCSV(filtered)}
              className="hidden sm:flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-gray-600 dark:text-white/70 border border-gray-200 dark:border-white/10 rounded-xl hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
              <Download size={14} /> Export
            </button>
            <button onClick={() => setDrawerOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5 hover:shadow-lg"
              style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)', boxShadow: '0 4px 12px rgba(41,171,226,0.2)' }}>
              <Plus size={14} />
              <span className="hidden sm:inline">Book Appointment</span>
              <span className="sm:hidden">Book</span>
            </button>
          </div>
        </div>

        {/* Row 2: view tabs */}
        <div className="flex gap-0">
          {([
            { key: 'upcoming', label: 'Upcoming bookings' },
            { key: 'recent',   label: 'Recently added bookings' },
          ] as const).map(t => (
            <button key={t.key} onClick={() => setViewTab(t.key)}
              className={cn(
                'px-4 py-2.5 text-sm font-semibold border-b-2 transition-all -mb-px whitespace-nowrap',
                viewTab === t.key
                  ? 'border-cyan-500 text-cyan-600 dark:text-cyan-400'
                  : 'border-transparent text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300',
              )}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Table ─────────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 size={24} className="animate-spin text-cyan-500" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <CalendarDays size={40} className="text-gray-200 dark:text-white/10" />
            <p className="font-semibold text-gray-400 dark:text-white/40">No appointments found</p>
            <p className="text-sm text-gray-300 dark:text-white/20">
              {appts.length === 0 ? 'No appointments in this period' : 'Nothing matches your search'}
            </p>
          </div>
        ) : (
          <>
            {/* Mobile cards */}
            <div className="sm:hidden divide-y divide-gray-100 dark:divide-white/5">
              {filtered.map(appt => (
                <div key={appt.id} onClick={() => openDetail(appt)}
                  className="flex items-center gap-3 px-4 py-3.5 cursor-pointer hover:bg-white dark:hover:bg-white/5 transition-colors">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                    style={{ background: appt.service.colour || '#29ABE2' }}>
                    {appt.patient.firstName[0]}{appt.patient.lastName[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-gray-800 dark:text-white truncate">
                        {appt.patient.firstName} {appt.patient.lastName}
                      </p>
                      <span className={cn('text-[9px] font-black px-2 py-0.5 rounded-full flex-shrink-0',
                        STATUS_BADGE[appt.status]?.cls ?? 'bg-gray-100 text-gray-500')}>
                        {STATUS_BADGE[appt.status]?.label ?? appt.status}
                      </span>
                    </div>
                    <p className="text-xs text-cyan-600 dark:text-cyan-400 font-medium truncate">{appt.service.name}</p>
                    <p className="text-[11px] text-gray-400">
                      {fmtDate(appt.startAt)} · {fmtTime(appt.startAt)} – {fmtTime(appt.endAt)}
                    </p>
                  </div>
                  <ChevronRight size={14} className="text-gray-300 dark:text-white/20 flex-shrink-0" />
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden sm:block">
              <table className="w-full">
                <thead className="sticky top-0 z-10 bg-gray-50 dark:bg-[#0a1f3a]/95 backdrop-blur-sm">
                  <tr className="border-b border-gray-100 dark:border-white/8">
                    {['Date', 'Time', 'Service name', 'Patient', 'Status', ''].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-black text-gray-400 dark:text-white/30 uppercase tracking-wider whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                  {filtered.map(appt => (
                    <tr key={appt.id}
                      className="hover:bg-white dark:hover:bg-white/5 transition-colors cursor-pointer group"
                      onClick={() => openDetail(appt)}>

                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <span className="text-sm text-gray-700 dark:text-white/80 font-medium">
                          {fmtDate(appt.startAt)}
                        </span>
                      </td>

                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <span className="text-sm text-gray-600 dark:text-white/60 font-medium">
                          {fmtTime(appt.startAt)} – {fmtTime(appt.endAt)}
                        </span>
                      </td>

                      <td className="px-4 py-3.5">
                        <span className="text-sm font-medium text-cyan-600 dark:text-cyan-400">
                          {appt.service.name}
                        </span>
                        <span className="text-xs text-gray-400 dark:text-white/30 ml-2">
                          by {appt.doctor.user.firstName} {appt.doctor.user.lastName}
                        </span>
                      </td>

                      <td className="px-4 py-3.5">
                        <span className="text-sm font-semibold text-gray-800 dark:text-white uppercase tracking-wide">
                          {appt.patient.firstName} {appt.patient.lastName}
                        </span>
                      </td>

                      <td className="px-4 py-3.5">
                        <span className={cn(
                          'text-[11px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap',
                          STATUS_BADGE[appt.status]?.cls ?? 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/50',
                        )}>
                          {STATUS_BADGE[appt.status]?.label ?? appt.status}
                        </span>
                      </td>

                      <td className="px-4 py-3.5 text-right pr-5">
                        <span className="text-sm text-cyan-600 dark:text-cyan-400 font-semibold group-hover:underline whitespace-nowrap">
                          Details <ChevronRight size={13} className="inline -mt-0.5" />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Footer count */}
      {!loading && filtered.length > 0 && (
        <div className="flex-shrink-0 px-6 py-2.5 bg-white dark:bg-[#0a1520] border-t border-gray-100 dark:border-white/8">
          <p className="text-xs text-gray-400">
            Showing <strong className="text-gray-700 dark:text-white/70">{filtered.length}</strong> of{' '}
            <strong className="text-gray-700 dark:text-white/70">{appts.length}</strong> appointments
          </p>
        </div>
      )}

      {/* ── Detail modal (SimplyBook-style) ───────────────────────────────────── */}
      {selected && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setSelected(null)} />
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <div className="w-full max-w-lg bg-white dark:bg-[#0f1729] rounded-2xl shadow-2xl overflow-hidden border border-gray-100 dark:border-white/10 flex flex-col max-h-[90vh]">

              {/* Tab bar + close */}
              <div className="flex items-center border-b border-gray-100 dark:border-white/8">
                <button onClick={() => setDetailTab('booking')}
                  className={cn(
                    'flex-1 py-3 text-sm font-bold transition-colors',
                    detailTab === 'booking'
                      ? 'bg-gray-900 dark:bg-white/10 text-white rounded-tl-2xl'
                      : 'text-gray-400 dark:text-white/40 hover:bg-gray-50 dark:hover:bg-white/5 rounded-tl-2xl',
                  )}>
                  Booking
                </button>
                <button onClick={() => { setDetailTab('patient'); setEditMode(false) }}
                  className={cn(
                    'flex-1 py-3 text-sm font-bold transition-colors',
                    detailTab === 'patient'
                      ? 'bg-gray-900 dark:bg-white/10 text-white'
                      : 'text-gray-400 dark:text-white/40 hover:bg-gray-50 dark:hover:bg-white/5',
                  )}>
                  Patient
                </button>
                <button onClick={() => setSelected(null)}
                  className="w-12 h-12 flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-white transition-colors">
                  <X size={18} />
                </button>
              </div>

              {/* ── Booking tab ──────────────────────────────────────────────── */}
              {detailTab === 'booking' && !editMode && (
                <div className="flex flex-col flex-1 overflow-y-auto">
                  {/* Top content */}
                  <div className="p-5 flex gap-4">
                    {/* Left: date card + booking code */}
                    <div className="flex flex-col gap-2 flex-shrink-0 w-44">
                      <div className="rounded-xl overflow-hidden border border-cyan-200 dark:border-cyan-800/50">
                        <div className="bg-cyan-500 dark:bg-cyan-600 px-4 py-3 text-center">
                          <p className="text-white text-xl font-black leading-tight">
                            {fmtDate(selected.startAt)}
                          </p>
                          <p className="text-cyan-100 text-sm font-semibold mt-1">
                            {fmtTime(selected.startAt)} – {fmtTime(selected.endAt)}
                          </p>
                          <div className="flex items-center justify-center gap-1 mt-1">
                            <span className="text-[10px] text-cyan-100 font-medium">
                              ⏳ {durationStr(selected.startAt, selected.endAt)}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="bg-gray-800 dark:bg-gray-900 rounded-lg px-3 py-2 text-center">
                        <p className="text-gray-300 font-mono text-xs font-bold tracking-widest">
                          {bookingCode(selected.id)}
                        </p>
                      </div>
                      <p className="text-[11px] text-gray-400 dark:text-white/40 text-center flex items-center justify-center gap-1">
                        <span>📋</span> Created by user
                      </p>
                    </div>

                    {/* Right: details */}
                    <div className="flex-1 min-w-0 space-y-3">
                      <div>
                        <h2 className="text-lg font-bold text-gray-800 dark:text-white leading-tight">
                          {selected.service.name}
                        </h2>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500 dark:text-white/40">Booking status</span>
                        <span className={cn(
                          'text-[11px] font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1',
                          STATUS_BADGE[selected.status]?.cls ?? 'bg-gray-100 text-gray-500',
                        )}>
                          ✓ {STATUS_BADGE[selected.status]?.label ?? selected.status}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-gray-100 dark:bg-white/10 flex items-center justify-center text-xs text-gray-500 flex-shrink-0">
                          👤
                        </span>
                        <span className="text-sm text-gray-700 dark:text-white/80 font-medium">
                          {selected.doctor.user.firstName} {selected.doctor.user.lastName}
                        </span>
                        <button onClick={() => openEdit(selected)}
                          className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">
                          <Edit2 size={12} className="text-gray-400" />
                        </button>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-500 dark:text-white/40">💰</span>
                        <span className="text-sm font-semibold text-gray-700 dark:text-white/80">
                          {selected.service.priceUGX
                            ? formatUGX(selected.service.priceUGX)
                            : 'UGX 0.00'}
                        </span>
                      </div>

                      {selected.notes && (
                        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/30 rounded-lg px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                          {selected.notes}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="px-5 pb-5 pt-1 flex flex-wrap gap-2 border-t border-gray-50 dark:border-white/5">
                    {!['COMPLETED','CANCELLED','NO_SHOW'].includes(selected.status) && (
                      <>
                        {STATUS_NEXT[selected.status] && (
                          <button
                            onClick={() => changeStatus(STATUS_NEXT[selected.status].status)}
                            disabled={!!actionLoading}
                            className={cn('flex items-center gap-1.5 px-3 py-2 text-white text-xs font-bold rounded-xl transition-opacity disabled:opacity-60', STATUS_NEXT[selected.status].cls)}>
                            {actionLoading === STATUS_NEXT[selected.status].status
                              ? <Loader2 size={12} className="animate-spin" />
                              : <Check size={12} />}
                            {STATUS_NEXT[selected.status].label}
                          </button>
                        )}
                        <button onClick={() => changeStatus('NO_SHOW')} disabled={!!actionLoading}
                          className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 dark:bg-white/10 text-gray-700 dark:text-white/70 text-xs font-bold rounded-xl hover:bg-gray-200 dark:hover:bg-white/15 transition-colors disabled:opacity-60">
                          {actionLoading === 'NO_SHOW' ? <Loader2 size={12} className="animate-spin" /> : <AlertTriangle size={12} />}
                          No Show
                        </button>
                      </>
                    )}
                    <button onClick={() => changeStatus('CANCELLED')} disabled={!!actionLoading}
                      className="flex items-center gap-1.5 px-3 py-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-xs font-bold rounded-xl hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors disabled:opacity-60">
                      {actionLoading === 'CANCELLED' ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
                      Cancel booking
                    </button>
                    <button onClick={() => openEdit(selected)}
                      className="flex items-center gap-1.5 px-3 py-2 bg-cyan-500 text-white text-xs font-bold rounded-xl hover:bg-cyan-600 transition-colors">
                      <Edit2 size={12} /> Edit
                    </button>
                    <button onClick={() => { setSelected(null); setDrawerOpen(true) }}
                      className="flex items-center gap-1.5 px-3 py-2 bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-400 text-xs font-bold rounded-xl hover:bg-cyan-200 dark:hover:bg-cyan-900/40 transition-colors">
                      <Plus size={12} /> Book More
                    </button>
                    <Link href={`/patients/${selected.patient.id}`}
                      className="flex items-center gap-1.5 px-3 py-2 bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-400 text-xs font-bold rounded-xl hover:bg-cyan-200 dark:hover:bg-cyan-900/40 transition-colors">
                      History
                    </Link>
                  </div>
                </div>
              )}

              {/* ── Booking tab — edit mode ──────────────────────────────────── */}
              {detailTab === 'booking' && editMode && (
                <div className="p-5 space-y-4 overflow-y-auto">
                  <p className="text-xs font-bold text-gray-500 dark:text-white/40 uppercase tracking-wide flex items-center gap-1.5">
                    <CalendarDays size={12} /> Edit Appointment
                  </p>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-gray-500 block mb-1">Date</label>
                      <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)}
                        className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20" />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-500 block mb-1">Time</label>
                      <input type="time" value={editTime} onChange={e => setEditTime(e.target.value)}
                        className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20" />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-gray-500 block mb-1">Status</label>
                    <select value={editStatus} onChange={e => setEditStatus(e.target.value)}
                      className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20">
                      {EDIT_STATUSES.map(s => (
                        <option key={s} value={s} className="dark:bg-gray-800">
                          {STATUS_BADGE[s]?.label ?? s}
                        </option>
                      ))}
                    </select>
                  </div>

                  {doctors.length > 0 && (
                    <div>
                      <label className="text-xs font-semibold text-gray-500 block mb-1">Doctor</label>
                      <select value={editDoctorId} onChange={e => setEditDoctorId(e.target.value)}
                        className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20">
                        {doctors.map(d => (
                          <option key={d.id} value={d.id} className="dark:bg-gray-800">
                            {d.firstName} {d.lastName}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div>
                    <label className="text-xs font-semibold text-gray-500 block mb-1">Notes</label>
                    <textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} rows={2}
                      className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20 resize-none" />
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button onClick={saveEdit} disabled={saving}
                      className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-60 hover:-translate-y-0.5 transition-all"
                      style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
                      {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                      Save Changes
                    </button>
                    <button onClick={() => setEditMode(false)}
                      className="px-4 py-2.5 rounded-xl text-sm font-bold text-gray-600 dark:text-white/60 bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/15 transition-colors">
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* ── Patient tab ───────────────────────────────────────────────── */}
              {detailTab === 'patient' && (
                <div className="p-5 space-y-4">
                  <div className="flex items-center gap-4 p-4 bg-gray-50 dark:bg-white/5 rounded-xl">
                    <div className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
                      style={{ background: selected.service.colour || '#29ABE2' }}>
                      {selected.patient.firstName[0]}{selected.patient.lastName[0]}
                    </div>
                    <div>
                      <p className="font-bold text-gray-800 dark:text-white text-base">
                        {selected.patient.firstName} {selected.patient.lastName}
                      </p>
                      <a href={`tel:${selected.patient.phone}`}
                        className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-white/50 hover:text-cyan-500 transition-colors mt-0.5">
                        <Phone size={12} />
                        {formatPhone(selected.patient.phone)}
                      </a>
                      {selected.patient.email && (
                        <p className="text-sm text-gray-500 dark:text-white/50 mt-0.5">{selected.patient.email}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <Link href={`/patients/${selected.patient.id}`}
                      onClick={() => setSelected(null)}
                      className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5"
                      style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
                      View Full Profile
                    </Link>
                    <Link href={`/patients/${selected.patient.id}?tab=dental`}
                      onClick={() => setSelected(null)}
                      className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold border border-gray-200 dark:border-white/10 text-gray-600 dark:text-white/70 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                      View Dental Chart
                    </Link>
                  </div>
                </div>
              )}
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
              <div className="overflow-y-auto flex-1 p-5">
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
        onBooked={() => { setDrawerOpen(false); setRefreshKey(k => k+1) }}
      />
    </div>
  )
}
