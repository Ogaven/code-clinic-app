'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, TrendingUp, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface CASummary { presented: number; accepted: number; followUp: number; declined: number; onHold: number; acceptanceRate: number }
interface CADoctor  { name: string; presented: number; accepted: number; followUp: number; declined: number; acceptanceRate: number }
interface CAData    { summary: CASummary; byStatus: Record<string, number>; byDoctor: CADoctor[] }

function eatMonthRange() {
  const eatNow = new Date(Date.now() + 3 * 60 * 60 * 1000)
  const y = eatNow.getUTCFullYear(), m = eatNow.getUTCMonth()
  return {
    from: new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10),
    to:   new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10),
  }
}
function lastMonthRange() {
  const eatNow = new Date(Date.now() + 3 * 60 * 60 * 1000)
  const y = eatNow.getUTCFullYear(), m = eatNow.getUTCMonth()
  return {
    from: new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10),
    to:   new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10),
  }
}
function fmtMonthLabel(from: string) {
  return new Date(from + 'T12:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

function RateBar({ rate }: { rate: number }) {
  const color = rate >= 70 ? '#16a34a' : rate >= 50 ? '#d97706' : '#dc2626'
  return (
    <div className="w-full h-3 bg-gray-100 dark:bg-white/10 rounded-full overflow-hidden">
      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${rate}%`, background: color }} />
    </div>
  )
}

export default function CaseAcceptancePage() {
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const def = eatMonthRange()
  const [preset,  setPreset]  = useState<'this' | 'last' | 'custom'>('this')
  const [from,    setFrom]    = useState(def.from)
  const [to,      setTo]      = useState(def.to)
  const [data,    setData]    = useState<CAData | null>(null)
  const [loading, setLoading] = useState(false)

  function applyPreset(p: 'this' | 'last') {
    setPreset(p)
    const r = p === 'this' ? eatMonthRange() : lastMonthRange()
    setFrom(r.from); setTo(r.to)
  }

  async function generate(f = from, t = to) {
    setLoading(true)
    try {
      const res = await fetch(`/api-proxy/reports/case-acceptance?from=${f}&to=${t}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) setData(await res.json())
    } catch {} finally { setLoading(false) }
  }

  useEffect(() => { generate() }, [])

  const s = data?.summary

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 px-6 pt-5 pb-4 bg-white dark:bg-[#0a1520] border-b border-gray-100 dark:border-white/8">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <Link href="/reports/patient-flow"
              className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 dark:hover:text-white transition-colors">
              <ArrowLeft size={15} /> Reports
            </Link>
            <span className="text-gray-200 dark:text-white/20">/</span>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-cyan-100 dark:bg-cyan-900/30 flex items-center justify-center">
                <TrendingUp size={14} className="text-cyan-600 dark:text-cyan-400" />
              </div>
              <div>
                <h1 className="text-lg font-black text-gray-800 dark:text-white leading-none">Case Acceptance Rate</h1>
                <p className="text-xs text-gray-400 mt-0.5">Treatment plans presented vs. accepted</p>
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2 flex-wrap">
            {(['this', 'last'] as const).map(p => (
              <button key={p} onClick={() => applyPreset(p)}
                className={cn('px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors',
                  preset === p ? 'bg-cyan-500 text-white border-cyan-500' : 'bg-white dark:bg-white/5 text-gray-600 dark:text-white/60 border-gray-200 dark:border-white/10 hover:border-cyan-300')}>
                {p === 'this' ? 'This Month' : 'Last Month'}
              </button>
            ))}
            <input type="date" value={from} onChange={e => { setFrom(e.target.value); setPreset('custom') }}
              className="text-sm border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 text-gray-600 dark:text-white bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-cyan-500/20" />
            <span className="text-xs text-gray-400">–</span>
            <input type="date" value={to} onChange={e => { setTo(e.target.value); setPreset('custom') }}
              className="text-sm border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 text-gray-600 dark:text-white bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-cyan-500/20" />
            <button onClick={() => generate()}
              className="px-4 py-2 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5 hover:shadow-lg"
              style={{ background: 'linear-gradient(135deg,#0c1e50,#29ABE2)' }}>
              Generate
            </button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-4xl">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 size={24} className="animate-spin text-cyan-500" />
          </div>
        ) : !data ? null : (
          <>
            {/* Hero big % */}
            <div className="bg-gradient-to-br from-slate-800 to-blue-900 rounded-2xl p-6 text-white">
              <p className="text-xs font-bold text-blue-200/70 uppercase tracking-widest mb-1">
                {preset !== 'custom' ? fmtMonthLabel(from) : `${from} → ${to}`}
              </p>
              <div className="flex items-end gap-4 mb-4">
                <p className={cn('text-7xl font-black',
                  (s?.acceptanceRate ?? 0) >= 70 ? 'text-emerald-400' :
                  (s?.acceptanceRate ?? 0) >= 50 ? 'text-amber-400' : 'text-red-400')}>
                  {s?.acceptanceRate ?? 0}%
                </p>
                <p className="text-blue-200/70 text-sm pb-3">Clinic-wide Case Acceptance Rate</p>
              </div>
              <RateBar rate={s?.acceptanceRate ?? 0} />
              <p className="text-xs text-blue-200/50 mt-2">
                {(s?.acceptanceRate ?? 0) >= 70 ? '✓ Above target (70%+)' :
                 (s?.acceptanceRate ?? 0) >= 50 ? '⚠ Below target — follow up on pending plans' :
                 '✕ Needs attention — many plans not accepted'}
              </p>
            </div>

            {/* Four stat cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: 'Presented', value: s?.presented ?? 0, color: '#0891b2', sub: 'total plans created'          },
                { label: 'Accepted',  value: s?.accepted  ?? 0, color: '#16a34a', sub: 'In Progress + Completed'      },
                { label: 'Follow-up', value: s?.followUp  ?? 0, color: '#d97706', sub: 'Planned — awaiting decision'  },
                { label: 'Declined',  value: s?.declined  ?? 0, color: '#dc2626', sub: 'patient declined'             },
              ].map(({ label, value, color, sub }) => (
                <div key={label} className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm p-5">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center mb-3" style={{ background: color + '20' }}>
                    <TrendingUp size={15} style={{ color }} />
                  </div>
                  <p className="text-3xl font-black text-gray-800 dark:text-white">{value}</p>
                  <p className="text-sm font-semibold text-gray-600 dark:text-gray-300 mt-0.5">{label}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
                </div>
              ))}
            </div>

            {/* Per-doctor table */}
            {data.byDoctor.length > 0 && (
              <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
                <div className="px-5 py-3.5 border-b border-gray-50 dark:border-white/8">
                  <h3 className="text-sm font-bold text-gray-700 dark:text-white">Per-Doctor Breakdown</h3>
                  <p className="text-xs text-gray-400 mt-0.5">Attributed via patient's first appointment in the selected period</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-white/5">
                      <tr>
                        {['Doctor','Presented','Accepted','Follow-up','Declined','Rate',''].map(h => (
                          <th key={h} className="text-left px-4 py-2.5 text-xs font-black text-gray-400 dark:text-white/30 uppercase tracking-wide">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                      {data.byDoctor.map(d => (
                        <tr key={d.name} className="hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                          <td className="px-4 py-3 font-semibold text-gray-800 dark:text-white">{d.name}</td>
                          <td className="px-4 py-3 text-gray-600 dark:text-white/60">{d.presented}</td>
                          <td className="px-4 py-3 font-bold text-emerald-600 dark:text-emerald-400">{d.accepted}</td>
                          <td className="px-4 py-3 text-amber-600 dark:text-amber-400">{d.followUp}</td>
                          <td className="px-4 py-3 text-red-500 dark:text-red-400">{d.declined}</td>
                          <td className="px-4 py-3">
                            <span className={cn('font-black text-base',
                              d.acceptanceRate >= 70 ? 'text-emerald-500' :
                              d.acceptanceRate >= 50 ? 'text-amber-500' : 'text-red-500')}>
                              {d.acceptanceRate}%
                            </span>
                          </td>
                          <td className="px-4 py-3 w-32"><RateBar rate={d.acceptanceRate} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* How to read */}
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-2xl border border-blue-100 dark:border-blue-800/30 p-5">
              <h3 className="text-sm font-bold text-blue-800 dark:text-blue-300 mb-2">How to read this report</h3>
              <ul className="text-sm text-blue-700 dark:text-blue-300/70 space-y-1.5 list-disc list-inside">
                <li><strong>Presented</strong> — every treatment plan item created in the period (clinic offered this treatment)</li>
                <li><strong>Accepted</strong> — plans marked <em>In Progress</em> or <em>Completed</em> (patient agreed to proceed)</li>
                <li><strong>Follow-up</strong> — plans still <em>Planned</em> (patient hasn't decided — staff should follow up)</li>
                <li><strong>Declined</strong> — plans marked <em>Declined</em> by staff after patient said no</li>
                <li><strong>Case Acceptance %</strong> = Accepted ÷ Presented × 100. Industry target is 70% or above.</li>
                <li>Doctor attribution is based on the patient's first non-cancelled appointment in the selected date range.</li>
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
