'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw, CalendarCheck, CheckCircle, Clock, XCircle, Rocket, ArrowRight, Loader2 } from 'lucide-react'

const APPT_STATUS_STYLES: Record<string, string> = {
  SCHEDULED:  'bg-blue-100 text-blue-700',
  CONFIRMED:  'bg-emerald-100 text-emerald-700',
  COMPLETED:  'bg-gray-100 text-gray-500',
  CANCELLED:  'bg-red-100 text-red-600',
  NO_SHOW:    'bg-orange-100 text-orange-600',
}

function isTomorrow(dateStr: string): boolean {
  const d        = new Date(dateStr)
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  return d.toDateString() === tomorrow.toDateString()
}

export default function ConfirmationDashboardPage() {
  const router = useRouter()
  const [data,       setData]       = useState<{ confirmations: any[]; upcomingAppts: any[] } | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [triggering, setTriggering] = useState(false)
  const [triggerMsg, setTriggerMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const token = localStorage.getItem('cc_token')
    try {
      const r = await fetch('/api-proxy/ai-suite/confirmation-report', { headers: { Authorization: `Bearer ${token}` } })
      setData(await r.json())
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function triggerConfirmations() {
    setTriggering(true)
    setTriggerMsg(null)
    const toSend = tomorrowWaiting
    const token  = localStorage.getItem('cc_token')
    try {
      const r = await fetch('/api-proxy/ai-suite/trigger/confirmations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!r.ok) throw new Error('Failed')
      setTriggerMsg({ type: 'success', text: `✅ Confirmations triggered — messages being sent to ${toSend} patient${toSend !== 1 ? 's' : ''} now` })
      setTimeout(load, 4000)
    } catch {
      setTriggerMsg({ type: 'error', text: '❌ Failed to trigger. Make sure you are logged in as Admin.' })
    } finally {
      setTriggering(false)
    }
  }

  const stats = {
    sent:      data?.confirmations.length ?? 0,
    confirmed: data?.upcomingAppts.filter(a => a.status === 'CONFIRMED').length ?? 0,
    scheduled: data?.upcomingAppts.filter(a => a.status === 'SCHEDULED').length ?? 0,
    cancelled: data?.upcomingAppts.filter(a => a.status === 'CANCELLED' || a.status === 'NO_SHOW').length ?? 0,
  }

  const tomorrowAppts     = (data?.upcomingAppts || []).filter(a => isTomorrow(a.startAt))
  const tomorrowConfirmed = tomorrowAppts.filter(a => a.status === 'CONFIRMED').length
  const tomorrowWaiting   = tomorrowAppts.filter(a => a.status === 'SCHEDULED').length
  const tomorrowDateStr   = new Date(Date.now() + 86400000).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  })

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

      {/* ── Morning Command Center ── */}
      <div className="bg-gradient-to-br from-cyan-50 to-blue-50 dark:from-cyan-900/20 dark:to-blue-900/20 rounded-2xl border border-cyan-100 dark:border-cyan-800/30 p-5 space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-base font-black text-gray-900 dark:text-white flex items-center gap-2">
              <Rocket size={18} className="text-cyan-500" /> Morning Command Center
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">Send WhatsApp confirmation messages to tomorrow&apos;s patients</p>
          </div>
          <button
            onClick={triggerConfirmations}
            disabled={triggering}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-60 hover:-translate-y-0.5 active:translate-y-0 flex-shrink-0 shadow-md"
            style={{ background: 'linear-gradient(135deg,#06b6d4,#1A237E)' }}>
            {triggering
              ? <><Loader2 size={16} className="animate-spin" /> Sending...</>
              : <>🚀 Send Confirmations Now</>}
          </button>
        </div>

        {/* Tomorrow summary */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white dark:bg-white/10 rounded-xl p-3 text-center border border-cyan-100 dark:border-white/10">
            <p className="text-2xl font-black text-gray-900 dark:text-white">{tomorrowAppts.length}</p>
            <p className="text-[10px] text-gray-500 mt-0.5 font-semibold">Appts Tomorrow</p>
            <p className="text-[9px] text-gray-400 mt-0.5 truncate">{tomorrowDateStr}</p>
          </div>
          <div className="bg-white dark:bg-white/10 rounded-xl p-3 text-center border border-emerald-100 dark:border-white/10">
            <p className="text-2xl font-black text-emerald-600">{tomorrowConfirmed}</p>
            <p className="text-[10px] text-gray-500 mt-0.5 font-semibold">Confirmed ✅</p>
          </div>
          <div className="bg-white dark:bg-white/10 rounded-xl p-3 text-center border border-amber-100 dark:border-white/10">
            <p className="text-2xl font-black text-amber-600">{tomorrowWaiting}</p>
            <p className="text-[10px] text-gray-500 mt-0.5 font-semibold">Awaiting Reply ⏳</p>
          </div>
        </div>

        {/* Result banner */}
        {triggerMsg && (
          <div className={`px-4 py-3 rounded-xl text-sm font-medium ${
            triggerMsg.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
              : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
          }`}>
            {triggerMsg.text}
          </div>
        )}
      </div>

      {/* Stat cards */}
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

      {/* Upcoming appointments with confirmation status */}
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
              <div key={a.id}
                onClick={() => a.patient?.phone && router.push(`/receptionist/ai-suite/inbox?phone=${encodeURIComponent(a.patient.phone)}`)}
                className="bg-white dark:bg-white/5 border border-gray-100 dark:border-white/10 rounded-xl p-4 flex items-center gap-4 cursor-pointer hover:border-cyan-200 dark:hover:border-cyan-700 transition-colors group">
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
                <div className="flex items-center gap-3 flex-shrink-0">
                  <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 text-right">
                    {new Date(a.startAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </p>
                  <span className="text-[11px] font-semibold text-cyan-500 group-hover:text-cyan-600 flex items-center gap-0.5 whitespace-nowrap">
                    View <ArrowRight size={11} />
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Confirmation messages log */}
      {data?.confirmations && data.confirmations.length > 0 && (
        <div>
          <h2 className="text-sm font-bold text-gray-700 dark:text-white mb-3">Confirmation Messages Log</h2>
          <div className="space-y-2">
            {data.confirmations.map((m: any) => (
              <div key={m.id}
                onClick={() => m.patient?.phone && router.push(`/receptionist/ai-suite/inbox?phone=${encodeURIComponent(m.patient.phone)}`)}
                className={`bg-white dark:bg-white/5 border border-gray-100 dark:border-white/10 rounded-xl p-4 flex items-start gap-4 transition-colors group ${m.patient?.phone ? 'cursor-pointer hover:border-cyan-200 dark:hover:border-cyan-700' : ''}`}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white mb-1">
                    {m.patient?.firstName} {m.patient?.lastName}
                  </p>
                  <p className="text-xs text-gray-500 line-clamp-2">{m.content}</p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <div className="text-right">
                    <p className="text-[10px] text-gray-400">
                      {new Date(m.scheduledFor).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{m.patient?.phone}</p>
                  </div>
                  {m.patient?.phone && (
                    <span className="text-[11px] font-semibold text-cyan-500 group-hover:text-cyan-600 flex items-center gap-0.5 whitespace-nowrap">
                      View <ArrowRight size={11} />
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
