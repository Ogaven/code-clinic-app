'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Users, UserCheck, AlertCircle, ArrowUpRight, Megaphone, Clock,
  ThumbsDown, Wallet, TrendingUp,
} from 'lucide-react'
import { cn, formatUGX } from '@/lib/utils'
import { formatFunnelRate, formatResponseMinutes, overallAverageResponseMinutes } from '@/lib/crmFormat'
import NeedsAttentionPanel from '@/components/leads/NeedsAttentionPanel'

// ── Types (mirror the API's real response shapes — no fields invented) ────
interface StageConversionRates {
  newToContactedRate: number | null
  contactedToQualifiedRate: number | null
  qualifiedToConvertedRate: number | null
  totals: { totalNew: number; contactedCount: number; qualifiedCount: number; convertedCount: number }
  leadsWithoutStageHistory: number
}
interface NeedsAttentionSummary { totalItems: number; categories: Array<{ key: string; label: string; count: number }> }
interface SourcePerformance { sources: Array<{ source: string; leadCount: number; qualifiedCount: number; convertedCount: number; lostCount: number }> }
interface LostReasons { totalLost: number; reasons: Array<{ reason: string; count: number }> }
interface FollowUpCounts { counts: { dueToday: number; overdue: number; upcoming: number; completed: number } }
interface ResponseLeaderboardEntry { leadCount: number; avgMinutes: number }
interface UnattributedRevenue { totalCollectedUGX: number; attributedToLeadUGX: number; unattributedUGX: number; ambiguousMultiLeadUGX: number }

const SOURCE_LABEL: Record<string, string> = {
  WHATSAPP: 'WhatsApp', FACEBOOK: 'Facebook', INSTAGRAM: 'Instagram', WEBSITE: 'Website',
  WALKIN: 'Walk-in', QUIZ: 'Internal Quiz', SCOREAPP: 'ScoreApp', OTHER: 'Other',
}

// Empty path means "not applicable for this role" (e.g. Revenue for
// RECEPTIONIST, who lacks accountsOrAdmin server-side) — skipped entirely
// rather than firing a request that server-side RBAC would reject anyway.
function useCrmFetch<T>(path: string): { data: T | null; loading: boolean; error: boolean } {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(!!path)
  const [error, setError] = useState(false)

  const load = useCallback(async () => {
    if (!path) { setLoading(false); return }
    setLoading(true)
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
      const r = await fetch(`/api-proxy${path}`, { headers: { Authorization: `Bearer ${token}` } })
      if (!r.ok) { setError(true); setData(null); return }
      setData(await r.json())
      setError(false)
    } catch { setError(true); setData(null) }
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  useEffect(() => { load() }, [load])
  return { data, loading, error }
}

function Card({ title, action, children, className }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 p-4', className)}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-white/50">{title}</p>
        {action}
      </div>
      {children}
    </div>
  )
}

function Kpi({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 p-4">
      <span className={cn('grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl', tone)}><Icon size={18} /></span>
      <div className="min-w-0">
        <p className="text-xl font-extrabold leading-tight text-gray-800 dark:text-white truncate">{value}</p>
        <p className="text-[11px] font-medium text-gray-500 dark:text-white/50 truncate">{label}</p>
      </div>
    </div>
  )
}

// Real, defensible KPIs only — see PRODUCTION_COMPLETION_RECORD-style caveats
// throughout: Attended/Treatment Accepted/Invoiced/Collected are NOT derived
// from Lead.CONVERTED here. They live in the Revenue section below, sourced
// from revenue-attribution.service.ts's single-clean-lead attribution rule,
// never blended into this lead-funnel KPI strip.
export default function CrmDashboard({ leadsHref, followUpsHref, needsAttentionHref, sourcesHref, revenueHref, campaignsHref, role }: {
  leadsHref: string
  needsAttentionHref: string
  followUpsHref: string
  sourcesHref: string
  revenueHref: string
  campaignsHref: string
  role: 'ADMIN' | 'RECEPTIONIST'
}) {
  const funnel = useCrmFetch<StageConversionRates>('/crm-automation/reports/stage-conversion-rates')
  const attention = useCrmFetch<NeedsAttentionSummary>('/crm-automation/needs-attention')
  const sources = useCrmFetch<SourcePerformance>('/crm-automation/reports/source-performance')
  const lostReasons = useCrmFetch<LostReasons>('/crm-automation/reports/lost-reasons')
  const followUps = useCrmFetch<FollowUpCounts>('/crm-automation/follow-ups')
  const responseLeaderboard = useCrmFetch<ResponseLeaderboardEntry[]>('/crm-automation/reports/response-time-leaderboard')
  // Revenue attribution requires accountsOrAdmin server-side — RECEPTIONIST
  // never issues this request at all, not just hides the result client-side.
  const revenue = useCrmFetch<UnattributedRevenue>(role === 'ADMIN' ? '/crm-automation/reports/unattributed-revenue' : '')

  const totals = funnel.data?.totals
  const unanswered = attention.data?.categories.find(c => c.key === 'UNANSWERED_NEW')?.count ?? null
  const overallAvgResponse = overallAverageResponseMinutes(responseLeaderboard.data)

  return (
    <div className="space-y-4 pb-8">
      {/* Header */}
      <div>
        <h1 className="text-xl font-extrabold text-gray-800 dark:text-white">CRM</h1>
        <p className="text-sm text-gray-500 dark:text-white/50">Track enquiries, sales activity, conversions and revenue.</p>
      </div>

      {/* Primary KPIs — lead-funnel only, real distinct-lead counts */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi icon={Users} label="Total Leads" value={totals ? String(totals.totalNew) : '—'} tone="bg-blue-50 text-blue-600 dark:bg-blue-400/15 dark:text-blue-300" />
        <Kpi icon={AlertCircle} label="Needs Attention" value={attention.data ? String(attention.data.totalItems) : '—'} tone="bg-amber-50 text-amber-600 dark:bg-amber-400/15 dark:text-amber-300" />
        <Kpi icon={UserCheck} label="Qualified" value={totals ? String(totals.qualifiedCount) : '—'} tone="bg-cyan-50 text-cyan-600 dark:bg-cyan-400/15 dark:text-cyan-300" />
        <Kpi icon={TrendingUp} label="Converted" value={totals ? String(totals.convertedCount) : '—'} tone="bg-emerald-50 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-300" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Funnel */}
        <Card title="Funnel" className="lg:col-span-2">
          {!totals ? (
            <p className="text-sm text-gray-400 dark:text-white/40">{funnel.loading ? 'Loading…' : 'Unavailable'}</p>
          ) : (
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {[
                { label: 'Leads', count: totals.totalNew, rate: null as number | null },
                { label: 'Contacted', count: totals.contactedCount, rate: funnel.data!.newToContactedRate },
                { label: 'Qualified', count: totals.qualifiedCount, rate: funnel.data!.contactedToQualifiedRate },
                { label: 'Converted', count: totals.convertedCount, rate: funnel.data!.qualifiedToConvertedRate },
              ].map((stage, i, arr) => (
                <div key={stage.label} className="flex items-center gap-2 flex-shrink-0">
                  <Link href={leadsHref} className="flex flex-col items-center gap-1 rounded-xl px-3 py-2 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                    <span className="text-lg font-extrabold text-gray-800 dark:text-white">{stage.count}</span>
                    <span className="text-[10px] font-semibold text-gray-500 dark:text-white/50">{stage.label}</span>
                  </Link>
                  {i < arr.length - 1 && (
                    <div className="flex flex-col items-center gap-0.5 text-gray-300 dark:text-white/20">
                      <ArrowUpRight size={14} className="rotate-90" />
                      <span className="text-[9px] font-bold text-gray-400 dark:text-white/30">{formatFunnelRate(arr[i + 1].rate)}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {funnel.data && funnel.data.leadsWithoutStageHistory > 0 && (
            <p className="mt-2 text-[10px] text-gray-400 dark:text-white/30">{funnel.data.leadsWithoutStageHistory} lead(s) have no recorded stage history and are excluded from rate calculations.</p>
          )}
        </Card>

        {/* Follow-ups */}
        <Card title="Follow-ups" action={<Link href={followUpsHref} className="text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline">View all</Link>}>
          {!followUps.data ? (
            <p className="text-sm text-gray-400 dark:text-white/40">{followUps.loading ? 'Loading…' : 'Unavailable'}</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Due Today', value: followUps.data.counts.dueToday, tone: 'text-blue-600 dark:text-blue-300' },
                { label: 'Overdue', value: followUps.data.counts.overdue, tone: 'text-red-600 dark:text-red-300' },
                { label: 'Upcoming', value: followUps.data.counts.upcoming, tone: 'text-gray-600 dark:text-white/70' },
                { label: 'Completed', value: followUps.data.counts.completed, tone: 'text-emerald-600 dark:text-emerald-300' },
              ].map(s => (
                <div key={s.label} className="rounded-xl bg-gray-50 dark:bg-white/5 px-3 py-2">
                  <p className={cn('text-lg font-extrabold', s.tone)}>{s.value}</p>
                  <p className="text-[10px] font-medium text-gray-500 dark:text-white/40">{s.label}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Needs Attention — reuses the real, already-shipped panel/backend as-is */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-white/50">Needs Attention</p>
            <Link href={needsAttentionHref} className="text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline">View all</Link>
          </div>
          <NeedsAttentionPanel onSelectLead={id => { window.location.href = `${leadsHref}?open=${id}` }} />
          {attention.data && attention.data.totalItems === 0 && (
            <div className="rounded-2xl border border-gray-100 dark:border-white/10 p-4 text-sm text-gray-400 dark:text-white/40">Nothing needs attention right now.</div>
          )}
        </div>

        {/* Lead Source Performance */}
        <Card title="Lead Source Performance" action={<Link href={sourcesHref} className="text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline">View all</Link>}>
          {!sources.data || sources.data.sources.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-white/40">{sources.loading ? 'Loading…' : 'No leads recorded yet.'}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-gray-400 dark:text-white/30">
                    <th className="pb-2 font-semibold">Source</th>
                    <th className="pb-2 font-semibold text-right">Leads</th>
                    <th className="pb-2 font-semibold text-right">Qualified</th>
                    <th className="pb-2 font-semibold text-right">Converted</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                  {sources.data.sources.slice(0, 6).map(s => (
                    <tr key={s.source}>
                      <td className="py-1.5 font-semibold text-gray-700 dark:text-white/80">{SOURCE_LABEL[s.source] ?? s.source}</td>
                      <td className="py-1.5 text-right text-gray-600 dark:text-white/60">{s.leadCount}</td>
                      <td className="py-1.5 text-right text-gray-600 dark:text-white/60">{s.qualifiedCount}</td>
                      <td className="py-1.5 text-right font-bold text-emerald-600 dark:text-emerald-400">{s.convertedCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Response performance — plain clinic language, not technical "SLA" jargon */}
        <Card title="Response Performance">
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-xl bg-gray-50 dark:bg-white/5 px-3 py-2">
              <span className="flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-white/60"><Clock size={13} /> Avg First Response</span>
              <span className="text-sm font-bold text-gray-800 dark:text-white">{overallAvgResponse !== null ? formatResponseMinutes(overallAvgResponse) : responseLeaderboard.loading ? '…' : '—'}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-gray-50 dark:bg-white/5 px-3 py-2">
              <span className="flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-white/60"><AlertCircle size={13} /> Unanswered Leads</span>
              <span className="text-sm font-bold text-gray-800 dark:text-white">{unanswered ?? '—'}</span>
            </div>
          </div>
        </Card>

        {/* Lost Reasons */}
        <Card title="Lost Reasons">
          {!lostReasons.data || lostReasons.data.reasons.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-white/40">{lostReasons.loading ? 'Loading…' : 'No lost leads recorded.'}</p>
          ) : (
            <div className="space-y-1.5">
              {lostReasons.data.reasons.slice(0, 5).map(r => (
                <div key={r.reason} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 text-gray-600 dark:text-white/60"><ThumbsDown size={12} className="text-gray-300 dark:text-white/20" /> {r.reason}</span>
                  <span className="font-bold text-gray-800 dark:text-white">{r.count}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Revenue teaser — ADMIN only, real attributed figures */}
        {role === 'ADMIN' && (
          <Card title="Revenue" action={<Link href={revenueHref} className="text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline">View all</Link>}>
            {!revenue.data ? (
              <p className="text-sm text-gray-400 dark:text-white/40">{revenue.loading ? 'Loading…' : 'Unavailable'}</p>
            ) : (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 text-gray-600 dark:text-white/60"><Wallet size={12} /> Collected (all time)</span>
                  <span className="font-bold text-gray-800 dark:text-white">{formatUGX(revenue.data.totalCollectedUGX)}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500 dark:text-white/50">Attributed to a lead</span>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">{formatUGX(revenue.data.attributedToLeadUGX)}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500 dark:text-white/50">Unattributed</span>
                  <span className="font-semibold text-gray-500 dark:text-white/40">{formatUGX(revenue.data.unattributedUGX)}</span>
                </div>
              </div>
            )}
          </Card>
        )}
      </div>

      <div className="flex items-center justify-end gap-3 text-xs">
        <Link href={campaignsHref} className="flex items-center gap-1 font-bold text-gray-500 dark:text-white/40 hover:text-blue-600 dark:hover:text-blue-400"><Megaphone size={13} /> Campaigns</Link>
      </div>
    </div>
  )
}
