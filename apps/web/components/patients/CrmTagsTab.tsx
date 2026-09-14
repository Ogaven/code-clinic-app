'use client'

// CRM Automation — Patient Tag Taxonomy tab (Part U).
// Extends the existing Patient detail page with a new tab rather than
// redesigning it. Tags are grouped exactly per the spec's taxonomy
// (Clinical, Lifecycle, Financial, Risk, Source/Preference) — a section is
// simply omitted if the API didn't return any of its fields, which is how
// the server-side role stripping (DOCTOR never sees financial tags) surfaces
// here with zero extra client-side logic.

import { useEffect, useState } from 'react'
import { cn, formatUGX } from '@/lib/utils'
import { Loader2, Save, Sparkles, UserCog } from 'lucide-react'

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
  commsChannelPref: string | null
  languagePref: string | null
  waitlistAvailable: boolean
  negativeExperience: boolean
  tagsUpdatedAt: string | null
  tagsUpdatedBy: string | null
  accountBalance?: number
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

export default function CrmTagsTab({ patientId, token }: { patientId: string; token: string | null }) {
  const [tags, setTags] = useState<CrmTags | null>(null)
  const [draft, setDraft] = useState<Partial<CrmTags>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

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
              onChange={e => setDraft(d => ({ ...d, crmReferralSource: (e.target.value || null) as any }))}
              className="w-full text-sm px-2 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-white"
            >
              <option value="">Not set</option>
              {REFERRAL_SOURCES.map(s => <option key={s} value={s}>{label(s)}</option>)}
            </select>
          </div>
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