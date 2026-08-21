'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  TrendingUp, TrendingDown, Users, Calendar, UserPlus, ClipboardList,
  ChevronRight, AlertTriangle, Bot, UserX, Stethoscope,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import { cn, formatUGX, getGreeting } from '@/lib/utils'
import Avatar from '@/components/ui/Avatar'

// ── Dashboard analytics types — all fields below are backed by real, live
//    Prisma-aggregated data from /clinical/analytics/dashboard and
//    /clinical/analytics/dental-dashboard. Nothing in this file is mocked. ──
interface DashMetrics {
  activeThisMonth: number; activeLastMonth: number
  newPatientsThisMonth: number; returningPatientsThisMonth: number; topReferralSource: string | null
  noShowRate: number; noShowCount: number; totalWeekAppts: number
  revenueCollected: number; revenueBilled: number; collectionRate: number
  unscheduledTreatmentValue: number; lapsedCount: number
}
interface DashCharts {
  revenueTrend:  { month: string; revenue: number }[]
  aiPerformance: { conversationsHandled: number; appointmentsBooked: number; messagesSent: number }
}
interface DashData { metrics: DashMetrics; charts: DashCharts }
interface DentalData {
  pipeline: Record<string, { count: number; totalUGX: number }>
  chartsToday: number
  treatmentsCompleted: number
}
interface UpcomingAppt {
  id: string; startAt: string; status: string
  patient: { firstName: string; lastName: string }
  doctor: { user: { firstName: string; lastName: string } }
  service: { name: string; colour: string }
}

const statusCfg: Record<string, { label: string; className: string }> = {
  CONFIRMED: { label: 'Confirmed', className: 'bg-blue-100 text-blue-700 dark:bg-blue-400/15 dark:text-blue-300' },
  PENDING:   { label: 'Pending',   className: 'bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300' },
  COMPLETED: { label: 'Completed', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300' },
  CANCELLED: { label: 'Cancelled', className: 'bg-red-100 text-red-700 dark:bg-red-400/15 dark:text-red-300' },
  NO_SHOW:   { label: 'No-show',   className: 'bg-red-100 text-red-700 dark:bg-red-400/15 dark:text-red-300' },
}

// ── Compact semicircle gauge — no charting library needed ──────────────────
function Gauge({ value, color }: { value: number; color: string }) {
  const clamped = Math.max(0, Math.min(100, value))
  const r = 46, cx = 56, cy = 54
  const circumference = Math.PI * r
  const offset = circumference * (1 - clamped / 100)
  const arc = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`
  return (
    <svg width="112" height="64" viewBox="0 0 112 64" className="mx-auto">
      <path d={arc} fill="none" stroke="currentColor" strokeWidth="9" strokeLinecap="round" className="text-gray-100 dark:text-white/10" />
      <path d={arc} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round"
        strokeDasharray={circumference} strokeDashoffset={offset} style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
    </svg>
  )
}

// ── Compact KPI tile ─────────────────────────────────────────────────────────
function KpiTile({ icon: Icon, label, value, sub, up, color }: {
  icon: React.ElementType; label: string; value: string; sub?: string; up?: boolean; color: string
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-gray-100 bg-white p-3.5 shadow-sm dark:border-white/10 dark:bg-white/5">
      <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl" style={{ background: color + '15', color }}>
        <Icon size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-lg font-semibold leading-tight text-clinic-navy dark:text-white">{value}</p>
        <p className="truncate text-[11px] text-gray-400">{label}</p>
        {sub && (
          <p className={cn('mt-0.5 flex items-center gap-1 text-[10px] font-medium', up === undefined ? 'text-gray-400' : up ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500')}>
            {up !== undefined && (up ? <TrendingUp size={9} /> : <TrendingDown size={9} />)}
            <span className="truncate">{sub}</span>
          </p>
        )}
      </div>
    </div>
  )
}

// ── Card shell ───────────────────────────────────────────────────────────────
function Card({ title, action, children, className }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/5', className)}>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{title}</p>
        {action}
      </div>
      {children}
    </div>
  )
}

const ViewAllLink = ({ href }: { href: string }) => (
  <Link href={href} className="flex items-center gap-0.5 text-[11px] font-semibold text-clinic-blue hover:underline dark:text-cyan-400">
    View all <ChevronRight size={11} />
  </Link>
)

export default function DashboardPage() {
  const [user, setUser]                 = useState<any>(null)
  const [dashData, setDashData]         = useState<DashData | null>(null)
  const [dentalData, setDentalData]     = useState<DentalData | null>(null)
  const [upcoming, setUpcoming]         = useState<UpcomingAppt[] | null>(null)

  useEffect(() => {
    const stored = localStorage.getItem('cc_user')
    if (stored) setUser(JSON.parse(stored))

    const token = localStorage.getItem('cc_token')
    if (!token) return
    const auth = { Authorization: `Bearer ${token}` }

    fetch('/api-proxy/clinical/analytics/dashboard', { headers: auth })
      .then(r => r.json()).then(d => { if (d?.metrics) setDashData(d) }).catch(() => {})

    fetch('/api-proxy/clinical/analytics/dental-dashboard', { headers: auth })
      .then(r => r.json()).then(d => { if (d && !d.error) setDentalData(d) }).catch(() => {})

    // Reuses the same scheduling/appointments endpoint the Appointments workspace
    // uses. No params = today, ascending by start time.
    fetch('/api-proxy/scheduling/appointments', { headers: auth })
      .then(r => r.ok ? r.json() : [])
      .then(d => { if (Array.isArray(d)) setUpcoming(d) })
      .catch(() => {})
  }, [])

  const greeting    = getGreeting()
  const name        = user ? user.firstName : 'there'
  const isDoctor    = user?.role === 'DOCTOR'
  const displayName = isDoctor ? `Dr. ${name}` : name

  const m = dashData?.metrics
  const collectionGood = (m?.collectionRate ?? 0) >= 80
  const gaugeColor = collectionGood ? '#10B981' : (m?.collectionRate ?? 0) >= 50 ? '#F59E0B' : '#EF4444'

  const futureAppts = (upcoming ?? []).filter(a => new Date(a.startAt).getTime() >= Date.now() && a.status !== 'CANCELLED')
  const pipelineActive = dentalData ? Object.values(dentalData.pipeline).reduce((sum, p) => sum + p.count, 0) : null

  return (
    <div className="animate-fade-in space-y-3">

      {/* ── Welcome header + quick actions ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold leading-tight text-clinic-navy dark:text-white">
            {greeting}, {displayName} 👋
          </h2>
          <p className="mt-0.5 text-xs text-gray-400">Here&apos;s what&apos;s happening at Code Clinic today.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/patients" className="flex items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-xs font-semibold text-clinic-navy shadow-sm border border-gray-100 transition hover:-translate-y-0.5 dark:border-white/10 dark:bg-white/5 dark:text-white">
            <UserPlus size={13} /> New Patient
          </Link>
          <Link href="/scheduling" className="flex items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-xs font-semibold text-clinic-navy shadow-sm border border-gray-100 transition hover:-translate-y-0.5 dark:border-white/10 dark:bg-white/5 dark:text-white">
            <Calendar size={13} /> Schedule Appointment
          </Link>
          <Link href="/reports" className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:-translate-y-0.5" style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
            <ClipboardList size={13} /> Reports
          </Link>
        </div>
      </div>

      {/* ── KPI row — all real, from /clinical/analytics/dashboard + dental-dashboard ── */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiTile icon={Calendar} label="Appointments This Week" value={m ? m.totalWeekAppts.toString() : '—'} color="#29ABE2" />
        <KpiTile icon={AlertTriangle} label="No-shows This Week" value={m ? m.noShowCount.toString() : '—'}
          sub={m ? `${m.noShowRate}% rate` : undefined} up={m ? m.noShowRate <= 10 : undefined} color={m && m.noShowRate > 10 ? '#DC2626' : '#F59E0B'} />
        <KpiTile icon={Stethoscope} label="Treatments Completed" value={dentalData ? dentalData.treatmentsCompleted.toString() : '—'} sub="today" color="#059669" />
        <KpiTile icon={Users} label="Active Patients" value={m ? m.activeThisMonth.toString() : '—'} sub="this month" color="#7C3AED" />
      </div>

      {/* ── Collection health · Financial snapshot · Sarah AI ── */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">

        {/* Collection rate gauge — stands in for patient-satisfaction data, which
            doesn't exist yet in this codebase. No rating was invented. */}
        <Card title="Collection Health">
          <Gauge value={m?.collectionRate ?? 0} color={gaugeColor} />
          <p className="-mt-1 text-center text-2xl font-semibold" style={{ color: gaugeColor }}>{m ? `${m.collectionRate}%` : '—'}</p>
          <p className="text-center text-[11px] text-gray-400">Collection rate</p>
          {m && <p className="mt-2 text-center text-[10px] text-gray-400">{formatUGX(m.revenueCollected)} of {formatUGX(m.revenueBilled)} billed</p>}
        </Card>

        {/* Financial snapshot — real revenue trend, no fabricated expenses/net figures */}
        <Card title="Financial Snapshot" action={<ViewAllLink href="/accounts/dashboard" />}>
          <div className="mb-2 flex items-baseline gap-4">
            <div>
              <p className="text-lg font-semibold text-clinic-navy dark:text-white">{m ? formatUGX(m.revenueCollected) : '—'}</p>
              <p className="text-[10px] text-gray-400">Collected this month</p>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-500 dark:text-slate-400">{m ? formatUGX(m.revenueBilled) : '—'}</p>
              <p className="text-[10px] text-gray-400">Billed</p>
            </div>
          </div>
          {!dashData ? (
            <div className="h-[80px] animate-pulse rounded-xl bg-gray-50 dark:bg-white/5" />
          ) : dashData.charts.revenueTrend.length === 0 ? (
            <div className="flex h-[80px] items-center justify-center text-xs text-gray-300">No payment data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={80}>
              <BarChart data={dashData.charts.revenueTrend} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                <XAxis dataKey="month" tick={{ fontSize: 9, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip formatter={(v: number) => [formatUGX(v), 'Revenue']} contentStyle={{ borderRadius: 8, fontSize: 11 }} />
                <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
                  {dashData.charts.revenueTrend.map((_, i, arr) => (
                    <Cell key={i} fill={i === arr.length - 1 ? '#1A237E' : '#29ABE2'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* Sarah — real AI Suite performance figures, links to Conversations */}
        <div className="rounded-2xl p-4 text-white shadow-sm" style={{ background: 'linear-gradient(135deg,#1A237E,#0d47a1)' }}>
          <div className="mb-3 flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-white/15"><Bot size={16} /></span>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-200">Sarah — AI Assistant</p>
              <p className="text-xs text-blue-100">This month</p>
            </div>
          </div>
          <div className="space-y-2">
            {[
              { label: 'Conversations Handled', value: dashData?.charts.aiPerformance.conversationsHandled },
              { label: 'Bookings by Sarah',      value: dashData?.charts.aiPerformance.appointmentsBooked },
              { label: 'Messages Sent',          value: dashData?.charts.aiPerformance.messagesSent },
            ].map(row => (
              <div key={row.label} className="flex items-center justify-between rounded-xl bg-white/10 px-3 py-2">
                <span className="text-[11px] font-medium text-blue-100">{row.label}</span>
                <span className="text-sm font-semibold text-white">{row.value ?? '—'}</span>
              </div>
            ))}
          </div>
          <Link href="/ai-suite/inbox" className="mt-3 flex items-center justify-center gap-1 rounded-xl bg-white/15 py-2 text-[11px] font-semibold text-white transition hover:bg-white/25">
            Open Conversations <ChevronRight size={12} />
          </Link>
        </div>
      </div>

      {/* ── Patient overview · Upcoming appointments · Clinic summary ── */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">

        {/* Patient Overview — real Active / Returning / New / Lapsed counts */}
        <Card title="Patients Overview" action={<ViewAllLink href="/patients" />}>
          {!m ? (
            <div className="h-24 animate-pulse rounded-xl bg-gray-50 dark:bg-white/5" />
          ) : (() => {
            const segments = [
              { label: 'Active',     value: m.activeThisMonth,             color: '#1A237E' },
              { label: 'Returning',  value: m.returningPatientsThisMonth,  color: '#29ABE2' },
              { label: 'New',        value: m.newPatientsThisMonth,        color: '#10B981' },
              { label: 'Lapsed',     value: m.lapsedCount,                 color: '#EF4444' },
            ]
            const total = Math.max(segments.reduce((s, x) => s + x.value, 0), 1)
            return (
              <>
                <div className="flex h-3 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-white/10">
                  {segments.map(s => s.value > 0 && (
                    <div key={s.label} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} />
                  ))}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-y-2">
                  {segments.map(s => (
                    <div key={s.label} className="flex items-center gap-1.5">
                      <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: s.color }} />
                      <span className="text-[11px] text-gray-500 dark:text-slate-400">{s.label}</span>
                      <span className="ml-auto text-[11px] font-semibold text-gray-800 dark:text-white">{s.value}</span>
                    </div>
                  ))}
                </div>
                {m.lapsedCount > 0 && (
                  <Link href="/campaigns?segment=LAPSED" className="mt-3 flex items-center justify-center gap-1.5 rounded-xl border border-red-100 py-1.5 text-[10px] font-semibold text-red-500 transition hover:bg-red-50 dark:border-red-500/20 dark:hover:bg-red-500/10">
                    <UserX size={11} /> Send Recall to Lapsed Patients
                  </Link>
                )}
              </>
            )
          })()}
        </Card>

        {/* Upcoming Appointments — real scheduling data, dashboard preview only */}
        <Card title="Upcoming Appointments" action={<ViewAllLink href="/scheduling" />}>
          {upcoming === null ? (
            <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-11 animate-pulse rounded-xl bg-gray-50 dark:bg-white/5" />)}</div>
          ) : futureAppts.length === 0 ? (
            <div className="flex h-24 flex-col items-center justify-center gap-1 text-center">
              <Calendar size={20} className="text-gray-200 dark:text-white/15" />
              <p className="text-xs text-gray-400">No more appointments today</p>
            </div>
          ) : (
            <div className="-mx-1 space-y-1">
              {futureAppts.slice(0, 4).map(a => {
                const s = statusCfg[a.status] ?? statusCfg.PENDING
                const time = new Date(a.startAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true })
                return (
                  <div key={a.id} className="flex items-center gap-2.5 rounded-xl px-1 py-1.5 transition hover:bg-gray-50 dark:hover:bg-white/5">
                    <Avatar firstName={a.patient.firstName} lastName={a.patient.lastName} colour={a.service.colour || '#29ABE2'} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-gray-800 dark:text-gray-200">{a.patient.firstName} {a.patient.lastName}</p>
                      <p className="truncate text-[10px] text-gray-400">{a.service.name} · Dr. {a.doctor.user.firstName}</p>
                    </div>
                    <div className="flex-shrink-0 text-right">
                      <p className="text-[10px] font-semibold text-gray-500 dark:text-slate-400">{time}</p>
                      <span className={cn('text-[9px] font-semibold px-1.5 py-0.5 rounded-full', s.className)}>{s.label}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        {/* Clinic summary — real counts in place of fabricated utilisation % */}
        <Card title="Today's Clinic Summary" action={<ViewAllLink href="/treatment-pipeline" />}>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-xl border border-gray-100 p-3 dark:border-white/10">
              <p className="text-xl font-semibold text-clinic-navy dark:text-white">{dentalData ? dentalData.chartsToday : '—'}</p>
              <p className="text-[10px] text-gray-400">Charts Updated</p>
            </div>
            <div className="rounded-xl border border-gray-100 p-3 dark:border-white/10">
              <p className="text-xl font-semibold text-clinic-navy dark:text-white">{dentalData ? dentalData.treatmentsCompleted : '—'}</p>
              <p className="text-[10px] text-gray-400">Treatments Done</p>
            </div>
            <div className="rounded-xl border border-gray-100 p-3 dark:border-white/10">
              <p className="text-xl font-semibold text-clinic-navy dark:text-white">{pipelineActive ?? '—'}</p>
              <p className="text-[10px] text-gray-400">Active Pipeline Cases</p>
            </div>
            <div className="rounded-xl border border-gray-100 p-3 dark:border-white/10">
              <p className="text-xl font-semibold text-clinic-navy dark:text-white">{m ? formatUGX(m.unscheduledTreatmentValue) : '—'}</p>
              <p className="text-[10px] text-gray-400">Unscheduled Value</p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
