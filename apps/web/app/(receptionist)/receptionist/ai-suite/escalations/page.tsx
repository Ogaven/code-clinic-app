'use client'

import { useEffect, useState, useCallback } from 'react'
import { AlertTriangle, CheckCircle2, Send, RefreshCw, Loader2, MessageSquare, X, Phone, MessageCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

type Escalation = {
  id: string
  patientId: string | null
  patientName: string | null
  phoneNumber: string
  channel: string
  reason: string
  status: string
  handledBy: string | null
  handledAt: string | null
  createdAt: string
}

type MsgTarget = 'patient' | 'julian'

export default function EscalationsPage() {
  const API = '/api-proxy'
  function authH(json = false) {
    const t = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
    const h: Record<string, string> = { Authorization: `Bearer ${t}` }
    if (json) h['Content-Type'] = 'application/json'
    return h
  }

  const [rows,        setRows]        = useState<Escalation[]>([])
  const [loading,     setLoading]     = useState(true)
  const [filter,      setFilter]      = useState<'all' | 'PENDING' | 'RESOLVED'>('PENDING')
  const [resolving,   setResolving]   = useState<string | null>(null)
  const [msgOpen,     setMsgOpen]     = useState<string | null>(null)
  const [msgTarget,   setMsgTarget]   = useState<MsgTarget>('julian')
  const [msgText,     setMsgText]     = useState('')
  const [sending,     setSending]     = useState(false)
  const [toast,       setToast]       = useState<{ text: string; ok: boolean } | null>(null)

  const showToast = useCallback((text: string, ok = true) => {
    setToast({ text, ok })
    setTimeout(() => setToast(null), 3500)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs  = filter === 'all' ? 'status=all' : `status=${filter}`
      const res = await fetch(`${API}/agent/escalations?${qs}`, { headers: authH() })
      if (res.ok) setRows(await res.json())
    } catch { showToast('Failed to load escalations', false) }
    finally  { setLoading(false) }
  }, [filter])

  useEffect(() => { load() }, [load])

  async function resolve(id: string) {
    setResolving(id)
    try {
      const res = await fetch(`${API}/agent/escalations/${id}/resolve`, {
        method: 'POST', headers: authH(),
      })
      if (!res.ok) throw new Error()
      setRows(prev => prev.map(r => r.id === id ? { ...r, status: 'RESOLVED', handledAt: new Date().toISOString() } : r))
      showToast('Marked as resolved')
    } catch { showToast('Failed to resolve', false) }
    finally  { setResolving(null) }
  }

  async function sendMsg(id: string) {
    if (!msgText.trim()) return
    setSending(true)
    try {
      const res = await fetch(`${API}/agent/escalations/${id}/message`, {
        method: 'POST', headers: authH(true),
        body: JSON.stringify({ to: msgTarget, message: msgText }),
      })
      if (!res.ok) throw new Error()
      const dest = msgTarget === 'patient' ? 'patient' : 'Julian'
      showToast(`Message sent to ${dest}`)
      setMsgOpen(null)
      setMsgText('')
    } catch { showToast('Failed to send message', false) }
    finally  { setSending(false) }
  }

  function openMsg(id: string) {
    setMsgOpen(id)
    setMsgTarget('julian')
    setMsgText('')
  }

  const pendingCount   = rows.filter(r => r.status === 'PENDING').length
  const resolvedCount  = rows.filter(r => r.status === 'RESOLVED').length
  const displayed      = filter === 'all' ? rows : rows.filter(r => r.status === filter)

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      {toast && (
        <div className={cn(
          'fixed top-5 right-5 z-50 text-white text-sm font-semibold px-4 py-3 rounded-2xl shadow-xl',
          toast.ok ? 'bg-gray-900' : 'bg-red-600',
        )}>
          {toast.text}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-gray-800 dark:text-white flex items-center gap-2">
            <AlertTriangle size={20} className="text-amber-500" />
            Escalations
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">Patient concerns flagged to Julian — track and follow up</p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold text-gray-600 dark:text-white/70 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors disabled:opacity-50">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Summary bar */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Open',     count: pendingCount,   color: 'text-amber-600 dark:text-amber-400',   bg: 'bg-amber-50 dark:bg-amber-900/20',   filter: 'PENDING'  },
          { label: 'Resolved', count: resolvedCount,  color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/20', filter: 'RESOLVED' },
          { label: 'Total',    count: rows.length,    color: 'text-gray-600 dark:text-white/70',     bg: 'bg-gray-50 dark:bg-white/5',           filter: 'all'      },
        ].map(s => (
          <button key={s.label} onClick={() => setFilter(s.filter as any)}
            className={cn(
              'rounded-2xl p-4 text-left border transition-all',
              filter === s.filter
                ? `${s.bg} border-current ${s.color}`
                : 'bg-white dark:bg-white/5 border-gray-100 dark:border-white/10 hover:border-gray-200',
            )}>
            <div className={cn('text-2xl font-black', s.color)}>{s.count}</div>
            <div className="text-xs text-gray-500 dark:text-white/50 font-medium mt-0.5">{s.label}</div>
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin text-cyan-500" />
        </div>
      ) : displayed.length === 0 ? (
        <div className="text-center py-16 text-gray-400 dark:text-white/30">
          <CheckCircle2 size={36} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">No {filter === 'PENDING' ? 'open' : filter === 'RESOLVED' ? 'resolved' : ''} escalations</p>
        </div>
      ) : (
        <div className="space-y-3">
          {displayed.map(esc => (
            <div key={esc.id}
              className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    {/* Patient + channel */}
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-bold text-sm text-gray-800 dark:text-white truncate">
                        {esc.patientName || esc.phoneNumber}
                      </span>
                      {esc.patientName && (
                        <span className="text-xs text-gray-400 dark:text-white/40">{esc.phoneNumber}</span>
                      )}
                      <span className={cn(
                        'text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1',
                        esc.channel === 'WHATSAPP'
                          ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                          : 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400',
                      )}>
                        {esc.channel === 'WHATSAPP' ? <MessageCircle size={9} /> : <Phone size={9} />}
                        {esc.channel}
                      </span>
                      <span className={cn(
                        'text-[10px] font-bold px-2 py-0.5 rounded-full',
                        esc.status === 'PENDING'
                          ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400'
                          : 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400',
                      )}>
                        {esc.status === 'PENDING' ? '● Open' : '✓ Resolved'}
                      </span>
                    </div>

                    {/* Reason */}
                    <p className="text-sm text-gray-600 dark:text-white/70 leading-relaxed line-clamp-2">{esc.reason}</p>

                    {/* Timestamp + resolved by */}
                    <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-400 dark:text-white/30">
                      <span>{new Date(esc.createdAt).toLocaleString('en-UG', {
                        day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
                        hour12: true, timeZone: 'Africa/Nairobi',
                      })}</span>
                      {esc.status === 'RESOLVED' && esc.handledBy && (
                        <span className="text-emerald-500 dark:text-emerald-400">
                          Resolved by {esc.handledBy}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => openMsg(esc.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-cyan-50 dark:bg-cyan-900/20 text-cyan-700 dark:text-cyan-400 hover:bg-cyan-100 transition-colors">
                      <MessageSquare size={12} /> Message
                    </button>
                    {esc.status !== 'RESOLVED' && (
                      <button onClick={() => resolve(esc.id)} disabled={resolving === esc.id}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 transition-colors disabled:opacity-50">
                        {resolving === esc.id
                          ? <Loader2 size={12} className="animate-spin" />
                          : <CheckCircle2 size={12} />}
                        Resolve
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Inline message panel */}
              {msgOpen === esc.id && (
                <div className="border-t border-gray-100 dark:border-white/10 p-4 bg-gray-50 dark:bg-white/3 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-gray-600 dark:text-white/60">Send WhatsApp message</p>
                    <button onClick={() => setMsgOpen(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-white/60">
                      <X size={14} />
                    </button>
                  </div>

                  {/* Recipient toggle */}
                  <div className="flex gap-2">
                    {([
                      { key: 'julian',  label: 'Julian (nudge)' },
                      { key: 'patient', label: 'Patient (direct)' },
                    ] as const).map(opt => (
                      <button key={opt.key} onClick={() => setMsgTarget(opt.key)}
                        className={cn(
                          'px-3 py-1.5 rounded-lg text-xs font-bold transition-all',
                          msgTarget === opt.key
                            ? 'bg-cyan-600 text-white'
                            : 'bg-white dark:bg-white/10 text-gray-600 dark:text-white/60 border border-gray-200 dark:border-white/10',
                        )}>
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  {/* Default message suggestion */}
                  {msgTarget === 'julian' && !msgText && (
                    <button onClick={() => setMsgText(
                      `Hi Julian, please follow up with the patient at ${esc.phoneNumber}${esc.patientName ? ` (${esc.patientName})` : ''}. Concern: ${esc.reason.slice(0, 120)}`
                    )} className="text-[11px] text-cyan-600 dark:text-cyan-400 underline underline-offset-2">
                      Use suggested text
                    </button>
                  )}

                  <div className="flex gap-2">
                    <textarea
                      value={msgText}
                      onChange={e => setMsgText(e.target.value)}
                      placeholder={msgTarget === 'julian'
                        ? 'Nudge Julian about this patient...'
                        : 'Message directly to patient...'}
                      rows={3}
                      className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-white dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20 resize-none"
                    />
                    <button onClick={() => sendMsg(esc.id)} disabled={sending || !msgText.trim()}
                      className="self-end flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-white disabled:opacity-50 transition-all"
                      style={{ background: 'linear-gradient(135deg,#0c1e50,#29ABE2)' }}>
                      {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                      Send
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
