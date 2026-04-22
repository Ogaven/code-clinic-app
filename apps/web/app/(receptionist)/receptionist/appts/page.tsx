'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  Search, Phone, RefreshCw, ChevronRight, Loader2,
  CalendarDays, CheckCircle2, XCircle, AlertTriangle,
  Clock, TrendingUp, ListChecks,
} from 'lucide-react'
import { cn, formatPhone } from '@/lib/utils'
import AppointmentModal from '@/components/scheduling/AppointmentModal'

// ─── Status config ─────────────────────────────────────────────
const STATUS_LABEL: Record<string, string> = {
  PENDING:        'Scheduled',
  CONFIRMED:      'Confirmed',
  CHECKED_IN:     'Checked In',
  IN_CHAIR:       'In Chair',
  WITH_PROVIDER:  'With Provider',
  READY_CHECKOUT: 'Ready Checkout',
  COMPLETED:      'Completed',
  NO_SHOW:        'No Show',
  CANCELLED:      'Cancelled',
}

const STATUS_STYLE: Record<string, string> = {
  PENDING:        'bg-slate-100 text-slate-600 dark:bg-slate-700/40 dark:text-slate-300',
  CONFIRMED:      'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  CHECKED_IN:     'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  IN_CHAIR:       'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  WITH_PROVIDER:  'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
  READY_CHECKOUT: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  COMPLETED:      'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  NO_SHOW:        'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300',
  CANCELLED:      'bg-gray-100 text-gray-400 dark:bg-gray-700/30 dark:text-gray-400',
}

// ─── Section definitions ────────────────────────────────────────
const SECTIONS = [
  {
    key: 'all',
    label: 'All Appointments',
    icon: ListChecks,
    color: '#29ABE2',
    filter: (_: string) => true,
  },
  {
    key: 'confirmed',
    label: 'Confirmed',
    icon: CheckCircle2,
    color: '#3B82F6',
    filter: (s: string) => s === 'CONFIRMED',
  },
  {
    key: 'inprogress',
    label: 'In Progress',
    icon: TrendingUp,
    color: '#0D9488',
    filter: (s: string) => ['CHECKED_IN', 'IN_CHAIR', 'WITH_PROVIDER', 'READY_CHECKOUT'].includes(s),
  },
  {
    key: 'rescheduled',
    label: 'Rescheduled',
    icon: Clock,
    color: '#8B5CF6',
    filter: (s: string) => s === 'PENDING',
  },
  {
    key: 'noshow',
    label: 'No Show',
    icon: AlertTriangle,
    color: '#EF4444',
    filter: (s: string) => s === 'NO_SHOW',
  },
  {
    key: 'cancelled',
    label: 'Cancelled',
    icon: XCircle,
    color: '#9CA3AF',
    filter: (s: string) => s === 'CANCELLED',
  },
] as const

type SectionKey = typeof SECTIONS[number]['key']

// ─── Appointment row ────────────────────────────────────────────
function ApptRow({ appt, onClick }: { appt: any; onClick: () => void }) {
  const t = new Date(appt.startAt).toLocaleTimeString('en-UG', {
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Kampala',
  })
  const d = new Date(appt.startAt).toLocaleDateString('en-UG', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Kampala',
  })
  return (
    <tr
      onClick={onClick}
      className="hover:bg-gray-50 dark:hover:bg-white/5 transition-colors cursor-pointer group"
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
            style={{ background: appt.service?.colour || '#29ABE2' }}
          >
            {appt.patient?.firstName?.[0]}{appt.patient?.lastName?.[0]}
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-800 dark:text-white leading-tight">
              {appt.patient?.firstName} {appt.patient?.lastName}
            </p>
            <a
              href={`tel:${appt.patient?.phone}`}
              onClick={e => e.stopPropagation()}
              className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-cyan-500 transition-colors"
            >
              <Phone size={10} /> {formatPhone(appt.patient?.phone)}
            </a>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <p className="text-sm font-mono font-semibold text-gray-700 dark:text-white/80">{t}</p>
        <p className="text-[11px] text-gray-400">{d}</p>
      </td>
      <td className="px-4 py-3 text-sm text-gray-600 dark:text-white/60">
        {appt.service?.name || '—'}
      </td>
      <td className="px-4 py-3 text-sm text-gray-600 dark:text-white/60">
        Dr. {appt.doctor?.user?.firstName} {appt.doctor?.user?.lastName}
      </td>
      <td className="px-4 py-3">
        <span className={cn('text-[10px] font-bold px-2.5 py-1 rounded-full', STATUS_STYLE[appt.status] || STATUS_STYLE.PENDING)}>
          {STATUS_LABEL[appt.status] || appt.status}
        </span>
      </td>
      <td className="px-4 py-3 text-right">
        <ChevronRight size={14} className="text-gray-300 dark:text-white/20 group-hover:text-cyan-500 transition-colors inline" />
      </td>
    </tr>
  )
}

// ─── Main page ──────────────────────────────────────────────────
export default function AppointmentsListPage() {
  const API   = '/api-proxy'
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const authH = { Authorization: `Bearer ${token}` }

  const [appts,       setAppts]       = useState<any[]>([])
  const [loading,     setLoading]     = useState(true)
  const [section,     setSection]     = useState<SectionKey>('all')
  const [search,      setSearch]      = useState('')
  const [selected,    setSelected]    = useState<any | null>(null)
  const [startDate,   setStartDate]   = useState(new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Kampala' }))
  const [endDate,     setEndDate]     = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 30)
    return d.toLocaleDateString('en-CA', { timeZone: 'Africa/Kampala' })
  })

  const fetchAppts = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API}/scheduling/appointments?startDate=${startDate}&endDate=${endDate}`, { headers: authH })
      if (res.ok) setAppts(await res.json())
    } catch {} finally { setLoading(false) }
  }, [startDate, endDate])

  useEffect(() => { fetchAppts() }, [fetchAppts])

  const sec    = SECTIONS.find(s => s.key === section)!
  const visible = appts
    .filter(a => sec.filter(a.status))
    .filter(a => {
      if (!search.trim()) return true
      const q = search.toLowerCase()
      return (
        `${a.patient?.firstName} ${a.patient?.lastName}`.toLowerCase().includes(q) ||
        a.patient?.phone?.includes(q) ||
        a.service?.name?.toLowerCase().includes(q) ||
        `${a.doctor?.user?.firstName} ${a.doctor?.user?.lastName}`.toLowerCase().includes(q)
      )
    })

  // Badge counts
  const counts = Object.fromEntries(SECTIONS.map(s => [s.key, appts.filter(a => s.filter(a.status)).length]))

  return (
    <div className="flex flex-col h-full">

      {/* ── Header ───────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-6 pt-5 pb-4 bg-white dark:bg-transparent border-b border-gray-100 dark:border-white/8">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div>
            <h1 className="text-xl font-black text-gray-800 dark:text-white flex items-center gap-2">
              <ListChecks size={20} className="text-cyan-500" />
              Appointments
            </h1>
            <p className="text-xs text-gray-400 mt-0.5">{appts.length} total in range</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="date" value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="text-xs border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 bg-white dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
            />
            <span className="text-xs text-gray-400">to</span>
            <input
              type="date" value={endDate}
              onChange={e => setEndDate(e.target.value)}
              className="text-xs border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 bg-white dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
            />
            <button onClick={fetchAppts}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-white transition-all hover:-translate-y-0.5"
              style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
              <RefreshCw size={12} /> Refresh
            </button>
            <Link href="/receptionist/appointments"
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-gray-200 dark:border-white/10 text-gray-600 dark:text-white/70 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
              <CalendarDays size={12} /> Calendar View
            </Link>
          </div>
        </div>

        {/* Section tabs */}
        <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
          {SECTIONS.map(s => {
            const Icon    = s.icon
            const active  = section === s.key
            const count   = counts[s.key] ?? 0
            return (
              <button
                key={s.key}
                onClick={() => setSection(s.key)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all flex-shrink-0',
                  active
                    ? 'text-white shadow-sm'
                    : 'bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-white/50 hover:bg-gray-200 dark:hover:bg-white/10',
                )}
                style={active ? { background: `linear-gradient(135deg, ${s.color}, ${s.color}cc)` } : {}}
              >
                <Icon size={12} />
                {s.label}
                {count > 0 && (
                  <span className={cn(
                    'text-[9px] font-black px-1.5 py-0.5 rounded-full min-w-[18px] text-center',
                    active ? 'bg-white/25 text-white' : 'bg-gray-200 dark:bg-white/10 text-gray-500 dark:text-white/50',
                  )}>
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Search ───────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-6 py-3 border-b border-gray-50 dark:border-white/5 bg-white dark:bg-transparent">
        <div className="relative max-w-sm">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search patient, doctor, service…"
            className="w-full pl-9 pr-4 py-2 text-sm bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all dark:text-white dark:placeholder-white/40"
          />
        </div>
      </div>

      {/* ── Table ────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={24} className="animate-spin text-cyan-500" />
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <sec.icon size={48} className="text-gray-200 dark:text-white/10 mb-3" style={{ color: sec.color, opacity: 0.2 }} />
            <p className="text-base font-bold text-gray-400 dark:text-white/30">No {sec.label.toLowerCase()} found</p>
            <p className="text-sm text-gray-300 dark:text-white/20 mt-1">Try adjusting the date range or search</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="sticky top-0 z-10 bg-gray-50 dark:bg-[#0a1f4a]/90 backdrop-blur-sm">
              <tr>
                {['Patient', 'Time', 'Service', 'Doctor', 'Status', ''].map(h => (
                  <th key={h} className="text-left px-4 py-2.5 text-[10px] font-black text-gray-400 dark:text-white/30 uppercase tracking-widest">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-white/5">
              {visible.map(appt => (
                <ApptRow key={appt.id} appt={appt} onClick={() => setSelected(appt)} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer count */}
      {!loading && visible.length > 0 && (
        <div className="flex-shrink-0 px-6 py-2.5 border-t border-gray-100 dark:border-white/8 bg-white dark:bg-transparent">
          <p className="text-xs text-gray-400">
            Showing <strong className="text-gray-700 dark:text-white/70">{visible.length}</strong> of <strong className="text-gray-700 dark:text-white/70">{appts.length}</strong> appointments
          </p>
        </div>
      )}

      {/* Appointment detail modal */}
      {selected && (
        <AppointmentModal
          appointment={selected}
          onClose={() => setSelected(null)}
          onStatusChange={() => { fetchAppts(); setSelected(null) }}
          userRole="RECEPTIONIST"
        />
      )}
    </div>
  )
}
