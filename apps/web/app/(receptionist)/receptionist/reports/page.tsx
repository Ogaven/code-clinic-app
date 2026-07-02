'use client'

import { useEffect, useState } from 'react'
import { BarChart2, Download, Bot, Loader2, Star, MessageSquare, TrendingUp } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Helpers ────────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' })
}
function daysAgoStr(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' })
}

// ── Patient Flow tab (existing content) ───────────────────────────────────────

function StatBox({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color: string }) {
  return (
    <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm p-5 hover:shadow-md transition-all">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ background: color + '20' }}>
        <BarChart2 size={18} style={{ color }} />
      </div>
      <p className="text-3xl font-black text-gray-800 dark:text-white">{value}</p>
      <p className="text-sm font-semibold text-gray-600 dark:text-gray-300 mt-0.5">{label}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function PatientFlowTab() {
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const authH = { Authorization: `Bearer ${token}` }
  const [stats, setStats]     = useState<any>(null)
  const [appts, setAppts]     = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [dateRange, setDate]  = useState('today')

  useEffect(() => { fetchData() }, [dateRange])

  async function fetchData() {
    setLoading(true)
    try {
      const [s, a] = await Promise.all([
        fetch('/api-proxy/receptionist/dashboard-stats', { headers: authH }).then(r => r.json()),
        fetch('/api-proxy/receptionist/today-appointments', { headers: authH }).then(r => r.json()),
      ])
      setStats(s)
      setAppts(Array.isArray(a) ? a : [])
    } catch {} finally { setLoading(false) }
  }

  const completed = appts.filter(a => a.status === 'COMPLETED').length
  const cancelled = appts.filter(a => a.status === 'CANCELLED').length
  const noShow    = appts.filter(a => a.status === 'NO_SHOW').length
  const pending   = appts.filter(a => a.status === 'PENDING').length

  const FLOW_STAGES = [
    { label: 'Patient Arrived',     statuses: ['PENDING'],                   color: '#64748B' },
    { label: 'Waiting Room',        statuses: ['CONFIRMED', 'CHECKED_IN'],   color: '#3B82F6' },
    { label: 'Session with Doctor', statuses: ['IN_CHAIR', 'WITH_PROVIDER'], color: '#0D9488' },
    { label: 'Checkout & Billing',  statuses: ['READY_CHECKOUT'],            color: '#9333EA' },
    { label: 'Patient Departed',    statuses: ['COMPLETED'],                 color: '#16A34A' },
    { label: 'Cancelled / No Show', statuses: ['CANCELLED', 'NO_SHOW'],      color: '#EF4444' },
  ]

  function durationMins(a: any): number {
    const end = a.status === 'COMPLETED' && a.updatedAt ? new Date(a.updatedAt) : new Date()
    return Math.round((end.getTime() - new Date(a.startAt).getTime()) / 60000)
  }
  function fmtMins(m: number) { return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m` }

  function exportFlowPDF() {
    const today = new Date().toLocaleDateString('en-UG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Nairobi' })
    const stageRows = FLOW_STAGES.map(s => {
      const pts = appts.filter(a => s.statuses.includes(a.status))
      const avg = pts.length ? Math.round(pts.reduce((sum, a) => sum + durationMins(a), 0) / pts.length) : null
      return `<tr><td style="color:${s.color};font-weight:700">${s.label}</td><td>${pts.length}</td><td>${avg !== null ? fmtMins(avg) : '—'}</td><td>${pts.length ? fmtMins(Math.min(...pts.map(durationMins))) : '—'}</td><td>${pts.length ? fmtMins(Math.max(...pts.map(durationMins))) : '—'}</td></tr>`
    }).join('')
    const rows = appts.map(a => {
      const t     = new Date(a.startAt).toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi' })
      const stage = FLOW_STAGES.find(s => s.statuses.includes(a.status))?.label || a.status
      return `<tr><td>${a.patient?.firstName} ${a.patient?.lastName}</td><td>${t}</td><td>${a.service?.name || '—'}</td><td>Dr. ${a.doctor?.user?.firstName} ${a.doctor?.user?.lastName}</td><td>${stage}</td><td>${fmtMins(durationMins(a))}</td></tr>`
    }).join('')
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Live Flow Report — ${today}</title><style>body{font-family:Arial,sans-serif;padding:32px;color:#1a1a1a}h1{font-size:22px;margin-bottom:4px}h2{font-size:14px;font-weight:700;margin:24px 0 10px}p.sub{color:#666;font-size:13px;margin-bottom:24px}table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:8px}th{background:#0c1e50;color:white;text-align:left;padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.05em}td{padding:8px 10px;border-bottom:1px solid #e5e7eb}tr:nth-child(even) td{background:#f9fafb}.summary{display:flex;gap:16px;margin-bottom:24px;flex-wrap:wrap}.stat{background:#f1f5f9;border-radius:10px;padding:12px 20px;text-align:center}.stat .n{font-size:28px;font-weight:900;color:#0c1e50}.stat .l{font-size:11px;color:#64748b;margin-top:2px}@media print{body{padding:16px}}</style></head><body><h1>Live Patient Flow Report</h1><p class="sub">Code Clinic — ${today}</p><div class="summary"><div class="stat"><div class="n">${appts.length}</div><div class="l">Total Today</div></div><div class="stat"><div class="n" style="color:#16a34a">${completed}</div><div class="l">Completed</div></div><div class="stat"><div class="n" style="color:#ef4444">${cancelled}</div><div class="l">Cancelled</div></div><div class="stat"><div class="n" style="color:#d97706">${noShow}</div><div class="l">No Show</div></div></div><h2>Stage Duration Summary</h2><table><thead><tr><th>Stage</th><th>Count</th><th>Avg</th><th>Min</th><th>Max</th></tr></thead><tbody>${stageRows}</tbody></table><h2>Appointment Log</h2><table><thead><tr><th>Patient</th><th>Time</th><th>Service</th><th>Doctor</th><th>Stage</th><th>Duration</th></tr></thead><tbody>${rows}</tbody></table><p style="margin-top:24px;font-size:11px;color:#9ca3af">Generated ${new Date().toLocaleString('en-UG',{timeZone:'Africa/Nairobi'})} · Code Clinic</p></body></html>`
    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close(); w.print() }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 px-6 pt-5 pb-4 bg-white dark:bg-transparent border-b border-gray-100 dark:border-white/8">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-base font-bold text-gray-800 dark:text-white">Patient Flow Report</h2>
            <p className="text-sm text-gray-400 mt-0.5">Today's activity summary</p>
          </div>
          <div className="flex items-center gap-3">
            <select value={dateRange} onChange={e => setDate(e.target.value)}
              className="text-sm border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-gray-600 dark:text-white bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-cyan-500/20">
              <option value="today">Today</option>
              <option value="week">This week</option>
              <option value="month">This month</option>
            </select>
            <button onClick={exportFlowPDF}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5 hover:shadow-lg"
              style={{ background: 'linear-gradient(135deg,#0c1e50,#29ABE2)' }}>
              <Download size={14} /> Export PDF
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-4xl">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={24} className="animate-spin text-cyan-500" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-4">
              <StatBox label="Total Appointments" value={stats?.appointments?.total || 0} sub="scheduled today" color="#0891b2" />
              <StatBox label="New Patients" value={stats?.newPatients?.count || 0} sub="first visit today" color="#7c3aed" />
              <StatBox label="Returning Patients" value={stats?.returningPatients?.count || 0} sub="repeat visits today" color="#059669" />
              <StatBox label="AI Escalations" value={stats?.aiAgents?.escalationsToday || 0} sub="required attention" color="#d97706" />
            </div>

            <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm p-5">
              <h2 className="text-sm font-bold text-gray-700 dark:text-white mb-4">Appointment Breakdown</h2>
              <div className="space-y-3">
                {[
                  { label: 'Completed', count: completed,                           color: '#059669' },
                  { label: 'Confirmed', count: stats?.appointments?.confirmed || 0, color: '#0891b2' },
                  { label: 'Pending',   count: pending,                             color: '#d97706' },
                  { label: 'No Show',   count: noShow,                              color: '#9ca3af' },
                  { label: 'Cancelled', count: cancelled,                           color: '#ef4444' },
                ].map(({ label, count, color }) => {
                  const pct = Math.round((count / (appts.length || 1)) * 100)
                  return (
                    <div key={label} className="flex items-center gap-3">
                      <span className="text-sm text-gray-600 dark:text-white/70 w-24 flex-shrink-0">{label}</span>
                      <div className="flex-1 h-2.5 bg-gray-100 dark:bg-white/10 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: color }} />
                      </div>
                      <span className="text-sm font-bold text-gray-700 dark:text-white/80 w-8 text-right flex-shrink-0">{count}</span>
                      <span className="text-xs text-gray-400 dark:text-white/40 w-10 text-right flex-shrink-0">{pct}%</span>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-50 dark:border-white/8">
                <h2 className="text-sm font-bold text-gray-700 dark:text-white">Appointment Log</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-white/5">
                      {['Time', 'Patient', 'Doctor', 'Service', 'Status', 'Duration'].map(h => (
                        <th key={h} className="text-left px-4 py-2.5 text-xs font-black text-gray-400 dark:text-white/40 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                    {appts.length === 0 ? (
                      <tr><td colSpan={6} className="text-center py-8 text-gray-400 dark:text-white/40 text-sm">No appointments today</td></tr>
                    ) : appts.map(a => {
                      const t = new Date(a.startAt).toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi' })
                      const statusColor: Record<string, string> = {
                        CONFIRMED: 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
                        COMPLETED: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400',
                        PENDING:   'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
                        CANCELLED: 'bg-red-50 text-red-500 dark:bg-red-900/30 dark:text-red-400',
                        NO_SHOW:   'bg-gray-50 text-gray-500 dark:bg-white/5 dark:text-white/50',
                      }
                      return (
                        <tr key={a.id} className="hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                          <td className="px-4 py-3 font-mono text-xs font-semibold text-gray-700 dark:text-white/70">{t}</td>
                          <td className="px-4 py-3 font-medium text-gray-800 dark:text-white/90">{a.patient?.firstName} {a.patient?.lastName}</td>
                          <td className="px-4 py-3 text-gray-500 dark:text-white/60">Dr. {a.doctor?.user?.firstName} {a.doctor?.user?.lastName}</td>
                          <td className="px-4 py-3 text-gray-500 dark:text-white/60">{a.service?.name}</td>
                          <td className="px-4 py-3">
                            <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', statusColor[a.status] || 'bg-gray-50 text-gray-500')}>
                              {a.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500 dark:text-white/50 font-mono">{fmtMins(durationMins(a))}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-gradient-to-r from-slate-800 to-blue-900 rounded-2xl p-5 text-white">
              <div className="flex items-center gap-2 mb-3">
                <Bot size={18} className="text-cyan-400" />
                <h2 className="font-bold">AI Activity Summary</h2>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center">
                  <p className="text-3xl font-black text-cyan-400">{stats?.aiAgents?.count || 0}</p>
                  <p className="text-sm text-blue-200/70">Active Agents</p>
                </div>
                <div className="text-center">
                  <p className="text-3xl font-black text-purple-400">{stats?.aiAgents?.escalationsToday || 0}</p>
                  <p className="text-sm text-blue-200/70">Escalations Today</p>
                </div>
                <div className="text-center">
                  <p className="text-3xl font-black text-emerald-400">0</p>
                  <p className="text-sm text-blue-200/70">Calls Made Today</p>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Feedback tab ───────────────────────────────────────────────────────────────

function StarRow({ rating, filled }: { rating: number; filled: boolean }) {
  return (
    <Star
      size={16}
      className={filled ? 'text-amber-400' : 'text-gray-200 dark:text-white/10'}
      fill={filled ? '#fbbf24' : 'none'}
    />
  )
}

function Stars({ n, size = 16 }: { n: number; size?: number }) {
  return (
    <span className="flex items-center gap-0.5">
      {[1,2,3,4,5].map(i => (
        <Star key={i} size={size} className={i <= Math.round(n) ? 'text-amber-400' : 'text-gray-200 dark:text-white/15'} fill={i <= Math.round(n) ? '#fbbf24' : 'none'} />
      ))}
    </span>
  )
}

interface FeedbackSummary {
  totalReviews: number
  avgRating: number
  breakdown: Record<number, number>
  byDoctor: { name: string; avgRating: number; count: number }[]
  recent: { id: string; patientName: string; rating: number; comment: string | null; channel: string; submittedAt: string }[]
}

function FeedbackTab() {
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const [startDate, setStartDate] = useState(daysAgoStr(30))
  const [endDate,   setEndDate]   = useState(todayStr)
  const [data,      setData]      = useState<FeedbackSummary | null>(null)
  const [loading,   setLoading]   = useState(true)

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ startDate, endDate })
    fetch(`/api-proxy/scheduling/feedback/summary?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [startDate, endDate])

  const maxBreakdown = data ? Math.max(...Object.values(data.breakdown), 1) : 1

  return (
    <div className="flex flex-col h-full">
      {/* Sub-header */}
      <div className="flex-shrink-0 px-6 pt-5 pb-4 bg-white dark:bg-transparent border-b border-gray-100 dark:border-white/8">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-base font-bold text-gray-800 dark:text-white">Patient Feedback</h2>
            <p className="text-sm text-gray-400 mt-0.5">Ratings submitted via WhatsApp or app</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
              className="text-sm border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 text-gray-600 dark:text-white bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-cyan-500/20" />
            <span className="text-xs text-gray-400">–</span>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
              className="text-sm border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 text-gray-600 dark:text-white bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-cyan-500/20" />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-4xl">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={24} className="animate-spin text-amber-400" />
          </div>
        ) : !data || data.totalReviews === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="w-16 h-16 rounded-2xl bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center">
              <Star size={28} className="text-amber-300" />
            </div>
            <p className="text-base font-bold text-gray-500 dark:text-white/50">No feedback yet</p>
            <p className="text-sm text-gray-400 dark:text-white/30 text-center max-w-sm">
              Ratings will appear here when patients rate their experience via WhatsApp or the app.
            </p>
          </div>
        ) : (
          <>
            {/* Hero: avg rating + total */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

              {/* Big rating */}
              <div className="sm:col-span-1 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/10 rounded-2xl border border-amber-100 dark:border-amber-800/30 p-6 flex flex-col items-center justify-center gap-2">
                <p className="text-6xl font-black text-amber-500">{data.avgRating}</p>
                <Stars n={data.avgRating} size={22} />
                <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mt-1">Average Rating</p>
              </div>

              {/* Total reviews */}
              <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm p-6 flex flex-col items-center justify-center gap-1">
                <p className="text-5xl font-black text-gray-800 dark:text-white">{data.totalReviews}</p>
                <p className="text-sm font-semibold text-gray-500 dark:text-gray-400">Total Reviews</p>
                <p className="text-xs text-gray-400">in selected period</p>
              </div>

              {/* 5-star count */}
              <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm p-6 flex flex-col items-center justify-center gap-1">
                <p className="text-5xl font-black text-emerald-500">{data.breakdown[5] || 0}</p>
                <p className="text-sm font-semibold text-gray-500 dark:text-gray-400">5-Star Reviews</p>
                <p className="text-xs text-gray-400">
                  {data.totalReviews > 0 ? Math.round(((data.breakdown[5] || 0) / data.totalReviews) * 100) : 0}% of total
                </p>
              </div>
            </div>

            {/* Rating breakdown */}
            <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm p-5">
              <h3 className="text-sm font-bold text-gray-700 dark:text-white mb-4">Rating Breakdown</h3>
              <div className="space-y-3">
                {[5,4,3,2,1].map(star => {
                  const count = data.breakdown[star] || 0
                  const pct   = data.totalReviews > 0 ? Math.round((count / data.totalReviews) * 100) : 0
                  const barW  = maxBreakdown > 0 ? Math.round((count / maxBreakdown) * 100) : 0
                  return (
                    <div key={star} className="flex items-center gap-3">
                      <div className="flex items-center gap-1 w-16 flex-shrink-0">
                        <span className="text-sm font-bold text-gray-700 dark:text-white/80">{star}</span>
                        <Star size={13} className="text-amber-400" fill="#fbbf24" />
                      </div>
                      <div className="flex-1 h-3 bg-gray-100 dark:bg-white/10 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${barW}%`, background: star >= 4 ? '#10b981' : star === 3 ? '#f59e0b' : '#ef4444' }} />
                      </div>
                      <span className="text-sm font-bold text-gray-700 dark:text-white/80 w-8 text-right flex-shrink-0">{count}</span>
                      <span className="text-xs text-gray-400 w-10 text-right flex-shrink-0">{pct}%</span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* By doctor */}
            {data.byDoctor.length > 0 && (
              <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
                <div className="px-5 py-3.5 border-b border-gray-50 dark:border-white/8">
                  <h3 className="text-sm font-bold text-gray-700 dark:text-white">Average Rating by Doctor</h3>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-white/5">
                    <tr>
                      {['Doctor', 'Avg Rating', 'Stars', '# Reviews'].map(h => (
                        <th key={h} className="text-left px-4 py-2.5 text-xs font-black text-gray-400 dark:text-white/30 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                    {data.byDoctor.map(d => (
                      <tr key={d.name} className="hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                        <td className="px-4 py-3 font-semibold text-gray-800 dark:text-white">{d.name}</td>
                        <td className="px-4 py-3">
                          <span className={cn('text-base font-black', d.avgRating >= 4 ? 'text-emerald-500' : d.avgRating >= 3 ? 'text-amber-500' : 'text-red-500')}>
                            {d.avgRating}
                          </span>
                        </td>
                        <td className="px-4 py-3"><Stars n={d.avgRating} size={14} /></td>
                        <td className="px-4 py-3 text-gray-500 dark:text-white/50">{d.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Recent reviews */}
            <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
              <div className="px-5 py-3.5 border-b border-gray-50 dark:border-white/8">
                <h3 className="text-sm font-bold text-gray-700 dark:text-white">Recent Reviews</h3>
              </div>
              <div className="divide-y divide-gray-50 dark:divide-white/5">
                {data.recent.map(r => (
                  <div key={r.id} className="flex items-start gap-4 px-5 py-4">
                    <div className="w-9 h-9 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
                      <MessageSquare size={15} className="text-amber-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <p className="text-sm font-bold text-gray-800 dark:text-white">{r.patientName}</p>
                        <Stars n={r.rating} size={12} />
                        <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full',
                          r.channel === 'WHATSAPP' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400')}>
                          {r.channel}
                        </span>
                      </div>
                      {r.comment && (
                        <p className="text-xs text-gray-500 dark:text-white/50 mt-0.5 leading-relaxed">{r.comment}</p>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-400 flex-shrink-0 whitespace-nowrap">
                      {new Date(r.submittedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Africa/Nairobi' })}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Case Acceptance tab ────────────────────────────────────────────────────────

interface CASummary { presented: number; accepted: number; followUp: number; declined: number; onHold: number; acceptanceRate: number }
interface CADoctor  { name: string; presented: number; accepted: number; followUp: number; declined: number; acceptanceRate: number }
interface CAData    { summary: CASummary; byStatus: Record<string, number>; byDoctor: CADoctor[] }

function eatMonthRange() {
  const eatNow = new Date(Date.now() + 3 * 60 * 60 * 1000)
  const y = eatNow.getUTCFullYear(), m = eatNow.getUTCMonth()
  const from = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10)
  const to   = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10)
  return { from, to }
}
function lastMonthRange() {
  const eatNow = new Date(Date.now() + 3 * 60 * 60 * 1000)
  const y = eatNow.getUTCFullYear(), m = eatNow.getUTCMonth()
  const from = new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10)
  const to   = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
  return { from, to }
}
function fmtMonthLabel(from: string) {
  return new Date(from + 'T12:00:00Z').toLocaleDateString('en-UG', { month: 'long', year: 'numeric' })
}

function RateBar({ rate }: { rate: number }) {
  const color = rate >= 70 ? '#16a34a' : rate >= 50 ? '#d97706' : '#dc2626'
  return (
    <div className="w-full h-3 bg-gray-100 dark:bg-white/10 rounded-full overflow-hidden">
      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${rate}%`, background: color }} />
    </div>
  )
}

function CaseAcceptanceTab() {
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const def = eatMonthRange()
  const [preset,   setPreset]   = useState<'this' | 'last' | 'custom'>('this')
  const [from,     setFrom]     = useState(def.from)
  const [to,       setTo]       = useState(def.to)
  const [data,     setData]     = useState<CAData | null>(null)
  const [loading,  setLoading]  = useState(false)

  function applyPreset(p: 'this' | 'last' | 'custom') {
    setPreset(p)
    if (p === 'this')  { const r = eatMonthRange();  setFrom(r.from); setTo(r.to) }
    if (p === 'last')  { const r = lastMonthRange(); setFrom(r.from); setTo(r.to) }
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
      {/* Sub-header */}
      <div className="flex-shrink-0 px-6 pt-5 pb-4 bg-white dark:bg-transparent border-b border-gray-100 dark:border-white/8">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-base font-bold text-gray-800 dark:text-white">Case Acceptance Rate</h2>
            <p className="text-sm text-gray-400 mt-0.5">Treatment plans presented vs. accepted by patients</p>
          </div>
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
              className="px-4 py-2 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5"
              style={{ background: 'linear-gradient(135deg,#0c1e50,#29ABE2)' }}>
              Generate
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-4xl">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 size={24} className="animate-spin text-cyan-500" />
          </div>
        ) : !data ? null : (
          <>
            {/* Hero: big acceptance rate */}
            <div className="bg-gradient-to-br from-slate-800 to-blue-900 rounded-2xl p-6 text-white">
              <p className="text-xs font-bold text-blue-200/70 uppercase tracking-widest mb-1">
                {preset === 'last' ? fmtMonthLabel(from) : preset === 'this' ? fmtMonthLabel(from) : `${from} → ${to}`}
              </p>
              <div className="flex items-end gap-4 mb-4">
                <p className={cn('text-7xl font-black', (s?.acceptanceRate ?? 0) >= 70 ? 'text-emerald-400' : (s?.acceptanceRate ?? 0) >= 50 ? 'text-amber-400' : 'text-red-400')}>
                  {s?.acceptanceRate ?? 0}%
                </p>
                <p className="text-blue-200/70 text-sm pb-3">Case Acceptance Rate</p>
              </div>
              <RateBar rate={s?.acceptanceRate ?? 0} />
              <p className="text-xs text-blue-200/50 mt-2">
                {(s?.acceptanceRate ?? 0) >= 70 ? '✓ Above target (70%+)' : (s?.acceptanceRate ?? 0) >= 50 ? '⚠ Below target — follow up on pending plans' : '✕ Needs attention — many plans not accepted'}
              </p>
            </div>

            {/* Four stat cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: 'Presented',  value: s?.presented  ?? 0, color: '#0891b2', sub: 'total plans created'   },
                { label: 'Accepted',   value: s?.accepted   ?? 0, color: '#16a34a', sub: 'In Progress + Completed'},
                { label: 'Follow-up',  value: s?.followUp   ?? 0, color: '#d97706', sub: 'Planned — awaiting decision'},
                { label: 'Declined',   value: s?.declined   ?? 0, color: '#dc2626', sub: 'patient said no'        },
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
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-white/5">
                      <tr>
                        {['Doctor', 'Presented', 'Accepted', 'Follow-up', 'Declined', 'Rate', ''].map(h => (
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
                            <span className={cn('font-black text-base', d.acceptanceRate >= 70 ? 'text-emerald-500' : d.acceptanceRate >= 50 ? 'text-amber-500' : 'text-red-500')}>
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

            {/* How to read this report */}
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-2xl border border-blue-100 dark:border-blue-800/30 p-5">
              <h3 className="text-sm font-bold text-blue-800 dark:text-blue-300 mb-2">How to read this report</h3>
              <ul className="text-sm text-blue-700 dark:text-blue-300/70 space-y-1.5 list-disc list-inside">
                <li><strong>Presented</strong> — every treatment plan item created in the period (the clinic offered this treatment)</li>
                <li><strong>Accepted</strong> — plans marked <em>In Progress</em> or <em>Completed</em> (patient agreed to proceed)</li>
                <li><strong>Follow-up</strong> — plans still <em>Planned</em> (patient hasn't decided; staff should follow up)</li>
                <li><strong>Declined</strong> — plans marked <em>Declined</em> by staff after patient said no</li>
                <li><strong>Case Acceptance %</strong> = Accepted ÷ Presented × 100. Industry target is 70% or above.</li>
                <li>Doctor attribution is based on the patient's first appointment in the selected date range.</li>
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

type ReportsTab = 'flow' | 'feedback' | 'case-acceptance'

export default function ReportsPage() {
  const [tab, setTab] = useState<ReportsTab>('flow')

  return (
    <div className="flex flex-col h-full">
      {/* Page header + tab bar */}
      <div className="flex-shrink-0 bg-white dark:bg-[#0a1520] border-b border-gray-100 dark:border-white/8">
        <div className="px-6 pt-5 pb-0">
          <h1 className="text-xl font-black text-gray-800 dark:text-white">Reports</h1>
        </div>
        <div className="flex gap-0.5 px-6 pt-3">
          {([
            { key: 'flow',             label: 'Patient Flow',    icon: <BarChart2 size={13} /> },
            { key: 'feedback',         label: 'Feedback',        icon: <Star size={13} />      },
            { key: 'case-acceptance',  label: 'Case Acceptance', icon: <TrendingUp size={13} />},
          ] as { key: ReportsTab; label: string; icon: React.ReactNode }[]).map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold border-b-2 transition-all -mb-px',
                tab === t.key
                  ? 'border-cyan-500 text-cyan-600 dark:text-cyan-400'
                  : 'border-transparent text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300',
              )}>
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {tab === 'flow'            && <PatientFlowTab />}
        {tab === 'feedback'        && <FeedbackTab />}
        {tab === 'case-acceptance' && <CaseAcceptanceTab />}
      </div>
    </div>
  )
}
