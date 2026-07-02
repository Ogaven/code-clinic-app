'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { Clock, ChevronRight, RefreshCw, UserCheck, FileBarChart, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import Avatar from '@/components/ui/Avatar'

// ── Stage config — 5 stages ───────────────────────────────────────────────────
const STAGES = [
  {
    key: 'ARRIVED',
    label: 'Patient Arrived',
    statuses: ['ARRIVED', 'CHECKED_IN'],
    color: '#3B82F6',
    bg: 'bg-blue-50 dark:bg-blue-900/10',
    badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    next: 'WAITING',
    nextLabel: 'To Waiting',
  },
  {
    key: 'WAITING',
    label: 'In Waiting Room',
    statuses: ['WAITING'],
    color: '#F59E0B',
    bg: 'bg-amber-50 dark:bg-amber-900/10',
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    next: 'IN_CHAIR',
    nextLabel: 'To Session',
  },
  {
    key: 'IN_SESSION',
    label: 'In Session with Doctor',
    statuses: ['IN_OPERATORY', 'IN_CHAIR', 'WITH_PROVIDER'],
    color: '#14B8A6',
    bg: 'bg-teal-50 dark:bg-teal-900/10',
    badge: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
    next: 'READY_CHECKOUT',
    nextLabel: 'Ready for Checkout',
  },
  {
    key: 'CHECKOUT',
    label: 'Checkout & Billing',
    statuses: ['READY_CHECKOUT'],
    color: '#8B5CF6',
    bg: 'bg-purple-50 dark:bg-purple-900/10',
    badge: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
    next: 'COMPLETED',
    nextLabel: 'Complete',
  },
]

const ALL_ACTIVE_STATUSES = [
  'ARRIVED', 'CHECKED_IN', 'WAITING', 'IN_OPERATORY', 'IN_CHAIR', 'WITH_PROVIDER', 'READY_CHECKOUT', 'COMPLETED',
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
  arrivedAt?: string | null
  withProviderAt?: string | null
  departedAt?: string | null
  patient: { id: string; firstName: string; lastName: string }
  doctor: { user: { firstName: string; lastName: string } }
  service: { name: string; colour: string }
}

interface LivePatientFlowProps {
  doctorId?: string
  refreshInterval?: number
  patientBasePath?: string
  readOnly?: boolean
}

function fmt(dateStr?: string) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi' })
}

function minsDiff(a?: string, b?: string) {
  if (!a || !b) return '—'
  const m = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000)
  return m < 0 ? '—' : `${m}m`
}

interface ReportRow {
  patient: string
  service?: string
  doctor?: string
  arrived?: string
  withDoctor?: string
  departed?: string
  totalMins?: number
}

function DailyReport({ appointments, onClose }: { appointments: Appointment[]; onClose: () => void }) {
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Nairobi' })

  const rows: ReportRow[] = appointments.map(a => {
    const arrived    = a.arrivedAt    || a.startAt
    const withDoctor = a.withProviderAt || undefined
    const departed   = a.departedAt   || undefined
    const totalMins  = departed && arrived
      ? Math.round((new Date(departed).getTime() - new Date(arrived).getTime()) / 60000)
      : undefined
    return {
      patient:    `${a.patient.firstName} ${a.patient.lastName}`,
      service:    a.service.name,
      doctor:     `Dr. ${a.doctor.user.firstName} ${a.doctor.user.lastName}`,
      arrived,
      withDoctor,
      departed,
      totalMins,
    }
  })

  function downloadCSV() {
    const clinic  = 'Code Clinic, Kamwokya'
    const dateStr = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Nairobi' })
    const header  = `"${clinic}"\n"${dateStr}"\n\nPatient,Service,Doctor,Arrived,Waiting Room → With Doctor,Departed,Total Time\n`
    const body    = rows.map(r =>
      `"${r.patient}","${r.service || ''}","${r.doctor || ''}","${fmt(r.arrived)}","${fmt(r.withDoctor)}","${fmt(r.departed)}","${r.totalMins !== undefined ? r.totalMins + 'm' : '—'}"`
    ).join('\n')
    const avgLine = rows.length
      ? `\n\nAverage Total Time,${Math.round(rows.filter(r => r.totalMins !== undefined).reduce((s, r) => s + (r.totalMins ?? 0), 0) / (rows.filter(r => r.totalMins !== undefined).length || 1))}m`
      : ''
    const blob = new Blob([header + body + avgLine], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = `code-clinic-flow-${new Date().toISOString().slice(0,10)}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  const completedRows = rows.filter(r => r.totalMins !== undefined)
  const avgTotal = completedRows.length
    ? Math.round(completedRows.reduce((s, r) => s + (r.totalMins ?? 0), 0) / completedRows.length)
    : 0

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white dark:bg-[#0e2045] rounded-3xl shadow-2xl border border-gray-100 dark:border-white/10 w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-white/8 flex-shrink-0">
          <div>
            <h3 className="text-base font-bold text-gray-800 dark:text-white">Daily Patient Flow Report</h3>
            <p className="text-xs text-gray-400 mt-0.5">{today} · Code Clinic, Kamwokya</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={downloadCSV}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-white"
              style={{ background: 'linear-gradient(135deg,#0c1e50,#29ABE2)' }}>
              <FileBarChart size={13} /> Download CSV
            </button>
            <button onClick={onClose} className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-gray-100 dark:hover:bg-white/8">
              <X size={16} className="text-gray-400" />
            </button>
          </div>
        </div>

        <div className="overflow-auto flex-1">
          {rows.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-gray-400">No patients recorded today</p>
            </div>
          ) : (
            <table className="w-full text-sm min-w-[700px]">
              <thead className="sticky top-0">
                <tr className="border-b border-gray-100 dark:border-white/8 bg-gray-50 dark:bg-[#0a1a3a]">
                  <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 dark:text-white/40 uppercase tracking-wide whitespace-nowrap">Patient</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 dark:text-white/40 uppercase tracking-wide whitespace-nowrap">Service</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 dark:text-white/40 uppercase tracking-wide whitespace-nowrap">Doctor</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 dark:text-white/40 uppercase tracking-wide whitespace-nowrap">Arrived</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 dark:text-white/40 uppercase tracking-wide whitespace-nowrap">With Doctor</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 dark:text-white/40 uppercase tracking-wide whitespace-nowrap">Departed</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 dark:text-white/40 uppercase tracking-wide whitespace-nowrap">Total Time</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-gray-50 dark:border-white/5 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                    <td className="px-4 py-3 font-semibold text-gray-800 dark:text-white whitespace-nowrap">{r.patient}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-white/50 whitespace-nowrap">{r.service}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-white/50 whitespace-nowrap">{r.doctor}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-white/50 whitespace-nowrap font-mono text-xs">{fmt(r.arrived)}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-white/50 whitespace-nowrap font-mono text-xs">{fmt(r.withDoctor)}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-white/50 whitespace-nowrap font-mono text-xs">{fmt(r.departed)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {r.totalMins !== undefined ? (
                        <span className={cn('text-xs font-bold px-2 py-0.5 rounded-full', r.totalMins > 60 ? 'bg-red-100 text-red-600 dark:bg-red-900/20 dark:text-red-400' : r.totalMins > 30 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400' : 'bg-green-100 text-green-600 dark:bg-green-900/20 dark:text-green-400')}>
                          {r.totalMins}m
                        </span>
                      ) : <span className="text-gray-300 dark:text-white/20 text-xs">In progress</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {rows.length > 0 && (
          <div className="flex items-center gap-6 px-6 py-3 border-t border-gray-100 dark:border-white/8 bg-gray-50 dark:bg-white/5 text-xs text-gray-500 dark:text-white/40 flex-shrink-0">
            <span><strong className="text-gray-800 dark:text-white">{rows.length}</strong> patients</span>
            {completedRows.length > 0 && (
              <span>Avg total: <strong className={cn(avgTotal > 60 ? 'text-red-500' : avgTotal > 30 ? 'text-amber-500' : 'text-green-500')}>{avgTotal}m</strong></span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function LivePatientFlow({ doctorId, refreshInterval = 30000, patientBasePath = '/patients', readOnly = false }: LivePatientFlowProps) {
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading]           = useState(true)
  const [advancing, setAdvancing]       = useState<string | null>(null)
  const [tick, setTick]                 = useState(0)
  const [showReport, setShowReport]     = useState(false)
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
      if (newStatus === 'READY_CHECKOUT') {
        const appt = appointments.find(a => a.id === apptId)
        if (appt) {
          const patientName = `${appt.patient.firstName} ${appt.patient.lastName}`
          const doctorName  = `Dr. ${appt.doctor.user.firstName} ${appt.doctor.user.lastName}`
          fetch('/api-proxy/receptionist/notifications/broadcast', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: 'Patient Ready for Checkout',
              message: `${patientName} is ready for checkout (${doctorName})`,
              type: 'PATIENT_FLOW',
            }),
          }).catch(() => {})
        }
      }
      await fetchFlow()
    } finally { setAdvancing(null) }
  }

  const totalActive = appointments.length

  return (
    <>
    {showReport && <DailyReport appointments={appointments} onClose={() => setShowReport(false)} />}
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
          <button onClick={() => setShowReport(true)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-teal-700 bg-teal-50 dark:bg-teal-900/20 dark:text-teal-300 hover:bg-teal-100 transition-colors">
            <FileBarChart size={12} /> Daily Report
          </button>
          <button onClick={fetchFlow}
            className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* 5-stage columns — horizontally scrollable on mobile */}
      <div className="overflow-x-auto">
        <div className="grid min-w-[600px]" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
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
                        className="bg-white dark:bg-gray-800/60 rounded-xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
                        {/* Entire patient info area is clickable */}
                        <Link href={`${patientBasePath}/${appt.patient.id}`}
                          className="flex items-start gap-2 p-2.5 hover:bg-blue-50/40 dark:hover:bg-blue-900/10 transition-colors">
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
                              <Clock size={9} style={{ color: elColor }} />
                              <span className="text-[9px] font-bold tabular-nums" style={{ color: elColor }}>
                                {elText}
                              </span>
                            </div>
                          </div>
                        </Link>
                        {/* Advance button — hidden in readOnly mode */}
                        {stage.next && !readOnly && (
                          <div className="px-2.5 pb-2.5">
                            <button
                              onClick={() => advance(appt.id, stage.next)}
                              disabled={advancing === appt.id}
                              className="w-full flex items-center justify-center gap-0.5 py-1.5 rounded-lg text-[10px] font-bold text-white transition-all hover:opacity-90 disabled:opacity-50 min-h-[32px]"
                              style={{ background: stage.color }}>
                              {advancing === appt.id
                                ? '…'
                                : <><ChevronRight size={10} />{stage.nextLabel}</>
                              }
                            </button>
                          </div>
                        )}
                        {/* View Billing — shown for checkout stage in readOnly mode */}
                        {stage.key === 'CHECKOUT' && readOnly && (
                          <div className="px-2.5 pb-2.5">
                            <Link href="/accounts/live-checkout"
                              className="w-full flex items-center justify-center gap-0.5 py-1.5 rounded-lg text-[10px] font-bold text-white min-h-[32px] hover:opacity-90 transition-all"
                              style={{ background: '#8B5CF6' }}>
                              <ChevronRight size={10} /> View Billing
                            </Link>
                          </div>
                        )}
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
    </>
  )
}
