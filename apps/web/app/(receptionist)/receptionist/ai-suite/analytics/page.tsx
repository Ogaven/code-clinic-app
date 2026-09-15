'use client'

import { useEffect, useState } from 'react'
import { RefreshCw, Loader2, BarChart2, DollarSign, MessageSquare, AlertCircle, Cpu } from 'lucide-react'
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

  useEffect(() => {
    load()
    try {
      const stored = typeof window !== 'undefined' ? localStorage.getItem('cc_user') : null
      const role = stored ? JSON.parse(stored)?.role : null
      setIsAdmin(role === 'ADMIN')
    } catch {
      setIsAdmin(false)
    }
  }, [])

  useEffect(() => {
    if (isAdmin) loadAiUsage(aiUsageRange)
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
                active/paused convention as the message channels above. */}
            <div className="mt-3 flex items-center gap-2 text-[11px] text-gray-400 dark:text-white/30">
              <span className="text-base">📞</span>
              <span className="font-bold uppercase tracking-widest text-[10px]">Calling</span>
              <span className="text-[8px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/40">
                Paused
              </span>
            </div>
          </section>

          {/* ── OpenAI token usage & cost (Admin only) ──── */}
          {isAdmin && (
            <OpenAiUsageCard
              data={aiUsage}
              range={aiUsageRange}
              onRangeChange={setAiUsageRange}
              loading={aiUsageLoading}
            />
          )}

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
