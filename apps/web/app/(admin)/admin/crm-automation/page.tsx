'use client'

// Admin CRM Automation settings (Part V/L/C/H) — Routing Rules, Sequence
// Definitions, and Review Request Config, all previously API-only. This is
// additive: it does not touch the existing Leads pipeline, Campaigns, or
// Patient CRM screens.

import { useEffect, useState } from 'react'
import { Plus, Trash2, Pencil, Loader2, CheckCircle2, AlertCircle, Zap, GitBranch, Star, X } from 'lucide-react'
import { cn } from '@/lib/utils'

const API = '/api-proxy'
const token = () => typeof window !== 'undefined' ? localStorage.getItem('cc_token') : ''
const authHeaders = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` })

const SOURCES = ['WHATSAPP', 'FACEBOOK', 'INSTAGRAM', 'WEBSITE', 'QUIZ', 'WALKIN', 'OTHER']

interface StaffMember { id: string; firstName: string; lastName: string; isActive: boolean }

interface RoutingRule {
  id: string
  name: string
  mode: 'SOURCE_BASED' | 'ROUND_ROBIN'
  sourceMap: string | null
  eligibleUserIds: string | null
  isActive: boolean
  updatedAt: string
}

interface SequenceTouch { order: number; delayDays: number; channel: string; messageTemplate: string }
interface SequenceDefinition {
  id: string
  key: string
  name: string
  description: string | null
  entityType: 'PATIENT' | 'LEAD'
  triggerEventType: string
  channel: string
  isMarketing: boolean
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED'
  touches: SequenceTouch[]
}

interface ReviewConfig {
  id?: string
  delayHours: number
  isActive: boolean
  gbpPlaceId: string | null
  reviewLinkOverride: string | null
}

// ── Automation mode status (Part 11) — read-only. Reports which CRM
// automation features are actually live right now, one flag per feature —
// never raw environment values/secrets, and no browser-side toggle exists
// for these (they're server env vars, set deliberately by an operator, not
// something this UI can flip).
const FEATURE_LABELS: Record<string, string> = {
  OPERATIONAL:    'Operational Leads',
  MARKETING:      'Marketing',
  BACKLOG:        'Backlog Re-engagement',
  WAITLIST:       'Waitlist Notifications',
  REVIEW_REQUEST: 'Review Requests',
}

function AutomationModeStatus() {
  const [status, setStatus] = useState<{ masterLive: boolean; features: Record<string, boolean> } | null>(null)

  useEffect(() => {
    fetch(`${API}/crm-automation/automation-status`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then(setStatus)
      .catch(() => {})
  }, [])

  if (!status) return null

  return (
    <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 p-4">
      <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-white/40 mb-2.5">Current Automation Mode</p>
      <div className="flex flex-wrap gap-2">
        {Object.entries(FEATURE_LABELS).map(([key, label]) => {
          const live = status.features[key] === true
          return (
            <span key={key}
              className={cn('flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold',
                live ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300'
                     : 'bg-gray-100 text-gray-500 dark:bg-white/8 dark:text-white/50')}>
              <span className={cn('w-1.5 h-1.5 rounded-full', live ? 'bg-emerald-500' : 'bg-gray-400')} />
              {label}: {live ? 'LIVE' : 'OFF'}
            </span>
          )
        })}
      </div>
      {!status.masterLive && (
        <p className="text-[11px] text-gray-400 dark:text-white/40 mt-2">Master automation switch is off — every feature above is forced to dry-run regardless of its own setting.</p>
      )}
    </div>
  )
}

function Toast({ toast }: { toast: { msg: string; ok: boolean } | null }) {
  if (!toast) return null
  return (
    <div className={cn(
      'fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-2xl shadow-xl text-sm font-bold text-white',
      toast.ok ? 'bg-emerald-500' : 'bg-red-500',
    )}>
      {toast.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
      {toast.msg}
    </div>
  )
}

export default function CrmAutomationSettingsPage() {
  const [tab, setTab] = useState<'routing' | 'sequences' | 'review'>('routing')
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  function showToast(msg: string, ok = true) { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500) }

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-5xl">
      <Toast toast={toast} />
      <div>
        <h1 className="text-xl font-black text-gray-800 dark:text-white flex items-center gap-2"><Zap size={20} className="text-cyan-500" /> CRM Automation Settings</h1>
        <p className="text-xs text-gray-400 mt-0.5">Lead owner routing, multi-touch sequences, and post-visit review requests</p>
      </div>

      <AutomationModeStatus />

      <div className="flex gap-1.5 bg-gray-100 dark:bg-white/5 rounded-2xl p-1.5 w-fit">
        {(['routing', 'sequences', 'review'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={cn('px-4 py-2 rounded-xl text-sm font-bold transition-colors',
              tab === t ? 'bg-white dark:bg-white/10 text-gray-800 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
            {t === 'routing' ? 'Routing Rules' : t === 'sequences' ? 'Sequences' : 'Review Requests'}
          </button>
        ))}
      </div>

      {tab === 'routing' && <RoutingRulesPanel showToast={showToast} />}
      {tab === 'sequences' && <SequencesPanel showToast={showToast} />}
      {tab === 'review' && <ReviewConfigPanel showToast={showToast} />}
    </div>
  )
}

// ── Routing Rules ────────────────────────────────────────────────────────
function RoutingRulesPanel({ showToast }: { showToast: (m: string, ok?: boolean) => void }) {
  const [rules, setRules] = useState<RoutingRule[]>([])
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', mode: 'SOURCE_BASED' as 'SOURCE_BASED' | 'ROUND_ROBIN', sourceMap: {} as Record<string, string>, eligibleUserIds: [] as string[] })

  function load() {
    setLoading(true)
    Promise.all([
      fetch(`${API}/crm-automation/routing-rules`, { headers: authHeaders() }).then(r => r.ok ? r.json() : []),
      fetch(`${API}/employees`, { headers: authHeaders() }).then(r => r.ok ? r.json() : []),
    ]).then(([r, s]) => {
      setRules(Array.isArray(r) ? r : [])
      setStaff(Array.isArray(s) ? s.filter((x: StaffMember) => x.isActive) : [])
    }).finally(() => setLoading(false))
  }
  useEffect(load, [])

  function resetForm() {
    setForm({ name: '', mode: 'SOURCE_BASED', sourceMap: {}, eligibleUserIds: [] })
    setEditingId(null)
    setShowCreate(false)
  }

  function openEdit(rule: RoutingRule) {
    setForm({
      name: rule.name,
      mode: rule.mode,
      sourceMap: rule.sourceMap ? JSON.parse(rule.sourceMap) : {},
      eligibleUserIds: rule.eligibleUserIds ? JSON.parse(rule.eligibleUserIds) : [],
    })
    setEditingId(rule.id)
    setShowCreate(true)
  }

  async function saveRule() {
    if (!form.name) { showToast('Name is required', false); return }
    setSaving(true)
    try {
      const body: any = { name: form.name, mode: form.mode }
      if (form.mode === 'SOURCE_BASED') body.sourceMap = form.sourceMap
      else body.eligibleUserIds = form.eligibleUserIds
      const r = editingId
        ? await fetch(`${API}/crm-automation/routing-rules/${editingId}`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(body) })
        : await fetch(`${API}/crm-automation/routing-rules`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) })
      if (r.ok) { showToast(editingId ? 'Routing rule updated' : 'Routing rule created'); resetForm(); load() }
      else { const d = await r.json(); showToast(d.error || 'Failed to save rule', false) }
    } catch { showToast('Network error', false) }
    setSaving(false)
  }

  async function toggleActive(rule: RoutingRule) {
    await fetch(`${API}/crm-automation/routing-rules/${rule.id}`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ isActive: !rule.isActive }) })
    load()
  }

  async function deleteRule(rule: RoutingRule) {
    if (rule.isActive) { showToast('Deactivate this rule before deleting it', false); return }
    if (!confirm(`Delete routing rule "${rule.name}"? This cannot be undone.`)) return
    const r = await fetch(`${API}/crm-automation/routing-rules/${rule.id}`, { method: 'DELETE', headers: authHeaders() })
    if (r.ok) { showToast('Routing rule deleted'); load() }
    else { const d = await r.json(); showToast(d.error || 'Failed to delete rule', false) }
  }

  const staffName = (id: string) => { const s = staff.find(x => x.id === id); return s ? `${s.firstName} ${s.lastName}` : id }

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-800/30 rounded-2xl p-3 text-xs text-blue-700 dark:text-blue-300">
        Only one routing rule should be active at a time — new leads are assigned using the most recently updated active rule.
      </div>

      <div className="flex justify-end">
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white bg-cyan-600 hover:bg-cyan-700 transition-colors">
          <Plus size={14} /> New Routing Rule
        </button>
      </div>

      {loading ? <div className="flex justify-center py-10"><Loader2 className="animate-spin text-gray-400" /></div> : (
        <div className="space-y-2">
          {rules.length === 0 && <p className="text-sm text-gray-400 text-center py-8">No routing rules configured — new leads will not be auto-assigned an owner.</p>}
          {rules.map(rule => (
            <div key={rule.id} className="bg-white dark:bg-white/5 border border-gray-100 dark:border-white/10 rounded-2xl p-4 flex items-center justify-between gap-4">
              <div>
                <p className="font-bold text-sm text-gray-800 dark:text-white">{rule.name}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">Updated {new Date(rule.updatedAt).toLocaleString()}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {rule.mode === 'SOURCE_BASED' ? 'Source-based' : 'Round-robin'}
                  {rule.mode === 'SOURCE_BASED' && rule.sourceMap && (() => {
                    try {
                      const map = JSON.parse(rule.sourceMap)
                      return ' — ' + Object.entries(map).map(([src, uid]) => `${src}→${staffName(uid as string)}`).join(', ')
                    } catch { return '' }
                  })()}
                  {rule.mode === 'ROUND_ROBIN' && rule.eligibleUserIds && (() => {
                    try {
                      const ids: string[] = JSON.parse(rule.eligibleUserIds)
                      return ' — ' + ids.map(staffName).join(', ')
                    } catch { return '' }
                  })()}
                </p>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button onClick={() => toggleActive(rule)}
                  className={cn('px-3 py-1.5 rounded-lg text-xs font-bold', rule.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500')}>
                  {rule.isActive ? 'Active' : 'Inactive'}
                </button>
                <button onClick={() => openEdit(rule)} className="p-1.5 rounded-lg text-gray-400 hover:text-cyan-600 hover:bg-cyan-50 dark:hover:bg-cyan-900/20" title="Edit">
                  <Pencil size={14} />
                </button>
                <button onClick={() => deleteRule(rule)} disabled={rule.isActive}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-30 disabled:hover:bg-transparent" title={rule.isActive ? 'Deactivate first' : 'Delete'}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={resetForm}>
          <div className="bg-white dark:bg-[#152040] rounded-3xl shadow-2xl w-full max-w-lg p-6 space-y-4 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-800 dark:text-white">{editingId ? 'Edit Routing Rule' : 'New Routing Rule'}</h2>
              <button onClick={resetForm}><X size={18} className="text-gray-400" /></button>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Name</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-xl" placeholder="e.g. Default lead routing" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Mode</label>
              <select value={form.mode} onChange={e => setForm(f => ({ ...f, mode: e.target.value as any }))}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-xl">
                <option value="SOURCE_BASED">Source-based (assign by channel)</option>
                <option value="ROUND_ROBIN">Round-robin (cycle across staff)</option>
              </select>
            </div>
            {form.mode === 'SOURCE_BASED' ? (
              <div className="space-y-2">
                <label className="block text-xs font-bold text-gray-500 uppercase">Source → Owner</label>
                {SOURCES.map(src => (
                  <div key={src} className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-500 w-24 flex-shrink-0">{src}</span>
                    <select value={form.sourceMap[src] ?? ''} onChange={e => setForm(f => ({ ...f, sourceMap: { ...f.sourceMap, [src]: e.target.value } }))}
                      className="flex-1 px-2 py-1.5 text-sm border border-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-lg">
                      <option value="">Unassigned</option>
                      {staff.map(s => <option key={s.id} value={s.id}>{s.firstName} {s.lastName}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            ) : (
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Eligible staff (cycled in order)</label>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {staff.map(s => (
                    <label key={s.id} className="flex items-center gap-2 text-sm text-gray-700 dark:text-white/70">
                      <input type="checkbox" checked={form.eligibleUserIds.includes(s.id)}
                        onChange={e => setForm(f => ({ ...f, eligibleUserIds: e.target.checked ? [...f.eligibleUserIds, s.id] : f.eligibleUserIds.filter(id => id !== s.id) }))} />
                      {s.firstName} {s.lastName}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="flex gap-3 pt-2">
              <button onClick={resetForm} className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-white/10 text-sm font-bold text-gray-600 dark:text-white/60">Cancel</button>
              <button onClick={saveRule} disabled={saving} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white bg-cyan-600 hover:bg-cyan-700 disabled:opacity-60">
                {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Create Rule'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sequence Definitions ─────────────────────────────────────────────────
function SequencesPanel({ showToast }: { showToast: (m: string, ok?: boolean) => void }) {
  const [sequences, setSequences] = useState<SequenceDefinition[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    key: '', name: '', entityType: 'PATIENT' as 'PATIENT' | 'LEAD', triggerEventType: '', channel: 'WHATSAPP', isMarketing: true,
    touches: [{ order: 0, delayDays: 0, channel: 'WHATSAPP', messageTemplate: '' }] as SequenceTouch[],
  })
  const [editingTouchesFor, setEditingTouchesFor] = useState<SequenceDefinition | null>(null)
  const [touchesDraft, setTouchesDraft] = useState<SequenceTouch[]>([])
  const [savingTouches, setSavingTouches] = useState(false)

  function load() {
    setLoading(true)
    fetch(`${API}/crm-automation/sequences`, { headers: authHeaders() }).then(r => r.ok ? r.json() : []).then(d => setSequences(Array.isArray(d) ? d : [])).finally(() => setLoading(false))
  }
  useEffect(load, [])

  async function createSequence() {
    if (!form.key || !form.name || !form.triggerEventType) { showToast('Key, name, and trigger event type are required', false); return }
    setSaving(true)
    try {
      const r = await fetch(`${API}/crm-automation/sequences`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(form) })
      if (r.ok) {
        showToast('Sequence created as DRAFT')
        setShowCreate(false)
        setForm({ key: '', name: '', entityType: 'PATIENT', triggerEventType: '', channel: 'WHATSAPP', isMarketing: true, touches: [{ order: 0, delayDays: 0, channel: 'WHATSAPP', messageTemplate: '' }] })
        load()
      } else { const d = await r.json(); showToast(d.error || 'Failed to create sequence', false) }
    } catch { showToast('Network error', false) }
    setSaving(false)
  }

  async function setStatus(seq: SequenceDefinition, status: string) {
    await fetch(`${API}/crm-automation/sequences/${seq.id}`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ status }) })
    load()
  }

  function openTouchEditor(seq: SequenceDefinition) {
    setEditingTouchesFor(seq)
    setTouchesDraft(seq.touches.length > 0 ? seq.touches.map(t => ({ ...t })) : [{ order: 0, delayDays: 0, channel: seq.channel, messageTemplate: '' }])
  }

  async function saveTouches() {
    if (!editingTouchesFor) return
    setSavingTouches(true)
    try {
      const r = await fetch(`${API}/crm-automation/sequences/${editingTouchesFor.id}/touches`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ touches: touchesDraft }) })
      if (r.ok) { showToast('Touches updated'); setEditingTouchesFor(null); load() }
      else { const d = await r.json(); showToast(d.error || 'Failed to update touches', false) }
    } catch { showToast('Network error', false) }
    setSavingTouches(false)
  }

  const STATUS_STYLE: Record<string, string> = {
    DRAFT: 'bg-gray-100 text-gray-600', ACTIVE: 'bg-emerald-100 text-emerald-700',
    PAUSED: 'bg-amber-100 text-amber-700', ARCHIVED: 'bg-red-100 text-red-500',
  }

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-800/30 rounded-2xl p-3 text-xs text-blue-700 dark:text-blue-300 flex items-start gap-2">
        <GitBranch size={14} className="flex-shrink-0 mt-0.5" />
        New sequences default to <strong className="mx-1">DRAFT</strong> and <strong className="mx-1">Marketing</strong> (requires an explicit patient opt-in before any send — never the default-opt-in used for operational reminders). Set to Active only once its touches are ready to fire.
      </div>

      <div className="flex justify-end">
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white bg-cyan-600 hover:bg-cyan-700 transition-colors">
          <Plus size={14} /> New Sequence
        </button>
      </div>

      {loading ? <div className="flex justify-center py-10"><Loader2 className="animate-spin text-gray-400" /></div> : (
        <div className="space-y-2">
          {sequences.length === 0 && <p className="text-sm text-gray-400 text-center py-8">No sequences defined yet.</p>}
          {sequences.map(seq => (
            <div key={seq.id} className="bg-white dark:bg-white/5 border border-gray-100 dark:border-white/10 rounded-2xl p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-bold text-sm text-gray-800 dark:text-white">{seq.name} <span className="text-gray-400 font-normal text-xs">({seq.key})</span></p>
                  <p className="text-xs text-gray-400 mt-0.5">{seq.entityType} · trigger: {seq.triggerEventType} · {seq.channel} · {seq.isMarketing ? 'Marketing (explicit opt-in required)' : 'Operational'} · {seq.touches?.length ?? 0} touch(es)</p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button onClick={() => openTouchEditor(seq)} className="p-1.5 rounded-lg text-gray-400 hover:text-cyan-600 hover:bg-cyan-50 dark:hover:bg-cyan-900/20" title="Edit touches">
                    <Pencil size={14} />
                  </button>
                  <select value={seq.status} onChange={e => setStatus(seq, e.target.value)}
                    className={cn('text-xs font-bold px-2.5 py-1.5 rounded-lg border-0 cursor-pointer', STATUS_STYLE[seq.status])}>
                    {['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED'].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowCreate(false)}>
          <div className="bg-white dark:bg-[#152040] rounded-3xl shadow-2xl w-full max-w-lg p-6 space-y-4 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-800 dark:text-white">New Sequence</h2>
              <button onClick={() => setShowCreate(false)}><X size={18} className="text-gray-400" /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Key</label>
                <input value={form.key} onChange={e => setForm(f => ({ ...f, key: e.target.value }))} placeholder="recall_overdue_30"
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-xl" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Name</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Recall — 30 days overdue"
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-xl" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Entity</label>
                <select value={form.entityType} onChange={e => setForm(f => ({ ...f, entityType: e.target.value as any }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-xl">
                  <option value="PATIENT">Patient</option>
                  <option value="LEAD">Lead</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Channel</label>
                <select value={form.channel} onChange={e => setForm(f => ({ ...f, channel: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-xl">
                  <option value="WHATSAPP">WhatsApp</option>
                  <option value="SMS">SMS</option>
                  <option value="EMAIL">Email</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Trigger Event Type</label>
              <input value={form.triggerEventType} onChange={e => setForm(f => ({ ...f, triggerEventType: e.target.value }))} placeholder="recall_status_changed"
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-xl" />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-white/70">
              <input type="checkbox" checked={form.isMarketing} onChange={e => setForm(f => ({ ...f, isMarketing: e.target.checked }))} />
              Marketing sequence (requires explicit patient opt-in — uncheck only for genuinely operational sequences)
            </label>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-bold text-gray-500 uppercase">Touches</label>
                <button onClick={() => setForm(f => ({ ...f, touches: [...f.touches, { order: f.touches.length, delayDays: 0, channel: f.channel, messageTemplate: '' }] }))}
                  className="text-xs font-bold text-cyan-600 flex items-center gap-1"><Plus size={12} /> Add touch</button>
              </div>
              {form.touches.map((t, i) => (
                <div key={i} className="flex items-start gap-2 bg-gray-50 dark:bg-white/5 rounded-xl p-2">
                  <input type="number" value={t.delayDays} onChange={e => setForm(f => ({ ...f, touches: f.touches.map((x, xi) => xi === i ? { ...x, delayDays: Number(e.target.value) } : x) }))}
                    className="w-16 px-2 py-1.5 text-sm border border-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-lg" title="Delay (days)" />
                  <textarea value={t.messageTemplate} onChange={e => setForm(f => ({ ...f, touches: f.touches.map((x, xi) => xi === i ? { ...x, messageTemplate: e.target.value } : x) }))}
                    placeholder="Message — use {firstName} / {lastName}" rows={2}
                    className="flex-1 px-2 py-1.5 text-sm border border-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-lg" />
                  {form.touches.length > 1 && (
                    <button onClick={() => setForm(f => ({ ...f, touches: f.touches.filter((_, xi) => xi !== i) }))} className="text-gray-400 hover:text-red-500 mt-1.5">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="flex gap-3 pt-2">
              <button onClick={() => setShowCreate(false)} className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-white/10 text-sm font-bold text-gray-600 dark:text-white/60">Cancel</button>
              <button onClick={createSequence} disabled={saving} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white bg-cyan-600 hover:bg-cyan-700 disabled:opacity-60">
                {saving ? 'Saving…' : 'Create Sequence (Draft)'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editingTouchesFor && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setEditingTouchesFor(null)}>
          <div className="bg-white dark:bg-[#152040] rounded-3xl shadow-2xl w-full max-w-lg p-6 space-y-4 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-800 dark:text-white">Edit Touches — {editingTouchesFor.name}</h2>
              <button onClick={() => setEditingTouchesFor(null)}><X size={18} className="text-gray-400" /></button>
            </div>
            {editingTouchesFor.status === 'ACTIVE' && (
              <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/30 rounded-xl p-3 text-xs text-amber-700 dark:text-amber-300">
                This sequence is Active — pause it first (change its status back on the list) before saving touch changes, or the save will be rejected to protect already-scheduled sends.
              </div>
            )}
            <div className="space-y-2">
              {touchesDraft.map((t, i) => (
                <div key={i} className="flex items-start gap-2 bg-gray-50 dark:bg-white/5 rounded-xl p-2">
                  <input type="number" value={t.delayDays} onChange={e => setTouchesDraft(d => d.map((x, xi) => xi === i ? { ...x, delayDays: Number(e.target.value) } : x))}
                    className="w-16 px-2 py-1.5 text-sm border border-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-lg" title="Delay (days)" />
                  <select value={t.channel} onChange={e => setTouchesDraft(d => d.map((x, xi) => xi === i ? { ...x, channel: e.target.value } : x))}
                    className="px-2 py-1.5 text-sm border border-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-lg">
                    <option value="WHATSAPP">WhatsApp</option>
                    <option value="SMS">SMS</option>
                    <option value="EMAIL">Email</option>
                  </select>
                  <textarea value={t.messageTemplate} onChange={e => setTouchesDraft(d => d.map((x, xi) => xi === i ? { ...x, messageTemplate: e.target.value } : x))}
                    placeholder="Message — use {firstName} / {lastName}" rows={2}
                    className="flex-1 px-2 py-1.5 text-sm border border-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-lg" />
                  {touchesDraft.length > 1 && (
                    <button onClick={() => setTouchesDraft(d => d.filter((_, xi) => xi !== i))} className="text-gray-400 hover:text-red-500 mt-1.5">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
              <button onClick={() => setTouchesDraft(d => [...d, { order: d.length, delayDays: 0, channel: editingTouchesFor.channel, messageTemplate: '' }])}
                className="text-xs font-bold text-cyan-600 flex items-center gap-1"><Plus size={12} /> Add touch</button>
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setEditingTouchesFor(null)} className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-white/10 text-sm font-bold text-gray-600 dark:text-white/60">Cancel</button>
              <button onClick={saveTouches} disabled={savingTouches} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white bg-cyan-600 hover:bg-cyan-700 disabled:opacity-60">
                {savingTouches ? 'Saving…' : 'Save Touches'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Review Request Config ────────────────────────────────────────────────
function ReviewConfigPanel({ showToast }: { showToast: (m: string, ok?: boolean) => void }) {
  const [config, setConfig] = useState<ReviewConfig>({ delayHours: 24, isActive: false, gbpPlaceId: '', reviewLinkOverride: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch(`${API}/crm-automation/review-config`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setConfig({ delayHours: d.delayHours ?? 24, isActive: !!d.isActive, gbpPlaceId: d.gbpPlaceId ?? '', reviewLinkOverride: d.reviewLinkOverride ?? '' }) })
      .finally(() => setLoading(false))
  }, [])

  async function save() {
    setSaving(true)
    try {
      const r = await fetch(`${API}/crm-automation/review-config`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(config) })
      if (r.ok) showToast('Review request settings saved')
      else { const d = await r.json(); showToast(d.error || 'Failed to save', false) }
    } catch { showToast('Network error', false) }
    setSaving(false)
  }

  if (loading) return <div className="flex justify-center py-10"><Loader2 className="animate-spin text-gray-400" /></div>

  return (
    <div className="bg-white dark:bg-white/5 border border-gray-100 dark:border-white/10 rounded-2xl p-5 space-y-4 max-w-lg">
      <div className="flex items-center gap-2">
        <Star size={16} className="text-amber-500" />
        <h2 className="font-bold text-sm text-gray-800 dark:text-white">Post-Visit Review Requests</h2>
      </div>
      <p className="text-xs text-gray-400">
        Uses the Google Business Profile connection under Settings → Google Business Profile. Get the place id from that page's Locations lookup.
      </p>
      <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-white/70">
        <input type="checkbox" checked={config.isActive} onChange={e => setConfig(c => ({ ...c, isActive: e.target.checked }))} />
        Active — schedule a review request after every completed appointment
      </label>
      <div>
        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Delay (hours after appointment)</label>
        <input type="number" value={config.delayHours} onChange={e => setConfig(c => ({ ...c, delayHours: Number(e.target.value) }))}
          className="w-32 px-3 py-2 text-sm border border-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-xl" />
      </div>
      <div>
        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Google Place ID</label>
        <input value={config.gbpPlaceId ?? ''} onChange={e => setConfig(c => ({ ...c, gbpPlaceId: e.target.value }))} placeholder="ChIJ..."
          className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-xl" />
      </div>
      <div>
        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Manual review link override (optional)</label>
        <input value={config.reviewLinkOverride ?? ''} onChange={e => setConfig(c => ({ ...c, reviewLinkOverride: e.target.value }))} placeholder="https://..."
          className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-xl" />
      </div>
      <button onClick={save} disabled={saving} className="px-5 py-2.5 rounded-xl text-sm font-bold text-white bg-cyan-600 hover:bg-cyan-700 disabled:opacity-60">
        {saving ? 'Saving…' : 'Save Settings'}
      </button>
    </div>
  )
}
