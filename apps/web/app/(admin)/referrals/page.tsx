'use client'

import { useCallback, useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { RefreshCw, Users, TrendingUp, Share2 } from 'lucide-react'

interface SourceStat {
  source:     string
  count:      number
  revenue:    number
  thisMonth:  number
}

const NOT_RECORDED = 'Not Recorded'

const SOURCE_COLORS: Record<string, string> = {
  'Google Search':   '#4285F4',
  'Google Maps':     '#34A853',
  'WhatsApp':        '#25D366',
  'Instagram':       '#E1306C',
  'Facebook':        '#1877F2',
  'Patient Referral':'#F59E0B',
  'Walk-in':         '#8B5CF6',
  'Other':           '#6B7280',
  [NOT_RECORDED]:    '#D1D5DB',
}

function fmtUGX(n: number) {
  if (n >= 1_000_000) return `UGX ${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `UGX ${(n / 1_000).toFixed(0)}K`
  return `UGX ${n}`
}

export default function ReferralsPage() {
  const API   = '/api-proxy'
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const authH = { Authorization: `Bearer ${token}` }

  const [stats,   setStats]   = useState<SourceStat[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`${API}/patients/referral-stats`, { headers: authH as any })
      const d = await r.json()
      setStats(Array.isArray(d.stats) ? d.stats : [])
    } catch (e) { console.error('[referrals] fetch failed:', e) }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const totalPatients  = stats.reduce((s, x) => s + x.count, 0)
  const totalThisMonth = stats.reduce((s, x) => s + x.thisMonth, 0)
  const totalRevenue   = stats.reduce((s, x) => s + x.revenue, 0)

  // Chart shows only named sources (Not Recorded isn't an acquisition channel)
  const chartData = stats
    .filter(s => s.source !== NOT_RECORDED && s.count > 0)
    .map(s => ({ name: s.source, count: s.count, color: SOURCE_COLORS[s.source] || '#6B7280' }))
    .sort((a, b) => b.count - a.count)

  return (
    <div className="space-y-6">

      {/* Metric strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MetricCard label="Total Patients" value={totalPatients.toString()} icon={<Users size={18} />} color="#1A237E" loading={loading} />
        <MetricCard label="New This Month" value={totalThisMonth.toString()} icon={<TrendingUp size={18} />} color="#065F46" loading={loading} />
        <MetricCard label="Revenue Generated" value={fmtUGX(totalRevenue)} icon={<Share2 size={18} />} color="#5B21B6" loading={loading} />
      </div>

      {/* Bar chart — all time */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <h2 className="text-sm font-bold text-slate-700 mb-1">Patients by Referral Source — All Time</h2>
        <p className="text-xs text-slate-400 mb-4">Where patients are coming from</p>
        {loading ? (
          <div className="h-52 flex items-center justify-center text-gray-300 gap-2">
            <RefreshCw size={18} className="animate-spin" /> Loading…
          </div>
        ) : chartData.length === 0 ? (
          <div className="h-52 flex flex-col items-center justify-center text-gray-300">
            <Share2 size={32} className="mb-2 opacity-30" />
            <p className="text-sm">No referral data yet</p>
            <p className="text-xs mt-1">Update patient profiles with "How did they find us?"</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip
                formatter={(v: number) => [`${v} patients`, 'Total patients']}
                contentStyle={{ borderRadius: 8, fontSize: 12 }}
              />
              <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-bold text-slate-700">All-Time Referral Sources</h2>
          <p className="text-xs text-slate-400 mt-0.5">Patient count and revenue by acquisition channel</p>
        </div>
        {loading ? (
          <div className="p-8 flex items-center justify-center gap-2 text-gray-300">
            <RefreshCw size={16} className="animate-spin" /> Loading…
          </div>
        ) : stats.length === 0 ? (
          <div className="p-8 text-center text-gray-300">
            <p className="text-sm">No referral data yet</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-5 py-3 text-[10px] font-black uppercase tracking-widest text-gray-400">Source</th>
                <th className="px-5 py-3 text-[10px] font-black uppercase tracking-widest text-gray-400 text-right">This Month</th>
                <th className="px-5 py-3 text-[10px] font-black uppercase tracking-widest text-gray-400 text-right">Total Patients</th>
                <th className="px-5 py-3 text-[10px] font-black uppercase tracking-widest text-gray-400 text-right">Revenue Generated</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((row, i) => {
                const isNotRecorded = row.source === NOT_RECORDED
                const color = SOURCE_COLORS[row.source] || '#6B7280'
                const pct = totalPatients > 0 ? Math.round((row.count / totalPatients) * 100) : 0
                return (
                  <tr key={row.source} className={isNotRecorded ? 'border-t border-gray-200' : i % 2 === 0 ? '' : 'bg-gray-50/50'}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
                        {isNotRecorded ? (
                          <span className="text-xs font-medium text-gray-400 italic">{row.source}</span>
                        ) : (
                          <span className="font-medium text-slate-800">{row.source}</span>
                        )}
                        <span className="text-[10px] text-slate-400 ml-1">{pct}%</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span className={`font-semibold ${row.thisMonth > 0 ? 'text-green-700' : 'text-slate-300'}`}>
                        {row.thisMonth > 0 ? `+${row.thisMonth}` : '—'}
                      </span>
                    </td>
                    <td className={`px-5 py-3 text-right font-semibold ${isNotRecorded ? 'text-gray-400' : 'text-slate-700'}`}>{row.count}</td>
                    <td className="px-5 py-3 text-right font-semibold" style={{ color: isNotRecorded ? '#9CA3AF' : '#1A237E' }}>{fmtUGX(row.revenue)}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 border-t-2 border-gray-200">
                <td className="px-5 py-3 text-xs font-black uppercase tracking-widest text-gray-500">Total</td>
                <td className="px-5 py-3 text-right font-black text-slate-700">
                  {totalThisMonth > 0 ? `+${totalThisMonth}` : '—'}
                </td>
                <td className="px-5 py-3 text-right font-black text-slate-700">{totalPatients}</td>
                <td className="px-5 py-3 text-right font-black" style={{ color: '#1A237E' }}>{fmtUGX(totalRevenue)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  )
}

function MetricCard({ label, value, icon, color, loading }: {
  label: string; value: string; icon: React.ReactNode; color: string; loading: boolean
}) {
  return (
    <div className="bg-white rounded-2xl p-4 border border-gray-100" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
      <div className="flex items-start justify-between mb-2">
        <p className="text-[10px] font-black uppercase tracking-[0.15em] text-gray-400">{label}</p>
        <span style={{ color }}>{icon}</span>
      </div>
      {loading ? (
        <div className="h-7 w-20 bg-gray-100 rounded-lg animate-pulse" />
      ) : (
        <p className="text-xl font-black" style={{ color }}>{value}</p>
      )}
    </div>
  )
}
