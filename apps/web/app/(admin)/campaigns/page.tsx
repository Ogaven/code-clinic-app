'use client'

import { useEffect, useState } from 'react'
import { Megaphone, Send, Clock, Users, CheckCircle2, AlertCircle, RefreshCw, X, Eye } from 'lucide-react'

const SEGMENTS = [
  { value: 'ALL',           label: 'All Patients' },
  { value: 'NEW_LEAD',      label: 'New Patient' },
  { value: 'UPCOMING',      label: 'Upcoming' },
  { value: 'ACTIVE',        label: 'Active' },
  { value: 'DUE_RECALL',    label: 'Due Recall' },
  { value: 'LAPSED',        label: 'Lapsed' },
  { value: 'DORMANT',       label: 'Dormant' },
  { value: 'BALANCE_OWING', label: 'Balance Owing' },
]

const SEGMENT_COLORS: Record<string, string> = {
  ALL:           'bg-blue-100 text-blue-700',
  NEW_LEAD:      'bg-gray-100 text-gray-600',
  UPCOMING:      'bg-blue-100 text-blue-600',
  ACTIVE:        'bg-emerald-100 text-emerald-700',
  DUE_RECALL:    'bg-amber-100 text-amber-700',
  LAPSED:        'bg-orange-100 text-orange-700',
  DORMANT:       'bg-red-100 text-red-700',
  BALANCE_OWING: 'bg-rose-100 text-rose-700',
}

const STATUS_COLORS: Record<string, string> = {
  SENT:      'bg-emerald-100 text-emerald-700',
  SCHEDULED: 'bg-blue-100 text-blue-700',
  SENDING:   'bg-amber-100 text-amber-700',
  FAILED:    'bg-red-100 text-red-700',
  DRAFT:     'bg-gray-100 text-gray-600',
}

const MAX_CHARS = 4096

function localMin() {
  const d   = new Date(Date.now() + 5 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function CampaignsPage() {
  const API   = '/api-proxy'
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const authH = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  const [segment,      setSegment]      = useState('ALL')
  const [segCount,     setSegCount]     = useState<number | null>(null)
  const [countLoading, setCountLoading] = useState(false)
  const [message,      setMessage]      = useState('')
  const [scheduleType, setScheduleType] = useState<'now' | 'later'>('now')
  const [scheduleAt,   setScheduleAt]   = useState('')
  const [sending,      setSending]      = useState(false)
  const [showPreview,  setShowPreview]  = useState(false)
  const [toast,        setToast]        = useState<{ msg: string; type: 'ok' | 'err' } | null>(null)
  const [campaigns,    setCampaigns]    = useState<any[]>([])
  const [histLoading,  setHistLoading]  = useState(true)

  const showToast = (msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4000)
  }

  const fetchCount = async (seg: string) => {
    setCountLoading(true)
    setSegCount(null)
    try {
      const r = await fetch(`${API}/campaigns/segment-count?segment=${seg}`, { headers: authH as any })
      const d = await r.json()
      setSegCount(typeof d.count === 'number' ? d.count : null)
    } catch { setSegCount(null) }
    setCountLoading(false)
  }

  const fetchHistory = async () => {
    setHistLoading(true)
    try {
      const r = await fetch(`${API}/campaigns`, { headers: authH as any })
      const d = await r.json()
      setCampaigns(Array.isArray(d) ? d : [])
    } catch { setCampaigns([]) }
    setHistLoading(false)
  }

  useEffect(() => {
    fetchCount('ALL')
    fetchHistory()
  }, [])

  const handleSegment = (seg: string) => {
    setSegment(seg)
    fetchCount(seg)
  }

  const canSend = message.trim().length > 0 && (scheduleType === 'now' || !!scheduleAt)

  const handleSend = async () => {
    if (!canSend || sending) return
    setSending(true)
    setShowPreview(false)
    try {
      const body: any = { segment, message: message.trim() }
      if (scheduleType === 'later' && scheduleAt) body.scheduleAt = scheduleAt
      const r = await fetch(`${API}/campaigns/whatsapp/broadcast`, {
        method:  'POST',
        headers: authH as any,
        body:    JSON.stringify(body),
      })
      const d = await r.json()
      if (!r.ok) { showToast(d.error || 'Failed to launch campaign', 'err'); return }
      showToast(scheduleType === 'later' ? 'Campaign scheduled!' : 'Campaign launched — sending now!')
      setMessage('')
      setScheduleAt('')
      setScheduleType('now')
      fetchHistory()
    } catch { showToast('Network error', 'err') }
    setSending(false)
  }

  const segLabel = SEGMENTS.find(s => s.value === segment)?.label || segment

  return (
    <div className="max-w-7xl mx-auto">

      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium text-white transition-all ${toast.type === 'ok' ? 'bg-emerald-500' : 'bg-red-500'}`}>
          {toast.type === 'ok' ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
          {toast.msg}
        </div>
      )}

      {/* Preview Modal */}
      {showPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-lg" style={{ color: '#1A237E' }}>Preview Campaign</h3>
              <button onClick={() => setShowPreview(false)}
                className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
                <X size={17} />
              </button>
            </div>

            <div className="mb-4 p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 flex items-center gap-2 text-sm">
              <Users size={15} className="text-blue-600 flex-shrink-0" />
              <span className="text-blue-700 dark:text-blue-300">
                Sending to <strong>{segCount !== null ? segCount.toLocaleString() : '...'} patient{segCount !== 1 ? 's' : ''}</strong> in <strong>{segLabel}</strong>
              </span>
            </div>

            <div className="mb-4">
              <p className="text-[10px] font-black uppercase tracking-[0.15em] text-gray-400 mb-2">Message</p>
              <div className="p-4 rounded-xl bg-gray-50 dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap border border-gray-200 dark:border-gray-700 max-h-48 overflow-y-auto">
                {message}
              </div>
            </div>

            {scheduleType === 'later' && scheduleAt && (
              <div className="mb-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 flex items-center gap-2 text-sm">
                <Clock size={15} className="text-amber-600 flex-shrink-0" />
                <span className="text-amber-700 dark:text-amber-300">
                  Scheduled for <strong>{new Date(scheduleAt).toLocaleString()}</strong>
                </span>
              </div>
            )}

            <div className="flex gap-3 mt-2">
              <button onClick={() => setShowPreview(false)}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800">
                Cancel
              </button>
              <button onClick={handleSend} disabled={sending}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
                {sending ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                {sending ? 'Launching...' : scheduleType === 'later' ? 'Confirm Schedule' : 'Send Now'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">

        {/* ── Builder ── */}
        <div className="xl:col-span-2">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 p-6">

            {/* Header */}
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
                <Megaphone size={17} color="white" />
              </div>
              <div>
                <h2 className="font-bold text-[15px]" style={{ color: '#1A237E' }}>WhatsApp Broadcast</h2>
                <p className="text-xs text-gray-400">Send to a patient segment</p>
              </div>
            </div>

            {/* Segment */}
            <div className="mb-5">
              <label className="block text-[10px] font-black uppercase tracking-[0.15em] text-gray-400 mb-2">
                Patient Segment
              </label>
              <select
                value={segment}
                onChange={e => handleSegment(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm font-medium text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              >
                {SEGMENTS.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
              <div className="mt-2 h-6 flex items-center">
                {countLoading ? (
                  <span className="text-xs text-gray-400 flex items-center gap-1.5">
                    <RefreshCw size={11} className="animate-spin" /> Counting patients...
                  </span>
                ) : segCount !== null ? (
                  <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${SEGMENT_COLORS[segment] || 'bg-gray-100 text-gray-600'}`}>
                    <Users size={11} />
                    {segCount.toLocaleString()} patient{segCount !== 1 ? 's' : ''}
                  </span>
                ) : null}
              </div>
            </div>

            {/* Message */}
            <div className="mb-5">
              <label className="block text-[10px] font-black uppercase tracking-[0.15em] text-gray-400 mb-2">
                Message
              </label>
              <textarea
                value={message}
                onChange={e => setMessage(e.target.value.slice(0, MAX_CHARS))}
                placeholder="Type your WhatsApp message here..."
                rows={8}
                className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              />
              <p className={`text-xs text-right mt-1 ${message.length > MAX_CHARS * 0.9 ? 'text-red-500' : 'text-gray-400'}`}>
                {message.length.toLocaleString()} / {MAX_CHARS.toLocaleString()}
              </p>
            </div>

            {/* Schedule */}
            <div className="mb-6">
              <label className="block text-[10px] font-black uppercase tracking-[0.15em] text-gray-400 mb-2">
                Schedule
              </label>
              <div className="grid grid-cols-2 gap-2 mb-3">
                {(['now', 'later'] as const).map(type => (
                  <button
                    key={type}
                    onClick={() => setScheduleType(type)}
                    className={`py-2 rounded-xl text-sm font-medium border transition-all ${
                      scheduleType === type
                        ? 'border-transparent text-white'
                        : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}
                    style={scheduleType === type ? { background: 'linear-gradient(135deg,#1A237E,#29ABE2)' } : {}}
                  >
                    {type === 'now' ? '⚡ Send Now' : '🕒 Schedule'}
                  </button>
                ))}
              </div>
              {scheduleType === 'later' && (
                <input
                  type="datetime-local"
                  value={scheduleAt}
                  min={localMin()}
                  onChange={e => setScheduleAt(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                />
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={() => setShowPreview(true)}
                disabled={!message.trim()}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-600 dark:text-gray-400 flex items-center justify-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                <Eye size={14} />
                Preview
              </button>
              <button
                onClick={handleSend}
                disabled={!canSend || sending}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}
              >
                {sending ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                {sending ? 'Launching...' : scheduleType === 'later' ? 'Schedule' : 'Send'}
              </button>
            </div>
          </div>
        </div>

        {/* ── History ── */}
        <div className="xl:col-span-3">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800">

            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
              <h2 className="font-bold text-[15px]" style={{ color: '#1A237E' }}>Campaign History</h2>
              <button onClick={fetchHistory}
                className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                <RefreshCw size={14} className="text-gray-400" />
              </button>
            </div>

            {histLoading ? (
              <div className="flex items-center justify-center py-20 text-gray-400 text-sm gap-2">
                <RefreshCw size={15} className="animate-spin" /> Loading...
              </div>
            ) : campaigns.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                <Megaphone size={36} className="mb-3 opacity-25" />
                <p className="text-sm font-semibold">No campaigns yet</p>
                <p className="text-xs mt-1 text-gray-300">Launch your first campaign on the left</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-gray-800">
                      <th className="text-left px-5 py-3 text-[10px] font-black uppercase tracking-[0.12em] text-gray-400 whitespace-nowrap">Date</th>
                      <th className="text-left px-5 py-3 text-[10px] font-black uppercase tracking-[0.12em] text-gray-400">Segment</th>
                      <th className="text-left px-5 py-3 text-[10px] font-black uppercase tracking-[0.12em] text-gray-400">Message</th>
                      <th className="text-center px-5 py-3 text-[10px] font-black uppercase tracking-[0.12em] text-gray-400 whitespace-nowrap">Sent</th>
                      <th className="text-left px-5 py-3 text-[10px] font-black uppercase tracking-[0.12em] text-gray-400">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.map((c: any) => {
                      const segInfo = SEGMENTS.find(s => s.value === c.targetSegment)
                      const created = new Date(c.createdAt)
                      return (
                        <tr key={c.id}
                          className="border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50/60 dark:hover:bg-gray-800/30 transition-colors">
                          <td className="px-5 py-3.5 whitespace-nowrap">
                            <p className="text-xs font-medium text-gray-700 dark:text-gray-300">
                              {created.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </p>
                            <p className="text-[11px] text-gray-400 mt-0.5">
                              {created.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </td>
                          <td className="px-5 py-3.5">
                            <span className={`inline-flex items-center text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${SEGMENT_COLORS[c.targetSegment || 'ALL'] || 'bg-gray-100 text-gray-600'}`}>
                              {segInfo?.label || c.targetSegment || 'All'}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 max-w-[220px]">
                            <p className="text-xs text-gray-600 dark:text-gray-400 truncate" title={c.messageTemplate}>
                              {c.messageTemplate?.slice(0, 90)}{(c.messageTemplate?.length || 0) > 90 ? '…' : ''}
                            </p>
                          </td>
                          <td className="px-5 py-3.5 text-center">
                            <span className="text-sm font-bold text-gray-700 dark:text-gray-300">
                              {(c.sentCount || 0).toLocaleString()}
                            </span>
                          </td>
                          <td className="px-5 py-3.5">
                            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${STATUS_COLORS[c.status] || 'bg-gray-100 text-gray-600'}`}>
                              {c.status === 'SENDING' && <RefreshCw size={9} className="animate-spin" />}
                              {c.status}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
