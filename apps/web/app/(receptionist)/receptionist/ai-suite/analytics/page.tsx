'use client'

import { useEffect, useState } from 'react'
import { RefreshCw, Loader2, BarChart2, DollarSign, MessageSquare, AlertCircle, Cpu, HeartPulse, CreditCard, ClipboardCheck, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface DayPoint   { day: string; agent: number; user: number }
interface MonthTotal { agent: number; user: number; total: number }
interface ChannelData {
  daily: DayPoint[]
  thisMonth: MonthTotal
  lastMonth: MonthTotal
  allTimeConvs: number
}

interface DataPoint  { start: number; end: number; volume: number; cost?: number }
interface WabaUsage  {
  wabaName: string; phone: string
  daily: DataPoint[]
  thisMonth: { volume: number; cost: number }
  lastMonth: { volume: number; cost: number }
}

interface DoBalance {
  accountBalance: string
  monthToDateUsage: string
  monthToDateBalance: string
  generatedAt: string
}

interface Analytics {
  channels: Record<string, ChannelData>
  channelStatus?: Record<string, 'ACTIVE' | 'PAUSED'>
  meta: { uganda: WabaUsage; kenya: WabaUsage; cachedAt: string } | null
  digitalocean: DoBalance | { notConfigured: true }
  cachedAt: string
}

// ── OpenAI token-usage / cost analytics (Admin-only) ───────────────────────

type AiUsageRange = 'today' | '7d' | '30d' | 'month' | 'prev_month'

interface AiUsageDayPoint { day: string; requests: number; totalTokens: number }
interface AiUsageChannelPoint { channel: string; requests: number; totalTokens: number }
interface AiUsage {
  range: AiUsageRange
  since: string
  until: string
  totals: {
    requests: number
    failedRequests: number
    inputTokens: number
    cachedInputTokens: number
    outputTokens: number
    reasoningTokens: number
    totalTokens: number
    toolCalls: number
    avgTokensPerResponse: number
  }
  byChannel: AiUsageChannelPoint[]
  byDay: AiUsageDayPoint[]
  models: string[]
  cost: { value: number; currency: string; source: string }
}

// ── WhatsApp delivery health + Meta billing + CRM readiness ──────────────

interface DeliveryWindow {
  attempted: number; delivered: number; read: number; failed: number; pending: number
  deliveryRate: number; failureRate: number
}
interface WhatsAppDeliveryHealth {
  today: DeliveryWindow; thisMonth: DeliveryWindow; last30Days: DeliveryWindow
  lastSuccessfulDeliveryAt: string | null
  lastFailedDeliveryAt: string | null
  latestError: { code: number; title: string; message: string | null; details: string | null; occurredAt: string } | null
  failureCountByCode: Record<string, number>
  status: 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'UNKNOWN'
}

interface CreditLine {
  id: string; legalEntityName: string | null
  balance: { amount: string; currency: string } | null
  creditAvailable: { amount: string; currency: string } | null
  isAccessRevoked: boolean | null
}
interface MetaBillingStatus {
  billingStatus: 'HEALTHY' | 'ATTENTION_REQUIRED' | 'UNKNOWN'
  wabaAccountReviewStatus: string | null
  creditLines: CreditLine[]
  creditLinesNote: string
  recent131042: boolean
  recent131042Within24h: boolean
  adminActionUrl: string | null
  fetchedAt: string
  graphApiError: string | null
}

interface CrmReadinessSummary {
  routingRuleCount: number; activeRoutingRuleCount: number
  sequenceDefinitionCount: number; activeSequenceDefinitionCount: number
  staleUnassignedLeadCount: number
  reviewRequestConfigured: boolean
}

const AI_USAGE_RANGES: { key: AiUsageRange; label: string }[] = [
  { key: 'today',      label: 'Today' },
  { key: '7d',         label: '7 days' },
  { key: '30d',        label: '30 days' },
  { key: 'month',      label: 'This month' },
  { key: 'prev_month', label: 'Last month' },
]

// ── Channel metadata ──────────────────────────────────────────────────────────

const CHANNEL_META: Record<string, { label: string; icon: string }> = {
  WHATSAPP:          { label: 'WhatsApp',        icon: '💬' },
  WEBSITE:           { label: 'Website Chat',     icon: '🌐' },
  FACEBOOK:          { label: 'Facebook DM',      icon: '👥' },
  FACEBOOK_COMMENT:  { label: 'FB Comments',      icon: '💬' },
  INSTAGRAM:         { label: 'Instagram DM',     icon: '📸' },
  INSTAGRAM_COMMENT: { label: 'IG Comments',      icon: '💬' },
  SMS:               { label: 'SMS',              icon: '📱' },
}

// ── Mini bar chart for DB channel data (agent + user stacked) ─────────────────

function ChannelBarChart({ points }: { points: DayPoint[] }) {
  if (!points.length) return <p className="text-xs text-gray-300 dark:text-white/20 italic">No data in last 30 days</p>
  const max = Math.max(...points.map(p => p.agent + p.user), 1)
  return (
    <div className="flex items-end gap-[2px] h-8 w-full">
      {points.map((p, i) => {
        const total = p.agent + p.user
        const h = Math.max(2, Math.round((total / max) * 32))
        return (
          <div key={i} title={`${p.day.slice(5)}: ${total} msgs (${p.agent} agent, ${p.user} user)`}
            style={{ height: `${h}px`, flex: 1 }}
            className="rounded-sm bg-cyan-400/60 dark:bg-cyan-400/40 hover:bg-cyan-500 transition-colors cursor-default" />
        )
      })}
    </div>
  )
}

// ── Single channel card ────────────────────────────────────────────────────────

function ChannelCard({ channel, data, status }: { channel: string; data: ChannelData; status?: 'ACTIVE' | 'PAUSED' }) {
  const meta = CHANNEL_META[channel] ?? { label: channel, icon: '📡' }
  const changeAmt = data.thisMonth.total - data.lastMonth.total
  const changePct = data.lastMonth.total
    ? Math.round((changeAmt / data.lastMonth.total) * 100)
    : null

  return (
    <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm p-5 space-y-3">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">{meta.icon}</span>
          <div>
            <div className="flex items-center gap-1.5">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-white/40">{meta.label}</p>
              {status && (
                <span className={cn(
                  'text-[8px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded-full',
                  status === 'ACTIVE'
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                    : 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/40',
                )}>
                  {status === 'ACTIVE' ? 'Active' : 'Paused'}
                </span>
              )}
            </div>
            <p className="text-[10px] text-gray-300 dark:text-white/20">{data.allTimeConvs.toLocaleString()} convs all-time</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl font-black text-gray-800 dark:text-white leading-none">{data.thisMonth.total.toLocaleString()}</p>
          <p className="text-[10px] text-gray-400 dark:text-white/40">msgs this month</p>
          {changePct !== null && (
            <p className={cn('text-[10px] font-bold mt-0.5', changeAmt >= 0 ? 'text-emerald-500' : 'text-red-400')}>
              {changeAmt >= 0 ? '+' : ''}{changePct}% vs last mo
            </p>
          )}
        </div>
      </div>

      <ChannelBarChart points={data.daily} />

      <div className="flex justify-between text-[10px] text-gray-400 dark:text-white/30">
        <span>Agent: <span className="font-bold text-gray-500 dark:text-white/40">{data.thisMonth.agent.toLocaleString()}</span></span>
        <span>User: <span className="font-bold text-gray-500 dark:text-white/40">{data.thisMonth.user.toLocaleString()}</span></span>
        <span>Last mo: <span className="font-bold text-gray-500 dark:text-white/40">{data.lastMonth.total.toLocaleString()}</span></span>
      </div>
    </div>
  )
}

// ── Meta WABA card ────────────────────────────────────────────────────────────

function MetaWabaCard({ data, label }: { data: WabaUsage; label: string }) {
  const changeAmt = data.thisMonth.volume - data.lastMonth.volume
  const changePct = data.lastMonth.volume
    ? Math.round((changeAmt / data.lastMonth.volume) * 100)
    : null

  const max = Math.max(...data.daily.map(p => p.volume), 1)

  return (
    <div className="bg-gray-50 dark:bg-white/5 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-white/40">{label}</p>
          <p className="text-xs font-bold text-gray-700 dark:text-white mt-0.5">{data.wabaName}</p>
          <p className="text-[10px] text-gray-400 dark:text-white/30">{data.phone}</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-black text-gray-800 dark:text-white leading-none">{data.thisMonth.volume.toLocaleString()}</p>
          <p className="text-[10px] text-gray-400 dark:text-white/40 mt-0.5">this month</p>
          {changePct !== null && (
            <p className={cn('text-[10px] font-bold mt-0.5', changeAmt >= 0 ? 'text-emerald-500' : 'text-red-400')}>
              {changeAmt >= 0 ? '+' : ''}{changePct}% vs last mo
            </p>
          )}
        </div>
      </div>

      {data.daily.length > 0 ? (
        <div className="flex items-end gap-[2px] h-8 w-full">
          {data.daily.map((p, i) => {
            const h = Math.max(2, Math.round((p.volume / max) * 32))
            const d = new Date(p.start * 1000)
            return (
              <div key={i} title={`${d.getDate()} ${d.toLocaleString('en', { month: 'short' })}: ${p.volume}`}
                style={{ height: `${h}px`, flex: 1 }}
                className="rounded-sm bg-emerald-400/60 dark:bg-emerald-400/40 hover:bg-emerald-500 transition-colors cursor-default" />
            )
          })}
        </div>
      ) : (
        <p className="text-xs text-gray-300 dark:text-white/20 italic">No data</p>
      )}

      <div className="flex items-center justify-between text-[10px] text-gray-400 dark:text-white/30">
        <span>Last month: <span className="font-bold text-gray-500 dark:text-white/40">{data.lastMonth.volume.toLocaleString()}</span></span>
        {data.thisMonth.cost > 0
          ? <span>Est. cost: <span className="font-bold text-amber-500">${data.thisMonth.cost.toFixed(4)}</span></span>
          : <span className="italic">Cost: $0.00 (free tier / AT routing)</span>
        }
      </div>
    </div>
  )
}

// ── Token usage bar chart (reuses the same visual pattern as ChannelBarChart) ──

function TokenBarChart({ points }: { points: AiUsageDayPoint[] }) {
  if (!points.length) return <p className="text-xs text-gray-300 dark:text-white/20 italic">No usage data in this range</p>
  const max = Math.max(...points.map(p => p.totalTokens), 1)
  return (
    <div className="flex items-end gap-[2px] h-8 w-full">
      {points.map((p, i) => {
        const h = Math.max(2, Math.round((p.totalTokens / max) * 32))
        return (
          <div key={i} title={`${p.day.slice(5)}: ${p.totalTokens.toLocaleString()} tokens (${p.requests} requests)`}
            style={{ height: `${h}px`, flex: 1 }}
            className="rounded-sm bg-violet-400/60 dark:bg-violet-400/40 hover:bg-violet-500 transition-colors cursor-default" />
        )
      })}
    </div>
  )
}

// ── OpenAI usage card (Admin-only — cost figures never shown to Receptionist) ──

function OpenAiUsageCard({
  data, range, onRangeChange, loading,
}: {
  data: AiUsage | null
  range: AiUsageRange
  onRangeChange: (r: AiUsageRange) => void
  loading: boolean
}) {
  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-white/40 flex items-center gap-2">
          <Cpu size={10} /> OpenAI Usage (Admin only)
        </p>
        <div className="flex gap-1">
          {AI_USAGE_RANGES.map(r => (
            <button key={r.key} onClick={() => onRangeChange(r.key)}
              className={cn(
                'px-2.5 py-1 rounded-lg text-[10px] font-bold transition-colors',
                range === r.key
                  ? 'bg-violet-500 text-white'
                  : 'bg-gray-50 dark:bg-white/5 text-gray-400 dark:text-white/40 hover:bg-gray-100 dark:hover:bg-white/10'
              )}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm p-5 space-y-4">
        {loading || !data ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 size={20} className="animate-spin text-violet-500" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="text-center p-3 bg-gray-50 dark:bg-white/5 rounded-xl">
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 dark:text-white/40 mb-1">Requests</p>
                <p className="text-xl font-black text-gray-800 dark:text-white">{data.totals.requests.toLocaleString()}</p>
                {data.totals.failedRequests > 0 && (
                  <p className="text-[9px] text-red-400 mt-0.5">{data.totals.failedRequests} failed</p>
                )}
              </div>
              <div className="text-center p-3 bg-gray-50 dark:bg-white/5 rounded-xl">
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 dark:text-white/40 mb-1">Total Tokens</p>
                <p className="text-xl font-black text-gray-800 dark:text-white">{data.totals.totalTokens.toLocaleString()}</p>
              </div>
              <div className="text-center p-3 bg-gray-50 dark:bg-white/5 rounded-xl">
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 dark:text-white/40 mb-1">Avg Tokens / Response</p>
                <p className="text-xl font-black text-gray-800 dark:text-white">{data.totals.avgTokensPerResponse.toLocaleString()}</p>
              </div>
              <div className="text-center p-3 bg-amber-50 dark:bg-amber-900/10 rounded-xl">
                <p className="text-[9px] font-black uppercase tracking-widest text-amber-500/70 mb-1">Est. Cost</p>
                <p className="text-xl font-black text-amber-500">${data.cost.value.toFixed(4)}</p>
                <p className="text-[8px] text-amber-500/60 mt-0.5">Calculated from token usage</p>
              </div>
            </div>

            <TokenBarChart points={data.byDay} />

            <div className="flex flex-wrap justify-between gap-2 text-[10px] text-gray-400 dark:text-white/30">
              <span>Input: <span className="font-bold text-gray-500 dark:text-white/40">{data.totals.inputTokens.toLocaleString()}</span></span>
              <span>Cached: <span className="font-bold text-gray-500 dark:text-white/40">{data.totals.cachedInputTokens.toLocaleString()}</span></span>
              <span>Output: <span className="font-bold text-gray-500 dark:text-white/40">{data.totals.outputTokens.toLocaleString()}</span></span>
              <span>Reasoning: <span className="font-bold text-gray-500 dark:text-white/40">{data.totals.reasoningTokens.toLocaleString()}</span></span>
              <span>Tool calls: <span className="font-bold text-gray-500 dark:text-white/40">{data.totals.toolCalls.toLocaleString()}</span></span>
            </div>

            {data.byChannel.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100 dark:border-white/10">
                {data.byChannel.map(c => (
                  <span key={c.channel} className="text-[10px] px-2 py-1 rounded-lg bg-gray-50 dark:bg-white/5 text-gray-500 dark:text-white/50">
                    {CHANNEL_META[c.channel]?.label ?? c.channel}: <span className="font-bold">{c.totalTokens.toLocaleString()}</span>
                  </span>
                ))}
              </div>
            )}

            <p className="text-[9px] text-gray-300 dark:text-white/20 leading-relaxed">
              Cost is {data.cost.source === 'CALCULATED_FROM_TOKEN_USAGE' ? 'calculated from logged token usage' : data.cost.source} using OpenAI&apos;s published per-token pricing for {data.models.join(', ') || 'the configured model'} — an estimate, not an actual invoiced figure.
            </p>
          </>
        )}
      </div>
    </section>
  )
}

// ── WhatsApp Delivery Health card ───────────────────────────────────────────
// Distinct from MetaWabaCard above: that shows volume/cost from Meta's
// pricing_analytics API; this shows what actually happened to those
// messages (sent vs delivered vs read vs failed) from our own webhook-fed
// AiMessage.status — "API accepted the message" is never conflated with
// "the message was delivered" here.

const HEALTH_STYLE: Record<WhatsAppDeliveryHealth['status'], { label: string; pill: string; dot: string }> = {
  HEALTHY:  { label: 'Healthy',  pill: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400', dot: 'bg-emerald-500' },
  DEGRADED: { label: 'Degraded', pill: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',       dot: 'bg-amber-500' },
  DOWN:     { label: 'Down',     pill: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',               dot: 'bg-red-500' },
  // Too few send attempts in the last 24h to judge either way — deliberately
  // distinct from HEALTHY so a quiet window can never read as "confirmed fine."
  UNKNOWN:  { label: 'Unknown',  pill: 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/40',              dot: 'bg-gray-400' },
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return 'Never recorded'
  return new Date(iso).toLocaleString('en', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

function WhatsAppHealthWindowStat({ label, w }: { label: string; w: DeliveryWindow }) {
  return (
    <div className="text-center p-3 bg-gray-50 dark:bg-white/5 rounded-xl">
      <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 dark:text-white/40 mb-1">{label}</p>
      <p className="text-xl font-black text-gray-800 dark:text-white">{w.attempted.toLocaleString()}</p>
      <p className="text-[9px] text-gray-400 dark:text-white/40 mt-1">
        <span className="text-emerald-500 font-bold">{w.deliveryRate}%</span> delivered · <span className="text-red-400 font-bold">{w.failureRate}%</span> failed
      </p>
    </div>
  )
}

function WhatsAppHealthCard({ data, loading }: { data: WhatsAppDeliveryHealth | null; loading: boolean }) {
  return (
    <section>
      <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-white/40 mb-4 flex items-center gap-2">
        <HeartPulse size={10} /> WhatsApp — Delivery Health
      </p>
      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm p-5 space-y-4">
        {loading || !data ? (
          <div className="flex items-center justify-center py-10"><Loader2 size={20} className="animate-spin text-cyan-500" /></div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <span className={cn('flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold', HEALTH_STYLE[data.status].pill)}>
                <span className={cn('w-1.5 h-1.5 rounded-full', HEALTH_STYLE[data.status].dot)} />
                {HEALTH_STYLE[data.status].label}
              </span>
              {data.status !== 'HEALTHY' && (
                <span className="text-[10px] text-gray-400 dark:text-white/40">Based on the last 24 hours of send attempts</span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <WhatsAppHealthWindowStat label="Today" w={data.today} />
              <WhatsAppHealthWindowStat label="This Month" w={data.thisMonth} />
              <WhatsAppHealthWindowStat label="Last 30 Days" w={data.last30Days} />
            </div>

            <div className="grid grid-cols-2 gap-3 text-[11px]">
              <div className="p-3 bg-gray-50 dark:bg-white/5 rounded-xl">
                <p className="text-gray-400 dark:text-white/40">Last successful delivery</p>
                <p className="font-bold text-gray-700 dark:text-white/80 mt-0.5">{fmtDateTime(data.lastSuccessfulDeliveryAt)}</p>
              </div>
              <div className="p-3 bg-gray-50 dark:bg-white/5 rounded-xl">
                <p className="text-gray-400 dark:text-white/40">Last failed delivery</p>
                <p className="font-bold text-gray-700 dark:text-white/80 mt-0.5">{fmtDateTime(data.lastFailedDeliveryAt)}</p>
              </div>
            </div>

            {data.latestError && (
              <div className="p-3 bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-800/20 rounded-xl text-[11px] text-red-600 dark:text-red-400">
                <span className="font-bold">Latest provider error</span> — #{data.latestError.code} {data.latestError.title}
                {data.latestError.details && <span className="block mt-1 text-red-500/80 dark:text-red-400/70">{data.latestError.details}</span>}
              </div>
            )}

            {Object.keys(data.failureCountByCode).length > 0 && (
              <div className="flex flex-wrap gap-2">
                {Object.entries(data.failureCountByCode).map(([code, count]) => (
                  <span key={code} className="text-[10px] px-2 py-1 rounded-lg bg-gray-50 dark:bg-white/5 text-gray-500 dark:text-white/50">
                    #{code}: <span className="font-bold">{count.toLocaleString()}</span>
                  </span>
                ))}
              </div>
            )}
            <p className="text-[9px] text-gray-300 dark:text-white/20">Failure counts are since delivery-failure tracking began (2026-09-15) — not backfilled from before instrumentation existed.</p>
          </>
        )}
      </div>
    </section>
  )
}

// ── Meta Billing card (Admin-only — financial account data) ────────────────

const BILLING_STYLE: Record<MetaBillingStatus['billingStatus'], { label: string; pill: string }> = {
  HEALTHY:             { label: 'Healthy',             pill: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  ATTENTION_REQUIRED:  { label: 'Attention Required',   pill: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  UNKNOWN:             { label: 'Unknown',              pill: 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/40' },
}

function MetaBillingCard({ data, loading }: { data: MetaBillingStatus | null; loading: boolean }) {
  return (
    <section>
      <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-white/40 mb-4 flex items-center gap-2">
        <CreditCard size={10} /> Meta Billing (Admin only)
      </p>
      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm p-5 space-y-4">
        {loading || !data ? (
          <div className="flex items-center justify-center py-10"><Loader2 size={20} className="animate-spin text-violet-500" /></div>
        ) : (
          <>
            <span className={cn('inline-flex items-center px-2.5 py-1.5 rounded-xl text-xs font-bold w-fit', BILLING_STYLE[data.billingStatus].pill)}>
              Billing status: {BILLING_STYLE[data.billingStatus].label}
            </span>

            {data.recent131042Within24h && (
              <div className="p-3 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-700/30 rounded-xl text-sm text-red-600 dark:text-red-400">
                <p className="font-bold flex items-center gap-1.5"><AlertCircle size={14} /> WhatsApp delivery is currently affected by a Meta billing/payment issue.</p>
                {data.adminActionUrl && (
                  <a href={data.adminActionUrl} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-2 text-xs font-bold underline">
                    Resolve in Meta Business Manager <ExternalLink size={11} />
                  </a>
                )}
              </div>
            )}

            {data.creditLines.length > 0 ? (
              <div className="space-y-2">
                {data.creditLines.map(cl => (
                  <div key={cl.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-white/5 rounded-xl text-sm">
                    <div>
                      <p className="font-bold text-gray-700 dark:text-white/80">{cl.legalEntityName ?? cl.id}</p>
                      {cl.isAccessRevoked && <p className="text-[10px] text-red-400 font-bold uppercase">Access revoked</p>}
                    </div>
                    <div className="text-right">
                      <p className="font-black text-gray-800 dark:text-white">{cl.balance ? `${cl.balance.amount} ${cl.balance.currency}` : '—'}</p>
                      <p className="text-[9px] text-gray-400 dark:text-white/40">balance</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-3 text-sm text-gray-400 dark:text-white/40">
                <AlertCircle size={15} className="text-amber-400 flex-shrink-0" />
                <p>Not available through API{data.graphApiError ? ` (${data.graphApiError})` : ''}</p>
              </div>
            )}

            <p className="text-[9px] text-gray-300 dark:text-white/20 leading-relaxed">{data.creditLinesNote}</p>
            {data.wabaAccountReviewStatus && (
              <p className="text-[10px] text-gray-400 dark:text-white/40">WABA account review status: <span className="font-bold">{data.wabaAccountReviewStatus}</span></p>
            )}
          </>
        )}
      </div>
    </section>
  )
}

// ── CRM Configuration Readiness card (Admin-only) ───────────────────────────

function CrmReadinessCard({ data, loading }: { data: CrmReadinessSummary | null; loading: boolean }) {
  return (
    <section>
      <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-white/40 mb-4 flex items-center gap-2">
        <ClipboardCheck size={10} /> CRM Configuration Readiness (Admin only)
      </p>
      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm p-5">
        {loading || !data ? (
          <div className="flex items-center justify-center py-10"><Loader2 size={20} className="animate-spin text-cyan-500" /></div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className={cn('p-3 rounded-xl', data.activeRoutingRuleCount === 0 ? 'bg-amber-50 dark:bg-amber-900/10' : 'bg-gray-50 dark:bg-white/5')}>
              <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 dark:text-white/40">Routing Rules</p>
              <p className="text-xl font-black text-gray-800 dark:text-white">{data.activeRoutingRuleCount} active <span className="text-xs text-gray-400 font-normal">/ {data.routingRuleCount} total</span></p>
              {data.activeRoutingRuleCount === 0 && <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">New leads aren&apos;t being auto-assigned to an owner.</p>}
            </div>
            <div className={cn('p-3 rounded-xl', data.activeSequenceDefinitionCount === 0 ? 'bg-amber-50 dark:bg-amber-900/10' : 'bg-gray-50 dark:bg-white/5')}>
              <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 dark:text-white/40">Sequence Definitions</p>
              <p className="text-xl font-black text-gray-800 dark:text-white">{data.activeSequenceDefinitionCount} active <span className="text-xs text-gray-400 font-normal">/ {data.sequenceDefinitionCount} total</span></p>
              {data.activeSequenceDefinitionCount === 0 && <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">No recall/follow-up automation is actually running yet.</p>}
            </div>
            <div className={cn('p-3 rounded-xl', data.staleUnassignedLeadCount > 0 ? 'bg-amber-50 dark:bg-amber-900/10' : 'bg-gray-50 dark:bg-white/5')}>
              <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 dark:text-white/40">Stale Unassigned Leads</p>
              <p className="text-xl font-black text-gray-800 dark:text-white">{data.staleUnassignedLeadCount.toLocaleString()}</p>
              {data.staleUnassignedLeadCount > 0 && <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">Untouched &gt;24h with no owner assigned.</p>}
            </div>
            <div className={cn('p-3 rounded-xl', !data.reviewRequestConfigured ? 'bg-amber-50 dark:bg-amber-900/10' : 'bg-gray-50 dark:bg-white/5')}>
              <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 dark:text-white/40">Review Requests</p>
              <p className="text-xl font-black text-gray-800 dark:text-white">{data.reviewRequestConfigured ? 'Configured' : 'Not configured'}</p>
              {!data.reviewRequestConfigured && <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">No Google review link set — can&apos;t send anything yet.</p>}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

const CHANNEL_ORDER = ['WHATSAPP', 'WEBSITE', 'FACEBOOK', 'FACEBOOK_COMMENT', 'INSTAGRAM', 'INSTAGRAM_COMMENT', 'SMS']

export default function AnalyticsPage() {
  const API = '/api-proxy'
  const [data, setData]             = useState<Analytics | null>(null)
  const [loading, setLoading]       = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError]           = useState<string | null>(null)

  // Provider billing/cost info is Admin-only — Receptionist (or anyone else)
  // viewing this same shared page must never see the OpenAI usage/cost
  // section, and must never even issue the request for it. The backend
  // enforces this too (adminOnly on GET /ai-suite/ai-usage), so this is
  // belt-and-braces, not the only guard.
  const [isAdmin, setIsAdmin]           = useState(false)
  const [aiUsage, setAiUsage]           = useState<AiUsage | null>(null)
  const [aiUsageRange, setAiUsageRange] = useState<AiUsageRange>('30d')
  const [aiUsageLoading, setAiUsageLoading] = useState(true)

  const [whatsappHealth, setWhatsappHealth]       = useState<WhatsAppDeliveryHealth | null>(null)
  const [whatsappHealthLoading, setWhatsappHealthLoading] = useState(true)
  const [metaBilling, setMetaBilling]             = useState<MetaBillingStatus | null>(null)
  const [metaBillingLoading, setMetaBillingLoading] = useState(true)
  const [crmReadiness, setCrmReadiness]           = useState<CrmReadinessSummary | null>(null)
  const [crmReadinessLoading, setCrmReadinessLoading] = useState(true)

  function authH() {
    const t = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
    return { Authorization: `Bearer ${t}` }
  }

  async function load(force = false) {
    force ? setRefreshing(true) : setLoading(true)
    setError(null)
    try {
      const ep = force ? `${API}/ai-suite/channel-analytics/refresh` : `${API}/ai-suite/channel-analytics`
      const res = await fetch(ep, { method: force ? 'POST' : 'GET', headers: authH() })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
    } catch {
      setError('Could not load analytics data')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  async function loadAiUsage(range: AiUsageRange) {
    setAiUsageLoading(true)
    try {
      const res = await fetch(`${API}/ai-suite/ai-usage?range=${range}`, { headers: authH() })
      if (!res.ok) { setAiUsage(null); return }
      setAiUsage(await res.json())
    } catch {
      setAiUsage(null)
    } finally {
      setAiUsageLoading(false)
    }
  }

  async function loadWhatsappHealth() {
    setWhatsappHealthLoading(true)
    try {
      const res = await fetch(`${API}/ai-suite/whatsapp-health`, { headers: authH() })
      setWhatsappHealth(res.ok ? await res.json() : null)
    } catch {
      setWhatsappHealth(null)
    } finally {
      setWhatsappHealthLoading(false)
    }
  }

  async function loadMetaBilling() {
    setMetaBillingLoading(true)
    try {
      const res = await fetch(`${API}/ai-suite/meta-billing`, { headers: authH() })
      setMetaBilling(res.ok ? await res.json() : null)
    } catch {
      setMetaBilling(null)
    } finally {
      setMetaBillingLoading(false)
    }
  }

  async function loadCrmReadiness() {
    setCrmReadinessLoading(true)
    try {
      const res = await fetch(`${API}/ai-suite/crm-readiness`, { headers: authH() })
      setCrmReadiness(res.ok ? await res.json() : null)
    } catch {
      setCrmReadiness(null)
    } finally {
      setCrmReadinessLoading(false)
    }
  }

  useEffect(() => {
    load()
    loadWhatsappHealth()
    try {
      const stored = typeof window !== 'undefined' ? localStorage.getItem('cc_user') : null
      const role = stored ? JSON.parse(stored)?.role : null
      setIsAdmin(role === 'ADMIN')
    } catch {
      setIsAdmin(false)
    }
  }, [])

  useEffect(() => {
    if (isAdmin) {
      loadAiUsage(aiUsageRange)
      loadMetaBilling()
      loadCrmReadiness()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, aiUsageRange])

  const doBalance      = data && !('notConfigured' in data.digitalocean) ? data.digitalocean as DoBalance : null
  const doNotConfig    = !!(data && 'notConfigured' in data.digitalocean)
  const cachedAt       = data ? new Date(data.cachedAt).toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' }) : null

  return (
    <div className="p-6 space-y-8 max-w-5xl">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-gray-800 dark:text-white">Platform Analytics & Costs</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Message volumes, channel breakdown, and infrastructure costs
            {cachedAt && <span className="ml-2 text-[10px]">· cached {cachedAt}</span>}
          </p>
        </div>
        <button onClick={() => load(true)} disabled={refreshing || loading}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-sm text-gray-500 dark:text-white/60 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors disabled:opacity-40">
          <RefreshCw size={13} className={cn(refreshing && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-32">
          <Loader2 size={28} className="animate-spin text-cyan-500" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-3 px-5 py-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/30 rounded-2xl text-sm text-red-600 dark:text-red-400">
          <AlertCircle size={16} />
          {error}
        </div>
      ) : data ? (
        <>
          {/* ── Channel analytics ─────────────────────── */}
          <section>
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-white/40 mb-4 flex items-center gap-2">
              <BarChart2 size={10} /> Messaging Channels (last 30 days)
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {CHANNEL_ORDER.map(ch => (
                <ChannelCard key={ch} channel={ch} data={data.channels[ch]} status={data.channelStatus?.[ch]} />
              ))}
            </div>
            {/* Calling has no message-volume data to chart (it isn't an aiConversation
                channel) but its dormancy still needs to be visible here per the same
                active/paused convention as the message channels above. Status is read
                from the real computed channelStatus.CALLING, not hardcoded. */}
            <div className="mt-3 flex items-center gap-2 text-[11px] text-gray-400 dark:text-white/30">
              <span className="text-base">📞</span>
              <span className="font-bold uppercase tracking-widest text-[10px]">Calling</span>
              <span className={cn(
                'text-[8px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded-full',
                data.channelStatus?.CALLING === 'ACTIVE'
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                  : 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/40',
              )}>
                {data.channelStatus?.CALLING === 'ACTIVE' ? 'Active' : 'Paused'}
              </span>
            </div>
          </section>

          {/* ── WhatsApp delivery health (real webhook-fed status, visible to all staff) ── */}
          <WhatsAppHealthCard data={whatsappHealth} loading={whatsappHealthLoading} />

          {/* ── OpenAI token usage & cost (Admin only) ──── */}
          {isAdmin && (
            <OpenAiUsageCard
              data={aiUsage}
              range={aiUsageRange}
              onRangeChange={setAiUsageRange}
              loading={aiUsageLoading}
            />
          )}

          {/* ── Meta billing status (Admin only — financial account data) ── */}
          {isAdmin && <MetaBillingCard data={metaBilling} loading={metaBillingLoading} />}

          {/* ── CRM configuration readiness (Admin only) ── */}
          {isAdmin && <CrmReadinessCard data={crmReadiness} loading={crmReadinessLoading} />}

          {/* ── Meta WhatsApp API view ─────────────────── */}
          {data.meta && (
            <section>
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-white/40 mb-4 flex items-center gap-2">
                <MessageSquare size={10} /> WhatsApp — Meta billing view
              </p>
              <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm p-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <MetaWabaCard data={data.meta.uganda} label="Main Clinic (Uganda)" />
                  <MetaWabaCard data={data.meta.kenya}  label="Kenya (test WABA)" />
                </div>
                <p className="text-[9px] text-gray-300 dark:text-white/20 mt-3 leading-relaxed">
                  Via Meta pricing_analytics API · Uganda routes through Africa&apos;s Talking so direct cost isn&apos;t exposed · Kenya uses Meta Cloud API directly · $0.00 = utility messages within 24-hour service window
                </p>
              </div>
            </section>
          )}

          {/* ── DigitalOcean costs ─────────────────────── */}
          <section>
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-white/40 mb-4 flex items-center gap-2">
              <DollarSign size={10} /> Infrastructure (DigitalOcean)
            </p>
            <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm p-5">
              {doNotConfig ? (
                <div className="flex items-center gap-3 text-sm text-gray-400 dark:text-white/40">
                  <AlertCircle size={15} className="text-amber-400 flex-shrink-0" />
                  <div>
                    <p className="font-bold text-gray-600 dark:text-white/60">Not connected</p>
                    <p className="text-[11px] mt-0.5">Set the <code className="bg-gray-100 dark:bg-white/10 px-1 py-0.5 rounded text-xs">DIGITALOCEAN_API_TOKEN</code> environment variable to see live billing data.</p>
                  </div>
                </div>
              ) : doBalance ? (
                <div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="text-center p-4 bg-gray-50 dark:bg-white/5 rounded-xl">
                      <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-white/40 mb-2">Account Balance</p>
                      <p className="text-2xl font-black text-gray-800 dark:text-white">${doBalance.accountBalance}</p>
                    </div>
                    <div className="text-center p-4 bg-gray-50 dark:bg-white/5 rounded-xl">
                      <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-white/40 mb-2">Month-to-Date Usage</p>
                      <p className="text-2xl font-black text-amber-500">${doBalance.monthToDateUsage}</p>
                    </div>
                    <div className="text-center p-4 bg-gray-50 dark:bg-white/5 rounded-xl">
                      <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-white/40 mb-2">MTD Balance</p>
                      <p className="text-2xl font-black text-gray-800 dark:text-white">${doBalance.monthToDateBalance}</p>
                    </div>
                  </div>
                  {doBalance.generatedAt && (
                    <p className="text-[9px] text-gray-300 dark:text-white/20 text-center mt-3">
                      Generated {new Date(doBalance.generatedAt).toLocaleString()}
                    </p>
                  )}
                </div>
              ) : null}
            </div>
          </section>
        </>
      ) : null}
    </div>
  )
}
