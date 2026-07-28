'use client'

import { useEffect, useState } from 'react'
import { RefreshCw, Loader2, BarChart2, DollarSign, MessageSquare, AlertCircle } from 'lucide-react'
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
  meta: { uganda: WabaUsage; kenya: WabaUsage; cachedAt: string } | null
  digitalocean: DoBalance | { notConfigured: true }
  cachedAt: string
}

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

function ChannelCard({ channel, data }: { channel: string; data: ChannelData }) {
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
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-white/40">{meta.label}</p>
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

// ── Page ──────────────────────────────────────────────────────────────────────

const CHANNEL_ORDER = ['WHATSAPP', 'WEBSITE', 'FACEBOOK', 'FACEBOOK_COMMENT', 'INSTAGRAM', 'INSTAGRAM_COMMENT', 'SMS']

export default function AnalyticsPage() {
  const API = '/api-proxy'
  const [data, setData]             = useState<Analytics | null>(null)
  const [loading, setLoading]       = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError]           = useState<string | null>(null)

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

  useEffect(() => { load() }, [])

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
                <ChannelCard key={ch} channel={ch} data={data.channels[ch]} />
              ))}
            </div>
          </section>

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
