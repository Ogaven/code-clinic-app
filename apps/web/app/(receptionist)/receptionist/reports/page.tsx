'use client'

import { useEffect, useState } from 'react'
import { BarChart2, Download, Calendar, Users, Bot, TrendingUp, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

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

export default function ReportsPage() {
  const API   = '/api-proxy'
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
        fetch(`${API}/receptionist/dashboard-stats`, { headers: authH }).then(r => r.json()),
        fetch(`${API}/receptionist/today-appointments`, { headers: authH }).then(r => r.json()),
      ])
      setStats(s)
      setAppts(Array.isArray(a) ? a : [])
    } catch {} finally { setLoading(false) }
  }

  const completed  = appts.filter(a => a.status === 'COMPLETED').length
  const cancelled  = appts.filter(a => a.status === 'CANCELLED').length
  const noShow     = appts.filter(a => a.status === 'NO_SHOW').length
  const pending    = appts.filter(a => a.status === 'PENDING').length

  const FLOW_STAGES = [
    { label: 'Patient Arrived',    statuses: ['PENDING'],                    color: '#64748B' },
    { label: 'Waiting Room',       statuses: ['CONFIRMED', 'CHECKED_IN'],    color: '#3B82F6' },
    { label: 'Session with Doctor',statuses: ['IN_CHAIR', 'WITH_PROVIDER'],  color: '#0D9488' },
    { label: 'Checkout & Billing', statuses: ['READY_CHECKOUT'],             color: '#9333EA' },
    { label: 'Patient Departed',   statuses: ['COMPLETED'],                  color: '#16A34A' },
    { label: 'Cancelled / No Show',statuses: ['CANCELLED', 'NO_SHOW'],       color: '#EF4444' },
  ]

  function exportFlowPDF() {
    const today = new Date().toLocaleDateString('en-UG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Kampala' })
    const rows = appts.map(a => {
      const t = new Date(a.startAt).toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Kampala' })
      const stage = FLOW_STAGES.find(s => s.statuses.includes(a.status))?.label || a.status
      const elapsed = a.status === 'COMPLETED' && a.updatedAt
        ? `${Math.round((new Date(a.updatedAt).getTime() - new Date(a.startAt).getTime()) / 60000)} min`
        : '—'
      return `<tr>
        <td>${a.patient?.firstName} ${a.patient?.lastName}</td>
        <td>${t}</td>
        <td>${a.service?.name || '—'}</td>
        <td>Dr. ${a.doctor?.user?.firstName} ${a.doctor?.user?.lastName}</td>
        <td>${stage}</td>
        <td>${elapsed}</td>
      </tr>`
    }).join('')

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Live Flow Report — ${today}</title>
<style>
  body { font-family: Arial, sans-serif; padding: 32px; color: #1a1a1a; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  p.sub { color: #666; font-size: 13px; margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { background: #0c1e50; color: white; text-align: left; padding: 8px 10px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
  td { padding: 8px 10px; border-bottom: 1px solid #e5e7eb; }
  tr:nth-child(even) td { background: #f9fafb; }
  .summary { display: flex; gap: 24px; margin-bottom: 24px; }
  .stat { background: #f1f5f9; border-radius: 10px; padding: 12px 20px; text-align: center; }
  .stat .n { font-size: 28px; font-weight: 900; color: #0c1e50; }
  .stat .l { font-size: 11px; color: #64748b; margin-top: 2px; }
  @media print { body { padding: 16px; } }
</style></head><body>
<h1>Live Patient Flow Report</h1>
<p class="sub">Code Clinic — ${today}</p>
<div class="summary">
  <div class="stat"><div class="n">${appts.length}</div><div class="l">Total Today</div></div>
  <div class="stat"><div class="n" style="color:#16a34a">${completed}</div><div class="l">Completed</div></div>
  <div class="stat"><div class="n" style="color:#ef4444">${cancelled}</div><div class="l">Cancelled</div></div>
  <div class="stat"><div class="n" style="color:#d97706">${noShow}</div><div class="l">No Show</div></div>
  <div class="stat"><div class="n" style="color:#0891b2">${appts.length - completed - cancelled - noShow}</div><div class="l">Active / Pending</div></div>
</div>
<table>
  <thead><tr><th>Patient</th><th>Time</th><th>Service</th><th>Doctor</th><th>Stage</th><th>Duration</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<p style="margin-top:24px;font-size:11px;color:#9ca3af">Generated ${new Date().toLocaleString('en-UG', { timeZone: 'Africa/Kampala' })} · Code Clinic Management System</p>
</body></html>`

    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close(); w.print() }
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-800 dark:text-white">Reports</h1>
          <p className="text-sm text-gray-400 mt-0.5">Receptionist summary — today's activity</p>
        </div>
        <div className="flex items-center gap-3">
          <select value={dateRange} onChange={e => setDate(e.target.value)}
            className="text-sm border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 text-gray-600 dark:text-gray-300 bg-white dark:bg-white/5 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500">
            <option value="today">Today</option>
            <option value="week">This week</option>
            <option value="month">This month</option>
          </select>
          <button onClick={exportFlowPDF}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5 hover:shadow-lg"
            style={{ background: 'linear-gradient(135deg,#0c1e50,#29ABE2)' }}>
            <Download size={14} /> Export Live Flow PDF
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin text-cyan-500" />
        </div>
      ) : (
        <>
          {/* Stats grid */}
          <div className="grid grid-cols-4 gap-4">
            <StatBox label="Total Appointments" value={stats?.appointments?.total || 0} sub="scheduled today" color="#0891b2" />
            <StatBox label="New Patients" value={stats?.newPatients?.count || 0} sub="first visit today" color="#7c3aed" />
            <StatBox label="Returning Patients" value={stats?.returningPatients?.count || 0} sub="repeat visits today" color="#059669" />
            <StatBox label="AI Escalations" value={stats?.aiAgents?.escalationsToday || 0} sub="required attention" color="#d97706" />
          </div>

          {/* Appointment breakdown */}
          <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm p-5">
            <h2 className="text-sm font-bold text-gray-700 dark:text-white mb-4">Appointment Breakdown</h2>
            <div className="space-y-3">
              {[
                { label: 'Completed', count: completed, color: '#059669' },
                { label: 'Confirmed', count: stats?.appointments?.confirmed || 0, color: '#0891b2' },
                { label: 'Pending', count: pending, color: '#d97706' },
                { label: 'No Show', count: noShow, color: '#9ca3af' },
                { label: 'Cancelled', count: cancelled, color: '#ef4444' },
              ].map(({ label, count, color }) => {
                const total = appts.length || 1
                const pct   = Math.round((count / total) * 100)
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

          {/* Appointment table */}
          <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-50 dark:border-white/8">
              <h2 className="text-sm font-bold text-gray-700 dark:text-white">Appointment Log</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-white/5">
                    {['Time', 'Patient', 'Doctor', 'Service', 'Status'].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-xs font-black text-gray-400 dark:text-white/40 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                  {appts.length === 0 ? (
                    <tr><td colSpan={5} className="text-center py-8 text-gray-400 dark:text-white/40 text-sm">No appointments today</td></tr>
                  ) : appts.map(a => {
                    const t = new Date(a.startAt).toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Kampala' })
                    const statusColor: Record<string, string> = {
                      CONFIRMED: 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
                      COMPLETED: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400',
                      PENDING: 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
                      CANCELLED: 'bg-red-50 text-red-500 dark:bg-red-900/30 dark:text-red-400',
                      NO_SHOW: 'bg-gray-50 text-gray-500 dark:bg-white/5 dark:text-white/50',
                      IN_PROGRESS: 'bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400',
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
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* AI summary */}
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
  )
}
