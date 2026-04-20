'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Clock, CheckCircle2, AlertTriangle, UserCheck, ChevronRight,
  RefreshCw, Phone, Calendar, ArrowRight, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const STATUS_ORDER = ['CONFIRMED','CHECKED_IN','IN_CHAIR','WITH_PROVIDER','READY_CHECKOUT','COMPLETED','CANCELLED','NO_SHOW']

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; dot: string; next?: string; nextLabel?: string }> = {
  CONFIRMED:      { label: 'Confirmed',      color: '#3B82F6', bg: 'bg-blue-50 dark:bg-blue-900/20',    dot: 'bg-blue-500',    next: 'CHECKED_IN',     nextLabel: 'Check In' },
  CHECKED_IN:     { label: 'Checked In',     color: '#F59E0B', bg: 'bg-amber-50 dark:bg-amber-900/20',  dot: 'bg-amber-400',   next: 'IN_CHAIR',       nextLabel: 'Seat Patient' },
  IN_CHAIR:       { label: 'In Chair',       color: '#F97316', bg: 'bg-orange-50 dark:bg-orange-900/20',dot: 'bg-orange-500',  next: 'WITH_PROVIDER',  nextLabel: 'With Provider' },
  WITH_PROVIDER:  { label: 'With Provider',  color: '#14B8A6', bg: 'bg-teal-50 dark:bg-teal-900/20',   dot: 'bg-teal-500',    next: 'READY_CHECKOUT', nextLabel: 'Ready Checkout' },
  READY_CHECKOUT: { label: 'Ready Checkout', color: '#A855F7', bg: 'bg-purple-50 dark:bg-purple-900/20',dot: 'bg-purple-500',  next: 'COMPLETED',      nextLabel: 'Check Out' },
  COMPLETED:      { label: 'Completed',      color: '#10B981', bg: 'bg-emerald-50 dark:bg-emerald-900/20',dot:'bg-emerald-500' },
  CANCELLED:      { label: 'Cancelled',      color: '#EF4444', bg: 'bg-red-50 dark:bg-red-900/20',      dot: 'bg-red-400' },
  NO_SHOW:        { label: 'No Show',        color: '#6B7280', bg: 'bg-gray-50 dark:bg-gray-900/20',    dot: 'bg-gray-400' },
  PENDING:        { label: 'Scheduled',      color: '#64748B', bg: 'bg-slate-50 dark:bg-slate-900/20',  dot: 'bg-slate-400',   next: 'CONFIRMED',      nextLabel: 'Confirm' },
}

const ACTIVE_STATUSES = ['CONFIRMED','CHECKED_IN','IN_CHAIR','WITH_PROVIDER','READY_CHECKOUT']
const DONE_STATUSES   = ['COMPLETED','CANCELLED','NO_SHOW']

function elapsed(startAt: string) {
  const diff = Date.now() - new Date(startAt).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 60) return `${m}m ago`
  return `${Math.floor(m / 60)}h ${m % 60}m ago`
}

function PatientCard({ appt, onAdvance, onCancel }: { appt: any; onAdvance: (id: string, status: string) => void; onCancel: (id: string) => void }) {
  const cfg = STATUS_CONFIG[appt.status] || STATUS_CONFIG.PENDING
  const time = new Date(appt.startAt).toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Kampala' })
  const isActive = ACTIVE_STATUSES.includes(appt.status)

  return (
    <div className={cn(
      'group bg-white dark:bg-white/5 rounded-2xl border shadow-sm hover:shadow-md transition-all',
      isActive ? 'border-l-4 border-gray-100 dark:border-white/10' : 'border-gray-100 dark:border-white/8',
    )} style={isActive ? { borderLeftColor: cfg.color } : {}}>
      <div className="p-4">
        {/* Top row */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
              style={{ background: appt.service?.colour || cfg.color }}>
              {appt.patient?.firstName?.[0]}{appt.patient?.lastName?.[0]}
            </div>
            <div>
              <p className="font-bold text-gray-800 dark:text-white text-sm">
                {appt.patient?.firstName} {appt.patient?.lastName}
              </p>
              <p className="text-xs text-gray-400 dark:text-white/40 truncate">
                {appt.service?.name} · Dr. {appt.doctor?.user?.firstName} {appt.doctor?.user?.lastName}
              </p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <span className="text-[10px] font-black px-2 py-0.5 rounded-full text-white" style={{ background: cfg.color }}>
              {time}
            </span>
            <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', cfg.bg)} style={{ color: cfg.color }}>
              {cfg.label}
            </span>
          </div>
        </div>

        {/* Contact + elapsed */}
        <div className="flex items-center gap-3 mb-3">
          {appt.patient?.phone && (
            <a href={`tel:${appt.patient.phone}`} className="flex items-center gap-1 text-xs text-gray-400 hover:text-cyan-500 transition-colors">
              <Phone size={11} /> {appt.patient.phone}
            </a>
          )}
          <span className="text-xs text-gray-300 dark:text-white/20">·</span>
          <span className="text-xs text-gray-400 flex items-center gap-1">
            <Clock size={11} /> {elapsed(appt.startAt)}
          </span>
        </div>

        {/* Action buttons */}
        {(cfg.next || appt.status === 'PENDING') && (
          <div className="flex items-center gap-2">
            {cfg.next && (
              <button
                onClick={() => onAdvance(appt.id, cfg.next!)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-black text-white transition-all hover:opacity-90 hover:-translate-y-0.5"
                style={{ background: `linear-gradient(135deg, ${cfg.color}, ${cfg.color}99)` }}>
                <ArrowRight size={12} />
                {cfg.nextLabel}
              </button>
            )}
            {ACTIVE_STATUSES.slice(0, 2).includes(appt.status) && (
              <button
                onClick={() => onCancel(appt.id)}
                className="px-3 py-2 rounded-xl text-xs font-bold bg-red-50 dark:bg-red-900/20 text-red-500 hover:bg-red-100 transition-colors">
                Cancel
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function LiveFlowPage() {
  const router   = useRouter()
  const API      = '/api-proxy'
  const [appts, setAppts]       = useState<any[]>([])
  const [loading, setLoading]   = useState(true)
  const [lastRefresh, setLast]  = useState(new Date())
  const [showDone, setShowDone] = useState(false)
  const [selectedDate, setDate] = useState(new Date().toISOString().slice(0,10))

  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const authH = { Authorization: `Bearer ${token}` }

  const fetchFlow = useCallback(async () => {
    try {
      const res = await fetch(`${API}/receptionist/today-appointments?date=${selectedDate}`, { headers: authH })
      if (res.ok) { setAppts(await res.json()); setLast(new Date()) }
    } catch {} finally { setLoading(false) }
  }, [selectedDate])

  useEffect(() => {
    fetchFlow()
    const t = setInterval(fetchFlow, 20000)
    return () => clearInterval(t)
  }, [fetchFlow])

  async function advance(apptId: string, status: string) {
    await fetch(`${API}/scheduling/appointments/${apptId}/status`, {
      method: 'PATCH',
      headers: { ...authH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    fetchFlow()
  }

  async function cancel(apptId: string) {
    await advance(apptId, 'CANCELLED')
  }

  const active = appts.filter(a => ACTIVE_STATUSES.includes(a.status))
    .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status))
  const pending = appts.filter(a => a.status === 'PENDING')
  const done    = appts.filter(a => DONE_STATUSES.includes(a.status))

  const stats = {
    total:    appts.length,
    active:   active.length,
    waiting:  appts.filter(a => ['CONFIRMED','CHECKED_IN'].includes(a.status)).length,
    done:     appts.filter(a => a.status === 'COMPLETED').length,
  }

  return (
    <div className="p-5 max-w-[1400px] mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-800 dark:text-white flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-500 animate-pulse" />
            Patient Live Flow
          </h1>
          <p className="text-xs text-gray-400 dark:text-white/40 mt-0.5">
            Last updated {lastRefresh.toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} · Auto-refreshes every 20s
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="date"
            value={selectedDate}
            onChange={e => setDate(e.target.value)}
            className="text-sm border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 bg-white dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
          />
          <button onClick={fetchFlow}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5"
            style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Today',  value: stats.total,   color: '#29ABE2', cls: 'stat-card-cyan'   },
          { label: 'Active Now',   value: stats.active,  color: '#F97316', cls: 'stat-card-orange' },
          { label: 'Waiting',      value: stats.waiting, color: '#3B82F6', cls: 'stat-card-purple' },
          { label: 'Completed',    value: stats.done,    color: '#10B981', cls: 'stat-card-green'  },
        ].map(s => (
          <div key={s.label} className={cn('dark-pop rounded-2xl p-4 border shadow-sm bg-white border-gray-100', s.cls)}>
            <p className="text-3xl font-black text-gray-800 dark:text-white">{s.value}</p>
            <p className="text-xs text-gray-400 dark:text-white/40 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Pipeline view */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-10 h-10 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-6">

          {/* Pipeline lanes */}
          {[
            { key: 'waiting',  label: 'Waiting Room',   statuses: ['CONFIRMED','CHECKED_IN'],  color: '#3B82F6' },
            { key: 'active',   label: 'In Clinic',      statuses: ['IN_CHAIR','WITH_PROVIDER'],color: '#F97316' },
            { key: 'checkout', label: 'Ready Checkout', statuses: ['READY_CHECKOUT'],           color: '#A855F7' },
          ].map(lane => {
            const patients = appts.filter(a => lane.statuses.includes(a.status))
            return (
              <div key={lane.key}>
                <div className="flex items-center gap-3 mb-3">
                  <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: lane.color }} />
                  <h2 className="text-sm font-black text-gray-700 dark:text-white/80 uppercase tracking-widest">{lane.label}</h2>
                  <span className="ml-1 text-xs font-bold px-2 py-0.5 rounded-full text-white" style={{ background: lane.color }}>
                    {patients.length}
                  </span>
                  <div className="flex-1 h-px bg-gray-100 dark:bg-white/5" />
                </div>

                {patients.length === 0 ? (
                  <p className="text-xs text-gray-300 dark:text-white/20 pl-6">No patients in this stage</p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {patients.map(a => (
                      <PatientCard key={a.id} appt={a} onAdvance={advance} onCancel={cancel} />
                    ))}
                  </div>
                )}
              </div>
            )
          })}

          {/* Pending (scheduled, not yet checked in) */}
          {pending.length > 0 && (
            <div>
              <div className="flex items-center gap-3 mb-3">
                <span className="w-3 h-3 rounded-full bg-slate-400 flex-shrink-0" />
                <h2 className="text-sm font-black text-gray-700 dark:text-white/80 uppercase tracking-widest">Scheduled</h2>
                <span className="ml-1 text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{pending.length}</span>
                <div className="flex-1 h-px bg-gray-100 dark:bg-white/5" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {pending.map(a => <PatientCard key={a.id} appt={a} onAdvance={advance} onCancel={cancel} />)}
              </div>
            </div>
          )}

          {/* Done (collapsed by default) */}
          {done.length > 0 && (
            <div>
              <button onClick={() => setShowDone(s => !s)}
                className="flex items-center gap-3 mb-3 w-full text-left group">
                <span className="w-3 h-3 rounded-full bg-gray-300 flex-shrink-0" />
                <h2 className="text-sm font-black text-gray-500 dark:text-white/40 uppercase tracking-widest group-hover:text-gray-700 dark:group-hover:text-white/70 transition-colors">
                  {showDone ? 'Hide' : 'Show'} Completed & Cancelled
                </h2>
                <span className="ml-1 text-xs font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{done.length}</span>
                <div className="flex-1 h-px bg-gray-100 dark:bg-white/5" />
                <ChevronRight size={14} className={cn('text-gray-400 transition-transform', showDone && 'rotate-90')} />
              </button>
              {showDone && (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {done.map(a => <PatientCard key={a.id} appt={a} onAdvance={advance} onCancel={cancel} />)}
                </div>
              )}
            </div>
          )}

          {appts.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Calendar size={48} className="text-gray-200 dark:text-white/10 mb-4" />
              <p className="text-lg font-bold text-gray-400 dark:text-white/30">No appointments for this date</p>
              <p className="text-sm text-gray-300 dark:text-white/20">Select a different date or book appointments</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
