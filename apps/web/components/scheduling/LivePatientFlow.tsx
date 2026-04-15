'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { Clock, ChevronRight, RefreshCw, UserCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import Avatar from '@/components/ui/Avatar'

// ── Stage config ──────────────────────────────────────────────────────────────
const STAGES = [
  {
    key: 'WAITING',
    label: 'Waiting Room',
    statuses: ['ARRIVED', 'WAITING', 'CHECKED_IN'],
    color: '#F59E0B',
    bg: 'bg-amber-50 dark:bg-amber-900/10',
    border: 'border-amber-200 dark:border-amber-700/30',
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    next: 'IN_OPERATORY' as const,
    nextLabel: 'Move to Operatory',
  },
  {
    key: 'IN_OPERATORY',
    label: 'In Operatory',
    statuses: ['IN_OPERATORY', 'IN_CHAIR'],
    color: '#3B82F6',
    bg: 'bg-blue-50 dark:bg-blue-900/10',
    border: 'border-blue-200 dark:border-blue-700/30',
    badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    next: 'WITH_PROVIDER' as const,
    nextLabel: 'With Provider',
  },
  {
    key: 'WITH_PROVIDER',
    label: 'With Provider',
    statuses: ['WITH_PROVIDER'],
    color: '#10B981',
    bg: 'bg-teal-50 dark:bg-teal-900/10',
    border: 'border-teal-200 dark:border-teal-700/30',
    badge: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
    next: 'SESSION_COMPLETE' as const,
    nextLabel: 'Session Complete',
  },
]

function timeSince(dateStr: string) {
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
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
  doctorId?: string  // if set, filter to this doctor only
  refreshInterval?: number
}

export default function LivePatientFlow({ doctorId, refreshInterval = 30000 }: LivePatientFlowProps) {
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [advancing, setAdvancing] = useState<string | null>(null)
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
        ['ARRIVED', 'WAITING', 'CHECKED_IN', 'IN_OPERATORY', 'IN_CHAIR', 'WITH_PROVIDER'].includes(a.status)
      )
      setAppointments(active)
    } catch { } finally { setLoading(false) }
  }, [token, doctorId])

  useEffect(() => {
    fetchFlow()
    const t = setInterval(fetchFlow, refreshInterval)
    return () => clearInterval(t)
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

  return (
    <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/8 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-white/8">
        <div className="flex items-center gap-2">
          <UserCheck size={15} className="text-teal-500" />
          <h3 className="text-sm font-bold text-gray-800 dark:text-white">Live Patient Flow</h3>
          <span className="w-2 h-2 rounded-full bg-teal-400 animate-pulse" />
        </div>
        <button onClick={fetchFlow} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">
          <RefreshCw size={13} />
        </button>
      </div>

      {/* Columns */}
      <div className="grid grid-cols-3 divide-x divide-gray-100 dark:divide-white/8">
        {STAGES.map((stage) => {
          const stageAppts = appointments.filter(a => stage.statuses.includes(a.status))
          return (
            <div key={stage.key} className={cn('p-3', stage.bg)}>
              {/* Column header */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ background: stage.color }} />
                  <span className="text-[11px] font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wide">
                    {stage.label}
                  </span>
                </div>
                <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full', stage.badge)}>
                  {stageAppts.length}
                </span>
              </div>

              {/* Cards */}
              <div className="space-y-2 min-h-[60px]">
                {loading && stageAppts.length === 0 && (
                  <div className="h-16 bg-white/60 dark:bg-white/5 rounded-xl animate-pulse" />
                )}
                {stageAppts.map((appt) => (
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
                        <div className="flex items-center gap-1 mt-0.5">
                          <Clock size={9} className="text-gray-300" />
                          <span className="text-[9px] text-gray-400">{timeSince(appt.updatedAt)}</span>
                        </div>
                        <p className="text-[9px] text-gray-400 mt-0.5 truncate">
                          Dr. {appt.doctor.user.firstName} {appt.doctor.user.lastName}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 mt-2">
                      <Link href={`/patients/${appt.patient.id}`}
                        className="text-[9px] text-blue-500 hover:underline font-semibold">
                        Profile
                      </Link>
                      <button
                        onClick={() => advance(appt.id, stage.next)}
                        disabled={advancing === appt.id}
                        className="flex-1 flex items-center justify-center gap-1 py-1 rounded-lg text-[10px] font-bold text-white transition-all hover:opacity-90 disabled:opacity-50"
                        style={{ background: stage.color }}>
                        {advancing === appt.id ? '...' : (
                          <><ChevronRight size={10} />{stage.nextLabel}</>
                        )}
                      </button>
                    </div>
                  </div>
                ))}
                {!loading && stageAppts.length === 0 && (
                  <p className="text-[10px] text-gray-300 dark:text-gray-600 text-center py-3">Empty</p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
