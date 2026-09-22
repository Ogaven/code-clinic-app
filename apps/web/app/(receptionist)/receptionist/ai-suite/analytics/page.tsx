'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { RefreshCw, Loader2, BarChart2, DollarSign, MessageSquare, AlertCircle, Cpu, HeartPulse, CreditCard, ClipboardCheck, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type ChannelStatus = 'ACTIVE' | 'DEGRADED' | 'ERROR' | 'CONFIG_REQUIRED' | 'PAUSED' | 'UNKNOWN'

const CHANNEL_STATUS_META: Record<ChannelStatus, { label: string; className: string }> = {
  ACTIVE:          { label: 'Active',          className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  DEGRADED:        { label: 'Delivery Issues', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  ERROR:           { label: 'Down',            className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  CONFIG_REQUIRED: { label: 'Setup Needed',    className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  PAUSED:          { label: 'Paused',          className: 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/40' },
  UNKNOWN:         { label: 'Status Unknown',  className: 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/40' },
}

interface DayPoint   { day: string; agent: number; user: number }
interface MonthTotal { agent: number; user: number; total: number }
interface ChannelData {
  daily: DayPoint[]
  thisMonth: MonthTotal
  lastMonth: MonthTotal
  allTimeConvs: number
  selected: MonthTotal
}

interface OperationalVolume {
  confirmationsSent: number
  followupsSent:     number
  escalations:       number
  callEvents:        number
  totalInteractions: number
}

interface DataPoint  { start: number; end: number; volume: number; cost?: number }
interface WabaPhoneNumber { id: string; displayPhoneNumber: string; verifiedName: string | null }
interface WabaUsage  {
  wabaId: string
  phoneNumbers: WabaPhoneNumber[]
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
  channelStatus?: Record<string, ChannelStatus>
  operational?: OperationalVolume
  range?: AiUsageRange
  meta: { account: WabaUsage | null; configured: boolean; cachedAt: string } | null
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
interface StaffEscalationHealth {
  last30Days: DeliveryWindow
  lastAttemptAt: string | null
  lastSuccessfulDeliveryAt: string | null
  lastFailedDeliveryAt: string | null
  latestError: { code: number; title: string; message: string | null; details: string | null; occurredAt: string } | null
  status: 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'UNKNOWN'
}

interface WhatsAppDeliveryHealth {
  today: DeliveryWindow; thisMonth: DeliveryWindow; last30Days: DeliveryWindow
  lastSuccessfulDeliveryAt: string | null
  lastFailedDeliveryAt: string | null
  latestError: { code: number; title: string; message: string | null; details: string | null; occurredAt: string } | null
  failureCountByCode: Record<string, number>
  status: 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'UNKNOWN'
  staffEscalation?: StaffEscalationHealth
}

interface CreditLine {
  id: string; legalEntityName: string | null
  balance: { amount: string; currency: string } | null
  creditAvailable: { amount: string; currency: string } | null
  isAccessRevoked: boolean | null
}
interface MetaPhoneNumberStatus {
  displayPhoneNumber: string | null
  verifiedName: string | null
  qualityRating: string | null
  codeVerificationStatus: string | null
  nameStatus: string | null
}
interface MetaTemplateSummary {
  approvedCount: number; pendingCount: number; rejectedCount: number; totalCount: number
}
interface MetaBillingStatus {
  billingStatus: 'HEALTHY' | 'ATTENTION_REQUIRED' | 'UNKNOWN'
  wabaConfigured: boolean
  wabaAccountReviewStatus: string | null
  phoneNumber: MetaPhoneNumberStatus | null
  templates: MetaTemplateSummary | null
  creditLines: CreditLine[]
  creditLinesNote: string
  recent131042: boolean
  recent131042Within24h: boolean
  latestPaymentError: { code: number; title: string; occurredAt: string } | null
  adminActionUrl: string | null
  billingDataNote: string
  fetchedAt: string
  graphApiError: string | null
}

interface CrmReadinessSummary {
  routingRuleCount: number; activeRoutingRuleCount: number
  sequenceDefinitionCount: number; activeSequenceDefinitionCount: number
  staleUnassignedLeadCount: number
  reviewRequestConfigured: boolean
}

// ── Meta Integration Health (Facebook/Instagram/WhatsApp webhook + permission evidence) ──

interface AppSubscriptionInfo { object: string; callbackUrl: string | null; active: boolean | null; fields: string[] }
interface PermissionCheck { permission: string; requiredByFeature: string; granted: boolean | 'UNKNOWN' }
interface MetaIntegrationDiagnostics {
  appConfigured: boolean
  appSubscriptions: AppSubscriptionInfo[] | null
  pageSubscribedToApp: boolean | null
  pageSubscribedFields: string[] | null
  pageReachable: boolean | null
  pageName: string | null
  instagramReachable: boolean | null
  instagramUsername: string | null
  whatsappPhoneSubscribed: boolean | null
  permissionChecks: PermissionCheck[]
  graphApiError: string | null
}
interface ChannelIngestionStatus { channel: string; lastInboundEventAt: string | null; evidence: 'RECENT' | 'STALE' | 'NONE' }
interface MetaIntegrationHealth {
  diagnostics: MetaIntegrationDiagnostics
  ingestion: Record<string, ChannelIngestionStatus>
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

function ChannelCard({ channel, data, status, rangeLabel }: { channel: string; data: ChannelData; status?: ChannelStatus; rangeLabel?: string }) {
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
                <span
                  className={cn('text-[8px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded-full', CHANNEL_STATUS_META[status].className)}
                  title={
                    status === 'DEGRADED'        ? 'WhatsApp deliveries are failing more than usual right now.' :
                    status === 'ERROR'           ? 'WhatsApp deliveries are failing — patients likely aren’t receiving messages on this channel.' :
                    status === 'CONFIG_REQUIRED' ? 'This channel isn’t connected yet — it needs setup before patients can message through it.' :
                    status === 'UNKNOWN'         ? 'Not enough recent activity to tell if this channel is working.' :
                    undefined
                  }
                >
                  {CHANNEL_STATUS_META[status].label}
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

      {rangeLabel && (
        <div className="pt-2 border-t border-gray-50 dark:border-white/5 text-[10px] text-gray-400 dark:text-white/30">
          {rangeLabel}: <span className="font-bold text-gray-600 dark:text-white/60">{data.selected.total.toLocaleString()}</span> msgs
          <span className="ml-2">({data.selected.agent.toLocaleString()} agent / {data.selected.user.toLocaleString()} user)</span>
        </div>
      )}
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
          {data.phoneNumbers.length > 0 ? (
            data.phoneNumbers.map(p => (
              <p key={p.id} className="text-[10px] text-gray-500 dark:text-white/40">
                <span className="font-bold text-gray-700 dark:text-white">{p.verifiedName ?? 'Unnamed'}</span> · {p.displayPhoneNumber}
              </p>
            ))
          ) : (
            <p className="text-[10px] text-gray-400 dark:text-white/30">Phone numbers unavailable</p>
          )}
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

function WhatsAppHealthCard({ data, loading, isAdmin }: { data: WhatsAppDeliveryHealth | null; loading: boolean; isAdmin: boolean }) {
  return (
    <section>
      <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-white/40 mb-4 flex items-center gap-2">
        <HeartPulse size={10} /> WhatsApp — Patient Messaging Health
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

            {!isAdmin && data.status !== 'HEALTHY' && (
              <div className="p-3 bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-800/20 rounded-xl text-[11px] text-amber-700 dark:text-amber-400">
                Some WhatsApp messages aren't going through right now. This has been flagged for the clinic admin.
              </div>
            )}

            {isAdmin && data.latestError && (
              <div className="p-3 bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-800/20 rounded-xl text-[11px] text-red-600 dark:text-red-400">
                <span className="font-bold">Latest provider error (admin)</span> — #{data.latestError.code} {data.latestError.title}
                {data.latestError.details && <span className="block mt-1 text-red-500/80 dark:text-red-400/70">{data.latestError.details}</span>}
              </div>
            )}

            {isAdmin && Object.keys(data.failureCountByCode).length > 0 && (
              <div className="flex flex-wrap gap-2">
                {Object.entries(data.failureCountByCode).map(([code, count]) => (
                  <span key={code} className="text-[10px] px-2 py-1 rounded-lg bg-gray-50 dark:bg-white/5 text-gray-500 dark:text-white/50">
                    #{code}: <span className="font-bold">{count.toLocaleString()}</span>
                  </span>
                ))}
              </div>
            )}
            {isAdmin && (
              <p className="text-[9px] text-gray-300 dark:text-white/20">Failure counts are since delivery-failure tracking began (2026-09-15) — not backfilled from before instrumentation existed.</p>
            )}

            {/* ── Staff Escalation Alerts — a SEPARATE status from patient
                messaging above. Deliveries to the internal staff escalation
                number (clinical concerns, guardian-routing warnings, new-lead
                notifications) are tracked independently so a burst of staff
                alert failures is visible on its own, and never silently
                blended into — or hidden from — the patient health status
                above. */}
            {data.staffEscalation && (
              <div className="pt-4 border-t border-gray-100 dark:border-white/10 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-white/40">Staff Escalation Alerts</p>
                  <span className={cn('flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold', HEALTH_STYLE[data.staffEscalation.status].pill)}>
                    <span className={cn('w-1.5 h-1.5 rounded-full', HEALTH_STYLE[data.staffEscalation.status].dot)} />
                    {HEALTH_STYLE[data.staffEscalation.status].label}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-[11px]">
                  <div className="p-2.5 bg-gray-50 dark:bg-white/5 rounded-xl">
                    <p className="text-gray-400 dark:text-white/40 text-[10px]">Last attempt</p>
                    <p className="font-bold text-gray-700 dark:text-white/80 mt-0.5">{fmtDateTime(data.staffEscalation.lastAttemptAt)}</p>
                  </div>
                  <div className="p-2.5 bg-gray-50 dark:bg-white/5 rounded-xl">
                    <p className="text-gray-400 dark:text-white/40 text-[10px]">Last successful delivery</p>
                    <p className="font-bold text-gray-700 dark:text-white/80 mt-0.5">{fmtDateTime(data.staffEscalation.lastSuccessfulDeliveryAt)}</p>
                  </div>
                  <div className="p-2.5 bg-gray-50 dark:bg-white/5 rounded-xl">
                    <p className="text-gray-400 dark:text-white/40 text-[10px]">Last failure</p>
                    <p className="font-bold text-gray-700 dark:text-white/80 mt-0.5">{fmtDateTime(data.staffEscalation.lastFailedDeliveryAt)}</p>
                  </div>
                </div>
                {isAdmin && data.staffEscalation.latestError && (
                  <div className="p-2.5 bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-800/20 rounded-xl text-[11px] text-red-600 dark:text-red-400">
                    <span className="font-bold">Latest error (admin)</span> — #{data.staffEscalation.latestError.code} {data.staffEscalation.latestError.title}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}

// ── WhatsApp / Meta Status card (Admin-only) ────────────────────────────────
// Redesigned 2026-09-20: this used to be titled "Meta Billing" and rendered
// Marketing API credit-line entities ("Ajua Inc.", "LeadConnector LLC") as
// bold entity-name-plus-balance rows indistinguishable from real financial
// line items, with only a 9px footnote explaining they weren't actually
// WhatsApp billing. Meta does not expose a real WhatsApp outstanding-balance
// figure to this token (payment_methods/adaccounts/funding all return
// permission-denied — see meta-billing.service.ts) — so this card now leads
// with verified, operationally useful status (account/phone/templates/
// payment-eligibility) and demotes the credit-line data to its own small,
// explicitly-labeled, visually muted section at the bottom, never implying
// it's Code Clinic's own WhatsApp bill.

const BILLING_STYLE: Record<MetaBillingStatus['billingStatus'], { label: string; pill: string }> = {
  HEALTHY:             { label: 'Healthy',             pill: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  ATTENTION_REQUIRED:  { label: 'Attention Required',   pill: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  UNKNOWN:             { label: 'Unknown',              pill: 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/40' },
}

function StatusRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between text-[11px] py-1.5">
      <span className="text-gray-400 dark:text-white/40">{label}</span>
      <span className="font-bold text-gray-700 dark:text-white/80">{value}</span>
    </div>
  )
}

function MetaBillingCard({ data, loading }: { data: MetaBillingStatus | null; loading: boolean }) {
  return (
    <section>
      <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-white/40 mb-4 flex items-center gap-2">
        <CreditCard size={10} /> WhatsApp / Meta Status (Admin only)
      </p>
      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm p-5 space-y-4">
        {loading || !data ? (
          <div className="flex items-center justify-center py-10"><Loader2 size={20} className="animate-spin text-violet-500" /></div>
        ) : (
          <>
            <span className={cn('inline-flex items-center px-2.5 py-1.5 rounded-xl text-xs font-bold w-fit', BILLING_STYLE[data.billingStatus].pill)}>
              Messaging health: {BILLING_STYLE[data.billingStatus].label}
            </span>

            {/* ── Payment / Eligibility — the ONLY red-alert section, and only when Meta actually reports one ── */}
            {data.recent131042Within24h && data.latestPaymentError ? (
              <div className="p-3 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-700/30 rounded-xl text-sm text-red-600 dark:text-red-400">
                <p className="font-bold flex items-center gap-1.5">
                  <AlertCircle size={14} /> Meta has blocked WhatsApp delivery — #{data.latestPaymentError.code} {data.latestPaymentError.title}
                </p>
                <p className="text-xs mt-1 text-red-500/90 dark:text-red-400/80">
                  Meta reports a business eligibility/payment condition on the production WhatsApp account. This is not something Code Clinic can resolve in-app.
                </p>
                {data.adminActionUrl && (
                  <a href={data.adminActionUrl} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-2 text-xs font-bold underline">
                    Resolve in Meta Business Manager <ExternalLink size={11} />
                  </a>
                )}
              </div>
            ) : data.recent131042 ? (
              <p className="text-[10px] text-gray-400 dark:text-white/40">
                A payment/eligibility error (#{data.latestPaymentError?.code}) occurred previously but not in the last 24 hours — not currently treated as an active incident.
              </p>
            ) : null}

            {/* ── WhatsApp Business Account ── */}
            <div className="pt-2 border-t border-gray-100 dark:border-white/10">
              <StatusRow label="WhatsApp Business Account" value={data.wabaConfigured ? 'Configured' : 'Not configured'} />
              {data.wabaAccountReviewStatus && <StatusRow label="Account review status" value={data.wabaAccountReviewStatus} />}
            </div>

            {/* ── Phone Number ── */}
            <div className="pt-2 border-t border-gray-100 dark:border-white/10">
              {data.phoneNumber ? (
                <>
                  <StatusRow label="Production number" value={data.phoneNumber.displayPhoneNumber ?? '—'} />
                  <StatusRow label="Verified name" value={data.phoneNumber.verifiedName ?? '—'} />
                  {data.phoneNumber.qualityRating && <StatusRow label="Quality rating" value={data.phoneNumber.qualityRating} />}
                </>
              ) : (
                <StatusRow label="Production number" value="Unavailable" />
              )}
            </div>

            {/* ── Templates ── */}
            <div className="pt-2 border-t border-gray-100 dark:border-white/10">
              {data.templates ? (
                <>
                  <StatusRow label="Approved templates" value={data.templates.approvedCount} />
                  {data.templates.pendingCount > 0 && <StatusRow label="Pending review" value={data.templates.pendingCount} />}
                  {data.templates.rejectedCount > 0 && <StatusRow label="Rejected" value={data.templates.rejectedCount} />}
                </>
              ) : (
                <StatusRow label="Templates" value="Unavailable" />
              )}
            </div>

            {/* ── Billing data — honest, never fabricated ── */}
            <p className="text-[10px] text-gray-400 dark:text-white/40 leading-relaxed pt-2 border-t border-gray-100 dark:border-white/10">
              {data.billingDataNote}
            </p>

            {/* ── Marketing API credit lines — explicitly NOT WhatsApp billing ── */}
            {data.creditLines.length > 0 && (
              <div className="pt-2 border-t border-gray-100 dark:border-white/10">
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-300 dark:text-white/20 mb-2">
                  Marketing API Credit Lines (not WhatsApp billing)
                </p>
                <div className="space-y-1.5">
                  {data.creditLines.map(cl => (
                    <div key={cl.id} className="flex items-center justify-between p-2 bg-gray-50 dark:bg-white/5 rounded-lg text-[11px] opacity-70">
                      <span className="text-gray-500 dark:text-white/50">{cl.legalEntityName ?? cl.id}{cl.isAccessRevoked ? ' · access revoked' : ''}</span>
                      <span className="text-gray-500 dark:text-white/50">{cl.balance ? `${cl.balance.amount} ${cl.balance.currency}` : '—'}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[9px] text-gray-300 dark:text-white/20 mt-1.5 leading-relaxed">{data.creditLinesNote}</p>
              </div>
            )}
            {data.graphApiError && (
              <p className="text-[9px] text-gray-300 dark:text-white/20">Graph API note: {data.graphApiError}</p>
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

// ── Meta Integration Health (Admin-only) ────────────────────────────────────
// Built 2026-09-20 for the Facebook/Instagram ingestion investigation.
// Every value shown is either a real Graph API read or a real DB read —
// "Connected" is never shown merely because a credential exists, and a
// quiet channel is never reported as failed without real evidence either
// way (see ChannelIngestionStatus.evidence === 'NONE' → "No recent inbound
// event available for verification").

function fmtEvidence(status: ChannelIngestionStatus | undefined): { label: string; className: string } {
  if (!status || status.evidence === 'NONE') {
    return { label: 'No recent inbound event available for verification', className: 'text-gray-400 dark:text-white/40' }
  }
  if (status.evidence === 'RECENT') {
    return { label: `Last event ${fmtDateTime(status.lastInboundEventAt)}`, className: 'text-emerald-600 dark:text-emerald-400' }
  }
  return { label: `Last event ${fmtDateTime(status.lastInboundEventAt)} (stale)`, className: 'text-amber-600 dark:text-amber-400' }
}

function BoolBadge({ value }: { value: boolean | null }) {
  if (value === null) return <span className="text-[10px] text-gray-400 dark:text-white/40">Unknown</span>
  return value
    ? <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">Yes</span>
    : <span className="text-[10px] font-bold text-red-500 dark:text-red-400">No</span>
}

function MetaIntegrationHealthCard({ data, loading }: { data: MetaIntegrationHealth | null; loading: boolean }) {
  const d = data?.diagnostics
  const pageSub = d?.appSubscriptions?.find(s => s.object === 'page') ?? null
  const igSub   = d?.appSubscriptions?.find(s => s.object === 'instagram') ?? null

  return (
    <section>
      <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-white/40 mb-4 flex items-center gap-2">
        <HeartPulse size={10} /> Meta Integration Health — Facebook &amp; Instagram (Admin only)
      </p>
      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm p-5 space-y-5">
        {loading || !d ? (
          <div className="flex items-center justify-center py-10"><Loader2 size={20} className="animate-spin text-cyan-500" /></div>
        ) : (
          <>
            {/* ── Facebook ── */}
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-white/50 mb-2">Facebook</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                <div><span className="text-gray-400 dark:text-white/40 block">Page reachable</span><BoolBadge value={d.pageReachable} /></div>
                <div><span className="text-gray-400 dark:text-white/40 block">App subscribed</span><BoolBadge value={pageSub?.active ?? null} /></div>
                <div><span className="text-gray-400 dark:text-white/40 block">Page subscribed to app</span><BoolBadge value={d.pageSubscribedToApp} /></div>
                <div><span className="text-gray-400 dark:text-white/40 block">Callback URL</span><span className="font-mono text-[9px] text-gray-500 dark:text-white/50 break-all">{pageSub?.callbackUrl ?? 'unknown'}</span></div>
              </div>
              <div className="mt-2 space-y-1">
                <p className={cn('text-[10px]', fmtEvidence(data.ingestion.FACEBOOK).className)}>DMs — {fmtEvidence(data.ingestion.FACEBOOK).label}</p>
                <p className={cn('text-[10px]', fmtEvidence(data.ingestion.FACEBOOK_COMMENT).className)}>Comments — {fmtEvidence(data.ingestion.FACEBOOK_COMMENT).label}</p>
              </div>
            </div>

            {/* ── Instagram ── */}
            <div className="pt-3 border-t border-gray-100 dark:border-white/10">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-white/50 mb-2">Instagram {d.instagramUsername && <span className="font-normal normal-case text-gray-400">· @{d.instagramUsername}</span>}</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                <div><span className="text-gray-400 dark:text-white/40 block">Account reachable</span><BoolBadge value={d.instagramReachable} /></div>
                <div><span className="text-gray-400 dark:text-white/40 block">App subscribed</span><BoolBadge value={igSub?.active ?? null} /></div>
                <div><span className="text-gray-400 dark:text-white/40 block">Subscribed fields</span><span className="text-gray-600 dark:text-white/60">{igSub?.fields?.join(', ') || 'unknown'}</span></div>
                <div><span className="text-gray-400 dark:text-white/40 block">Callback URL</span><span className="font-mono text-[9px] text-gray-500 dark:text-white/50 break-all">{igSub?.callbackUrl ?? 'unknown'}</span></div>
              </div>
              <div className="mt-2 space-y-1">
                <p className={cn('text-[10px]', fmtEvidence(data.ingestion.INSTAGRAM).className)}>DMs — {fmtEvidence(data.ingestion.INSTAGRAM).label}</p>
                <p className={cn('text-[10px]', fmtEvidence(data.ingestion.INSTAGRAM_COMMENT).className)}>Comments — {fmtEvidence(data.ingestion.INSTAGRAM_COMMENT).label}</p>
              </div>
            </div>

            {/* ── Permissions ── */}
            <div className="pt-3 border-t border-gray-100 dark:border-white/10">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-white/50 mb-2">Permissions</p>
              <div className="space-y-1">
                {d.permissionChecks.map(p => (
                  <div key={p.permission} className="flex items-center justify-between text-[11px]">
                    <span className="text-gray-500 dark:text-white/50">{p.permission} <span className="text-gray-300 dark:text-white/20">— {p.requiredByFeature}</span></span>
                    {p.granted === 'UNKNOWN'
                      ? <span className="text-[10px] text-gray-400 dark:text-white/40">Unknown</span>
                      : <BoolBadge value={p.granted} />}
                  </div>
                ))}
              </div>
            </div>

            {d.graphApiError && (
              <p className="text-[9px] text-gray-300 dark:text-white/20 pt-2 border-t border-gray-100 dark:border-white/10">Graph API note: {d.graphApiError}</p>
            )}
            <p className="text-[9px] text-gray-300 dark:text-white/20">
              &quot;App subscribed&quot; reflects Meta&apos;s app-level webhook configuration. &quot;Page subscribed to app&quot; confirms this specific Page opted into receiving from it — both must be true for events to arrive.
            </p>
          </>
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
  const [channelRange, setChannelRange] = useState<AiUsageRange>('30d')

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
  const [metaIntegrationHealth, setMetaIntegrationHealth]               = useState<MetaIntegrationHealth | null>(null)
  const [metaIntegrationHealthLoading, setMetaIntegrationHealthLoading] = useState(true)

  function authH() {
    const t = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
    return { Authorization: `Bearer ${t}` }
  }

  async function load(force = false, range: AiUsageRange = channelRange) {
    force ? setRefreshing(true) : setLoading(true)
    setError(null)
    try {
      const ep = force ? `${API}/ai-suite/channel-analytics/refresh` : `${API}/ai-suite/channel-analytics`
      const res = await fetch(`${ep}?range=${range}`, { method: force ? 'POST' : 'GET', headers: authH() })
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

  async function loadMetaIntegrationHealth() {
    setMetaIntegrationHealthLoading(true)
    try {
      const res = await fetch(`${API}/ai-suite/meta-integration-health`, { headers: authH() })
      setMetaIntegrationHealth(res.ok ? await res.json() : null)
    } catch {
      setMetaIntegrationHealth(null)
    } finally {
      setMetaIntegrationHealthLoading(false)
    }
  }

  useEffect(() => {
    loadWhatsappHealth()
    try {
      const stored = typeof window !== 'undefined' ? localStorage.getItem('cc_user') : null
      const role = stored ? JSON.parse(stored)?.role : null
      setIsAdmin(role === 'ADMIN')
    } catch {
      setIsAdmin(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    load(false, channelRange)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelRange])

  useEffect(() => {
    if (isAdmin) {
      loadAiUsage(aiUsageRange)
      loadMetaBilling()
      loadCrmReadiness()
      loadMetaIntegrationHealth()
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
          {/* ── Operational volume (confirmations/follow-ups/escalations/calling) ── */}
          {data.operational && (
            <section>
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-white/40 mb-4 flex items-center gap-2">
                <ClipboardCheck size={10} /> Operational Volume ({AI_USAGE_RANGES.find(r => r.key === channelRange)?.label})
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                {[
                  { label: 'AI Interactions', value: data.operational.totalInteractions, tooltip: 'Total agent + patient messages across every channel below, for the selected period.' },
                  { label: 'Confirmations Sent', value: data.operational.confirmationsSent },
                  { label: 'Follow-ups Sent', value: data.operational.followupsSent },
                  { label: 'Escalations', value: data.operational.escalations },
                  { label: 'Calls', value: data.operational.callEvents, tooltip: 'Calling runs on a mock provider today — see the Calling status below.' },
                ].map(tile => (
                  <div key={tile.label} className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm p-4" title={tile.tooltip}>
                    <p className="text-2xl font-black text-gray-800 dark:text-white leading-none">{tile.value.toLocaleString()}</p>
                    <p className="text-[10px] font-bold text-gray-400 dark:text-white/40 mt-1">{tile.label}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Channel analytics ─────────────────────── */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-white/40 flex items-center gap-2">
                <BarChart2 size={10} /> Messaging Channels
              </p>
              <div className="flex gap-1">
                {AI_USAGE_RANGES.map(r => (
                  <button key={r.key} onClick={() => setChannelRange(r.key)}
                    className={cn(
                      'px-2.5 py-1 rounded-lg text-[10px] font-bold transition-colors',
                      channelRange === r.key
                        ? 'bg-cyan-500 text-white'
                        : 'bg-gray-50 dark:bg-white/5 text-gray-400 dark:text-white/40 hover:bg-gray-100 dark:hover:bg-white/10'
                    )}>
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {CHANNEL_ORDER.map(ch => (
                <ChannelCard key={ch} channel={ch} data={data.channels[ch]} status={data.channelStatus?.[ch]} rangeLabel={AI_USAGE_RANGES.find(r => r.key === channelRange)?.label} />
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
          <WhatsAppHealthCard data={whatsappHealth} loading={whatsappHealthLoading} isAdmin={isAdmin} />

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

          {/* ── Meta Integration Health — Facebook/Instagram webhook + permission evidence (Admin only) ── */}
          {isAdmin && <MetaIntegrationHealthCard data={metaIntegrationHealth} loading={metaIntegrationHealthLoading} />}

          {/* ── Meta WhatsApp API usage ─────────────────── */}
          {data.meta && (
            <section>
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-white/40 mb-4 flex items-center gap-2">
                <MessageSquare size={10} /> WhatsApp — Meta Cloud API usage
              </p>
              <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm p-5">
                {data.meta.account ? (
                  <>
                    <div className="grid grid-cols-1 gap-3">
                      <MetaWabaCard data={data.meta.account} label="Production WhatsApp Business Account" />
                    </div>
                    <p className="text-[9px] text-gray-300 dark:text-white/20 mt-3 leading-relaxed">
                      Via Meta pricing_analytics API, direct Meta Cloud API (no third-party routing) · figures cover every phone number registered on this account — Meta does not expose a per-number cost split · $0.00 = utility messages within 24-hour service window
                    </p>
                  </>
                ) : (
                  <div className="flex items-center gap-3 text-sm text-gray-400 dark:text-white/40">
                    <AlertCircle size={15} className="text-amber-400 flex-shrink-0" />
                    <p>WHATSAPP_WABA_ID not configured — usage data unavailable.</p>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* ── DigitalOcean costs (Admin only — infrastructure billing) ── */}
          {isAdmin && (
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
          )}
        </>
      ) : null}
    </div>
  )
}
