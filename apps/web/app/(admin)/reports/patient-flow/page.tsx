'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, Download, RefreshCw, Clock, Calendar } from 'lucide-react'
import { cn } from '@/lib/utils'

// Ordered stage labels for display
const STAGES = [
  { key: 'ARRIVED',          label: 'Arrived' },
  { key: 'WAITING',          label: 'Waiting' },
  { key: 'IN_OPERATORY',     label: 'Operatory' },
  { key: 'WITH_PROVIDER',    label: 'With Provider' },
  { key: 'SESSION_COMPLETE', label: 'Complete' },
  { key: 'CHECKOUT',         label: 'Checkout' },
  { key: 'DEPARTED',         label: 'Departed' },
  // legacy
  { key: 'CHECKED_IN',       label: 'Checked In' },
  { key: 'IN_CHAIR',         label: 'In Chair' },
  { key: 'READY_CHECKOUT',   label: 'Ready Checkout' },
  { key: 'COMPLETED',        label: 'Completed' },
]
const STAGE_KEYS = STAGES.map(s => s.key)

const STATUS_COLOR: Record<string, string> = {
  ARRIVED: 'bg-blue-100 text-blue-700', WAITING: 'bg-amber-100 text-amber-700',
  IN_OPERATORY: 'bg-orange-100 text-orange-700', WITH_PROVIDER: 'bg-teal-100 text-teal-700',
  SESSION_COMPLETE: 'bg-green-100 text-green-700', CHECKOUT: 'bg-purple-100 text-purple-700',
  DEPARTED: 'bg-gray-100 text-gray-600',
  CHECKED_IN: 'bg-yellow-100 text-yellow-700', IN_CHAIR: 'bg-orange-100 text-orange-700',
  READY_CHECKOUT: 'bg-purple-100 text-purple-700', COMPLETED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-red-100 text-red-600', NO_SHOW: 'bg-gray-100 text-gray-400',
}

function minsAgo(fromStr: string, toStr?: string) {
  const from = new Date(fromStr)
  const to   = toStr ? new Date(toStr) : new Date()
  return Math.floor((to.getTime() - from.getTime()) / 60000)
}

function fmtMins(m: number | null) {
  if (m === null) return '—'
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

function fmtTime(dateStr?: string | null) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleTimeString('en-UG', {
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi',
  })
}

interface PatientRow {
  patientId: string
  patientName: string
  doctorName: string
  serviceName: string
  status: string
  startAt: string
  updatedAt: string
  stageLog: { action: string; createdAt: string; userName: string }[]
  arrivedAt?: string
  departedAt?: string
  totalMins: number | null
}

export default function PatientFlowReportPage() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [rows, setRows] = useState<PatientRow[]>([])
  const [loading, setLoading] = useState(true)
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ startDate: date, endDate: date })
      const res = await fetch(`/api-proxy/scheduling/appointments?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return
      const appts: any[] = await res.json()

      // Fetch activity logs for each appointment's patient
      const processedRows: PatientRow[] = await Promise.all(
        appts
          .filter(a => !['PENDING', 'CONFIRMED'].includes(a.status))
          .map(async (a) => {
            let stageLog: any[] = []
            try {
              const actRes = await fetch(`/api-proxy/patients/${a.patient?.id}/activity`, {
                headers: { Authorization: `Bearer ${token}` },
              })
              if (actRes.ok) {
                const acts: any[] = await actRes.json()
                stageLog = acts
                  .filter(act => act.metadata && JSON.parse(act.metadata || '{}').appointmentId === a.id)
                  .sort((x, y) => new Date(x.createdAt).getTime() - new Date(y.createdAt).getTime())
              }
            } catch { }

            const arrivedAt = stageLog.find(s =>
              ['Patient Arrived', 'Checked In'].includes(s.action)
            )?.createdAt

            const departedAt = stageLog.find(s =>
              ['Patient Departed', 'Completed'].includes(s.action)
            )?.createdAt

            const totalMins = arrivedAt && departedAt ? minsAgo(arrivedAt, departedAt) : null

            return {
              patientId: a.patient?.id,
              patientName: `${a.patient?.firstName} ${a.patient?.lastName}`,
              doctorName: `Dr. ${a.doctor?.user?.firstName} ${a.doctor?.user?.lastName}`,
              serviceName: a.service?.name,
              status: a.status,
              startAt: a.startAt,
              updatedAt: a.updatedAt,
              stageLog,
              arrivedAt,
              departedAt,
              totalMins,
            }
          })
      )

      setRows(processedRows)
    } catch { } finally { setLoading(false) }
  }, [date, token])

  useEffect(() => { fetchData() }, [fetchData])

  function exportCSV() {
    const headers = ['Patient', 'Doctor', 'Service', 'Appt Time', 'Arrived', 'Departed', 'Total Time', 'Final Status']
    const csvRows = rows.map(r => [
      r.patientName, r.doctorName, r.serviceName,
      fmtTime(r.startAt), fmtTime(r.arrivedAt), fmtTime(r.departedAt),
      fmtMins(r.totalMins), r.status,
    ])
    const csv = [headers, ...csvRows].map(row => row.map(c => `"${c}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a'); a.href = url
    a.download = `patient-flow-${date}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-5 animate-fade-in p-6">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/dashboard" className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-white/10 transition-colors text-gray-400">
          <ArrowLeft size={16} />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-clinic-navy dark:text-white">Patient Flow Report</h1>
          <p className="text-sm text-gray-400 mt-0.5">Today&apos;s patient journey through all clinical stages</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2">
            <Calendar size={14} className="text-gray-400" />
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="text-sm bg-transparent text-gray-700 dark:text-gray-200 focus:outline-none"
            />
          </div>
          <button onClick={fetchData}
            className="p-2.5 rounded-xl border border-gray-200 dark:border-white/10 hover:bg-gray-100 dark:hover:bg-white/10 text-gray-500 dark:text-gray-400 transition-colors">
            <RefreshCw size={14} />
          </button>
          <button onClick={exportCSV}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm text-white transition-all hover:-translate-y-0.5 hover:shadow-md"
            style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
            <Download size={14} /> Export CSV
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total Patients', value: rows.length, color: '#29ABE2' },
          { label: 'Currently Active', value: rows.filter(r => !['DEPARTED','COMPLETED','CANCELLED','NO_SHOW'].includes(r.status)).length, color: '#F59E0B' },
          { label: 'Departed Today', value: rows.filter(r => ['DEPARTED','COMPLETED'].includes(r.status)).length, color: '#10B981' },
          { label: 'Avg Visit Time', value: (() => {
            const timed = rows.filter(r => r.totalMins !== null)
            if (!timed.length) return '—'
            const avg = Math.round(timed.reduce((s, r) => s + (r.totalMins || 0), 0) / timed.length)
            return fmtMins(avg)
          })(), color: '#8B5CF6' },
        ].map((s, i) => (
          <div key={i} className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 p-4 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400 mb-1">{s.label}</p>
            <p className="text-2xl font-black" style={{ color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 dark:bg-white/5 border-b border-gray-100 dark:border-white/10">
                {['Patient', 'Doctor', 'Service', 'Appt', 'Arrived', 'Departed', 'Total Time', 'Status'].map(h => (
                  <th key={h} className="text-left text-[10px] font-bold uppercase tracking-wide text-gray-400 px-4 py-3 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-white/5">
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-3 bg-gray-100 dark:bg-white/10 rounded animate-pulse w-20" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-gray-400 text-sm">
                    <Clock size={32} className="mx-auto mb-2 opacity-30" />
                    No active patients for {date}
                  </td>
                </tr>
              ) : rows.map((r, i) => (
                <tr key={i} className="hover:bg-blue-50/20 dark:hover:bg-white/5 transition-colors">
                  <td className="px-4 py-3">
                    <Link href={`/patients/${r.patientId}`} className="text-sm font-semibold text-gray-800 dark:text-white hover:text-clinic-blue transition-colors">
                      {r.patientName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{r.doctorName}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{r.serviceName}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{fmtTime(r.startAt)}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{fmtTime(r.arrivedAt)}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{fmtTime(r.departedAt)}</td>
                  <td className="px-4 py-3">
                    <span className={cn('text-xs font-bold', r.totalMins !== null ? 'text-teal-600' : 'text-gray-300')}>
                      {fmtMins(r.totalMins)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', STATUS_COLOR[r.status] || 'bg-gray-100 text-gray-500')}>
                      {r.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Stage journey legend */}
        {!loading && rows.length > 0 && (
          <div className="border-t border-gray-100 dark:border-white/10 px-4 py-3">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">Clinical Stage Flow</p>
            <div className="flex items-center gap-1 flex-wrap">
              {['Arrived', 'Waiting Room', 'In Operatory', 'With Provider', 'Session Complete', 'Checkout', 'Departed'].map((s, i, arr) => (
                <div key={s} className="flex items-center gap-1">
                  <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 dark:bg-white/10 px-2 py-0.5 rounded-full">{s}</span>
                  {i < arr.length - 1 && <span className="text-gray-300 text-[10px]">→</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
