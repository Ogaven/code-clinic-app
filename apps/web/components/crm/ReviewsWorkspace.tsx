'use client'

// CRM Automation — Reviews (Patient Engagement, Admin only — the backend
// GET/POST /crm-automation/review-config are both adminOnly). Surfaces and
// edits the existing post-visit review-request configuration; the send
// logic itself (review-request.service.ts) is untouched and unreused here —
// this is purely the config screen, and no review request is ever sent
// from this page.

import { useEffect, useState } from 'react'
import { Star, Info } from 'lucide-react'

interface ReviewConfig { id?: string; delayHours: number; isActive: boolean; gbpPlaceId: string | null; reviewLinkOverride: string | null }

export default function ReviewsWorkspace() {
  const API = '/api-proxy'
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const authH = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }

  const [config, setConfig] = useState<ReviewConfig | null>(null)
  const [draft, setDraft] = useState<Partial<ReviewConfig>>({})
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`${API}/crm-automation/review-config`, { headers: authH as any })
      .then(r => { if (r.status === 403) { setForbidden(true); return null } return r.ok ? r.json() : null })
      .then(d => { if (d) setConfig(d) })
      .catch(() => {})
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function save() {
    setSaving(true); setError('')
    try {
      const body = { delayHours: draft.delayHours ?? config?.delayHours ?? 24, isActive: draft.isActive ?? config?.isActive ?? false, gbpPlaceId: draft.gbpPlaceId ?? config?.gbpPlaceId ?? null, reviewLinkOverride: draft.reviewLinkOverride ?? config?.reviewLinkOverride ?? null }
      const res = await fetch(`${API}/crm-automation/review-config`, { method: 'POST', headers: authH as any, body: JSON.stringify(body) })
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || 'Failed to save') }
      setConfig(await res.json()); setDraft({})
    } catch (e: any) { setError(e.message) } finally { setSaving(false) }
  }

  if (forbidden) {
    return <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 p-10 text-center">
      <p className="text-sm font-semibold text-gray-700 dark:text-white/80">Review request settings are restricted to Admin.</p>
    </div>
  }

  return (
    <div className="space-y-4 max-w-xl">
      <div>
        <h1 className="text-xl font-extrabold text-gray-800 dark:text-white flex items-center gap-2"><Star size={20} className="text-amber-500" /> Reviews</h1>
        <p className="text-sm text-gray-500 dark:text-white/50">Post-visit review request configuration.</p>
      </div>

      {loading ? <p className="text-sm text-gray-400 dark:text-white/40">Loading…</p> : (
        <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 p-4 space-y-3">
          {error && <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg p-3">{error}</div>}
          <label className="flex items-center justify-between text-sm">
            <span className="font-semibold text-gray-700 dark:text-white/80">Send review requests</span>
            <input type="checkbox" checked={draft.isActive ?? config?.isActive ?? false} onChange={e => setDraft(d => ({ ...d, isActive: e.target.checked }))} />
          </label>
          <div>
            <p className="text-xs text-gray-500 mb-1">Delay after visit (hours)</p>
            <input type="number" min={1} value={draft.delayHours ?? config?.delayHours ?? 24} onChange={e => setDraft(d => ({ ...d, delayHours: Number(e.target.value) }))}
              className="w-full text-sm px-2 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-white" />
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">Google Business Profile Place ID</p>
            <input value={draft.gbpPlaceId ?? config?.gbpPlaceId ?? ''} onChange={e => setDraft(d => ({ ...d, gbpPlaceId: e.target.value || null }))}
              className="w-full text-sm px-2 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-white" placeholder="e.g. ChIJ..." />
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">Review link override (optional)</p>
            <input value={draft.reviewLinkOverride ?? config?.reviewLinkOverride ?? ''} onChange={e => setDraft(d => ({ ...d, reviewLinkOverride: e.target.value || null }))}
              className="w-full text-sm px-2 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-white" placeholder="https://..." />
          </div>
          <p className="flex items-start gap-1.5 text-[11px] text-gray-400 dark:text-white/30">
            <Info size={13} className="mt-0.5 flex-shrink-0" />
            Automatically suppressed for any patient flagged with a negative experience. Sending requires a Place ID or link override to be set.
          </p>
          <button onClick={save} disabled={saving} className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40">
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      )}
    </div>
  )
}
