'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Clock, CheckCircle2, RefreshCw, Phone, Calendar,
  ArrowRight, X, ChevronDown, ChevronUp, UserCheck,
  DoorOpen, Sofa, Stethoscope, CreditCard, Plane,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Stage definitions ─────────────────────────────────────────
const STAGES = [
  {
    key: 'arrived',
    label: 'Patient Arrived',
    icon: DoorOpen,
    statuses: ['PENDING'],
    color: '#64748B',
    gradient: 'from-slate-500 to-slate-600',
    bg: 'bg-slate-50 dark:bg-slate-900/20',
    border: 'border-slate-200 dark:border-slate-700/30',
    ring: 'ring-slate-300 dark:ring-slate-700',
    nextStatus: 'CONFIRMED',
    nextLabel: 'Move to Waiting Room',
    nextColor: '#3B82F6',
  },
  {
    key: 'waiting',
    label: 'In Waiting Room',
    icon: Sofa,
    statuses: ['CONFIRMED', 'CHECKED_IN'],
    color: '#3B82F6',
    gradient: 'from-blue-500 to-blue-600',
    bg: 'bg-blue-50 dark:bg-blue-900/20',
    border: 'border-blue-200 dark:border-blue-700/30',
    ring: 'ring-blue-300 dark:ring-blue-700',
    nextStatus: 'IN_CHAIR',
    nextLabel: 'Send to Doctor',
    nextColor: '#0D9488',
  },
  {
    key: 'session',
    label: 'In Session with Doctor',
    icon: Stethoscope,
    statuses: ['IN_CHAIR', 'WITH_PROVIDER'],
    color: '#0D9488',
    gradient: 'from-teal-500 to-teal-600',
    bg: 'bg-teal-50 dark:bg-teal-900/20',
    border: 'border-teal-200 dark:border-teal-700/30',
    ring: 'ring-teal-300 dark:ring-teal-700',
    nextStatus: 'READY_CHECKOUT',
    nextLabel: 'Send to Billing',
    nextColor: '#9333EA',
  },
  {
    key: 'billing',
    label: 'Checkout & Billing',
    icon: CreditCard,
    statuses: ['READY_CHECKOUT'],
    color: '#9333EA',
    gradient: 'from-purple-500 to-purple-600',
    bg: 'bg-purple-50 dark:bg-purple-900/20',
    border: 'border-purple-200 dark:border-purple-700/30',
    ring: 'ring-purple-300 dark:ring-purple-700',
    nextStatus: 'COMPLETED',
    nextLabel: 'Mark Departed',
    nextColor: '#10B981',
  },
  {
    key: 'departed',
    label: 'Patient Departed',
    icon: Plane,
    statuses: ['COMPLETED'],
    color: '#10B981',
    gradient: 'from-emerald-500 to-emerald-600',
    bg: 'bg-emerald-50 dark:bg-emerald-900/20',
    border: 'border-emerald-200 dark:border-emerald-700/30',
    ring: 'ring-emerald-300 dark:ring-emerald-700',
    nextStatus: null,
    nextLabel: null,
    nextColor: null,
  },
] as const

function elapsed(startAt: string): { label: string; mins: number } {
  const diff = Date.now() - new Date(startAt).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return { label: 'Just now', mins: 0 }
  if (m < 60) return { label: `${m}m`, mins: m }
  return { label: `${Math.floor(m / 60)}h ${m % 60}m`, mins: m }
}

function waitClass(mins: number) {
  if (mins < 20) return { bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-700 dark:text-emerald-400' }
  if (mins < 45) return { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-400' }
  return { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-400' }
}

// ── Patient Card ──────────────────────────────────────────────
function PatientCard({
  appt, stageColor, nextStatus, nextLabel, nextColor,
  onAdvance, onCancel,
}: {
  appt: any
  stageColor: string
  nextStatus: string | null
  nextLabel: string | null
  nextColor: string | null
  onAdvance: (id: string, status: string) => void
  onCancel: (id: string) => void
}) {
  const time = new Date(appt.startAt).toLocaleTimeString('en-UG', {
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi',
  })
  const wait     = elapsed(appt.startAt)
  const wc       = waitClass(wait.mins)
  const initials = `${appt.patient?.firstName?.[0] || ''}${appt.patient?.lastName?.[0] || ''}`
  const service  = appt.service?.name || 'Appointment'
  const doctor   = `Dr. ${appt.doctor?.user?.firstName || ''} ${appt.doctor?.user?.lastName || ''}`.trim()

  return (
    <div className={cn(
      'group relative bg-white dark:bg-[#0d1f45] rounded-2xl border shadow-sm',
      'hover:shadow-lg hover:-translate-y-0.5 transition-all cursor-default',
      'border-gray-100 dark:border-white/10',
      'border-l-4',
    )}
    style={{ borderLeftColor: stageColor }}>
      <div className="p-4">
        {/* Patient info row */}
        <div className="flex items-start gap-3 mb-3">
          {appt.patient?.avatarUrl ? (
            <img src={appt.patient.avatarUrl} alt="" loading="lazy" width={36} height={36}
              className="w-9 h-9 rounded-xl object-cover flex-shrink-0 ring-2 ring-white dark:ring-white/10 shadow-sm" />
          ) : (
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-black text-[13px] flex-shrink-0 shadow-sm"
              style={{ background: appt.service?.colour || stageColor }}>
              {initials}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-gray-800 dark:text-white text-[13px] leading-snug" style={{ wordBreak: 'break-word' }}>
              {appt.patient?.firstName} {appt.patient?.lastName}
            </p>
            <p className="text-[12px] text-gray-500 dark:text-white/50 truncate mt-0.5">{service}</p>
            <p className="text-[12px] font-semibold truncate" style={{ color: stageColor }}>{doctor}</p>
          </div>
          {/* Time + duration badge */}
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <span className="text-[10px] font-black px-2 py-0.5 rounded-full text-white"
              style={{ background: stageColor }}>
              {time}
            </span>
            <span className={cn('text-[11px] font-black px-2 py-0.5 rounded-full flex items-center gap-0.5', wc.bg, wc.text)}>
              <Clock size={9} /> {wait.label}
            </span>
          </div>
        </div>

        {/* Contact row */}
        {appt.patient?.phone && (
          <a href={`tel:${appt.patient.phone}`}
            className="flex items-center gap-1.5 mb-3 text-xs text-gray-400 dark:text-white/40 hover:text-cyan-500 dark:hover:text-cyan-400 transition-colors w-fit">
            <Phone size={11} />
            {appt.patient.phone}
          </a>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          {nextStatus && nextLabel && nextColor && (
            <button
              onClick={() => onAdvance(appt.id, nextStatus)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-black text-white transition-all hover:opacity-90 hover:shadow-md hover:-translate-y-0.5"
              style={{ background: `linear-gradient(135deg, ${nextColor}, ${nextColor}cc)`, boxShadow: `0 4px 12px ${nextColor}40` }}>
              <ArrowRight size={12} />
              {nextLabel}
            </button>
          )}
          {['PENDING', 'CONFIRMED', 'CHECKED_IN'].includes(appt.status) && (
            <button
              onClick={() => onCancel(appt.id)}
              className="px-3 py-2.5 rounded-xl text-xs font-bold bg-red-50 dark:bg-red-900/20 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors flex-shrink-0">
              <X size={12} />
            </button>
          )}
          {!nextStatus && (
            <div className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 size={12} /> Visit Complete
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Stage Lane ────────────────────────────────────────────────
function StageLane({
  stage, patients, onAdvance, onCancel,
}: {
  stage: typeof STAGES[number]
  patients: any[]
  onAdvance: (id: string, status: string) => void
  onCancel: (id: string) => void
}) {
  const [collapsed, setCollapsed] = useState(stage.key === 'departed')
  const Icon = stage.icon
  const isEmpty = patients.length === 0

  return (
    <div className={cn('rounded-2xl border overflow-hidden', stage.border, isEmpty && 'opacity-60')}>
      {/* Stage header */}
      <button
        onClick={() => setCollapsed(c => !c)}
        className={cn(
          'w-full flex items-center gap-3 px-5 py-4 transition-colors',
          stage.bg,
          'hover:opacity-90',
        )}>
        {/* Icon circle */}
        <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white flex-shrink-0 shadow-sm"
          style={{ background: `linear-gradient(135deg, ${stage.color}, ${stage.color}cc)` }}>
          <Icon size={18} />
        </div>

        {/* Labels */}
        <div className="flex-1 text-left">
          <p className="text-sm font-black" style={{ color: stage.color }}>{stage.label}</p>
          <p className="text-xs text-gray-500 dark:text-white/40">
            {patients.length === 0 ? 'No patients' : (() => {
              const avg = Math.round(patients.reduce((sum, a) => sum + elapsed(a.startAt).mins, 0) / patients.length)
              return `${patients.length} patient${patients.length > 1 ? 's' : ''} · avg ${avg < 1 ? '<1' : avg}m`
            })()}
          </p>
        </div>

        {/* Count badge */}
        {patients.length > 0 && (
          <span className="text-sm font-black w-8 h-8 rounded-full flex items-center justify-center text-white flex-shrink-0 shadow-sm"
            style={{ background: stage.color }}>
            {patients.length}
          </span>
        )}

        {/* Collapse toggle */}
        <div className="ml-1 text-gray-400 dark:text-white/30 flex-shrink-0">
          {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </div>
      </button>

      {/* Cards grid */}
      {!collapsed && (
        <div className={cn('p-4', stage.bg)}>
          {patients.length === 0 ? (
            <p className="text-xs text-center text-gray-400 dark:text-white/30 py-4">
              No patients in this stage right now
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {patients.map(appt => (
                <PatientCard
                  key={appt.id}
                  appt={appt}
                  stageColor={stage.color}
                  nextStatus={stage.nextStatus ?? null}
                  nextLabel={stage.nextLabel ?? null}
                  nextColor={stage.nextColor ?? null}
                  onAdvance={onAdvance}
                  onCancel={onCancel}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Pipeline connector ────────────────────────────────────────
function Connector({ from, to }: { from: string; to: string }) {
  return (
    <div className="flex items-center justify-center gap-2 px-4 py-1">
      <div className="h-px flex-1 bg-gray-200 dark:bg-white/10" />
      <div className="flex items-center gap-1.5 text-[10px] font-black text-gray-300 dark:text-white/20 uppercase tracking-widest">
        <ArrowRight size={12} />
      </div>
      <div className="h-px flex-1 bg-gray-200 dark:bg-white/10" />
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────
export default function LiveFlowPage() {
  const API = '/api-proxy'
  const [appts, setAppts]       = useState<any[]>([])
  const [loading, setLoading]   = useState(true)
  const [lastRefresh, setLast]  = useState(new Date())
  const [selectedDate, setDate] = useState(new Date().toISOString().slice(0, 10))

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

  async function cancel(apptId: string) { await advance(apptId, 'CANCELLED') }

  const stats = {
    total:     appts.length,
    active:    appts.filter(a => ['CHECKED_IN','IN_CHAIR','WITH_PROVIDER'].includes(a.status)).length,
    waiting:   appts.filter(a => ['CONFIRMED','CHECKED_IN'].includes(a.status)).length,
    completed: appts.filter(a => a.status === 'COMPLETED').length,
  }

  return (
    <div className="p-5 max-w-[1400px] mx-auto space-y-4 overflow-x-hidden">

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black text-gray-800 dark:text-white flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-500 animate-pulse" />
            Patient Live Flow
          </h1>
          <p className="text-xs text-gray-400 dark:text-white/40 mt-0.5">
            Auto-refreshes every 20s · Last updated {lastRefresh.toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={selectedDate}
            onChange={e => setDate(e.target.value)}
            className="text-sm border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 bg-white dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
          />
          <button onClick={fetchFlow}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5"
            style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)', boxShadow: '0 4px 12px rgba(41,171,226,0.3)' }}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {/* ── Stats strip ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Today',  value: stats.total,     color: '#29ABE2', icon: Calendar },
          { label: 'Active Now',   value: stats.active,    color: '#F97316', icon: UserCheck },
          { label: 'Waiting',      value: stats.waiting,   color: '#3B82F6', icon: Sofa },
          { label: 'Departed',     value: stats.completed, color: '#10B981', icon: Plane },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/8 p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center"
                style={{ background: `${color}20` }}>
                <Icon size={15} style={{ color }} />
              </div>
            </div>
            <p className="text-3xl font-black text-gray-800 dark:text-white">{value}</p>
            <p className="text-xs text-gray-400 dark:text-white/40 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* ── Pipeline ────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-10 h-10 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : appts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Calendar size={48} className="text-gray-200 dark:text-white/10 mb-4" />
          <p className="text-lg font-bold text-gray-400 dark:text-white/30">No appointments for this date</p>
          <p className="text-sm text-gray-300 dark:text-white/20">Select a different date or book appointments</p>
        </div>
      ) : (
        <div className="space-y-2">
          {STAGES.map((stage, i) => {
            const patients = appts.filter(a => (stage.statuses as readonly string[]).includes(a.status))
              .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())

            return (
              <div key={stage.key}>
                <StageLane
                  stage={stage}
                  patients={patients}
                  onAdvance={advance}
                  onCancel={cancel}
                />
                {i < STAGES.length - 1 && (
                  <Connector from={stage.label} to={STAGES[i + 1].label} />
                )}
              </div>
            )
          })}

          {/* Cancelled / No Shows */}
          {appts.filter(a => ['CANCELLED', 'CANCELLED_RESCHEDULED', 'NO_SHOW'].includes(a.status)).length > 0 && (() => {
            const cancelled = appts.filter(a => ['CANCELLED', 'CANCELLED_RESCHEDULED', 'NO_SHOW'].includes(a.status))
            return (
              <div className="mt-4">
                <div className="flex items-center gap-3 px-2 mb-2">
                  <div className="h-px flex-1 bg-gray-100 dark:bg-white/5" />
                  <span className="text-[10px] font-black text-gray-300 dark:text-white/20 uppercase tracking-widest">
                    Cancelled / No Show ({cancelled.length})
                  </span>
                  <div className="h-px flex-1 bg-gray-100 dark:bg-white/5" />
                </div>
                <div className="flex flex-col gap-2 opacity-50">
                  {cancelled.map(appt => {
                    const time = new Date(appt.startAt).toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi' })
                    return (
                      <div key={appt.id} className="bg-gray-50 dark:bg-white/3 rounded-xl border border-gray-100 dark:border-white/5 p-3 flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-xs font-bold flex-shrink-0 bg-gray-300 dark:bg-white/20">
                          {appt.patient?.firstName?.[0]}{appt.patient?.lastName?.[0]}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-gray-500 dark:text-white/40 truncate">{appt.patient?.firstName} {appt.patient?.lastName}</p>
                          <p className="text-[10px] text-gray-400">{time} · {appt.status === 'CANCELLED' ? 'Cancelled' : appt.status === 'CANCELLED_RESCHEDULED' ? 'Cancelled & Rescheduled' : 'No Show'}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}
