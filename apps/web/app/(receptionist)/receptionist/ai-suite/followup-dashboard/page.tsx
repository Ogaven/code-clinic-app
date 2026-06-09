'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw, MessageCircle, UserCheck, UserX, Phone, Clock, Bot, Send, X, Loader2, ArrowRight } from 'lucide-react'

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
  const router = useRouter()
  const [data,       setData]       = useState<{ messages: any[]; notes: any[] } | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [askOpen,    setAskOpen]    = useState<Record<string, boolean>>({})
  const [askInput,   setAskInput]   = useState<Record<string, string>>({})
  const [askReply,   setAskReply]   = useState<Record<string, string>>({})
  const [askLoading, setAskLoading] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    setLoading(true)
    const token = localStorage.getItem('cc_token')
    try {
      const r = await fetch('/api-proxy/ai-suite/followup-report', { headers: { Authorization: `Bearer ${token}` } })
      setData(await r.json())
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function askSarah(m: any) {
    const id = m.id
    const q  = askInput[id]?.trim()
    if (!q) return
    setAskLoading(prev => ({ ...prev, [id]: true }))
    const token = localStorage.getItem('cc_token')
    try {
      const res = await fetch('/api-proxy/website-chat/message', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          sessionId: 'staff-followup-' + (m.patient?.id || id),
          message:   q + ` Context: This is about the follow-up conversation with ${m.patient?.firstName} (${m.patient?.phone})`,
        }),
      })
      const d = await res.json()
      setAskReply(prev => ({ ...prev, [id]: d.message || d.reply || d.response || 'No response received' }))
    } catch {
      setAskReply(prev => ({ ...prev, [id]: '⚠️ Could not reach Sarah right now. Try again.' }))
    } finally {
      setAskLoading(prev => ({ ...prev, [id]: false }))
    }
  }

  function closeAsk(id: string) {
    setAskOpen(prev   => ({ ...prev,   [id]: false }))
    setAskReply(prev  => ({ ...prev,   [id]: '' }))
    setAskInput(prev  => ({ ...prev,   [id]: '' }))
  }

  const stats = {
    total:        data?.messages.length ?? 0,
    contact:      data?.notes.filter(n => n.followUpStatus === 'CONTACT').length ?? 0,
    contacted:    data?.notes.filter(n => n.followUpStatus === 'CONTACTED').length ?? 0,
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
              <div key={n.id}
                onClick={() => n.patient?.phone && router.push(`/receptionist/ai-suite/inbox?phone=${encodeURIComponent(n.patient.phone)}`)}
                className={`bg-white dark:bg-white/5 border border-gray-100 dark:border-white/10 rounded-xl p-4 flex items-start gap-4 transition-colors group ${n.patient?.phone ? 'cursor-pointer hover:border-cyan-200 dark:hover:border-cyan-700' : ''}`}>
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
                {n.patient?.phone && (
                  <span className="text-[11px] font-semibold text-cyan-500 group-hover:text-cyan-600 flex items-center gap-0.5 whitespace-nowrap flex-shrink-0 mt-0.5">
                    View <ArrowRight size={11} />
                  </span>
                )}
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
              <div key={m.id} className="bg-white dark:bg-white/5 border border-gray-100 dark:border-white/10 rounded-xl overflow-hidden">

                {/* Clickable card body */}
                <div
                  onClick={() => m.patient?.phone && router.push(`/receptionist/ai-suite/inbox?phone=${encodeURIComponent(m.patient.phone)}`)}
                  className={`p-4 flex items-start gap-4 transition-colors group ${m.patient?.phone ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5' : ''}`}>
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
                  <div className="text-right flex-shrink-0 flex items-start gap-3">
                    <div>
                      <div className="flex items-center gap-1 text-[10px] text-gray-400 justify-end">
                        <Clock size={10} />
                        {new Date(m.scheduledFor).toLocaleString('en-UG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </div>
                      <p className="text-[10px] text-gray-400 mt-0.5">{m.patient?.phone}</p>
                    </div>
                    {m.patient?.phone && (
                      <span className="text-[11px] font-semibold text-cyan-500 group-hover:text-cyan-600 flex items-center gap-0.5 whitespace-nowrap mt-0.5">
                        View <ArrowRight size={11} />
                      </span>
                    )}
                  </div>
                </div>

                {/* Ask Sarah section */}
                <div className="border-t border-gray-50 dark:border-white/5 px-4 py-2.5">
                  {!askOpen[m.id] ? (
                    <button
                      onClick={() => setAskOpen(prev => ({ ...prev, [m.id]: true }))}
                      className="flex items-center gap-1.5 text-[11px] font-semibold text-cyan-500 hover:text-cyan-600 transition-colors">
                      <Bot size={12} /> Ask Sarah about this
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <input
                          value={askInput[m.id] || ''}
                          onChange={e => setAskInput(prev => ({ ...prev, [m.id]: e.target.value }))}
                          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); askSarah(m) } }}
                          placeholder={`How did the follow-up with ${m.patient?.firstName || 'this patient'} go?`}
                          className="flex-1 text-xs bg-gray-50 dark:bg-white/10 border border-gray-200 dark:border-white/10 rounded-lg px-3 py-2 outline-none focus:border-cyan-300 dark:focus:border-cyan-600 text-gray-800 dark:text-white placeholder-gray-400"
                          autoFocus
                        />
                        <button
                          onClick={() => askSarah(m)}
                          disabled={askLoading[m.id] || !askInput[m.id]?.trim()}
                          className="p-2 rounded-lg bg-cyan-500 text-white disabled:opacity-40 hover:bg-cyan-600 transition-colors flex-shrink-0">
                          {askLoading[m.id] ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                        </button>
                        <button
                          onClick={() => closeAsk(m.id)}
                          className="p-2 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors flex-shrink-0">
                          <X size={13} />
                        </button>
                      </div>

                      {askLoading[m.id] && (
                        <div className="flex items-center gap-2 text-[11px] text-cyan-600">
                          <Loader2 size={11} className="animate-spin" /> Sarah is thinking...
                        </div>
                      )}

                      {askReply[m.id] && (
                        <div className="bg-cyan-50 dark:bg-cyan-900/20 rounded-xl p-3 border border-cyan-100 dark:border-cyan-800/30">
                          <p className="text-[10px] font-black text-cyan-600 dark:text-cyan-400 mb-1 flex items-center gap-1">
                            <Bot size={10} /> Sarah
                          </p>
                          <p className="text-xs text-gray-700 dark:text-gray-200 leading-relaxed">{askReply[m.id]}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>

              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
