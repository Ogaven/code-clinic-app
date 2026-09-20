'use client'

// CRM Automation — Patient Tag Taxonomy tab (Part U).
// Extends the existing Patient detail page with a new tab rather than
// redesigning it. Tags are grouped exactly per the spec's taxonomy
// (Clinical, Lifecycle, Financial, Risk, Source/Preference) — a section is
// simply omitted if the API didn't return any of its fields, which is how
// the server-side role stripping (DOCTOR never sees financial tags) surfaces
// here with zero extra client-side logic.

import { useEffect, useRef, useState } from 'react'
import { cn, formatUGX } from '@/lib/utils'
import { Loader2, Save, Sparkles, UserCog, Search, X, ShieldCheck } from 'lucide-react'

interface CrmTags {
  id: string
  treatmentTypes: string[]
  treatmentPlanStatus: string
  recallInterval: string | null
  providerId: string | null
  lifecycleStage: string
  recallStatus: string
  noShowCount: number
  lateCancelCount: number
  declineReason: string | null
  declineReasonNote: string | null
  paymentType?: string | null
  balanceStatus?: string
  balanceAgingBucket?: string | null
  valueTier?: string
  riskFlags: string[]
  crmReferralSource: string | null
  crmReferredByPatientId: string | null
  crmReferredByPatient?: { id: string; firstName: string; lastName: string } | null
  commsChannelPref: string | null
  languagePref: string | null
  waitlistAvailable: boolean
  negativeExperience: boolean
  tagsUpdatedAt: string | null
  tagsUpdatedBy: string | null
  accountBalance?: number
}

interface PatientSearchResult { id: string; firstName: string; lastName: string; patientNumber?: number }

// Searchable "Referred By" patient picker — reuses the existing patient
// search endpoint (GET /patients?q=) rather than a new one, and renders only
// name + patient number, never phone/DOB/balance/other patient data.
function ReferredByPicker({
  patientId, currentId, currentLabel, token, onChange,
}: {
  patientId: string; currentId: string | null; currentLabel: string | null; token: string | null
  onChange: (id: string | null, label: string | null) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PatientSearchResult[]>([])
  const [open, setOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (query.trim().length < 2) { setResults([]); return }
    debounceRef.current = setTimeout(() => {
      setSearching(true)
      fetch(`/api-proxy/patients?q=${encodeURIComponent(query.trim())}&limit=8`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : { data: [] })
        .then(d => setResults((Array.isArray(d) ? d : d.data || []).filter((p: PatientSearchResult) => p.id !== patientId)))
        .catch(() => setResults([]))
        .finally(() => setSearching(false))
    }, 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, token, patientId])

  if (currentId && !open) {
    return (
      <div className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
        <span className="text-sm text-slate-700 dark:text-white/80">{currentLabel || 'Selected patient'}</span>
        <button type="button" onClick={() => { onChange(null, null); setOpen(true) }} className="text-slate-400 hover:text-red-500" title="Remove">
          <X size={14} />
        </button>
      </div>
    )
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder="Search patient by name…"
          className="w-full text-sm pl-8 pr-2 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-white"
        />
      </div>
      {open && query.trim().length >= 2 && (
        <div className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#152040] shadow-lg">
          {searching && <div className="px-3 py-2 text-xs text-slate-400">Searching…</div>}
          {!searching && results.length === 0 && <div className="px-3 py-2 text-xs text-slate-400">No matching patients</div>}
          {!searching && results.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => { onChange(p.id, `${p.firstName} ${p.lastName}`); setQuery(''); setOpen(false) }}
              className="w-full text-left px-3 py-2 text-sm text-slate-700 dark:text-white/80 hover:bg-slate-50 dark:hover:bg-white/10"
            >
              {p.firstName} {p.lastName}{p.patientNumber ? ` (CC-${p.patientNumber})` : ''}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const TREATMENT_TYPES = ['CLEANING', 'FILLING', 'CROWN', 'ROOT_CANAL', 'EXTRACTION', 'ORTHO', 'IMPLANT', 'WHITENING', 'DENTURE']
const RISK_FLAGS = ['PERIO_RISK', 'HIGH_CARIES_RISK', 'EMERGENCY_HISTORY']
const TREATMENT_PLAN_STATUSES = ['NONE', 'PROPOSED', 'INCOMPLETE', 'ACCEPTED', 'DECLINED']
const RECALL_INTERVALS = ['THREE_MONTH', 'SIX_MONTH', 'TWELVE_MONTH']
const DECLINE_REASONS = ['COST', 'TIMING', 'SECOND_OPINION', 'UNKNOWN', 'OTHER']
const PAYMENT_TYPES = ['INSURANCE', 'SELF_PAY', 'FINANCING_ACTIVE']
const CHANNELS = ['SMS', 'WHATSAPP', 'EMAIL']
const REFERRAL_SOURCES = ['GOOGLE', 'INSURANCE_DIRECTORY', 'PATIENT_REFERRAL', 'OTHER']

function label(value: string | null | undefined): string {
  if (!value) return '—'
  return value.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
}

function Chip({ text, tone = 'default' }: { text: string; tone?: 'default' | 'risk' | 'warn' }) {
  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold',
      tone === 'risk' && 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
      tone === 'warn' && 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
      tone === 'default' && 'bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-white/70',
    )}>
      {label(text)}
    </span>
  )
}

function MultiSelect({ options, selected, onToggle }: { options: string[]; selected: string[]; onToggle: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(opt => (
        <button
          key={opt}
          type="button"
          onClick={() => onToggle(opt)}
          className={cn(
            'px-2 py-1 rounded-lg text-[11px] font-semibold border transition-colors',
            selected.includes(opt)
              ? 'bg-blue-600 text-white border-blue-600'
              : 'bg-white dark:bg-white/5 text-slate-600 dark:text-white/60 border-slate-200 dark:border-white/10 hover:border-blue-400'
          )}
        >
          {label(opt)}
        </button>
      ))}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-white/5 border border-gray-100 dark:border-white/10 rounded-xl p-4 space-y-3">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-white/50">{title}</p>
      {children}
    </div>
  )
}

interface ConsentLogEntry { id: string; channel: string; status: 'OPT_IN' | 'OPT_OUT'; source: string; createdAt: string }

// Read-only audit trail — the backend (ConsentLog, append-only, per-channel,
// timestamped) already existed; this is the missing staff-facing screen for
// it, mirroring the gap this milestone also closed for Collections.
function ConsentHistorySection({ patientId, token }: { patientId: string; token: string | null }) {
  const [entries, setEntries] = useState<ConsentLogEntry[] | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open || entries !== null) return
    fetch(`/api-proxy/crm-automation/patients/${patientId}/consent`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : [])
      .then(setEntries)
      .catch(() => setEntries([]))
  }, [open, entries, patientId, token])

  return (
    <div className="bg-white dark:bg-white/5 border border-gray-100 dark:border-white/10 rounded-xl p-4">
      <button type="button" onClick={() => setOpen(v => !v)} className="w-full flex items-center justify-between text-left">
        <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-white/50">
          <ShieldCheck size={13} /> Consent History
        </span>
        <span className="text-xs text-slate-400">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-1.5">
          {entries === null && <p className="text-xs text-slate-400">Loading…</p>}
          {entries !== null && entries.length === 0 && <p className="text-xs text-slate-400">No consent events logged for this patient yet.</p>}
          {entries?.map(e => (
            <div key={e.id} className="flex items-center justify-between text-xs py-1 border-b border-slate-50 dark:border-white/5 last:border-0">
              <span className={cn('font-semibold', e.status === 'OPT_IN' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500')}>
                {e.status === 'OPT_IN' ? 'Opted in' : 'Opted out'} — {label(e.channel)}
              </span>
              <span className="text-slate-400">{label(e.source)} · {new Date(e.createdAt).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function CrmTagsTab({ patientId, token }: { patientId: string; token: string | null }) {
  const [tags, setTags] = useState<CrmTags | null>(null)
  const [draft, setDraft] = useState<Partial<CrmTags>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [pickedReferrerLabel, setPickedReferrerLabel] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    fetch(`/api-proxy/crm-automation/patients/${patientId}/tags`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : Promise.reject(new Error('Failed to load CRM tags')))
      .then(d => { setTags(d); setDraft({}) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [patientId, token]) // eslint-disable-line react-hooks/exhaustive-deps

  const hasFinancial = tags && ('balanceStatus' in tags)
  const hasDraft = Object.keys(draft).length > 0

  async function save() {
    if (!hasDraft) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api-proxy/crm-automation/patients/${patientId}/tags`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(draft),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to save CRM tags')
      }
      const updated = await res.json()
      setTags(updated)
      setDraft({})
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-slate-400" /></div>
  if (!tags) return <div className="text-sm text-red-600 p-4">{error || 'Could not load CRM tags'}</div>

  const treatmentTypes = draft.treatmentTypes ?? tags.treatmentTypes
  const riskFlags = draft.riskFlags ?? tags.riskFlags

  return (
    <div className="space-y-4">
      {tags.tagsUpdatedAt && (
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-white/50">
          {tags.tagsUpdatedBy ? <UserCog size={13} /> : <Sparkles size={13} />}
          {tags.tagsUpdatedBy ? 'Manually updated' : 'Automatically updated'} · {new Date(tags.tagsUpdatedAt).toLocaleString()}
        </div>
      )}

      {error && <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg p-3">{error}</div>}

      {/* Clinical / Treatment */}
      <Section title="Clinical & Treatment">
        <div>
          <p className="text-xs text-slate-500 mb-1">Treatment Types (multi-select)</p>
          <MultiSelect
            options={TREATMENT_TYPES}
            selected={treatmentTypes}
            onToggle={(v) => {
              const next = treatmentTypes.includes(v) ? treatmentTypes.filter(t => t !== v) : [...treatmentTypes, v]
              setDraft(d => ({ ...d, treatmentTypes: next as any }))
            }}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-slate-500 mb-1">Treatment Plan Status</p>
            <select
              value={draft.treatmentPlanStatus ?? tags.treatmentPlanStatus}
              onChange={e => setDraft(d => ({ ...d, treatmentPlanStatus: e.target.value as any }))}
              className="w-full text-sm px-2 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-white"
            >
              {TREATMENT_PLAN_STATUSES.map(s => <option key={s} value={s}>{label(s)}</option>)}
            </select>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Recall Interval</p>
            <select
              value={draft.recallInterval ?? tags.recallInterval ?? ''}
              onChange={e => setDraft(d => ({ ...d, recallInterval: (e.target.value || null) as any }))}
              className="w-full text-sm px-2 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-white"
            >
              <option value="">Not set</option>
              {RECALL_INTERVALS.map(s => <option key={s} value={s}>{label(s)}</option>)}
            </select>
          </div>
        </div>
      </Section>

      {/* Lifecycle / Behavioral */}
      <Section title="Lifecycle & Behavioral">
        <div className="flex flex-wrap gap-2">
          <Chip text={tags.lifecycleStage} />
          <Chip text={tags.recallStatus} tone={tags.recallStatus.startsWith('OVERDUE') ? 'warn' : 'default'} />
          {tags.noShowCount > 0 && <Chip text={`${tags.noShowCount} no-show${tags.noShowCount > 1 ? 's' : ''}`} tone="warn" />}
          {tags.lateCancelCount > 0 && <Chip text={`${tags.lateCancelCount} late cancel${tags.lateCancelCount > 1 ? 's' : ''}`} tone="warn" />}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-slate-500 mb-1">Decline Reason</p>
            <select
              value={draft.declineReason ?? tags.declineReason ?? ''}
              onChange={e => setDraft(d => ({ ...d, declineReason: (e.target.value || null) as any }))}
              className="w-full text-sm px-2 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-white"
            >
              <option value="">Not set</option>
              {DECLINE_REASONS.map(s => <option key={s} value={s}>{label(s)}</option>)}
            </select>
          </div>
          {(draft.declineReason ?? tags.declineReason) === 'OTHER' && (
            <div>
              <p className="text-xs text-slate-500 mb-1">Decline Note</p>
              <input
                value={draft.declineReasonNote ?? tags.declineReasonNote ?? ''}
                onChange={e => setDraft(d => ({ ...d, declineReasonNote: e.target.value }))}
                className="w-full text-sm px-2 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-white"
              />
            </div>
          )}
        </div>
      </Section>

      {/* Financial — only rendered when the API actually returned financial fields (role-gated server-side) */}
      {hasFinancial && (
        <Section title="Financial">
          <div className="flex flex-wrap gap-2">
            <Chip text={tags.balanceStatus!} tone={tags.balanceStatus === 'OWING' ? 'warn' : 'default'} />
            {tags.balanceAgingBucket && <Chip text={`Aging: ${tags.balanceAgingBucket}`} tone="warn" />}
            <Chip text={tags.valueTier!} tone={tags.valueTier === 'HIGH_VALUE' ? 'default' : 'default'} />
            {typeof tags.accountBalance === 'number' && tags.accountBalance > 0 && (
              <Chip text={formatUGX(tags.accountBalance)} tone="warn" />
            )}
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Payment Type</p>
            <select
              value={draft.paymentType ?? tags.paymentType ?? ''}
              onChange={e => setDraft(d => ({ ...d, paymentType: (e.target.value || null) as any }))}
              className="w-full text-sm px-2 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-white"
            >
              <option value="">Not set</option>
              {PAYMENT_TYPES.map(s => <option key={s} value={s}>{label(s)}</option>)}
            </select>
          </div>
        </Section>
      )}

      {/* Risk / Urgency */}
      <Section title="Risk & Urgency">
        <MultiSelect
          options={RISK_FLAGS}
          selected={riskFlags}
          onToggle={(v) => {
            const next = riskFlags.includes(v) ? riskFlags.filter(t => t !== v) : [...riskFlags, v]
            setDraft(d => ({ ...d, riskFlags: next as any }))
          }}
        />
      </Section>

      {/* Source / Preference */}
      <Section title="Source & Preferences">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-slate-500 mb-1">Referral Source</p>
            <select
              value={draft.crmReferralSource ?? tags.crmReferralSource ?? ''}
              onChange={e => {
                const next = (e.target.value || null) as any
                setDraft(d => ({
                  ...d,
                  crmReferralSource: next,
                  // Referral source changed away from Patient Referral — the
                  // "Referred By" link no longer means anything, so clear it
                  // in the same edit rather than leaving a stale relationship.
                  ...(next !== 'PATIENT_REFERRAL' ? { crmReferredByPatientId: null } : {}),
                }))
              }}
              className="w-full text-sm px-2 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-white"
            >
              <option value="">Not set</option>
              {REFERRAL_SOURCES.map(s => <option key={s} value={s}>{label(s)}</option>)}
            </select>
          </div>
          {(draft.crmReferralSource ?? tags.crmReferralSource) === 'PATIENT_REFERRAL' && (
            <div>
              <p className="text-xs text-slate-500 mb-1">Referred By</p>
              <ReferredByPicker
                patientId={patientId}
                token={token}
                currentId={draft.crmReferredByPatientId !== undefined ? draft.crmReferredByPatientId : tags.crmReferredByPatientId}
                currentLabel={
                  draft.crmReferredByPatientId !== undefined
                    ? pickedReferrerLabel
                    : (tags.crmReferredByPatient ? `${tags.crmReferredByPatient.firstName} ${tags.crmReferredByPatient.lastName}` : null)
                }
                onChange={(id, referrerLabel) => {
                  setPickedReferrerLabel(referrerLabel)
                  setDraft(d => ({ ...d, crmReferredByPatientId: id }))
                }}
              />
            </div>
          )}
          <div>
            <p className="text-xs text-slate-500 mb-1">Preferred Channel</p>
            <select
              value={draft.commsChannelPref ?? tags.commsChannelPref ?? ''}
              onChange={e => setDraft(d => ({ ...d, commsChannelPref: (e.target.value || null) as any }))}
              className="w-full text-sm px-2 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-white"
            >
              <option value="">Not set</option>
              {CHANNELS.map(s => <option key={s} value={s}>{label(s)}</option>)}
            </select>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Language Preference</p>
            <input
              value={draft.languagePref ?? tags.languagePref ?? ''}
              onChange={e => setDraft(d => ({ ...d, languagePref: e.target.value }))}
              className="w-full text-sm px-2 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-white"
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-4 pt-1">
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-white/70">
            <input
              type="checkbox"
              checked={draft.waitlistAvailable ?? tags.waitlistAvailable}
              onChange={e => setDraft(d => ({ ...d, waitlistAvailable: e.target.checked }))}
            />
            Available for same-day waitlist
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-white/70">
            <input
              type="checkbox"
              checked={draft.negativeExperience ?? tags.negativeExperience}
              onChange={e => setDraft(d => ({ ...d, negativeExperience: e.target.checked }))}
            />
            Negative experience (suppress review requests)
          </label>
        </div>
      </Section>

      <ConsentHistorySection patientId={patientId} token={token} />

      <div className="flex justify-end gap-2 sticky bottom-0 bg-gradient-to-t from-white dark:from-[#0b1220] pt-2">
        {hasDraft && (
          <button onClick={() => setDraft({})} className="px-4 py-2 rounded-xl text-sm font-semibold text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10">
            Discard
          </button>
        )}
        <button
          onClick={save}
          disabled={!hasDraft || saving}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 transition-colors"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save Changes
        </button>
      </div>
    </div>
  )
}