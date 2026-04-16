'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { Clock, ChevronRight, RefreshCw, UserCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import Avatar from '@/components/ui/Avatar'

// ── Stage config — 5 stages ───────────────────────────────────────────────────
const STAGES = [
  {
    key: 'ARRIVED',
    label: 'Arrived',
    statuses: ['ARRIVED', 'CHECKED_IN'],
    color: '#3B82F6',
    bg: 'bg-blue-50 dark:bg-blue-900/10',
    badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    next: 'WAITING',
    nextLabel: 'To Waiting',
  },
  {
    key: 'WAITING',
    label: 'Waiting Room',
    statuses: ['WAITING'],
    color: '#F59E0B',
    bg: 'bg-amber-50 dark:bg-amber-900/10',
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    next: 'IN_OPERATORY',
    nextLabel: 'To Operatory',
  },
  {
    key: 'IN_OPERATORY',
    label: 'In Operatory',
    statuses: ['IN_OPERATORY', 'IN_CHAIR'],
    color: '#F97316',
    bg: 'bg-orange-50 dark:bg-orange-900/10',
    badge: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
    next: 'WITH_PROVIDER',
    nextLabel: 'With Provider',
  },
  {
    key: 'WITH_PROVIDER',
    label: 'With Provider',
    statuses: ['WITH_PROVIDER'],
    color: '#14B8A6',
    bg: 'bg-teal-50 dark:bg-teal-900/10',
    badge: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
    next: 'SESSION_COMPLETE',
    nextLabel: 'Complete',
  },
  {
    key: 'CHECKOUT',
    label: 'Checkout',
    statuses: ['SESSION_COMPLETE', 'CHECKOUT'],
    color: '#8B5CF6',
    bg: 'bg-purple-50 dark:bg-purple-900/10',
    badge: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
    next: 'DEPARTED',
    nextLabel: 'Departed',
  },
]

const ALL_ACTIVE_STATUSES = [
  'ARRIVED', 'CHECKED_IN', 'WAITING', 'IN_OPERATORY', 'IN_CHAIR', 'WITH_PROVIDER', 'SESSION_COMPLETE', 'CHECKOUT',
]

// Elapsed time since dateStr — returns text + color based on wait
function elapsed(dateStr: string): { text: string; color: string } {
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000)
  let text: string
  if (mins < 1)       text = 'just now'
  else if (mins < 60) text = `${mins}m`
  else                text = `${Math.floor(mins / 60)}h ${mins % 60}m`
  // Green < 15 min · Amber 15-30 min · Red > 30 min
  const color = mins < 15 ? '#10B981' : mins < 30 ? '#F59E0B' : '#EF4444'
  return { text, color }
}

interface Appointment {
  id: string
  status: string
  startAt: string
  updatedAt: string
  patient: { id: string; firstName: string; lastName: string }
  doctor: { user: { firstName: string; lastName: string } }
  service: { name: string; colour: string }
}

interface LivePatientFlowProps {
  doctorId?: string
  refreshInterval?: number
}

export default function LivePatientFlow({ doctorId, refreshInterval = 30000 }: LivePatientFlowProps) {
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading]           = useState(true)
  const [advancing, setAdvancing]       = useState<string | null>(null)
  const [tick, setTick]                 = useState(0)  // forces re-render every 30s for timer refresh
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null

  const fetchFlow = useCallback(async () => {
    try {
      const today = new Date().toISOString().slice(0, 10)
      const params = new URLSearchParams({ startDate: today, endDate: today })
      if (doctorId) params.set('doctorId', doctorId)
      const res = await fetch(`/api-proxy/scheduling/appointments?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return
      const data = await res.json()
      const active = (Array.isArray(data) ? data : []).filter((a: Appointment) =>
        ALL_ACTIVE_STATUSES.includes(a.status)
      )
      setAppointments(active)
    } catch { } finally { setLoading(false) }
  }, [token, doctorId])

  useEffect(() => {
    fetchFlow()
    const fetchT = setInterval(fetchFlow, refreshInterval)
    // Refresh timers every 60s without re-fetching
    const tickT = setInterval(() => setTick(t => t + 1), 60000)
    return () => { clearInterval(fetchT); clearInterval(tickT) }
  }, [fetchFlow, refreshInterval])

  async function advance(apptId: string, newStatus: string) {
    setAdvancing(apptId)
    try {
      await fetch(`/api-proxy/scheduling/appointments/${apptId}/status`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      await fetchFlow()
    } finally { setAdvancing(null) }
  }

  const totalActive = appointments.length

  return (
    <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/8 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-white/8">
        <div className="flex items-center gap-2">
          <UserCheck size={15} className="text-teal-500" />
          <h3 className="text-sm font-bold text-gray-800 dark:text-white">Live Patient Flow</h3>
          <span className="w-2 h-2 rounded-full bg-teal-400 animate-pulse" />
          {totalActive > 0 && (
            <span className="text-[10px] font-bold bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 px-1.5 py-0.5 rounded-full">
              {totalActive} active
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-gray-400 hidden sm:block">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1" />&lt;15m
            <span className="inline-block w-2 h-2 rounded-full bg-amber-500 mx-1 ml-2" />15-30m
            <span className="inline-block w-2 h-2 rounded-full bg-red-500 mx-1 ml-2" />&gt;30m
          </span>
          <button onClick={fetchFlow}
            className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* 5-stage columns — horizontally scrollable on mobile */}
      <div className="overflow-x-auto">
        <div className="grid min-w-[700px]" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
          {STAGES.map((stage, idx) => {
            const stageAppts = appointments.filter(a => stage.statuses.includes(a.status))
            return (
              <div key={stage.key}
                className={cn('p-3', stage.bg, idx > 0 && 'border-l border-gray-100 dark:border-white/8')}>
                {/* Column header */}
                <div className="flex items-center justify-between mb-2.5">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: stage.color }} />
                    <span className="text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wide truncate">
                      {stage.label}
                    </span>
                  </div>
                  <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0', stage.badge)}>
                    {stageAppts.length}
                  </span>
                </div>

                {/* Cards */}
                <div className="space-y-2 min-h-[60px]">
                  {loading && stageAppts.length === 0 && (
                    <div className="h-16 bg-white/60 dark:bg-white/5 rounded-xl animate-pulse" />
                  )}
                  {stageAppts.map((appt) => {
                    const { text: elText, color: elColor } = elapsed(appt.updatedAt)
                    return (
                      <div key={appt.id}
                        className="bg-white dark:bg-gray-800/60 rounded-xl border border-gray-100 dark:border-white/10 p-2.5 shadow-sm">
                        <div className="flex items-start gap-2">
                          <Avatar
                            firstName={appt.patient.firstName}
                            lastName={appt.patient.lastName}
                            colour={appt.service.colour}
                            size="sm"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold text-gray-900 dark:text-white truncate">
                              {appt.patient.firstName} {appt.patient.lastName}
                            </p>
                            <p className="text-[10px] text-gray-400 truncate">{appt.service.name}</p>
                            {/* Elapsed timer with color coding */}
                            <div className="flex items-center gap-1 mt-0.5">
                              <Clock size={9} style={{ color: elColor }} />
                              <span className="text-[9px] font-bold tabular-nums" style={{ color: elColor }}>
                                {elText}
                              </span>
                            </div>
                          </div>
                        </div>
                        {/* Action buttons */}
                        <div className="flex items-center gap-1.5 mt-2">
                          <Link href={`/patients/${appt.patient.id}`}
                            className="text-[9px] text-blue-500 hover:underline font-semibold flex-shrink-0">
                            Profile
                          </Link>
                          {stage.next && (
                            <button
                              onClick={() => advance(appt.id, stage.next)}
                              disabled={advancing === appt.id}
                              className="flex-1 flex items-center justify-center gap-0.5 py-1 rounded-lg text-[9px] font-bold text-white transition-all hover:opacity-90 disabled:opacity-50"
                              style={{ background: stage.color }}>
                              {advancing === appt.id
                                ? '…'
                                : <><ChevronRight size={9} />{stage.nextLabel}</>
                              }
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                  {!loading && stageAppts.length === 0 && (
                    <p className="text-[10px] text-gray-300 dark:text-gray-600 text-center py-4">Empty</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Timer legend — mobile only */}
      <div className="sm:hidden flex items-center gap-3 justify-center px-4 py-2 border-t border-gray-100 dark:border-white/8 text-[9px] text-gray-400">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> &lt;15m OK</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" /> 15-30m</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> &gt;30m</span>
      </div>
    </div>
  )
}
