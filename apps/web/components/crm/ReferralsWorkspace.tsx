'use client'

// CRM Automation — Referrals (Leads section). Reuses the crmReferralSource/
// crmReferredByPatientId fields and "Referred By" picker from the prior
// Patient CRM Automation milestone — distinct from the legacy /referrals
// analytics page (Patient.referredBy, a free-text source-category field).
// Revenue-per-referral is deliberately not shown — see referrals.service.ts
// for why an approximate figure here would violate "don't fabricate
// referral relationships."

import { useEffect, useState } from 'react'
import { Share2 } from 'lucide-react'

interface ReferralRow {
  referredPatientId: string; referredPatientName: string; referredPatientPhone: string
  referredAt: string | null; referringPatientId: string; referringPatientName: string; treatmentPlanStatus: string
}
interface TopReferrer { patientId: string; name: string; count: number }
interface ReferralSummary { totalReferred: number; uniqueReferrers: number; newThisMonth: number; convertedTreatment: number }

export default function ReferralsWorkspace({ patientHref }: { patientHref: (id: string) => string }) {
  const [referrals, setReferrals] = useState<ReferralRow[] | null>(null)
  const [topReferrers, setTopReferrers] = useState<TopReferrer[]>([])
  const [summary, setSummary] = useState<ReferralSummary | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
    fetch('/api-proxy/crm-automation/referrals', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) { setReferrals(d.referrals); setTopReferrers(d.topReferrers); setSummary(d.summary ?? null) } })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-extrabold text-gray-800 dark:text-white flex items-center gap-2"><Share2 size={20} className="text-amber-500" /> Referrals</h1>
        <p className="text-sm text-gray-500 dark:text-white/50">Patients who referred another patient, from the "Referred By" field on each patient's record.</p>
        {/* This is a genuinely different, narrower number than the
            Dashboard's "Source Recorded" tile (any intake channel —
            Google/Walk-in/Instagram/etc). Both are correct; they measure
            different things, so they are never expected to match. */}
        <p className="text-xs text-gray-400 dark:text-white/30 mt-1">Only counts a real "Referred By" link set on a patient's CRM Tags — different from (and always smaller than) the Dashboard's "Source Recorded" figure, which includes every recorded acquisition channel.</p>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400 dark:text-white/40">Loading…</p>
      ) : !referrals || referrals.length === 0 ? (
        <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 p-10 text-center">
          <p className="text-sm font-semibold text-gray-600 dark:text-white/70">No patient referrals recorded yet.</p>
          <p className="text-xs text-gray-400 dark:text-white/40 mt-1 max-w-md mx-auto">This page only shows patients whose record has "Referred By" explicitly set to another patient (Patient profile → CRM Tags → Referral Source → Patient Referral). Nothing is inferred or guessed from older intake notes.</p>
        </div>
      ) : (
        <>
          {summary && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 p-4">
                <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-white/50">Total Referred</p>
                <p className="text-2xl font-extrabold text-gray-800 dark:text-white mt-1">{summary.totalReferred}</p>
              </div>
              <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 p-4">
                <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-white/50">Referring Patients</p>
                <p className="text-2xl font-extrabold text-gray-800 dark:text-white mt-1">{summary.uniqueReferrers}</p>
              </div>
              <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 p-4">
                <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-white/50">New This Month</p>
                <p className="text-2xl font-extrabold text-gray-800 dark:text-white mt-1">{summary.newThisMonth}</p>
              </div>
              <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 p-4">
                <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-white/50">Treatment Accepted</p>
                <p className="text-2xl font-extrabold text-gray-800 dark:text-white mt-1">{summary.convertedTreatment}</p>
              </div>
            </div>
          )}
          {topReferrers.length > 0 && (
            <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 p-4">
              <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-white/50 mb-2">Top Referrers</p>
              <div className="flex flex-wrap gap-2">
                {topReferrers.slice(0, 8).map(r => (
                  <a key={r.patientId} href={patientHref(r.patientId)} className="flex items-center gap-1.5 rounded-xl bg-gray-50 dark:bg-white/5 px-3 py-1.5 text-xs font-semibold text-gray-700 dark:text-white/80 hover:bg-gray-100 dark:hover:bg-white/10">
                    {r.name} <span className="text-amber-600 dark:text-amber-400">×{r.count}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
          <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 dark:bg-white/5">
                  <tr className="text-gray-500 dark:text-white/50 text-xs">
                    <th className="px-4 py-3 font-bold">Referred Patient</th>
                    <th className="px-4 py-3 font-bold">Referred By</th>
                    <th className="px-4 py-3 font-bold">Treatment Status</th>
                    <th className="px-4 py-3 font-bold text-right">Recorded</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                  {referrals.map(r => (
                    <tr key={r.referredPatientId}>
                      <td className="px-4 py-3">
                        <a href={patientHref(r.referredPatientId)} className="font-semibold text-gray-800 dark:text-white hover:text-blue-600 dark:hover:text-blue-400">{r.referredPatientName}</a>
                        <div className="text-[11px] text-gray-400">{r.referredPatientPhone}</div>
                      </td>
                      <td className="px-4 py-3">
                        <a href={patientHref(r.referringPatientId)} className="text-gray-700 dark:text-white/80 hover:text-blue-600 dark:hover:text-blue-400">{r.referringPatientName}</a>
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-white/60">{r.treatmentPlanStatus.replace(/_/g, ' ').toLowerCase()}</td>
                      <td className="px-4 py-3 text-right text-gray-400">{r.referredAt ? new Date(r.referredAt).toLocaleDateString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
