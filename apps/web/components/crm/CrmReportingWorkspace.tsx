'use client'

// CRM Automation — business reporting (Product Experience Closure, Part 14).
//
// This is the canonical, business-facing home for every CRM report. It
// replaces the old "Open Full Reporting -> CRM Automation Settings" link:
// the exact same reporting.service.ts endpoints are reused (extracted from
// admin/crm-automation/page.tsx's ReportingPanel, which no longer renders a
// reporting tab — Settings and Reports are now two different destinations,
// not one page wearing two hats), plus two new report tabs (Source
// Performance, Campaign Performance) and direct links to Revenue and
// Referrals, which already have their own richer dedicated workspaces and
// are intentionally not duplicated here.
import NextLink from 'next/link'
import { useEffect, useState } from 'react'
import {
  Users, GitBranch, Clock, AlertCircle, CheckCircle2, Zap, DollarSign, Phone,
  Megaphone, Share2, Wallet, ArrowUpRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const API = '/api-proxy'
const token = () => typeof window !== 'undefined' ? localStorage.getItem('cc_token') : ''
const authHeaders = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` })

const REPORT_TABS = [
  { key: 'leaderboard',  label: 'Response Performance',       icon: Users,      path: 'response-time-leaderboard' },
  { key: 'conversion',   label: 'Conversion',                 icon: GitBranch,  path: 'stage-conversion-rates' },
  { key: 'source',       label: 'Source Performance',         icon: Share2,     path: 'source-performance' },
  { key: 'campaign',     label: 'Campaign Performance',       icon: Megaphone,  path: 'campaign-performance' },
  { key: 'stale',        label: 'Stale Leads',                icon: Clock,      path: 'stale-leads' },
  { key: 'cold',         label: 'Weekly Cold Leads',          icon: AlertCircle,path: 'weekly-cold-leads' },
  { key: 'caseAcceptance', label: 'Case Acceptance',          icon: CheckCircle2, path: 'case-acceptance' },
  { key: 'sequences',    label: 'Sequence Performance',       icon: Zap,        path: 'sequence-performance' },
  { key: 'ar',           label: 'Receivables',                icon: DollarSign, path: 'aging-receivables' },
  { key: 'calls',        label: 'Call Performance',           icon: Phone,      path: 'call-performance' },
] as const

function pct(n: number | null) { return n == null ? '—' : `${(n * 100).toFixed(1)}%` }
function ugx(n: number) { return `UGX ${n.toLocaleString('en-UG')}` }

const SOURCE_LABEL: Record<string, string> = {
  WHATSAPP: 'WhatsApp', FACEBOOK: 'Facebook', INSTAGRAM: 'Instagram', WEBSITE: 'Website',
  WALKIN: 'Walk-in', QUIZ: 'Internal Quiz', SCOREAPP: 'ScoreApp', OTHER: 'Other',
}

export default function CrmReportingWorkspace({ revenueHref, referralsHref }: { revenueHref?: string; referralsHref: string }) {
  const [sub, setSub] = useState<typeof REPORT_TABS[number]['key']>('leaderboard')
  const [data, setData] = useState<Record<string, any>>({})
  const [loading, setLoading] = useState<Record<string, 'loading' | 'ok' | 'forbidden' | 'error'>>({})

  function loadSub(key: typeof REPORT_TABS[number]['key']) {
    if (loading[key] === 'loading' || loading[key] === 'ok') return
    const tab = REPORT_TABS.find(t => t.key === key)!
    setLoading(l => ({ ...l, [key]: 'loading' }))
    fetch(`${API}/crm-automation/reports/${tab.path}`, { headers: authHeaders() })
      .then(r => {
        if (r.status === 403) { setLoading(l => ({ ...l, [key]: 'forbidden' })); return null }
        if (!r.ok) { setLoading(l => ({ ...l, [key]: 'error' })); return null }
        return r.json()
      })
      .then(d => { if (d !== null && d !== undefined) { setData(v => ({ ...v, [key]: d })); setLoading(l => ({ ...l, [key]: 'ok' })) } })
      .catch(() => setLoading(l => ({ ...l, [key]: 'error' })))
  }
  useEffect(() => { loadSub(sub) }, [sub]) // eslint-disable-line react-hooks/exhaustive-deps

  const status = loading[sub]
  const d = data[sub]

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-extrabold text-gray-800 dark:text-white">Reports</h1>
        <p className="text-sm text-gray-500 dark:text-white/50">Real CRM metrics, organised by what you're trying to answer.</p>
      </div>

      <div className={cn('grid grid-cols-1 gap-3', revenueHref && 'sm:grid-cols-2')}>
        {revenueHref && (
          <NextLink href={revenueHref} className="flex items-center justify-between rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 p-4 hover:border-blue-200 dark:hover:border-blue-400/30 transition-colors">
            <span className="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-white"><Wallet size={16} className="text-emerald-500" /> Revenue</span>
            <ArrowUpRight size={15} className="text-gray-400" />
          </NextLink>
        )}
        <NextLink href={referralsHref} className="flex items-center justify-between rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 p-4 hover:border-blue-200 dark:hover:border-blue-400/30 transition-colors">
          <span className="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-white"><Share2 size={16} className="text-amber-500" /> Referrals</span>
          <ArrowUpRight size={15} className="text-gray-400" />
        </NextLink>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {REPORT_TABS.map(t => (
          <button key={t.key} onClick={() => setSub(t.key)}
            className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-colors',
              sub === t.key ? 'bg-cyan-600 text-white' : 'bg-gray-100 dark:bg-white/8 text-gray-600 dark:text-white/60 hover:bg-gray-200 dark:hover:bg-white/15')}>
            <t.icon size={13} /> {t.label}
          </button>
        ))}
      </div>

      {status === 'loading' && <div className="flex justify-center py-10"><div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-cyan-500" /></div>}
      {status === 'forbidden' && <p className="text-sm text-gray-400 text-center py-10">Restricted to Accounts/Admin.</p>}
      {status === 'error' && <p className="text-sm text-red-400 text-center py-10">Failed to load this report.</p>}

      {status === 'ok' && sub === 'leaderboard' && (
        <div className="bg-white dark:bg-white/5 border border-gray-100 dark:border-white/10 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-white/5 text-[10px] uppercase text-gray-400 font-black">
              <tr><th className="text-left px-4 py-2.5">Owner</th><th className="text-right px-4 py-2.5">Leads</th><th className="text-right px-4 py-2.5">Avg (min)</th><th className="text-right px-4 py-2.5">Median (min)</th></tr>
            </thead>
            <tbody>
              {(d ?? []).map((row: any) => (
                <tr key={row.ownerId} className="border-t border-gray-100 dark:border-white/10">
                  <td className="px-4 py-2.5 font-semibold text-gray-700 dark:text-white/80">{row.ownerName}</td>
                  <td className="px-4 py-2.5 text-right text-gray-500">{row.leadCount}</td>
                  <td className="px-4 py-2.5 text-right text-gray-500">{row.avgMinutes.toFixed(1)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-500">{row.medianMinutes.toFixed(1)}</td>
                </tr>
              ))}
              {(d ?? []).length === 0 && <tr><td colSpan={4} className="text-center py-8 text-gray-400">No leads with a logged first reply yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {status === 'ok' && sub === 'conversion' && d && (
        <div className="space-y-3">
          <p className="text-xs text-gray-500 dark:text-white/60">{d.note} {d.leadsWithoutStageHistory} leads have no recorded stage history.</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { label: 'New → Contacted', rate: d.newToContactedRate, n: d.totals.totalNew },
            { label: 'Contacted → Qualified', rate: d.contactedToQualifiedRate, n: d.totals.contactedCount },
            { label: 'Qualified → Converted', rate: d.qualifiedToConvertedRate, n: d.totals.qualifiedCount },
          ].map(c => (
            <div key={c.label} className="bg-white dark:bg-white/5 border border-gray-100 dark:border-white/10 rounded-2xl p-4">
              <p className="text-[10px] font-black uppercase text-gray-400">{c.label}</p>
              <p className="text-2xl font-black text-gray-800 dark:text-white mt-1">{pct(c.rate)}</p>
              <p className="text-[11px] text-gray-400 mt-0.5">{c.n > 0 ? `of ${c.n} leads` : 'No eligible leads yet'}</p>
            </div>
          ))}
          </div>
        </div>
      )}

      {status === 'ok' && sub === 'source' && d && (
        <div className="bg-white dark:bg-white/5 border border-gray-100 dark:border-white/10 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-white/5 text-[10px] uppercase text-gray-400 font-black">
              <tr><th className="text-left px-4 py-2.5">Source</th><th className="text-right px-4 py-2.5">Leads</th><th className="text-right px-4 py-2.5">Qualified</th><th className="text-right px-4 py-2.5">Converted</th><th className="text-right px-4 py-2.5">Lost</th></tr>
            </thead>
            <tbody>
              {(d.sources ?? []).map((row: any) => (
                <tr key={row.source} className="border-t border-gray-100 dark:border-white/10">
                  <td className="px-4 py-2.5 font-semibold text-gray-700 dark:text-white/80">{SOURCE_LABEL[row.source] ?? row.source}</td>
                  <td className="px-4 py-2.5 text-right text-gray-500">{row.leadCount}</td>
                  <td className="px-4 py-2.5 text-right text-cyan-600 dark:text-cyan-400">{row.qualifiedCount}</td>
                  <td className="px-4 py-2.5 text-right font-bold text-emerald-600 dark:text-emerald-400">{row.convertedCount}</td>
                  <td className="px-4 py-2.5 text-right text-red-500">{row.lostCount}</td>
                </tr>
              ))}
              {(d.sources ?? []).length === 0 && <tr><td colSpan={5} className="text-center py-8 text-gray-400">No leads recorded yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {status === 'ok' && sub === 'campaign' && d && (
        <div className="space-y-2">
          <div className="bg-white dark:bg-white/5 border border-gray-100 dark:border-white/10 rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-white/5 text-[10px] uppercase text-gray-400 font-black">
                <tr><th className="text-left px-4 py-2.5">Campaign</th><th className="text-right px-4 py-2.5">Leads</th><th className="text-right px-4 py-2.5">Qualified</th><th className="text-right px-4 py-2.5">Converted</th><th className="text-right px-4 py-2.5">Collected</th></tr>
              </thead>
              <tbody>
                {(d.campaigns ?? []).map((row: any) => (
                  <tr key={row.campaignId} className="border-t border-gray-100 dark:border-white/10">
                    <td className="px-4 py-2.5 font-semibold text-gray-700 dark:text-white/80">{row.campaignName || row.campaignId}</td>
                    <td className="px-4 py-2.5 text-right text-gray-500">{row.leadCount}</td>
                    <td className="px-4 py-2.5 text-right text-cyan-600 dark:text-cyan-400">{row.qualifiedCount}</td>
                    <td className="px-4 py-2.5 text-right font-bold text-emerald-600 dark:text-emerald-400">{row.convertedCount}</td>
                    <td className="px-4 py-2.5 text-right text-gray-500">{ugx(row.collectedUGX)}</td>
                  </tr>
                ))}
                {(d.campaigns ?? []).length === 0 && <tr><td colSpan={5} className="text-center py-8 text-gray-400">No leads are tagged with a campaign yet.</td></tr>}
              </tbody>
            </table>
          </div>
          {d.note && <p className="text-[11px] text-gray-400 dark:text-white/30">{d.note}</p>}
        </div>
      )}

      {status === 'ok' && sub === 'stale' && (
        <div className="space-y-2">
          {(d ?? []).length === 0 && <p className="text-sm text-gray-400 text-center py-8">No leads untouched past 24 hours.</p>}
          {(d ?? []).map((grp: any) => (
            <div key={grp.ownerId} className="bg-white dark:bg-white/5 border border-gray-100 dark:border-white/10 rounded-2xl p-4">
              <p className="font-bold text-sm text-gray-800 dark:text-white mb-2">{grp.ownerId === 'unassigned' ? 'Unassigned' : grp.ownerId} — {grp.count} stale</p>
              <div className="space-y-1">
                {grp.leads.map((l: any) => (
                  <p key={l.id} className="text-xs text-gray-500 flex justify-between"><span>{l.name || l.phone}</span><span>{new Date(l.createdAt).toLocaleDateString()}</span></p>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {status === 'ok' && sub === 'cold' && (
        <div className="bg-white dark:bg-white/5 border border-gray-100 dark:border-white/10 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-white/5 text-[10px] uppercase text-gray-400 font-black">
              <tr><th className="text-left px-4 py-2.5">Lead</th><th className="text-left px-4 py-2.5">Source</th><th className="text-left px-4 py-2.5">Loss Reason</th><th className="text-right px-4 py-2.5">Moved to Lost</th></tr>
            </thead>
            <tbody>
              {(d ?? []).map((row: any) => (
                <tr key={row.id} className="border-t border-gray-100 dark:border-white/10">
                  <td className="px-4 py-2.5 font-semibold text-gray-700 dark:text-white/80">{row.lead?.name || row.lead?.phone}</td>
                  <td className="px-4 py-2.5 text-gray-500">{row.lead?.source}</td>
                  <td className="px-4 py-2.5 text-gray-500">{row.lead?.lossReason ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right text-gray-500">{new Date(row.changedAt).toLocaleDateString()}</td>
                </tr>
              ))}
              {(d ?? []).length === 0 && <tr><td colSpan={4} className="text-center py-8 text-gray-400">No leads moved to Lost in the past 7 days.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {status === 'ok' && sub === 'caseAcceptance' && d && (
        <div className="space-y-3">
          <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/30 rounded-2xl p-3 text-xs text-amber-700 dark:text-amber-300">
            This counts patients by their current CRM tag (treatment plan status). For the per-doctor, date-ranged acceptance rate over individual treatment plans, see the clinical Reports hub's Case Acceptance Rate report instead — both are real, they measure different things.
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {Object.entries(d.counts as Record<string, number>).map(([status, count]) => (
              <div key={status} className="bg-white dark:bg-white/5 border border-gray-100 dark:border-white/10 rounded-2xl p-4">
                <p className="text-[10px] font-black uppercase text-gray-400">{status}</p>
                <p className="text-xl font-black text-gray-800 dark:text-white mt-1">{count}</p>
              </div>
            ))}
          </div>
          <div className="bg-white dark:bg-white/5 border border-gray-100 dark:border-white/10 rounded-2xl p-4">
            <p className="text-[10px] font-black uppercase text-gray-400">Acceptance Rate</p>
            <p className="text-xl font-black text-gray-800 dark:text-white mt-1">{pct(d.acceptanceRate)}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">Accepted ÷ (Proposed + Accepted + Declined + Incomplete)</p>
          </div>
        </div>
      )}

      {status === 'ok' && sub === 'sequences' && (
        <div className="bg-white dark:bg-white/5 border border-gray-100 dark:border-white/10 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-white/5 text-[10px] uppercase text-gray-400 font-black">
              <tr><th className="text-left px-4 py-2.5">Sequence</th><th className="text-left px-4 py-2.5">Entity</th><th className="text-right px-4 py-2.5">Enrolled</th><th className="text-right px-4 py-2.5">Response Rate</th><th className="text-right px-4 py-2.5">Booking Rate</th></tr>
            </thead>
            <tbody>
              {(d ?? []).map((row: any) => (
                <tr key={row.sequenceId} className="border-t border-gray-100 dark:border-white/10">
                  <td className="px-4 py-2.5 font-semibold text-gray-700 dark:text-white/80">{row.name} <span className="text-gray-400 font-normal text-xs">({row.key})</span></td>
                  <td className="px-4 py-2.5 text-gray-500">{row.entityType}</td>
                  <td className="px-4 py-2.5 text-right text-gray-500">{row.totalEnrollments}</td>
                  <td className="px-4 py-2.5 text-right text-gray-500">{pct(row.responseRate)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-500">{pct(row.bookingRate)}</td>
                </tr>
              ))}
              {(d ?? []).length === 0 && <tr><td colSpan={5} className="text-center py-8 text-gray-400">No sequences defined yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {status === 'ok' && sub === 'ar' && d && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {Object.entries(d).length === 0 && <p className="text-sm text-gray-400 col-span-full text-center py-8">No outstanding balances.</p>}
          {Object.entries(d).map(([bucket, v]: [string, any]) => (
            <div key={bucket} className="bg-white dark:bg-white/5 border border-gray-100 dark:border-white/10 rounded-2xl p-4">
              <p className="text-[10px] font-black uppercase text-gray-400">{bucket}</p>
              <p className="text-xl font-black text-gray-800 dark:text-white mt-1">{ugx(v.totalOwedUGX)}</p>
              <p className="text-[11px] text-gray-400 mt-0.5">{v.count} patient(s)</p>
            </div>
          ))}
        </div>
      )}

      {status === 'ok' && sub === 'calls' && d && (
        <div className="space-y-3">
          <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/30 rounded-2xl p-3 text-xs text-amber-700 dark:text-amber-300">
            Calling is currently a <strong>PAUSED</strong> Code Clinic channel — the figures below are real logged events, not fake data, but a meaningful share of "missed" calls here is unsolicited SIP scanner/probe traffic hitting the trunk, not real patients.
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Logged', v: d.totalLogged }, { label: 'Missed', v: d.missedCount },
              { label: 'Answered', v: d.answeredCount }, { label: 'Answer Rate', v: pct(d.answerRate) },
            ].map(c => (
              <div key={c.label} className="bg-white dark:bg-white/5 border border-gray-100 dark:border-white/10 rounded-2xl p-4">
                <p className="text-[10px] font-black uppercase text-gray-400">{c.label}</p>
                <p className="text-xl font-black text-gray-800 dark:text-white mt-1">{c.v}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400">{d.note}</p>
        </div>
      )}
    </div>
  )
}
