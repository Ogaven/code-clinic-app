'use client'

import { useEffect, useState } from 'react'
import { X, Loader2, Calendar } from 'lucide-react'
import Avatar from '@/components/ui/Avatar'

// Read/view-only drill-down for an appointment-status count — reuses the
// existing GET /scheduling/appointments?startDate=&endDate=&status= endpoint
// (already real, already scoped server-side to the given date range and a
// single real AppointmentStatus value). No new backend route, no writes.
interface DrilldownAppt {
  id: string; startAt: string; status: string
  patient: { firstName: string; lastName: string; phone?: string }
  doctor?: { user?: { firstName: string; lastName: string } }
  service?: { name: string }
}

export default function StatusDrilldownModal({ label, status, color, startDate, endDate, onClose }: {
  label: string
  status: string
  color: string
  /** YYYY-MM-DD, inclusive — the exact period already resolved by the report/dashboard, not re-derived here */
  startDate: string
  endDate: string
  onClose: () => void
}) {
  const [rows, setRows] = useState<DrilldownAppt[] | null>(null)

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
    const qs = new URLSearchParams({ startDate, endDate, status })
    fetch(`/api-proxy/scheduling/appointments?${qs}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : [])
      .then(d => setRows(Array.isArray(d) ? d : (d?.appointments ?? [])))
      .catch(() => setRows([]))
  }, [status, startDate, endDate])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-[#111a35]" onClick={e => e.stopPropagation()}>
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-white/10">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide" style={{ color }}>{label}</p>
            <p className="text-sm text-gray-400 dark:text-slate-500">{rows ? `${rows.length} appointment${rows.length !== 1 ? 's' : ''}` : 'Loading…'}</p>
          </div>
          <button onClick={onClose} className="rounded-xl p-2 text-gray-400 transition-colors hover:bg-gray-100 dark:hover:bg-white/10">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {rows === null ? (
            <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-300" size={22} /></div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Calendar size={22} className="text-gray-200 dark:text-white/15" />
              <p className="text-sm text-gray-400 dark:text-slate-500">No appointments in this period</p>
            </div>
          ) : rows.map(a => (
            <div key={a.id} className="flex items-center gap-3 border-b border-gray-50 px-5 py-3 last:border-b-0 dark:border-white/5">
              <Avatar firstName={a.patient.firstName} lastName={a.patient.lastName} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-gray-800 dark:text-white">{a.patient.firstName} {a.patient.lastName}</p>
                <p className="truncate text-xs text-gray-400 dark:text-slate-500">
                  {a.service?.name ?? 'Service'}{a.doctor?.user ? ` · Dr. ${a.doctor.user.firstName} ${a.doctor.user.lastName}` : ''}{a.patient.phone ? ` · ${a.patient.phone}` : ''}
                </p>
              </div>
              <p className="flex-shrink-0 text-right text-xs font-medium text-gray-500 dark:text-slate-400">
                {new Date(a.startAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi' })}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
