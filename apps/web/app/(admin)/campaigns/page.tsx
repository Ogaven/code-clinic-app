'use client'

import { useEffect, useState } from 'react'
import { Megaphone, Send, Clock, Users, CheckCircle2, AlertCircle, RefreshCw, X, Eye, BookOpen, Plus, Pencil, Trash2 } from 'lucide-react'

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

  // Templates
  const [mainTab,      setMainTab]      = useState<'send' | 'templates'>('send')
  const [templates,    setTemplates]    = useState<any[]>([])
  const [tmplLoading,  setTmplLoading]  = useState(false)
  const [editTmpl,     setEditTmpl]     = useState<any | null>(null)   // null = closed, {} = new, obj = edit
  const [tmplTitle,    setTmplTitle]    = useState('')
  const [tmplBody,     setTmplBody]     = useState('')
  const [tmplCategory, setTmplCategory] = useState('General')
  const [tmplSending,  setTmplSending]  = useState(false)
  const [sendTmpl,     setSendTmpl]     = useState<any | null>(null)   // template to send
  const [tmplSegment,  setTmplSegment]  = useState('ALL')
  const [tmplPreview,  setTmplPreview]  = useState('')

  const CATEGORIES = ['Recall', 'Follow-up', 'Promotion', 'Appointment', 'Child health', 'General']
  const VARS = ['patientName', 'doctorName', 'appointmentDate', 'serviceName', 'clinicName', 'primaryContactName']

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

  const fetchTemplates = async () => {
    setTmplLoading(true)
    try {
      const r = await fetch(`${API}/templates`, { headers: authH as any })
      const d = await r.json()
      setTemplates(Array.isArray(d) ? d : [])
    } catch { setTemplates([]) }
    setTmplLoading(false)
  }

  const openNewTemplate = () => {
    setEditTmpl({})
    setTmplTitle(''); setTmplBody(''); setTmplCategory('General')
  }
  const openEditTemplate = (t: any) => {
    setEditTmpl(t)
    setTmplTitle(t.title); setTmplBody(t.body); setTmplCategory(t.category)
  }
  const closeTemplateForm = () => setEditTmpl(null)

  const saveTemplate = async () => {
    if (!tmplTitle.trim() || !tmplBody.trim()) return
    const isNew = !editTmpl?.id
    const vars  = VARS.filter(v => tmplBody.includes(`{${v}}`))
    const url   = isNew ? `${API}/templates` : `${API}/templates/${editTmpl.id}`
    const method = isNew ? 'POST' : 'PUT'
    try {
      const r = await fetch(url, {
        method, headers: authH as any,
        body: JSON.stringify({ title: tmplTitle, body: tmplBody, category: tmplCategory, variables: vars }),
      })
      if (r.ok) { closeTemplateForm(); fetchTemplates(); showToast(isNew ? 'Template created!' : 'Template updated!') }
      else showToast('Failed to save template', 'err')
    } catch { showToast('Network error', 'err') }
  }

  const deleteTemplate = async (id: string) => {
    if (!confirm('Delete this template?')) return
    try {
      await fetch(`${API}/templates/${id}`, { method: 'DELETE', headers: authH as any })
      fetchTemplates(); showToast('Template deleted')
    } catch { showToast('Failed to delete', 'err') }
  }

  const useTemplate = (t: any) => {
    setMessage(t.body)
    setMainTab('send')
    showToast(`Template "${t.title}" loaded into composer`)
  }

  const openSendTemplate = async (t: any) => {
    setSendTmpl(t); setTmplSegment('ALL')
    // Generate preview with dummy data
    try {
      const r = await fetch(`${API}/templates/${t.id}/preview`, { headers: authH as any })
      const d = await r.json()
      setTmplPreview(d.preview || t.body)
    } catch { setTmplPreview(t.body) }
  }

  const sendTemplate = async () => {
    if (!sendTmpl || tmplSending) return
    setTmplSending(true)
    try {
      const r = await fetch(`${API}/templates/${sendTmpl.id}/send`, {
        method: 'POST', headers: authH as any,
        body: JSON.stringify({ segment: tmplSegment }),
      })
      const d = await r.json()
      if (r.ok) {
        showToast(`Sending "${sendTmpl.title}" to ${d.recipientCount} patients!`)
        setSendTmpl(null); fetchHistory()
      } else showToast(d.error || 'Failed to send', 'err')
    } catch { showToast('Network error', 'err') }
    setTmplSending(false)
  }

  useEffect(() => {
    fetchCount('ALL')
    fetchHistory()
    fetchTemplates()
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

      {/* Main tabs */}
      <div className="flex gap-1 mb-6">
        {([
          { key: 'send',      label: 'Broadcast',  icon: Send     },
          { key: 'templates', label: 'Templates',  icon: BookOpen },
        ] as const).map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setMainTab(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-colors ${
              mainTab === key ? 'text-white' : 'text-gray-500 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5'
            }`}
            style={mainTab === key ? { background: 'linear-gradient(135deg,#1A237E,#29ABE2)' } : {}}>
            <Icon size={14} />{label}
          </button>
        ))}
      </div>

      {/* ───────────── TEMPLATES TAB ───────────── */}
      {mainTab === 'templates' && (
        <div className="space-y-4">

          {/* Send template modal */}
          {sendTmpl && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
              <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-lg" style={{ color: '#1A237E' }}>Send: {sendTmpl.title}</h3>
                  <button onClick={() => setSendTmpl(null)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"><X size={17} /></button>
                </div>
                <div className="mb-4">
                  <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Segment</label>
                  <select value={tmplSegment} onChange={e => setTmplSegment(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm">
                    {SEGMENTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
                <div className="mb-5">
                  <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Preview (sample data)</label>
                  <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap max-h-40 overflow-y-auto border border-gray-200 dark:border-gray-700">
                    {tmplPreview || sendTmpl.body}
                  </div>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setSendTmpl(null)} className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-600">Cancel</button>
                  <button onClick={sendTemplate} disabled={tmplSending}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
                    {tmplSending ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                    {tmplSending ? 'Sending...' : 'Send Now'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Template form */}
          {editTmpl !== null && (
            <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 p-6">
              <div className="flex items-center justify-between mb-5">
                <h3 className="font-bold text-base" style={{ color: '#1A237E' }}>{editTmpl.id ? 'Edit Template' : 'New Template'}</h3>
                <button onClick={closeTemplateForm} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"><X size={16} /></button>
              </div>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">Title</label>
                  <input value={tmplTitle} onChange={e => setTmplTitle(e.target.value)} placeholder="e.g. Recall — 6-month checkup"
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">Category</label>
                  <select value={tmplCategory} onChange={e => setTmplCategory(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm">
                    {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div className="mb-3">
                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">Message Body</label>
                <textarea value={tmplBody} onChange={e => setTmplBody(e.target.value)} rows={6} placeholder="Type your template message here..."
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
              </div>
              <div className="mb-5">
                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Insert Variable</label>
                <div className="flex flex-wrap gap-1.5">
                  {VARS.map(v => (
                    <button key={v} onClick={() => setTmplBody(b => b + `{${v}}`)}
                      className="px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 text-xs font-mono border border-blue-100 dark:border-blue-800/30 hover:bg-blue-100 transition-colors">
                      {`{${v}}`}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={closeTemplateForm} className="flex-1 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-600">Cancel</button>
                <button onClick={saveTemplate} disabled={!tmplTitle.trim() || !tmplBody.trim()}
                  className="flex-1 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-40"
                  style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
                  Save Template
                </button>
              </div>
            </div>
          )}

          {/* Template list header */}
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-base" style={{ color: '#1A237E' }}>
              Message Templates <span className="text-gray-400 font-normal text-sm ml-1">({templates.length})</span>
            </h2>
            <button onClick={openNewTemplate} disabled={editTmpl !== null}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-bold text-white disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
              <Plus size={13} /> New Template
            </button>
          </div>

          {tmplLoading ? (
            <div className="flex items-center justify-center py-16 text-gray-400 text-sm gap-2">
              <RefreshCw size={15} className="animate-spin" /> Loading templates...
            </div>
          ) : templates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400 bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800">
              <BookOpen size={36} className="mb-3 opacity-25" />
              <p className="text-sm font-semibold">No templates yet</p>
              <p className="text-xs mt-1 text-gray-300">Create your first template above</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {templates.map((t: any) => (
                <div key={t.id} className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-5">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm text-gray-800 dark:text-white truncate">{t.title}</p>
                      <span className="inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300">
                        {t.category}
                      </span>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <button onClick={() => openEditTemplate(t)} className="p-1.5 rounded-lg text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors" title="Edit">
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => deleteTemplate(t.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors" title="Delete">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-3 line-clamp-2">{t.body.slice(0, 100)}{t.body.length > 100 ? '…' : ''}</p>
                  <div className="flex gap-2">
                    <button onClick={() => useTemplate(t)}
                      className="flex-1 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                      Use in Composer
                    </button>
                    <button onClick={() => openSendTemplate(t)}
                      className="flex-1 py-1.5 rounded-lg text-xs font-semibold text-white flex items-center justify-center gap-1"
                      style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
                      <Send size={11} /> Send
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ───────────── SEND TAB ───────────── */}
      {mainTab === 'send' && (
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
      )}
    </div>
  )
}
