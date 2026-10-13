'use client'

// CRM Automation — Reviews (Patient Engagement, Admin only — every endpoint
// this page calls is adminOnly). Shows real patient feedback (in-app
// ratings) and real outbound review-request activity, plus the existing
// post-visit review-request configuration form. The send logic itself
// (review-request.service.ts) is untouched and unreused here — no review
// request is ever sent from this page.

import { useEffect, useState } from 'react'
import { Star, Info } from 'lucide-react'

interface ReviewConfig { id?: string; delayHours: number; isActive: boolean; gbpPlaceId: string | null; reviewLinkOverride: string | null }
interface FeedbackEntry { id: string; patientId: string; patientName: string; rating: number; comment: string | null; channel: string; submittedAt: string }
interface ReviewsOverview {
  feedback: { totalCount: number; averageRating: number | null; ratingBreakdown: Record<string, number>; recent: FeedbackEntry[] }
  reviewRequests: { totalCount: number; byStatus: Record<string, number> }
}

export default function ReviewsWorkspace() {
  const API = '/api-proxy'
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const authH = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }

  const [config, setConfig] = useState<ReviewConfig | null>(null)
  const [overview, setOverview] = useState<ReviewsOverview | null>(null)
  const [draft, setDraft] = useState<Partial<ReviewConfig>>({})
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [gbpStatus, setGbpStatus] = useState<{ connected: boolean; configured?: boolean; message?: string } | null>(null)
  const [gbpAccounts, setGbpAccounts] = useState<{ name: string; accountName?: string }[]>([])
  const [gbpLocations, setGbpLocations] = useState<{ account: string; locations: { name: string; title?: string }[] }[]>([])
  const [gbpAccount, setGbpAccount] = useState('')
  const [gbpLocation, setGbpLocation] = useState('')
  const [gbpReviews, setGbpReviews] = useState<{ averageRating: number | null; totalReviewCount: number; reviews: { reviewId: string; reviewer?: string; starRating?: string; comment?: string; createTime?: string; reviewReply?: string | null }[]; nextPageToken?: string | null } | null>(null)
  const [gbpBusy, setGbpBusy] = useState(false)
  const [gbpError, setGbpError] = useState('')
  const [gbpNextPage, setGbpNextPage] = useState<string | null>(null)

  async function gbpGet(path: string) {
    const response = await fetch(`${API}/business-profile/${path}`, { headers: { Authorization: `Bearer ${localStorage.getItem('cc_token')}` } })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.message || data.error || 'Google Business Profile request failed')
    return data
  }

  async function loadGbpConnection() {
    setGbpBusy(true); setGbpError('')
    try {
      const status = await gbpGet('status')
      setGbpStatus(status)
      if (!status.connected) return
      const [accounts, locations] = await Promise.all([gbpGet('accounts'), gbpGet('locations')])
      setGbpAccounts(accounts.accounts || [])
      setGbpLocations(locations.results || [])
      const available = (locations.results || []).flatMap((item: { account: string; locations?: { name: string; title?: string }[] }) =>
        (item.locations || []).map(location => ({ account: item.account, ...location })))
      const chosen = available.find((location: { title?: string }) => /code clinic/i.test(location.title || ''))
      if (chosen) { setGbpAccount(chosen.account); setGbpLocation(chosen.name) }
    } catch (e: any) { setGbpError(e.message || 'Unable to load Google Business Profile') }
    finally { setGbpBusy(false) }
  }

  async function connectGbp() {
    setGbpBusy(true); setGbpError('')
    try {
      const data = await gbpGet('auth-url?returnTo=/crm/reviews')
      if (!data.url || !/^https:\/\/accounts\.google\.com\//.test(data.url)) throw new Error('Unexpected Google authorization URL')
      window.location.assign(data.url)
    } catch (e: any) { setGbpError(e.message || 'Unable to connect Google') ; setGbpBusy(false) }
  }

  async function loadGbpReviews(nextToken?: string) {
    if (!gbpAccount || !gbpLocation) return
    setGbpBusy(true); setGbpError('')
    try {
      const query = new URLSearchParams({ accountId: gbpAccount, locationId: gbpLocation, pageSize: '50' })
      if (nextToken) query.set('pageToken', nextToken)
      const result = await gbpGet(`reviews?${query.toString()}`)
      setGbpReviews(previous => nextToken && previous ? { ...result, reviews: [...previous.reviews, ...(result.reviews || [])] } : result)
      setGbpNextPage(result.nextPageToken || null)
    } catch (e: any) { setGbpError(e.message || 'Unable to fetch Google reviews') }
    finally { setGbpBusy(false) }
  }

  useEffect(() => { void loadGbpConnection() }, [])

  // Read-only live polling while the Reviews workspace is open. A location
  // must be explicitly selected (or uniquely identified as Code Clinic).
  // No background job, database writes, or review replies are involved.
  useEffect(() => {
    if (!gbpStatus?.connected || !gbpAccount || !gbpLocation) return
    let active = true
    let pending = false
    const refresh = async () => {
      if (pending || !active || document.visibilityState === 'hidden') return
      pending = true
      try {
        const query = new URLSearchParams({ accountId: gbpAccount, locationId: gbpLocation, pageSize: '50' })
        const response = await fetch(`${API}/business-profile/reviews?${query.toString()}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('cc_token')}` },
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.message || data.error || 'Google reviews unavailable')
        if (active) {
          setGbpReviews(data)
          setGbpNextPage(data.nextPageToken || null)
          setGbpError('')
        }
      } catch (error: any) {
        if (active) setGbpError(error.message || 'Google reviews unavailable')
      } finally { pending = false }
    }
    void refresh()
    const interval = window.setInterval(() => { void refresh() }, 5 * 60 * 1000)
    return () => { active = false; window.clearInterval(interval) }
  }, [gbpStatus?.connected, gbpAccount, gbpLocation])



  useEffect(() => {
    Promise.all([
      fetch(`${API}/crm-automation/review-config`, { headers: authH as any }),
      fetch(`${API}/crm-automation/reviews/overview`, { headers: authH as any }),
    ]).then(async ([configRes, overviewRes]) => {
      if (configRes.status === 403 || overviewRes.status === 403) { setForbidden(true); return }
      if (configRes.ok) setConfig(await configRes.json())
      if (overviewRes.ok) setOverview(await overviewRes.json())
    }).catch(() => {}).finally(() => setLoading(false))
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
        <p className="text-sm text-gray-500 dark:text-white/50">Real patient feedback, outbound Google-review requests, and post-visit review request configuration.</p>
      </div>

      {loading ? <p className="text-sm text-gray-400 dark:text-white/40">Loading…</p> : (
        <>

          <section className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 p-4 space-y-3">
            <h2 className="text-sm font-bold text-gray-800 dark:text-white">Google Business Profile — Live Reviews</h2>
            <p className="text-xs text-gray-500">Google reviews load automatically when a location is selected and refresh every five minutes while this page is open. They are separate from the clinic's internal patient feedback and review-request logs. No replies are published from this screen.</p>
            {gbpError && <p role="alert" className="text-sm text-red-600">{gbpError}</p>}
            {!gbpStatus ? <p className="text-xs text-gray-500">Checking Google connection…</p> :
              !gbpStatus.connected ? <div className="space-y-2">
                <p className="text-xs text-amber-700">{gbpStatus.configured ? 'Google Business Profile needs administrator authorization.' : 'Google Business Profile OAuth credentials must first be configured on the API server.'}</p>
                <button type="button" disabled={gbpBusy || !gbpStatus.configured} onClick={() => void connectGbp()} className="rounded-lg bg-blue-700 text-white px-3 py-2 text-xs font-semibold disabled:opacity-40">Connect Google Business Profile</button>
              </div> : <>
                <p className="text-xs text-green-700">Google account authorized. Select the Code Clinic business location.</p>
                <label className="block text-xs">Business account
                  <select value={gbpAccount} onChange={e => { setGbpAccount(e.target.value); setGbpLocation(''); setGbpReviews(null) }} className="mt-1 w-full rounded-lg border p-2 dark:bg-slate-900">
                    <option value="">Choose account</option>
                    {gbpAccounts.map(a => <option key={a.name} value={a.name}>{a.accountName || a.name}</option>)}
                  </select>
                </label>
                <label className="block text-xs">Business location
                  <select value={gbpLocation} onChange={e => { setGbpLocation(e.target.value); setGbpReviews(null); setGbpNextPage(null) }} className="mt-1 w-full rounded-lg border p-2 dark:bg-slate-900">
                    <option value="">Choose location</option>
                    {gbpLocations.filter(item => item.account === gbpAccount).flatMap(item => item.locations.map(location => <option key={location.name} value={location.name}>{location.title || location.name}</option>))}
                  </select>
                </label>
                <button type="button" disabled={gbpBusy || !gbpAccount || !gbpLocation} onClick={() => void loadGbpReviews()} className="rounded-lg bg-blue-700 text-white px-3 py-2 text-xs font-semibold disabled:opacity-40">{gbpBusy ? 'Loading…' : 'Load / Refresh Google Reviews'}</button>
                {gbpReviews && <div className="space-y-3">
                  <p className="font-semibold text-sm">{gbpReviews.averageRating ?? '—'} / 5 · {gbpReviews.totalReviewCount} Google reviews</p>
                  {gbpReviews.reviews.map(review => <article key={review.reviewId} className="border-t pt-3 text-sm">
                    <div className="flex justify-between gap-2"><strong>{review.reviewer || 'Google reviewer'}</strong><span className="text-xs text-gray-500">{review.createTime ? new Date(review.createTime).toLocaleDateString('en-UG') : ''}</span></div>
                    <p className="text-amber-600 text-xs">{review.starRating?.replace(/_/g, ' ') || 'No rating'}</p>
                    {review.comment && <p className="mt-1 whitespace-pre-wrap">{review.comment}</p>}
                    {review.reviewReply && <p className="mt-2 text-xs text-gray-500">Clinic reply: {review.reviewReply}</p>}
                  </article>)}
                  {gbpNextPage && <button type="button" disabled={gbpBusy} onClick={() => void loadGbpReviews(gbpNextPage)} className="rounded-lg border px-3 py-2 text-xs font-semibold">Load more Google reviews</button>}
                </div>}
              </>}
          </section>
          {overview && (
            <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 p-4">
              <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-white/50 mb-1">Patient Feedback (in-app ratings)</p>
              <p className="text-xs text-gray-400 dark:text-white/30 mb-3">Star ratings and comments patients send back via WhatsApp after a visit — a different concept from the outbound Google-review requests configured below.</p>
              {overview.feedback.totalCount === 0 ? (
                <p className="text-sm text-gray-400 dark:text-white/40">No patient feedback has been received yet.</p>
              ) : (
                <>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-2xl font-extrabold text-gray-800 dark:text-white">{overview.feedback.averageRating ?? '—'}</span>
                    <span className="text-xs text-gray-400">avg / 5, from {overview.feedback.totalCount} rating(s)</span>
                  </div>
                  <div className="divide-y divide-gray-50 dark:divide-white/5">
                    {overview.feedback.recent.map(f => (
                      <div key={f.id} className="py-2 flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-gray-700 dark:text-white/80">{f.patientName} <span className="text-amber-500">{'★'.repeat(f.rating)}{'☆'.repeat(5 - f.rating)}</span></p>
                          {f.comment && <p className="text-xs text-gray-500 dark:text-white/50 mt-0.5">{f.comment}</p>}
                        </div>
                        <span className="text-[11px] text-gray-400 whitespace-nowrap">{new Date(f.submittedAt).toLocaleDateString()}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {overview && (
            <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 p-4">
              <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-white/50 mb-1">Outbound Google-Review Requests</p>
              {overview.reviewRequests.totalCount === 0 ? (
                <p className="text-sm text-gray-400 dark:text-white/40">No review requests have been sent yet — this stays empty until "Send review requests" is turned on below.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {Object.entries(overview.reviewRequests.byStatus).map(([status, count]) => (
                    <span key={status} className="px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-50 dark:bg-white/5 text-gray-600 dark:text-white/70">{status.replace(/_/g, ' ').toLowerCase()}: {count}</span>
                  ))}
                </div>
              )}
            </div>
          )}

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
        </>
      )}
    </div>
  )
}
