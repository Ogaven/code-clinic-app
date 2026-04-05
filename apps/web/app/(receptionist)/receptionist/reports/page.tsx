'use client'

import { useEffect, useState } from 'react'
import { BarChart2, Download, Calendar, Users, Bot, TrendingUp, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

function StatBox({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 hover:shadow-md transition-all">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ background: color + '20' }}>
        <BarChart2 size={18} style={{ color }} />
      </div>
      <p className="text-3xl font-black text-gray-800">{value}</p>
      <p className="text-sm font-semibold text-gray-600 mt-0.5">{label}</p>
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

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-800">Reports</h1>
          <p className="text-sm text-gray-400 mt-0.5">Receptionist summary — today's activity</p>
        </div>
        <div className="flex items-center gap-3">
          <select value={dateRange} onChange={e => setDate(e.target.value)}
            className="text-sm border border-gray-200 rounded-xl px-3 py-2 text-gray-600 bg-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500">
            <option value="today">Today</option>
            <option value="week">This week</option>
            <option value="month">This month</option>
          </select>
          <button className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5 hover:shadow-lg"
            style={{ background: 'linear-gradient(135deg,#0c1e50,#29ABE2)' }}>
            <Download size={14} /> Export PDF
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
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h2 className="text-sm font-bold text-gray-700 mb-4">Appointment Breakdown</h2>
            <div className="space-y-3">
              {[
                { label: 'Completed', count: completed, color: '#059669', bg: '#f0fdf4' },
                { label: 'Confirmed', count: stats?.appointments?.confirmed || 0, color: '#0891b2', bg: '#ecfeff' },
                { label: 'Pending', count: pending, color: '#d97706', bg: '#fffbeb' },
                { label: 'No Show', count: noShow, color: '#9ca3af', bg: '#f9fafb' },
                { label: 'Cancelled', count: cancelled, color: '#ef4444', bg: '#fef2f2' },
              ].map(({ label, count, color, bg }) => {
                const total = appts.length || 1
                const pct   = Math.round((count / total) * 100)
                return (
                  <div key={label} className="flex items-center gap-3">
                    <span className="text-sm text-gray-600 w-24 flex-shrink-0">{label}</span>
                    <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: color }} />
                    </div>
                    <span className="text-sm font-bold text-gray-700 w-8 text-right flex-shrink-0">{count}</span>
                    <span className="text-xs text-gray-400 w-10 text-right flex-shrink-0">{pct}%</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Appointment table */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-50">
              <h2 className="text-sm font-bold text-gray-700">Appointment Log</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50">
                    {['Time', 'Patient', 'Doctor', 'Service', 'Status'].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-xs font-black text-gray-400 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {appts.length === 0 ? (
                    <tr><td colSpan={5} className="text-center py-8 text-gray-400 text-sm">No appointments today</td></tr>
                  ) : appts.map(a => {
                    const t = new Date(a.startAt).toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Kampala' })
                    const statusColor: Record<string, string> = {
                      CONFIRMED: 'bg-blue-50 text-blue-600',
                      COMPLETED: 'bg-emerald-50 text-emerald-600',
                      PENDING: 'bg-amber-50 text-amber-600',
                      CANCELLED: 'bg-red-50 text-red-500',
                      NO_SHOW: 'bg-gray-50 text-gray-500',
                      IN_PROGRESS: 'bg-violet-50 text-violet-600',
                    }
                    return (
                      <tr key={a.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs font-semibold text-gray-700">{t}</td>
                        <td className="px-4 py-3 font-medium text-gray-800">{a.patient?.firstName} {a.patient?.lastName}</td>
                        <td className="px-4 py-3 text-gray-500">Dr. {a.doctor?.user?.firstName} {a.doctor?.user?.lastName}</td>
                        <td className="px-4 py-3 text-gray-500">{a.service?.name}</td>
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
