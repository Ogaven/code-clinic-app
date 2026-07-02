'use client'

import { useEffect, useState, useCallback } from 'react'
import { RefreshCw, CalendarCheck, CheckCircle, Clock, XCircle } from 'lucide-react'

const APPT_STATUS_STYLES: Record<string, string> = {
  SCHEDULED:  'bg-blue-100 text-blue-700',
  CONFIRMED:  'bg-emerald-100 text-emerald-700',
  COMPLETED:  'bg-gray-100 text-gray-500',
  CANCELLED:  'bg-red-100 text-red-600',
  NO_SHOW:    'bg-orange-100 text-orange-600',
}

export default function DoctorConfirmationDashboardPage() {
  const [data, setData]       = useState<{ confirmations: any[]; upcomingAppts: any[] } | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const token = localStorage.getItem('cc_token')
    try {
      const r = await fetch('/api-proxy/ai-suite/confirmation-report', { headers: { Authorization: `Bearer ${token}` } })
      setData(await r.json())
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const stats = {
    sent:      data?.confirmations.length ?? 0,
    confirmed: data?.upcomingAppts.filter(a => a.status === 'CONFIRMED').length ?? 0,
    scheduled: data?.upcomingAppts.filter(a => a.status === 'SCHEDULED').length ?? 0,
    cancelled: data?.upcomingAppts.filter(a => a.status === 'CANCELLED' || a.status === 'NO_SHOW').length ?? 0,
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-900 dark:text-white">Confirmation Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">Appointment confirmation messages — last 30 days</p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-gray-100 dark:bg-white/10 text-gray-700 dark:text-white hover:bg-gray-200 dark:hover:bg-white/20 disabled:opacity-50 transition-all">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: CalendarCheck, label: 'Confirmations Sent', value: stats.sent,      color: 'text-blue-600',    bg: 'bg-blue-50 dark:bg-blue-900/20' },
          { icon: CheckCircle,   label: 'Confirmed',          value: stats.confirmed, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
          { icon: Clock,         label: 'Still Scheduled',    value: stats.scheduled, color: 'text-amber-600',   bg: 'bg-amber-50 dark:bg-amber-900/20' },
          { icon: XCircle,       label: 'Cancelled/No-Show',  value: stats.cancelled, color: 'text-red-600',     bg: 'bg-red-50 dark:bg-red-900/20' },
        ].map(({ icon: Icon, label, value, color, bg }) => (
          <div key={label} className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 p-4 shadow-sm">
            <div className={`w-9 h-9 rounded-xl ${bg} flex items-center justify-center mb-3`}>
              <Icon size={16} className={color} />
            </div>
            <p className="text-2xl font-black text-gray-900 dark:text-white">{value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      <div>
        <h2 className="text-sm font-bold text-gray-700 dark:text-white mb-3">Appointments with Confirmation Sent</h2>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : !data?.upcomingAppts.length ? (
          <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 p-12 text-center">
            <CalendarCheck size={36} className="text-gray-200 dark:text-white/10 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">No confirmation messages sent in the last 30 days</p>
          </div>
        ) : (
          <div className="space-y-2">
            {data.upcomingAppts.map((a: any) => (
              <div key={a.id} className="bg-white dark:bg-white/5 border border-gray-100 dark:border-white/10 rounded-xl p-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-gray-900 dark:text-white">
                      {a.patient?.firstName} {a.patient?.lastName}
                    </span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${APPT_STATUS_STYLES[a.status] || 'bg-gray-100 text-gray-500'}`}>
                      {a.status}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500">
                    Dr {a.doctor?.user?.firstName} {a.doctor?.user?.lastName} · {a.service?.name}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                    {new Date(a.startAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {data?.confirmations && data.confirmations.length > 0 && (
        <div>
          <h2 className="text-sm font-bold text-gray-700 dark:text-white mb-3">Confirmation Messages Log</h2>
          <div className="space-y-2">
            {data.confirmations.map((m: any) => (
              <div key={m.id} className="bg-white dark:bg-white/5 border border-gray-100 dark:border-white/10 rounded-xl p-4 flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white mb-1">
                    {m.patient?.firstName} {m.patient?.lastName}
                  </p>
                  <p className="text-xs text-gray-500 line-clamp-2">{m.content}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-[10px] text-gray-400">
                    {new Date(m.scheduledFor).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{m.patient?.phone}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
