'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw, MessageCircle, UserX, Clock, Bot, Send, X, Loader2, ArrowRight, CheckCircle2, AlertCircle, Rocket, Eye, Mail, XCircle } from 'lucide-react'

const STATUS_STYLES: Record<string, string> = {
  NONE:           'bg-gray-100 text-gray-500',
  CONTACT:        'bg-amber-100 text-amber-700',
  CONTACTED:      'bg-emerald-100 text-emerald-700',
  DO_NOT_CONTACT: 'bg-red-100 text-red-600',
}
const STATUS_LABELS: Record<string, string> = {
  NONE: 'No Status', CONTACT: 'Contact', CONTACTED: 'Contacted', DO_NOT_CONTACT: 'Do Not Contact',
}

type FollowupMessage = {
  id: string
  content: string
  scheduledFor: string
  templateType: string
  channel: string
  replied: boolean
  replyContent: string | null
  replyAt: string | null
  deliveryStatus: string | null
  patient: { id: string; firstName: string; lastName: string; phone: string } | null
}

function DeliveryBadge({ m }: { m: FollowupMessage }) {
  if (m.replied)
    return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">✅ Replied</span>
  if (m.deliveryStatus === 'read')
    return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 flex items-center gap-0.5"><Eye size={9} /> Seen, no reply</span>
  if (m.deliveryStatus === 'delivered')
    return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 flex items-center gap-0.5"><Mail size={9} /> Delivered</span>
  if (m.deliveryStatus === 'failed')
    return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 flex items-center gap-0.5"><XCircle size={9} /> Not on WhatsApp</span>
  return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-600">❌ No response</span>
}

export default function FollowupDashboardPage() {
  const router = useRouter()
  const [data,       setData]       = useState<{ messages: FollowupMessage[]; notes: any[] } | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [askOpen,    setAskOpen]    = useState<Record<string, boolean>>({})
  const [askInput,   setAskInput]   = useState<Record<string, string>>({})
  const [askReply,   setAskReply]   = useState<Record<string, string>>({})
  const [askLoading, setAskLoading] = useState<Record<string, boolean>>({})
  const [triggering, setTriggering] = useState(false)
  const [triggerMsg, setTriggerMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const token = localStorage.getItem('cc_token')
    try {
      const r = await fetch('/api-proxy/ai-suite/followup-report', { headers: { Authorization: `Bearer ${token}` } })
      setData(await r.json())
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function triggerFollowups() {
    setTriggering(true)
    setTriggerMsg(null)
    const token = localStorage.getItem('cc_token')
    try {
      const r = await fetch('/api-proxy/ai-suite/trigger/followups', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Unknown error')
      setTriggerMsg({ type: 'success', text: `Sent ${d.sent} follow-up${d.sent !== 1 ? 's' : ''}${d.skipped ? `, ${d.skipped} skipped` : ''}.` })
      await load()
    } catch (e: any) {
      setTriggerMsg({ type: 'error', text: e.message || 'Failed to trigger follow-ups' })
    } finally {
      setTriggering(false)
    }
  }

  async function askSarah(m: FollowupMessage) {
    const id = m.id
    const q  = askInput[id]?.trim()
    if (!q) return
    setAskLoading(prev => ({ ...prev, [id]: true }))
    const token = localStorage.getItem('cc_token')
    try {
      const patientFullName = `${m.patient?.firstName || ''} ${m.patient?.lastName || ''}`.trim()
      const sentDate = new Date(m.scheduledFor).toLocaleString('en-UG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      const staffContext = `[STAFF ASSISTANT MODE] You are Sarah, assistant to the Code Clinic medical team. A staff member is asking about a patient follow-up — answer helpfully and share all relevant details freely with clinic staff. Patient: ${patientFullName} (${m.patient?.phone}). Follow-up sent on ${sentDate}: "${m.content}".${m.replied && m.replyContent ? ` Patient replied: "${m.replyContent}"` : ' Patient has not replied yet.'} Staff question: ${q}`
      const res = await fetch('/api-proxy/website-chat/message', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          sessionId: 'staff-followup-' + (m.patient?.id || id),
          message:   staffContext,
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
    setAskOpen(prev  => ({ ...prev, [id]: false }))
    setAskReply(prev => ({ ...prev, [id]: '' }))
    setAskInput(prev => ({ ...prev, [id]: '' }))
  }

  const msgs             = data?.messages || []
  const repliedCount     = msgs.filter(m => m.replied).length
  const seenNoReply      = msgs.filter(m => !m.replied && m.deliveryStatus === 'read').length
  const deliveredNoReply = msgs.filter(m => !m.replied && m.deliveryStatus === 'delivered').length
  const failedCount      = msgs.filter(m => m.deliveryStatus === 'failed').length
  const noResponseCount  = msgs.filter(m => !m.replied && (!m.deliveryStatus || m.deliveryStatus === 'sent')).length
  const doNotContact     = data?.notes.filter(n => n.followUpStatus === 'DO_NOT_CONTACT').length ?? 0

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

      {/* Info note */}
      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800/30 rounded-xl px-4 py-3 text-xs text-amber-700 dark:text-amber-300">
        📌 Follow-up messages are sent automatically at 10am the day after a patient&apos;s appointment is marked Complete. Patients marked &quot;Contact&quot; today will receive their follow-up tomorrow morning.
      </div>

      {/* Send Follow-ups Now */}
      <div className="bg-gradient-to-r from-violet-500 to-purple-600 rounded-2xl p-5 text-white shadow-lg">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="font-black text-base flex items-center gap-2"><Rocket size={16} /> Send Follow-ups Now</h2>
            <p className="text-xs text-violet-200 mt-0.5">Immediately send follow-up messages to all eligible patients</p>
          </div>
          <button
            onClick={triggerFollowups}
            disabled={triggering}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white text-violet-700 font-bold text-sm hover:bg-violet-50 disabled:opacity-60 transition-all shadow-sm flex-shrink-0">
            {triggering ? <Loader2 size={14} className="animate-spin" /> : <Rocket size={14} />}
            {triggering ? 'Sending...' : 'Send Now'}
          </button>
        </div>
        {triggerMsg && (
          <div className={`mt-3 px-4 py-2 rounded-xl text-sm font-semibold ${triggerMsg.type === 'success' ? 'bg-emerald-500/20 text-emerald-100' : 'bg-red-500/20 text-red-100'}`}>
            {triggerMsg.type === 'success' ? '✅' : '⚠️'} {triggerMsg.text}
          </div>
        )}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {[
          { icon: MessageCircle, label: 'Messages Sent',    value: msgs.length,        color: 'text-blue-600',    bg: 'bg-blue-50 dark:bg-blue-900/20' },
          { icon: CheckCircle2,  label: 'Replied',          value: repliedCount,        color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
          { icon: Eye,           label: 'Seen, no reply',   value: seenNoReply,         color: 'text-amber-600',   bg: 'bg-amber-50 dark:bg-amber-900/20' },
          { icon: Mail,          label: 'Delivered',        value: deliveredNoReply,    color: 'text-indigo-600',  bg: 'bg-indigo-50 dark:bg-indigo-900/20' },
          { icon: AlertCircle,   label: 'No response',      value: noResponseCount,     color: 'text-red-600',     bg: 'bg-red-50 dark:bg-red-900/20' },
          { icon: UserX,         label: 'Do Not Contact',   value: doNotContact,        color: 'text-gray-600',    bg: 'bg-gray-100 dark:bg-white/10' },
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
        ) : !msgs.length ? (
          <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 p-12 text-center">
            <MessageCircle size={36} className="text-gray-200 dark:text-white/10 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">No follow-up messages sent in the last 30 days</p>
          </div>
        ) : (
          <div className="space-y-2">
            {msgs.map((m) => (
              <div key={m.id} className="bg-white dark:bg-white/5 border border-gray-100 dark:border-white/10 rounded-xl overflow-hidden">

                {/* Clickable card body */}
                <div
                  onClick={() => m.patient?.phone && router.push(`/receptionist/ai-suite/inbox?phone=${encodeURIComponent(m.patient.phone)}`)}
                  className={`p-4 flex items-start gap-4 transition-colors group ${m.patient?.phone ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5' : ''}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-sm font-semibold text-gray-900 dark:text-white">
                        {m.patient?.firstName} {m.patient?.lastName}
                      </span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-50 text-cyan-600">
                        {m.templateType === 'MISSED_APPOINTMENT' ? 'Missed Appt' : 'Follow-up'}
                      </span>
                      <DeliveryBadge m={m} />
                    </div>
                    <p className="text-xs text-gray-500 line-clamp-2">{m.content}</p>
                    {/* Reply preview */}
                    {m.replied && m.replyContent && (
                      <div className="mt-1.5 flex items-start gap-1.5">
                        <span className="text-[10px] font-bold text-emerald-600 flex-shrink-0 mt-0.5">↩</span>
                        <p className="text-[11px] text-emerald-700 dark:text-emerald-400 italic line-clamp-1">
                          &ldquo;{m.replyContent}&rdquo;
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0 flex items-start gap-3">
                    <div>
                      <div className="flex items-center gap-1 text-[10px] text-gray-400 justify-end">
                        <Clock size={10} />
                        {new Date(m.scheduledFor).toLocaleString('en-UG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </div>
                      <p className="text-[10px] text-gray-400 mt-0.5">{m.patient?.phone}</p>
                      {m.replyAt && (
                        <p className="text-[10px] text-emerald-500 mt-0.5">
                          replied {new Date(m.replyAt).toLocaleString('en-UG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      )}
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
