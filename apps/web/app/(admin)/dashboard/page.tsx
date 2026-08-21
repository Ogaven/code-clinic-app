'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Plus, Calendar, Download, Bot, Users, Mic, Keyboard, Image as ImageIcon, ArrowUpRight,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts'
import { cn, formatUGX, getGreeting } from '@/lib/utils'
import Avatar from '@/components/ui/Avatar'

// ── All data below is fetched from real, already-existing Code Clinic APIs —
//    nothing in this file is mocked. Two slots in the reference layout
//    (Patient Satisfaction, Utilisation rings) have no backing data source
//    anywhere in this codebase; rather than invent numbers, they render an
//    honest "no data" state — see report. ──────────────────────────────────

interface DashMetrics {
  activeThisMonth: number; activeLastMonth: number
  newPatientsThisMonth: number; returningPatientsThisMonth: number
  noShowRate: number; noShowCount: number; totalWeekAppts: number
  lapsedCount: number
}
interface DashCharts {
  aiPerformance: { conversationsHandled: number; appointmentsBooked: number; messagesSent: number }
}
interface DashData { metrics: DashMetrics; charts: DashCharts }
interface DentalData { treatmentsCompleted: number }
interface UpcomingAppt {
  id: string; startAt: string; status: string
  patient: { firstName: string; lastName: string }
  doctor: { user: { firstName: string; lastName: string } }
  service: { name: string; colour: string }
}
interface FinanceData {
  monthRevenue: number; monthExpenses: number
  trend: { month: string; revenue: number; expenses: number }[]
}
interface MiniPatient { id: string; firstName: string; lastName: string; avatarUrl?: string | null }

const CATEGORY_FILTERS = { active: 'ACTIVE', returning: 'returning', fresh: 'new_patient', lapsed: 'LAPSED' } as const

// ── Compact KPI card — matches the 3-card row in the reference ─────────────
function KpiCard({ icon: Icon, value, label, color }: { icon: React.ElementType; value: string; label: string; color: string }) {
  return (
    <div className="flex flex-col justify-between rounded-2xl border border-gray-100 bg-white p-3.5 shadow-sm dark:border-white/10 dark:bg-white/5">
      <div className="flex items-start justify-between">
        <span />
        <span className="grid h-8 w-8 place-items-center rounded-xl" style={{ background: color + '15', color }}>
          <Icon size={15} />
        </span>
      </div>
      <div>
        <p className="text-2xl font-semibold leading-none text-clinic-navy dark:text-white">{value}</p>
        <p className="mt-1 text-[11px] text-gray-400">{label}</p>
      </div>
    </div>
  )
}

// ── Semicircle gauge ─────────────────────────────────────────────────────
function Gauge({ pct, color }: { pct: number | null; color: string }) {
  const clamped = pct === null ? 0 : Math.max(0, Math.min(100, pct))
  const r = 50, cx = 60, cy = 58
  const circumference = Math.PI * r
  const offset = circumference * (1 - clamped / 100)
  const arc = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`
  return (
    <svg width="120" height="66" viewBox="0 0 120 66" className="mx-auto">
      <path d={arc} fill="none" stroke="currentColor" strokeWidth="10" strokeLinecap="round" className="text-gray-100 dark:text-white/10" />
      {pct !== null && (
        <path d={arc} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset} style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
      )}
    </svg>
  )
}

function dateISOToday() {
  return new Date().toLocaleDateString('en-GB', { timeZone: 'Africa/Nairobi', weekday: 'long', day: 'numeric', month: 'long' })
}

export default function DashboardPage() {
  const [user, setUser]           = useState<any>(null)
  const [dashData, setDashData]   = useState<DashData | null>(null)
  const [dentalData, setDentalData] = useState<DentalData | null>(null)
  const [finance, setFinance]     = useState<FinanceData | null>(null)
  const [upcoming, setUpcoming]   = useState<UpcomingAppt[] | null>(null)
  const [avatars, setAvatars]     = useState<Record<string, MiniPatient[]>>({})

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

    // Reuses the existing Accounts dashboard endpoint (open to any authenticated
    // role) for real revenue/expenses — the only place that data exists.
    fetch('/api-proxy/accounts/dashboard', { headers: auth })
      .then(r => r.ok ? r.json() : null).then(d => { if (d) setFinance(d) }).catch(() => {})

    // Reuses the same scheduling/appointments endpoint the Appointments workspace uses.
    fetch('/api-proxy/scheduling/appointments', { headers: auth })
      .then(r => r.ok ? r.json() : []).then(d => { if (Array.isArray(d)) setUpcoming(d) }).catch(() => {})

    // Reuses the same patients endpoint/filters the Patients page uses, just to
    // pull a few real avatars per category — not for the counts themselves.
    Object.entries(CATEGORY_FILTERS).forEach(([key, filter]) => {
      fetch(`/api-proxy/patients?filter=${filter}&limit=3`, { headers: auth })
        .then(r => r.ok ? r.json() : null)
        .then(d => { const rows = Array.isArray(d) ? d : d?.data; if (Array.isArray(rows)) setAvatars(prev => ({ ...prev, [key]: rows })) })
        .catch(() => {})
    })
  }, [])

  const greeting    = getGreeting()
  const name        = user ? user.firstName : ''
  const isDoctor    = user?.role === 'DOCTOR'
  const displayName = isDoctor ? `Dr. ${name}` : name
  const m = dashData?.metrics

  const netIncome = finance ? finance.monthRevenue - finance.monthExpenses : null

  const futureAppts = (upcoming ?? []).filter(a => new Date(a.startAt).getTime() >= Date.now() && a.status !== 'CANCELLED').slice(0, 6)

  return (
    <div className="animate-fade-in space-y-3">

      {/* ── ROW 1 — greeting + actions | 3 KPI cards ── */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.4fr_1fr]">
        <div>
          <h2 className="text-xl font-semibold leading-tight text-clinic-navy dark:text-white">{greeting}, {displayName}! 👋</h2>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-full bg-clinic-navy px-3 py-1.5 text-[11px] font-semibold text-white dark:bg-white/10">
              <span className="grid h-4 w-4 place-items-center rounded-full bg-white/20 text-[9px]">{new Date().getDate()}</span>
              {dateISOToday()}
            </span>
            <Link href="/patients" className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm transition hover:-translate-y-0.5" style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
              <Plus size={12} /> New Patient
            </Link>
            <Link href="/scheduling" className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-clinic-navy transition hover:-translate-y-0.5 dark:border-white/10 dark:bg-white/5 dark:text-white">
              <Calendar size={12} /> Schedule Appointment
            </Link>
            <Link href="/reports" className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-clinic-navy transition hover:-translate-y-0.5 dark:border-white/10 dark:bg-white/5 dark:text-white">
              <Download size={12} /> Download Report
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2.5">
          <KpiCard icon={Calendar} value={m ? m.totalWeekAppts.toString() : '—'} label="Appointments This Week" color="#29ABE2" />
          <KpiCard icon={Calendar} value={m ? m.noShowCount.toString() : '—'} label="No-show Appointments" color="#EF4444" />
          <KpiCard icon={Calendar} value={dentalData ? dentalData.treatmentsCompleted.toString() : '—'} label="Treatments Completed" color="#10B981" />
        </div>
      </div>

      {/* ── ROW 2 — Patient Satisfaction | Financial Snapshot | Sarah AI Assistant ── */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[0.85fr_1.6fr_0.85fr]">

        {/* Patient Satisfaction — no review/rating data exists anywhere in this
            codebase (checked the Prisma schema and every API route). Rather
            than invent a rating, this renders an honest empty state. */}
        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/5">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Patient Satisfaction</p>
          <Gauge pct={null} color="#D1D5DB" />
          <p className="-mt-1 text-center text-xl font-semibold text-gray-300 dark:text-white/20">No data</p>
          <p className="text-center text-[10px] text-gray-400">Review data not tracked yet</p>
        </div>

        {/* Financial Snapshot — real Revenue/Expenses/Net Income + real 6-month
            trend, reused from the existing Accounts dashboard endpoint. */}
        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/5">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Financial Snapshot</p>
            <span className="rounded-full border border-gray-200 px-2.5 py-1 text-[10px] font-semibold text-gray-500 dark:border-white/10 dark:text-slate-400">Jan – Jun</span>
          </div>
          <div className="flex gap-4">
            <div className="flex-shrink-0 space-y-2">
              <div>
                <p className="text-lg font-semibold text-clinic-navy dark:text-white">{finance ? formatUGX(finance.monthRevenue) : '—'}</p>
                <p className="text-[10px] text-gray-400">Revenue</p>
              </div>
              <div>
                <p className="text-base font-semibold text-gray-500 dark:text-slate-300">{finance ? formatUGX(finance.monthExpenses) : '—'}</p>
                <p className="text-[10px] text-gray-400">Expenses</p>
              </div>
              <div>
                <p className="text-base font-semibold" style={{ color: netIncome !== null && netIncome >= 0 ? '#10B981' : '#EF4444' }}>{netIncome !== null ? formatUGX(netIncome) : '—'}</p>
                <p className="text-[10px] text-gray-400">Net Income</p>
              </div>
            </div>
            <div className="min-w-0 flex-1">
              {!finance ? (
                <div className="h-[128px] animate-pulse rounded-xl bg-gray-50 dark:bg-white/5" />
              ) : (
                <ResponsiveContainer width="100%" height={128}>
                  <BarChart data={finance.trend} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                    <YAxis hide />
                    <Tooltip formatter={(v: number, key: string) => [formatUGX(v), key === 'revenue' ? 'Revenue' : 'Expenses']} contentStyle={{ borderRadius: 8, fontSize: 11 }} />
                    <Bar dataKey="revenue" fill="#93C5FD" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>

        {/* Sarah AI Assistant — real conversation/booking stats from the AI Suite */}
        <Link href="/ai-suite/inbox" className="flex flex-col justify-between rounded-2xl p-4 text-white shadow-sm transition hover:-translate-y-0.5" style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-100">Sarah AI Assistant</p>
            <ArrowUpRight size={15} className="text-white/70" />
          </div>
          <div className="my-3 rounded-2xl bg-white/15 p-3 backdrop-blur-sm">
            <div className="flex items-start gap-2">
              <span className="grid h-6 w-6 flex-shrink-0 place-items-center rounded-full bg-white/25"><Bot size={13} /></span>
              <p className="rounded-xl rounded-tl-none bg-white/20 px-2.5 py-1.5 text-[11px] leading-snug text-white">Hi, I&apos;m Sarah — how can I help today?</p>
            </div>
          </div>
          <div className="space-y-1.5">
            {[
              { label: 'Conversations', value: dashData?.charts.aiPerformance.conversationsHandled },
              { label: 'Bookings by Sarah', value: dashData?.charts.aiPerformance.appointmentsBooked },
            ].map(row => (
              <div key={row.label} className="flex items-center justify-between text-[11px]">
                <span className="text-blue-100">{row.label}</span>
                <span className="font-semibold text-white">{row.value ?? '—'}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2 border-t border-white/15 pt-3 text-white/70">
            <Keyboard size={13} /> <Mic size={13} /> <ImageIcon size={13} />
          </div>
        </Link>
      </div>

      {/* ── ROW 3 — Patients Overview | Upcoming Appointments | Utilisation ── */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.05fr_1.3fr_0.85fr]">

        {/* Patients Overview — real Active/Returning/New/Lapsed, real avatars */}
        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/5">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Patients Overview</p>
            <Link href="/patients" className="text-[11px] font-semibold text-clinic-blue hover:underline dark:text-cyan-400">View all patients</Link>
          </div>
          {!m ? (
            <div className="h-32 animate-pulse rounded-xl bg-gray-50 dark:bg-white/5" />
          ) : (() => {
            const segs = [
              { key: 'active', label: 'Active', value: m.activeThisMonth, color: '#1A237E', delta: m.activeThisMonth - m.activeLastMonth },
              { key: 'returning', label: 'Returning', value: m.returningPatientsThisMonth, color: '#29ABE2', delta: null as number | null },
              { key: 'fresh', label: 'New', value: m.newPatientsThisMonth, color: '#10B981', delta: null as number | null },
              { key: 'lapsed', label: 'Lapsed', value: m.lapsedCount, color: '#EF4444', delta: null as number | null },
            ]
            const total = Math.max(segs.slice(0, 3).reduce((s, x) => s + x.value, 0), 1)
            return (
              <>
                <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-white/10">
                  {segs.slice(0, 3).map(s => s.value > 0 && <div key={s.key} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} />)}
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  {segs.map(s => {
                    const people = avatars[s.key] ?? []
                    return (
                      <div key={s.key}>
                        <div className="mb-1 flex -space-x-1.5">
                          {people.length > 0 ? people.map(p => (
                            <Avatar key={p.id} firstName={p.firstName} lastName={p.lastName} avatarUrl={p.avatarUrl} size="xs" />
                          )) : <span className="grid h-6 w-6 place-items-center rounded-full bg-gray-100 text-gray-300 dark:bg-white/5"><Users size={11} /></span>}
                        </div>
                        <p className="text-lg font-semibold leading-tight text-clinic-navy dark:text-white">{s.value}</p>
                        <p className="text-[10px] text-gray-400">{s.label} Patients</p>
                        {s.delta !== null && (
                          <span className={cn('mt-0.5 inline-block rounded-full px-1.5 py-0.5 text-[9px] font-semibold', s.delta >= 0 ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-400/10 dark:text-emerald-400' : 'bg-red-50 text-red-500 dark:bg-red-400/10 dark:text-red-400')}>
                            {s.delta >= 0 ? '+' : ''}{s.delta} vs last month
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            )
          })()}
        </div>

        {/* Upcoming Appointments — real scheduling data, compact timeline */}
        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/5">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Upcoming Appointments</p>
            <Link href="/scheduling" className="text-[11px] font-semibold text-clinic-blue hover:underline dark:text-cyan-400">View all</Link>
          </div>
          {upcoming === null ? (
            <div className="h-36 animate-pulse rounded-xl bg-gray-50 dark:bg-white/5" />
          ) : futureAppts.length === 0 ? (
            <div className="flex h-36 flex-col items-center justify-center gap-1 text-center">
              <Calendar size={20} className="text-gray-200 dark:text-white/15" />
              <p className="text-xs text-gray-400">No more appointments today</p>
            </div>
          ) : (() => {
            const dayStart = new Date(); dayStart.setHours(8, 0, 0, 0)
            const dayEnd = new Date(); dayEnd.setHours(18, 0, 0, 0)
            const span = dayEnd.getTime() - dayStart.getTime()
            const pctOf = (t: number) => Math.min(97, Math.max(0, ((t - dayStart.getTime()) / span) * 100))
            const nowPct = pctOf(Date.now())
            const hourMarks = [8, 10, 12, 14, 16, 18]
            return (
              <div>
                <div className="mb-1 flex justify-between px-1 text-[9px] text-gray-400">
                  {hourMarks.map(h => <span key={h}>{h > 12 ? h - 12 : h}{h >= 12 ? 'PM' : 'AM'}</span>)}
                </div>
                <div className="relative h-[104px] rounded-xl bg-gray-50 dark:bg-white/5">
                  {hourMarks.map(h => <div key={h} className="absolute top-0 bottom-0 border-l border-gray-200/70 dark:border-white/5" style={{ left: `${pctOf(new Date(new Date().setHours(h, 0, 0, 0)).getTime())}%` }} />)}
                  {nowPct >= 0 && nowPct <= 100 && (
                    <div className="absolute top-0 bottom-0 w-px bg-clinic-blue dark:bg-cyan-400" style={{ left: `${nowPct}%` }}>
                      <span className="absolute -top-2 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-clinic-blue dark:bg-cyan-400" />
                    </div>
                  )}
                  {futureAppts.map((a, i) => {
                    const left = pctOf(new Date(a.startAt).getTime())
                    const top = 10 + (i % 3) * 30
                    const time = new Date(a.startAt).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })
                    return (
                      <div key={a.id} className="absolute flex items-center gap-1.5 rounded-full py-1 pl-1 pr-2.5 text-white shadow-sm" style={{ left: `${left}%`, top, background: a.service.colour || '#29ABE2' }} title={`${time} · ${a.patient.firstName} ${a.patient.lastName} · ${a.service.name}`}>
                        <Avatar firstName={a.patient.firstName} lastName={a.patient.lastName} size="xs" colour="rgba(255,255,255,0.3)" />
                        <span className="whitespace-nowrap text-[10px] font-semibold">{a.patient.firstName}</span>
                      </div>
                    )
                  })}
                </div>
                <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-white/10">
                  <div className="h-1 rounded-full bg-clinic-blue dark:bg-cyan-400" style={{ width: `${nowPct}%` }} />
                </div>
              </div>
            )
          })()}
        </div>

        {/* Today's Utilisation AI Summary — no capacity/utilisation data exists
            anywhere in this codebase (no working-hours-vs-booked capacity model
            wired to this dashboard), so each ring shows an honest empty state
            rather than an invented percentage. */}
        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/5">
          <p className="mb-4 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Today&apos;s Utilization AI Summary</p>
          <div className="grid grid-cols-3 gap-2 text-center">
            {['Provider', 'Room', 'Equipment'].map(label => (
              <div key={label}>
                <div className="relative mx-auto h-[52px] w-[52px]">
                  <svg width="52" height="52" viewBox="0 0 52 52">
                    <circle cx="26" cy="26" r="22" fill="none" stroke="currentColor" strokeWidth="6" className="text-gray-100 dark:text-white/10" />
                  </svg>
                  <span className="absolute inset-0 grid place-items-center text-xs font-semibold text-gray-300 dark:text-white/20">—</span>
                </div>
                <p className="mt-1.5 text-[10px] text-gray-400">{label}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-center text-[10px] text-gray-400">Capacity data not tracked yet</p>
        </div>
      </div>
    </div>
  )
}
