'use client'

import { useEffect, useState, useCallback } from 'react'
import { RefreshCw, MessageCircle, UserCheck, UserX, Phone, Clock } from 'lucide-react'

const STATUS_STYLES: Record<string, string> = {
  NONE:           'bg-gray-100 text-gray-500',
  CONTACT:        'bg-amber-100 text-amber-700',
  CONTACTED:      'bg-emerald-100 text-emerald-700',
  DO_NOT_CONTACT: 'bg-red-100 text-red-600',
}
const STATUS_LABELS: Record<string, string> = {
  NONE: 'No Status', CONTACT: 'Contact', CONTACTED: 'Contacted', DO_NOT_CONTACT: 'Do Not Contact',
}

export default function FollowupDashboardPage() {
  const [data, setData]       = useState<{ messages: any[]; notes: any[] } | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const token = localStorage.getItem('cc_token')
    try {
      const r = await fetch('/api-proxy/ai-suite/followup-report', { headers: { Authorization: `Bearer ${token}` } })
      setData(await r.json())
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const stats = {
    total:       data?.messages.length ?? 0,
    contact:     data?.notes.filter(n => n.followUpStatus === 'CONTACT').length ?? 0,
    contacted:   data?.notes.filter(n => n.followUpStatus === 'CONTACTED').length ?? 0,
    doNotContact: data?.notes.filter(n => n.followUpStatus === 'DO_NOT_CONTACT').length ?? 0,
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-900 dark:text-white">Follow-up Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">Post-appointment follow-up messages — last 30 days</p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-gray-100 dark:bg-white/10 text-gray-700 dark:text-white hover:bg-gray-200 dark:hover:bg-white/20 disabled:opacity-50 transition-all">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: MessageCircle, label: 'Messages Sent',  value: stats.total,        color: 'text-blue-600',    bg: 'bg-blue-50 dark:bg-blue-900/20' },
          { icon: Phone,         label: 'Need Contact',   value: stats.contact,      color: 'text-amber-600',   bg: 'bg-amber-50 dark:bg-amber-900/20' },
          { icon: UserCheck,     label: 'Contacted',      value: stats.contacted,    color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
          { icon: UserX,         label: 'Do Not Contact', value: stats.doNotContact, color: 'text-red-600',     bg: 'bg-red-50 dark:bg-red-900/20' },
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

      {/* Notes with follow-up statuses */}
      {data?.notes && data.notes.length > 0 && (
        <div>
          <h2 className="text-sm font-bold text-gray-700 dark:text-white mb-3">Notes with Follow-up Status</h2>
          <div className="space-y-2">
            {data.notes.map((n: any) => (
              <div key={n.id} className="bg-white dark:bg-white/5 border border-gray-100 dark:border-white/10 rounded-xl p-4 flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-gray-900 dark:text-white">
                      {n.patient?.firstName} {n.patient?.lastName}
                    </span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_STYLES[n.followUpStatus] || STATUS_STYLES.NONE}`}>
                      {STATUS_LABELS[n.followUpStatus] || 'No Status'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 line-clamp-2">{n.content}</p>
                  <p className="text-[10px] text-gray-400 mt-1">
                    {n.author?.firstName} {n.author?.lastName} · {new Date(n.updatedAt).toLocaleString('en-UG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent follow-up messages */}
      <div>
        <h2 className="text-sm font-bold text-gray-700 dark:text-white mb-3">Recent Follow-up Messages</h2>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : !data?.messages.length ? (
          <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 p-12 text-center">
            <MessageCircle size={36} className="text-gray-200 dark:text-white/10 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">No follow-up messages sent in the last 30 days</p>
          </div>
        ) : (
          <div className="space-y-2">
            {data.messages.map((m: any) => (
              <div key={m.id} className="bg-white dark:bg-white/5 border border-gray-100 dark:border-white/10 rounded-xl p-4 flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-gray-900 dark:text-white">
                      {m.patient?.firstName} {m.patient?.lastName}
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-50 text-cyan-600">
                      {m.templateType === 'MISSED_APPOINTMENT' ? 'Missed Appt' : 'Follow-up'}
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                      {m.channel}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 line-clamp-2">{m.content}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="flex items-center gap-1 text-[10px] text-gray-400">
                    <Clock size={10} />
                    {new Date(m.scheduledFor).toLocaleString('en-UG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </div>
                  <p className="text-[10px] text-gray-400 mt-0.5">{m.patient?.phone}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
