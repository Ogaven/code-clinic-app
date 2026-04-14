'use client'

import { useEffect, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, FunnelChart, Funnel, LabelList,
} from 'recharts'
import { TrendingUp, Users, Activity, CheckCircle2, Clock } from 'lucide-react'
import { cn, formatUGX } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────
interface JourneyStage { stage: string; count: number; pct: number }
interface ServiceItem  { service: string; count: number; revenue: number; color: string }
interface ProviderItem { doctor: string; appointments: number; color: string }
interface AcceptanceData { total: number; accepted: number; declined: number; pending: number; rate: number }

const STAGE_COLORS: Record<string, string> = {
  PENDING:        '#94A3B8',
  CONFIRMED:      '#3B82F6',
  CHECKED_IN:     '#EAB308',
  IN_CHAIR:       '#F97316',
  WITH_PROVIDER:  '#14B8A6',
  READY_CHECKOUT: '#A855F7',
  COMPLETED:      '#10B981',
}

const STAGE_LABELS: Record<string, string> = {
  PENDING:        'Scheduled',
  CONFIRMED:      'Confirmed',
  CHECKED_IN:     'Checked In',
  IN_CHAIR:       'In Chair',
  WITH_PROVIDER:  'With Provider',
  READY_CHECKOUT: 'Ready Checkout',
  COMPLETED:      'Completed',
}

// ─── Custom tooltip ───────────────────────────────────────────────────────────
function BarTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-100 dark:border-white/10 p-3 text-xs">
      <p className="font-bold text-gray-800 dark:text-white mb-1">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color || p.fill }} />
          <span className="text-gray-500">{p.name}:</span>
          <span className="font-bold text-gray-800 dark:text-white">
            {p.name === 'Revenue' ? formatUGX(p.value) : p.value}
          </span>
        </div>
      ))}
    </div>
  )
}

// ─── Patient Flow Funnel ──────────────────────────────────────────────────────
function PatientFlowFunnel({ data }: { data: JourneyStage[] }) {
  if (!data.length) return (
    <div className="flex items-center justify-center h-48 text-gray-400 text-sm">No data yet</div>
  )

  const maxCount = Math.max(...data.map((d) => d.count), 1)

  return (
    <div className="space-y-2">
      {data.map((stage) => {
        const color  = STAGE_COLORS[stage.stage] || '#94A3B8'
        const label  = STAGE_LABELS[stage.stage] || stage.stage
        const widthPct = Math.max((stage.count / maxCount) * 100, 8)
        return (
          <div key={stage.stage} className="flex items-center gap-3">
            <span className="text-[11px] text-gray-500 dark:text-gray-400 w-32 text-right flex-shrink-0">{label}</span>
            <div className="flex-1 bg-gray-100 dark:bg-white/10 rounded-full h-6 relative overflow-hidden">
              <div
                className="h-6 rounded-full flex items-center justify-end pr-2 transition-all duration-700"
                style={{ width: `${widthPct}%`, background: color }}
              >
                <span className="text-[10px] text-white font-bold">{stage.count}</span>
              </div>
            </div>
            <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 w-10 flex-shrink-0">{stage.pct}%</span>
          </div>
        )
      })}
    </div>
  )
}

// ─── Treatment Acceptance ─────────────────────────────────────────────────────
function AcceptanceDonut({ data }: { data: AcceptanceData | null }) {
  if (!data) return <div className="flex items-center justify-center h-40 text-gray-400 text-sm">No data</div>

  const slices = [
    { name: 'Accepted', value: data.accepted, color: '#10B981' },
    { name: 'Pending',  value: data.pending,  color: '#F59E0B' },
    { name: 'Declined', value: data.declined, color: '#EF4444' },
  ].filter((s) => s.value > 0)

  return (
    <div className="flex items-center gap-4">
      <ResponsiveContainer width={120} height={120}>
        <PieChart>
          <Pie data={slices} cx="50%" cy="50%" innerRadius={35} outerRadius={55} dataKey="value" paddingAngle={2}>
            {slices.map((s, i) => <Cell key={i} fill={s.color} />)}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="flex-1 space-y-2">
        <div className="text-center">
          <p className="text-3xl font-black text-clinic-navy dark:text-white">{data.rate}%</p>
          <p className="text-xs text-gray-400">Acceptance Rate</p>
        </div>
        {slices.map((s) => (
          <div key={s.name} className="flex items-center gap-2 text-xs">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: s.color }} />
            <span className="flex-1 text-gray-500 dark:text-gray-400">{s.name}</span>
            <span className="font-bold text-gray-700 dark:text-gray-200">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Main Analytics Page ──────────────────────────────────────────────────────
export default function AnalyticsPage() {
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const headers = { Authorization: `Bearer ${token}` }

  const [journey,     setJourney]     = useState<JourneyStage[]>([])
  const [acceptance,  setAcceptance]  = useState<AcceptanceData | null>(null)
  const [serviceMix,  setServiceMix]  = useState<ServiceItem[]>([])
  const [workload,    setWorkload]    = useState<ProviderItem[]>([])
  const [loading,     setLoading]     = useState(true)

  useEffect(() => {
    const API = '/api-proxy'
    Promise.all([
      fetch(`${API}/clinical/analytics/patient-journey`,      { headers }).then((r) => r.json()).catch(() => []),
      fetch(`${API}/clinical/analytics/treatment-acceptance`, { headers }).then((r) => r.json()).catch(() => null),
      fetch(`${API}/clinical/analytics/service-mix`,          { headers }).then((r) => r.json()).catch(() => []),
      fetch(`${API}/clinical/analytics/provider-workload`,    { headers }).then((r) => r.json()).catch(() => []),
    ]).then(([j, a, s, w]) => {
      setJourney(Array.isArray(j) ? j : [])
      setAcceptance(a)
      setServiceMix(Array.isArray(s) ? s : [])
      setWorkload(Array.isArray(w) ? w : [])
      setLoading(false)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const completedCount = journey.find((s) => s.stage === 'COMPLETED')?.count || 0
  const totalCount     = journey[0]?.count || 0
  const conversionRate = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

  const COLORS = ['#29ABE2','#1A237E','#9B59B6','#E8A838','#2ECC71','#E74C3C','#1ABC9C','#F39C12']

  return (
    <div className="space-y-4 animate-fade-in">

      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-clinic-navy dark:text-white">Analytics</h2>
        <p className="text-sm text-gray-400 mt-0.5">Clinical performance insights for this month</p>
      </div>

      {/* KPI row */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white dark:bg-white/5 rounded-2xl p-4 border border-gray-100 dark:border-white/10 animate-pulse h-24" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Total Appointments', value: totalCount, icon: Calendar2, color: '#29ABE2', bg: '#E0F7FF' },
            { label: 'Completed',          value: completedCount, icon: CheckCircle2, color: '#10B981', bg: '#D1FAE5' },
            { label: 'Conversion Rate',    value: `${conversionRate}%`, icon: TrendingUp, color: '#7C3AED', bg: '#EDE9FE' },
            { label: 'Acceptance Rate',    value: `${acceptance?.rate ?? 0}%`, icon: Activity, color: '#F59E0B', bg: '#FEF3C7' },
          ].map((k, i) => (
            <div key={i} className="bg-white dark:bg-white/5 rounded-2xl p-4 border border-gray-100 dark:border-white/10 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] font-semibold text-gray-400 dark:text-white/50 uppercase tracking-wide">{k.label}</p>
                <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: k.bg }}>
                  <k.icon size={15} style={{ color: k.color }} />
                </div>
              </div>
              <p className="text-2xl font-black text-clinic-navy dark:text-white">{k.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Main 2-col grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">

        {/* Patient Flow Funnel */}
        <div className="bg-white dark:bg-white/5 rounded-2xl p-5 border border-gray-100 dark:border-white/10 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="font-bold text-clinic-navy dark:text-white text-sm">Patient Flow Funnel</p>
              <p className="text-[11px] text-gray-400 mt-0.5">Journey through appointment stages this month</p>
            </div>
            <Users size={18} className="text-clinic-blue" />
          </div>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="h-6 bg-gray-100 dark:bg-white/10 rounded-full animate-pulse" />
              ))}
            </div>
          ) : (
            <PatientFlowFunnel data={journey} />
          )}
        </div>

        {/* Treatment Acceptance */}
        <div className="bg-white dark:bg-white/5 rounded-2xl p-5 border border-gray-100 dark:border-white/10 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="font-bold text-clinic-navy dark:text-white text-sm">Treatment Acceptance</p>
              <p className="text-[11px] text-gray-400 mt-0.5">Treatment plan acceptance rate this month</p>
            </div>
            <CheckCircle2 size={18} className="text-emerald-500" />
          </div>
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-8 h-8 border-2 border-clinic-blue border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <AcceptanceDonut data={acceptance} />
          )}
        </div>

        {/* Service Mix */}
        <div className="bg-white dark:bg-white/5 rounded-2xl p-5 border border-gray-100 dark:border-white/10 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="font-bold text-clinic-navy dark:text-white text-sm">Service Mix</p>
              <p className="text-[11px] text-gray-400 mt-0.5">Top services by appointments this month</p>
            </div>
            <Activity size={18} className="text-purple-500" />
          </div>
          {loading ? (
            <div className="h-48 bg-gray-100 dark:bg-white/10 rounded-xl animate-pulse" />
          ) : serviceMix.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-gray-400 text-sm">No data yet</div>
          ) : (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width="50%" height={160}>
                <PieChart>
                  <Pie data={serviceMix} cx="50%" cy="50%" innerRadius={40} outerRadius={70} dataKey="count" paddingAngle={2}>
                    {serviceMix.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: any) => [v, 'Appointments']} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-1.5">
                {serviceMix.slice(0, 6).map((s, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                    <span className="flex-1 truncate text-gray-600 dark:text-gray-300">{s.service}</span>
                    <span className="font-bold text-gray-700 dark:text-gray-200">{s.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Provider Workload */}
        <div className="bg-white dark:bg-white/5 rounded-2xl p-5 border border-gray-100 dark:border-white/10 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="font-bold text-clinic-navy dark:text-white text-sm">Provider Workload</p>
              <p className="text-[11px] text-gray-400 mt-0.5">Appointments per doctor this month</p>
            </div>
            <Clock size={18} className="text-orange-500" />
          </div>
          {loading ? (
            <div className="h-48 bg-gray-100 dark:bg-white/10 rounded-xl animate-pulse" />
          ) : workload.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-gray-400 text-sm">No data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={workload} margin={{ top: 0, right: 0, left: -30, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                <XAxis dataKey="doctor" tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                <Tooltip content={<BarTooltip />} />
                <Bar dataKey="appointments" name="Appointments" radius={[4, 4, 0, 0]}>
                  {workload.map((w, i) => (
                    <Cell key={i} fill={w.color || COLORS[i % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  )
}

// local icon shim (Calendar from lucide conflicts with variable name)
function Calendar2({ size, style }: { size: number; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={style}>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8" y1="2" x2="8" y2="6"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  )
}
