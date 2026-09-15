'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  RefreshCw, CalendarCheck, CheckCircle, Clock, XCircle, Rocket, ArrowRight, Loader2, AlertTriangle,
} from 'lucide-react'

// Shared by Admin, Doctor, and Receptionist confirmation-dashboard pages —
// same fetch/render logic, role-aware only in whether the send action and
// inbox-navigation links are shown. Backed by GET /ai-suite/confirmation-report
// (real tomorrow's-appointments + 30-day log) and, for roles allowed to
// trigger sends, POST /ai-suite/trigger/confirmations.

type ConfirmationStatus = 'NOT_SENT' | 'AWAITING_REPLY' | 'CONFIRMED' | 'CANCEL_REQUESTED' | 'RESCHEDULE_REQUESTED' | 'FAILED' | 'TEMPLATE_REQUIRED'

interface TomorrowAppt {
  id: string
  patient: { firstName: string; lastName: string; phone: string } | null
  doctor: { user: { firstName: string; lastName: string } } | null
  service: { name: string } | null
  startAt: string
  status: string
  confirmationStatus: ConfirmationStatus
  confirmationSentAt: string | null
  repliedAt: string | null
  deliveryStatus: string | null
}

interface ConfirmationLogEntry {
  id: string
  patient: { firstName: string; lastName: string; phone: string } | null
  content: string
  scheduledFor: string
  replied: boolean
  replyContent: string | null
  replyAt: string | null
}

interface ReportData {
  confirmations: ConfirmationLogEntry[]
  tomorrowAppointments: TomorrowAppt[]
  eligibleTomorrowCount: number
}

const STATUS_STYLES: Record<ConfirmationStatus, string> = {
  NOT_SENT:              'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/50',
  AWAITING_REPLY:        'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  CONFIRMED:             'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  CANCEL_REQUESTED:      'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  RESCHEDULE_REQUESTED:  'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  FAILED:                'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  TEMPLATE_REQUIRED:     'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
}

const STATUS_LABELS: Record<ConfirmationStatus, string> = {
  NOT_SENT:             'Not Sent',
  AWAITING_REPLY:       'Awaiting Reply',
  CONFIRMED:            'Confirmed',
  CANCEL_REQUESTED:     'Cancel Requested',
  RESCHEDULE_REQUESTED: 'Reschedule Requested',
  FAILED:               'Failed',
  TEMPLATE_REQUIRED:    'Template Required',
}

type Filter = 'ALL' | 'NOT_SENT' | 'AWAITING' | 'CONFIRMED' | 'NEEDS_ATTENTION' | 'FAILED'

export default function ConfirmationDashboard({
  canSend,
  inboxBasePath,
}: {
  /** Admin + Receptionist can trigger sends; Doctor is read-only (matches server-side adminAndReceptionist gate on the trigger endpoint). */
  canSend: boolean
  /** Base path for "view in inbox" row navigation, e.g. '/receptionist/ai-suite/inbox'. Omit (Doctor — no inbox route exists) to disable row navigation. */
  inboxBasePath?: string
}) {
  const router = useRouter()
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('ALL')
  const [triggering, setTriggering] = useState(false)
  const [triggerMsg, setTriggerMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const token = localStorage.getItem('cc_token')
    try {
      const r = await fetch('/api-proxy/ai-suite/confirmation-report', { headers: { Authorization: `Bearer ${token}` } })
      if (r.ok) setData(await r.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function sendConfirmationsNow() {
    setShowConfirmDialog(false)
    setTriggering(true)
    setTriggerMsg(null)
    const token = localStorage.getItem('cc_token')
    try {
      const r = await fetch('/api-proxy/ai-suite/trigger/confirmations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const body = await r.json()
      if (!r.ok) throw new Error(body?.error || 'Failed')
      const parts = [`${body.sent} sent`]
      if (body.skipped) parts.push(`${body.skipped} skipped`)
      if (body.blockedTemplateRequired) parts.push(`${body.blockedTemplateRequired} need an approved template — not sent`)
      setTriggerMsg({ type: 'success', text: `✅ Confirmation run complete — ${parts.join(', ')}` })
      setTimeout(load, 3000)
    } catch (e: any) {
      setTriggerMsg({ type: 'error', text: `❌ ${e.message || 'Failed to trigger confirmations'}` })
    } finally {
      setTriggering(false)
    }
  }

  const tomorrowAppts = data?.tomorrowAppointments ?? []
  const eligibleCount = data?.eligibleTomorrowCount ?? 0

  const stats = useMemo(() => ({
    sent:      tomorrowAppts.filter(a => a.confirmationStatus !== 'NOT_SENT' && a.confirmationStatus !== 'TEMPLATE_REQUIRED').length,
    confirmed: tomorrowAppts.filter(a => a.confirmationStatus === 'CONFIRMED').length,
    awaiting:  tomorrowAppts.filter(a => a.confirmationStatus === 'AWAITING_REPLY').length,
    needsAttention: tomorrowAppts.filter(a => a.confirmationStatus === 'CANCEL_REQUESTED' || a.confirmationStatus === 'RESCHEDULE_REQUESTED').length,
    failed:    tomorrowAppts.filter(a => a.confirmationStatus === 'FAILED').length,
    templateRequired: tomorrowAppts.filter(a => a.confirmationStatus === 'TEMPLATE_REQUIRED').length,
  }), [tomorrowAppts])

  const filteredAppts = useMemo(() => {
    switch (filter) {
      case 'NOT_SENT':        return tomorrowAppts.filter(a => a.confirmationStatus === 'NOT_SENT')
      case 'AWAITING':        return tomorrowAppts.filter(a => a.confirmationStatus === 'AWAITING_REPLY')
      case 'CONFIRMED':       return tomorrowAppts.filter(a => a.confirmationStatus === 'CONFIRMED')
      case 'NEEDS_ATTENTION': return tomorrowAppts.filter(a => a.confirmationStatus === 'CANCEL_REQUESTED' || a.confirmationStatus === 'RESCHEDULE_REQUESTED')
      case 'FAILED':          return tomorrowAppts.filter(a => a.confirmationStatus === 'FAILED')
      default:                return tomorrowAppts
    }
  }, [tomorrowAppts, filter])

  const tomorrowDateStr = new Date(Date.now() + 86400000).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Kampala',
  })

  function goToInbox(phone?: string | null) {
    if (!inboxBasePath || !phone) return
    router.push(`${inboxBasePath}?phone=${encodeURIComponent(phone)}`)
  }

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'ALL',             label: 'All' },
    { key: 'NOT_SENT',        label: 'Not Sent' },
    { key: 'AWAITING',        label: 'Awaiting' },
    { key: 'CONFIRMED',       label: 'Confirmed' },
    { key: 'NEEDS_ATTENTION', label: 'Needs Attention' },
    { key: 'FAILED',          label: 'Failed' },
  ]

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-900 dark:text-white">Confirmation Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">Tomorrow&apos;s appointments &amp; confirmation status</p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-gray-100 dark:bg-white/10 text-gray-700 dark:text-white hover:bg-gray-200 dark:hover:bg-white/20 disabled:opacity-50 transition-all">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Morning Command Center */}
      <div className="bg-gradient-to-br from-cyan-50 to-blue-50 dark:from-cyan-900/20 dark:to-blue-900/20 rounded-2xl border border-cyan-100 dark:border-cyan-800/30 p-5 space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-base font-black text-gray-900 dark:text-white flex items-center gap-2">
              <Rocket size={18} className="text-cyan-500" /> Tomorrow — {tomorrowDateStr}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">{tomorrowAppts.length} appointment{tomorrowAppts.length !== 1 ? 's' : ''} · {eligibleCount} not yet sent a confirmation</p>
          </div>
          {canSend && (
            <button
              onClick={() => setShowConfirmDialog(true)}
              disabled={triggering || eligibleCount === 0}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-60 hover:-translate-y-0.5 active:translate-y-0 flex-shrink-0 shadow-md"
              style={{ background: 'linear-gradient(135deg,#06b6d4,#1A237E)' }}>
              {triggering
                ? <><Loader2 size={16} className="animate-spin" /> Sending...</>
                : <>🚀 Send Confirmations Now</>}
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="bg-white dark:bg-white/10 rounded-xl p-3 text-center border border-cyan-100 dark:border-white/10">
            <p className="text-2xl font-black text-gray-900 dark:text-white">{tomorrowAppts.length}</p>
            <p className="text-[10px] text-gray-500 mt-0.5 font-semibold">Appts Tomorrow</p>
          </div>
          <div className="bg-white dark:bg-white/10 rounded-xl p-3 text-center border border-emerald-100 dark:border-white/10">
            <p className="text-2xl font-black text-emerald-600">{stats.confirmed}</p>
            <p className="text-[10px] text-gray-500 mt-0.5 font-semibold">Confirmed</p>
          </div>
          <div className="bg-white dark:bg-white/10 rounded-xl p-3 text-center border border-amber-100 dark:border-white/10">
            <p className="text-2xl font-black text-amber-600">{stats.awaiting}</p>
            <p className="text-[10px] text-gray-500 mt-0.5 font-semibold">Awaiting Reply</p>
          </div>
          <div className="bg-white dark:bg-white/10 rounded-xl p-3 text-center border border-purple-100 dark:border-white/10">
            <p className="text-2xl font-black text-purple-600">{stats.needsAttention}</p>
            <p className="text-[10px] text-gray-500 mt-0.5 font-semibold">Needs Attention</p>
          </div>
          <div className="bg-white dark:bg-white/10 rounded-xl p-3 text-center border border-red-100 dark:border-white/10">
            <p className="text-2xl font-black text-red-600">{stats.failed}</p>
            <p className="text-[10px] text-gray-500 mt-0.5 font-semibold">Failed</p>
          </div>
        </div>

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

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              filter === f.key
                ? 'bg-cyan-600 text-white'
                : 'bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-white/60 hover:bg-gray-200 dark:hover:bg-white/20'
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Tomorrow's appointments list */}
      <div>
        <h2 className="text-sm font-bold text-gray-700 dark:text-white mb-3">Tomorrow&apos;s Appointments</h2>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredAppts.length === 0 ? (
          <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 p-12 text-center">
            <CalendarCheck size={36} className="text-gray-200 dark:text-white/10 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">No appointments match this filter</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredAppts.map(a => (
              <div key={a.id}
                onClick={() => goToInbox(a.patient?.phone)}
                className={`bg-white dark:bg-white/5 border border-gray-100 dark:border-white/10 rounded-xl p-4 flex items-center gap-4 transition-colors group ${inboxBasePath ? 'cursor-pointer hover:border-cyan-200 dark:hover:border-cyan-700' : ''}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-sm font-semibold text-gray-900 dark:text-white">
                      {a.patient?.firstName} {a.patient?.lastName}
                    </span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_STYLES[a.confirmationStatus]}`}>
                      {STATUS_LABELS[a.confirmationStatus]}
                    </span>
                    {(a.confirmationStatus === 'CANCEL_REQUESTED' || a.confirmationStatus === 'RESCHEDULE_REQUESTED') && (
                      <AlertTriangle size={12} className="text-purple-500" />
                    )}
                  </div>
                  <p className="text-xs text-gray-500">
                    {a.doctor?.user ? `Dr ${a.doctor.user.firstName} ${a.doctor.user.lastName} · ` : ''}{a.service?.name ?? '—'}
                  </p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 text-right">
                    {new Date(a.startAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kampala' })}
                  </p>
                  {inboxBasePath && a.patient?.phone && (
                    <span className="text-[11px] font-semibold text-cyan-500 group-hover:text-cyan-600 flex items-center gap-0.5 whitespace-nowrap">
                      View <ArrowRight size={11} />
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Confirmation messages log */}
      {data?.confirmations && data.confirmations.length > 0 && (
        <div>
          <h2 className="text-sm font-bold text-gray-700 dark:text-white mb-3">Confirmation Messages Log (30 days)</h2>
          <div className="space-y-2">
            {data.confirmations.map(m => (
              <div key={m.id}
                onClick={() => goToInbox(m.patient?.phone)}
                className={`bg-white dark:bg-white/5 border border-gray-100 dark:border-white/10 rounded-xl p-4 flex items-start gap-4 transition-colors group ${inboxBasePath && m.patient?.phone ? 'cursor-pointer hover:border-cyan-200 dark:hover:border-cyan-700' : ''}`}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white mb-1">
                    {m.patient?.firstName} {m.patient?.lastName}
                    {m.replied && <span className="ml-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">Replied</span>}
                  </p>
                  <p className="text-xs text-gray-500 line-clamp-2">{m.content}</p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <div className="text-right">
                    <p className="text-[10px] text-gray-400">
                      {new Date(m.scheduledFor).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kampala' })}
                    </p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{m.patient?.phone}</p>
                  </div>
                  {inboxBasePath && m.patient?.phone && (
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

      {/* Send confirmation dialog */}
      {showConfirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowConfirmDialog(false)}>
          <div onClick={e => e.stopPropagation()}
            className="bg-white dark:bg-[#152040] rounded-2xl shadow-2xl border border-gray-100 dark:border-white/10 p-6 max-w-sm w-full space-y-4">
            <h3 className="text-base font-bold text-gray-900 dark:text-white">Send confirmations?</h3>
            <p className="text-sm text-gray-500">
              Send confirmation messages to <strong>{eligibleCount}</strong> eligible appointment{eligibleCount !== 1 ? 's' : ''} for tomorrow?
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowConfirmDialog(false)}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-gray-600 dark:text-white/70 hover:bg-gray-100 dark:hover:bg-white/10">
                Cancel
              </button>
              <button onClick={sendConfirmationsNow}
                className="px-4 py-2 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5"
                style={{ background: 'linear-gradient(135deg,#06b6d4,#1A237E)' }}>
                Send Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
