'use client'

import { useEffect, useState } from 'react'
import { Wallet, Info } from 'lucide-react'
import { formatUGX } from '@/lib/utils'

interface UnattributedSummary {
  totalCollectedUGX: number
  attributedToLeadUGX: number
  ambiguousMultiLeadUGX: number
  unattributedUGX: number
  note: string
}
interface Bucket {
  key: string
  leadCount: number
  bookedCount: number
  attendedCount: number
  treatmentAcceptedCount: number
  treatmentValueUGX: number
  invoicedUGX: number
  collectedUGX: number
}

const SOURCE_LABEL: Record<string, string> = {
  WHATSAPP: 'WhatsApp', FACEBOOK: 'Facebook', INSTAGRAM: 'Instagram', WEBSITE: 'Website',
  WALKIN: 'Walk-in', QUIZ: 'Internal Quiz', SCOREAPP: 'ScoreApp', OTHER: 'Other',
}

// This entire workspace only exists because revenue-attribution.service.ts
// applies a strict rule: a patient's revenue counts toward a source/lead ONLY
// when exactly one lead ever pointed at that patient. Patients linked from
// more than one lead are excluded, not guessed at. See the `note` fields
// surfaced verbatim below — this is not decorative copy, it's the honesty
// contract for every number on this page.
export default function RevenueWorkspace() {
  const [summary, setSummary] = useState<UnattributedSummary | null>(null)
  const [buckets, setBuckets] = useState<Bucket[] | null>(null)
  const [bucketNote, setBucketNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
    const authH = { Authorization: `Bearer ${token}` }
    Promise.all([
      fetch('/api-proxy/crm-automation/reports/unattributed-revenue', { headers: authH }),
      fetch('/api-proxy/crm-automation/reports/acquisition-revenue-by/source', { headers: authH }),
    ]).then(async ([sumRes, bucketRes]) => {
      if (sumRes.status === 403 || bucketRes.status === 403) { setForbidden(true); return }
      if (sumRes.ok) setSummary(await sumRes.json())
      if (bucketRes.ok) { const d = await bucketRes.json(); setBuckets(d.buckets); setBucketNote(`${d.ambiguousPatientCount} patient(s) linked from more than one lead are excluded from every bucket below.`) }
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  if (forbidden) {
    return <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 p-10 text-center">
      <p className="text-sm font-semibold text-gray-700 dark:text-white/80">Revenue data is restricted to Admin and Accounts.</p>
    </div>
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-extrabold text-gray-800 dark:text-white">Revenue</h1>
        <p className="text-sm text-gray-500 dark:text-white/50">Only revenue with a single, unambiguous lead-to-patient link is attributed. Everything else is reported honestly as unattributed or ambiguous — never guessed.</p>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400 dark:text-white/40">Loading…</p>
      ) : !summary ? (
        <p className="text-sm text-gray-400 dark:text-white/40">Unavailable.</p>
      ) : (
        <>
          {/* Root cause of a genuinely-zero Total Collected: this report
              reads ONLY the local Code Clinic invoices/payments tables
              (Accounts module) — the same tables the Accounts dashboard
              itself reads. If the clinic's real payment activity is
              recorded in QuickBooks instead, it has not been synced back
              into these local tables (that sync is currently one-way,
              local -> QuickBooks only), so it is invisible here. This is
              not a query bug — say so honestly rather than showing a
              silent, unexplained zero. */}
          {summary.totalCollectedUGX === 0 && (
            <div className="flex items-start gap-2 rounded-2xl border border-amber-200 dark:border-amber-400/20 bg-amber-50 dark:bg-amber-400/10 p-4 text-xs text-amber-800 dark:text-amber-300">
              <Info size={14} className="mt-0.5 flex-shrink-0" />
              <span>Total Collected is UGX 0 because no payments exist yet in Code Clinic's own Accounts records. If the clinic records payments in QuickBooks instead, that activity is not reflected here — QuickBooks sync is currently one-way (Code Clinic → QuickBooks only), so this report cannot show it without a separate two-way sync.</span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 p-4">
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-white/50"><Wallet size={12} /> Total Collected</p>
              <p className="mt-1 text-2xl font-extrabold text-gray-800 dark:text-white">{formatUGX(summary.totalCollectedUGX)}</p>
            </div>
            <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 p-4">
              <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">Attributed to a Lead</p>
              <p className="mt-1 text-2xl font-extrabold text-emerald-600 dark:text-emerald-400">{formatUGX(summary.attributedToLeadUGX)}</p>
            </div>
            <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 p-4">
              <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400 dark:text-white/40">Unattributed</p>
              <p className="mt-1 text-2xl font-extrabold text-gray-500 dark:text-white/50">{formatUGX(summary.unattributedUGX)}</p>
            </div>
          </div>
          <p className="flex items-start gap-1.5 text-[11px] text-gray-400 dark:text-white/30"><Info size={13} className="mt-0.5 flex-shrink-0" /> {summary.note}</p>

          <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 overflow-hidden">
            <div className="border-b border-gray-100 dark:border-white/10 px-4 py-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-white/50">Revenue by Source</p>
            </div>
            {!buckets || buckets.length === 0 ? (
              <p className="p-6 text-sm text-gray-400 dark:text-white/40">No attributable revenue yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 dark:bg-white/5">
                    <tr className="text-gray-500 dark:text-white/50 text-xs">
                      <th className="px-4 py-3 font-bold">Source</th>
                      <th className="px-4 py-3 font-bold text-right">Leads</th>
                      <th className="px-4 py-3 font-bold text-right">Booked</th>
                      <th className="px-4 py-3 font-bold text-right">Attended</th>
                      <th className="px-4 py-3 font-bold text-right">Treatment Value</th>
                      <th className="px-4 py-3 font-bold text-right">Invoiced</th>
                      <th className="px-4 py-3 font-bold text-right">Collected</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                    {buckets.map(b => (
                      <tr key={b.key}>
                        <td className="px-4 py-3 font-semibold text-gray-800 dark:text-white">{SOURCE_LABEL[b.key] ?? b.key}</td>
                        <td className="px-4 py-3 text-right text-gray-600 dark:text-white/60">{b.leadCount}</td>
                        <td className="px-4 py-3 text-right text-gray-600 dark:text-white/60">{b.bookedCount}</td>
                        <td className="px-4 py-3 text-right text-gray-600 dark:text-white/60">{b.attendedCount}</td>
                        <td className="px-4 py-3 text-right text-gray-600 dark:text-white/60">{formatUGX(b.treatmentValueUGX)}</td>
                        <td className="px-4 py-3 text-right text-gray-600 dark:text-white/60">{formatUGX(b.invoicedUGX)}</td>
                        <td className="px-4 py-3 text-right font-bold text-emerald-600 dark:text-emerald-400">{formatUGX(b.collectedUGX)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {bucketNote && <p className="border-t border-gray-100 dark:border-white/10 px-4 py-2 text-[11px] text-gray-400 dark:text-white/30">{bucketNote}</p>}
          </div>
        </>
      )}
    </div>
  )
}
