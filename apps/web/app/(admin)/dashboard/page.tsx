'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Plus, Calendar, Download, Users, TrendingUp, TrendingDown, ArrowUpRight,
  UserCheck, Megaphone, Share2,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import { cn, formatUGX, getGreeting } from '@/lib/utils'
import Avatar from '@/components/ui/Avatar'

// ── Everything below is real, live Code Clinic data reused from existing
//    APIs — EXCEPT the Financial Snapshot, which uses explicitly
//    user-approved placeholder figures (see "DEMO DATA" block) because the
//    Accounts application isn't finished yet. Nothing here is written to
//    the database and no Accounts API is touched. ──────────────────────────

interface DashMetrics {
  activeThisMonth: number; activeLastMonth: number
  newPatientsThisMonth: number; returningPatientsThisMonth: number
  lapsedCount: number
}
interface DashCharts { aiPerformance: { conversationsHandled: number; appointmentsBooked: number; messagesSent: number } }
interface DashData { metrics: DashMetrics; charts: DashCharts }
interface PipelineEntry { count: number; totalUGX: number }
interface DentalData { pipeline: Record<string, PipelineEntry> }
interface Appt {
  id: string; startAt: string; status: string
  patient: { firstName: string; lastName: string }
  doctor: { user: { firstName: string; lastName: string } }
  service: { name: string; colour: string }
}
interface FollowupReport { messages: any[] }
interface MiniPatient { id: string; firstName: string; lastName: string; avatarUrl?: string | null }
interface Lead { id: string; status: string; createdAt: string }
interface Campaign { id: string; status: string; sentCount: number }
interface ReferralStats { stats: { source: string; count: number; thisMonth: number }[] }

const PIPELINE_STATUSES = [
  { key: 'Planned', label: 'Planned', color: '#1D4ED8' },
  { key: 'In Progress', label: 'In Progress', color: '#92400E' },
  { key: 'Completed', label: 'Completed', color: '#065F46' },
  { key: 'On Hold', label: 'On Hold', color: '#854D0E' },
  { key: 'Declined', label: 'Declined', color: '#9F1239' },
  { key: 'Cancelled', label: 'Cancelled', color: '#991B1B' },
]

// Same live-flow grouping the real <LivePatientFlow /> component uses
// (apps/web/components/scheduling/LivePatientFlow.tsx) — reused here, not reinvented.
const FLOW_STAGES = [
  { key: 'arrived', label: 'Arrived', statuses: ['ARRIVED', 'CHECKED_IN'], color: '#3B82F6' },
  { key: 'waiting', label: 'Waiting', statuses: ['WAITING'], color: '#EAB308' },
  { key: 'session', label: 'In Session', statuses: ['IN_OPERATORY', 'IN_CHAIR', 'WITH_PROVIDER'], color: '#F97316' },
  { key: 'checkout', label: 'Checkout', statuses: ['READY_CHECKOUT'], color: '#A855F7' },
]

const WEEK_STATUSES = [
  { key: 'CONFIRMED', label: 'Confirmed', color: '#2563EB' },
  { key: 'PENDING', label: 'Pending', color: '#D97706' },
  { key: 'NO_SHOW', label: 'No-show', color: '#DC2626' },
  { key: 'RESCHEDULED', label: 'Rescheduled', color: '#7C3AED' },
  { key: 'CANCELLED', label: 'Cancelled', color: '#6B7280' },
]

const CATEGORY_FILTERS = { total: '', seen: 'ACTIVE', returning: 'returning', fresh: 'new_patient' } as const

function Gauge({ pct, color }: { pct: number | null; color: string }) {
  const clamped = pct === null ? 0 : Math.max(0, Math.min(100, pct))
  const r = 52, cx = 62, cy = 60
  const circumference = Math.PI * r
  const offset = circumference * (1 - clamped / 100)
  const arc = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`
  return (
    <svg width="124" height="68" viewBox="0 0 124 68" className="mx-auto">
      <path d={arc} fill="none" stroke="currentColor" strokeWidth="12" strokeLinecap="round" className="text-gray-100 dark:text-white/10" />
      {pct !== null && (
        <path d={arc} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset} style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
      )}
    </svg>
  )
}

function Ring({ pct, color, size = 52 }: { pct: number | null; color: string; size?: number }) {
  const r = (size - 8) / 2, cx = size / 2, cy = size / 2
  const c = 2 * Math.PI * r
  const offset = pct === null ? c : c * (1 - Math.max(0, Math.min(100, pct)) / 100)
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="currentColor" strokeWidth="6" className="text-gray-100 dark:text-white/10" />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={offset} transform={`rotate(-90 ${cx} ${cy})`} style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
    </svg>
  )
}

function CompactCard({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-3.5 shadow-sm dark:border-white/10 dark:bg-white/5">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{title}</p>
        {action}
      </div>
      {children}
    </div>
  )
}

export default function DashboardPage() {
  const [user, setUser] = useState<any>(null)
  const [dashData, setDashData] = useState<DashData | null>(null)
  const [dentalData, setDentalData] = useState<DentalData | null>(null)
  const [weekAppts, setWeekAppts] = useState<Appt[] | null>(null)
  const [todayAppts, setTodayAppts] = useState<Appt[] | null>(null)
  const [upcoming, setUpcoming] = useState<Appt[] | null>(null)
  const [followups, setFollowups] = useState<FollowupReport | null>(null)
  const [totalPatients, setTotalPatients] = useState<number | null>(null)
  const [avatars, setAvatars] = useState<Record<string, MiniPatient[]>>({})
  const [leads, setLeads] = useState<Lead[] | null>(null)
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null)
  const [referrals, setReferrals] = useState<ReferralStats | null>(null)

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

    // This week's date range (Mon–Sun), real appointments, reused endpoint —
    // powers both the "Appointments This Week" breakdown and nothing else.
    const now = new Date()
    const dow = now.getDay()
    const monday = new Date(now); monday.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1))
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6)
    const iso = (d: Date) => d.toISOString().slice(0, 10)
    fetch(`/api-proxy/scheduling/appointments?startDate=${iso(monday)}&endDate=${iso(sunday)}`, { headers: auth })
      .then(r => r.ok ? r.json() : []).then(d => { if (Array.isArray(d)) setWeekAppts(d) }).catch(() => {})

    // Today's appointments — reused for both Live Flow and Upcoming Appointments.
    fetch('/api-proxy/scheduling/appointments', { headers: auth })
      .then(r => r.ok ? r.json() : []).then(d => {
        if (Array.isArray(d)) { setTodayAppts(d); setUpcoming(d) }
      }).catch(() => {})

    fetch('/api-proxy/ai-suite/followup-report', { headers: auth })
      .then(r => r.ok ? r.json() : null).then(d => { if (d) setFollowups(d) }).catch(() => {})

    fetch('/api-proxy/patients?limit=1', { headers: auth })
      .then(r => r.ok ? r.json() : null).then(d => { if (d && typeof d.total === 'number') setTotalPatients(d.total) }).catch(() => {})

    Object.entries(CATEGORY_FILTERS).forEach(([key, filter]) => {
      const qs = filter ? `filter=${filter}&limit=3` : 'limit=3'
      fetch(`/api-proxy/patients?${qs}`, { headers: auth })
        .then(r => r.ok ? r.json() : null)
        .then(d => { const rows = Array.isArray(d) ? d : d?.data; if (Array.isArray(rows)) setAvatars(prev => ({ ...prev, [key]: rows })) })
        .catch(() => {})
    })

    fetch('/api-proxy/crm/leads', { headers: auth })
      .then(r => r.ok ? r.json() : null).then(d => { if (Array.isArray(d)) setLeads(d) }).catch(() => {})
    fetch('/api-proxy/campaigns', { headers: auth })
      .then(r => r.ok ? r.json() : null).then(d => { if (Array.isArray(d)) setCampaigns(d) }).catch(() => {})
    fetch('/api-proxy/patients/referral-stats', { headers: auth })
      .then(r => r.ok ? r.json() : null).then(d => { if (d?.stats) setReferrals(d) }).catch(() => {})
  }, [])

  const greeting = getGreeting()
  const name = user ? user.firstName : ''
  const isDoctor = user?.role === 'DOCTOR'
  const displayName = isDoctor ? `Dr. ${name}` : name
  const m = dashData?.metrics

  // ── DEMO DATA — explicitly approved by the user for this card only. The
  // Accounts application isn't finished, so there's no reliable real
  // Revenue/Expenses/Net Income source yet. NOT written to the database,
  // NOT read from any Accounts API. Replace with real Accounts data once
  // that module is ready. ─────────────────────────────────────────────────
  const DEMO_FINANCE = {
    revenue: 58_320_000, expenses: 24_000_000, netIncome: 34_320_000,
    trend: [
      { month: 'Jan', revenue: 21_000_000 }, { month: 'Feb', revenue: 24_500_000 },
      { month: 'Mar', revenue: 27_800_000 }, { month: 'Apr', revenue: 29_100_000 },
      { month: 'May', revenue: 26_400_000 }, { month: 'Jun', revenue: 34_320_000 },
    ],
  }

  const weekCounts = WEEK_STATUSES.map(s => ({ ...s, count: (weekAppts ?? []).filter(a => a.status === s.key).length }))
  const flowCounts = FLOW_STAGES.map(s => ({ ...s, count: (todayAppts ?? []).filter(a => s.statuses.includes(a.status)).length }))
  const futureAppts = (upcoming ?? [])
    .filter(a => new Date(a.startAt).getTime() >= Date.now() && a.status !== 'CANCELLED')
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
    .slice(0, 6)

  const newLeads = leads ? leads.filter(l => Date.now() - new Date(l.createdAt).getTime() < 7 * 86400000).length : null
  const convertedLeads = leads ? leads.filter(l => l.status === 'CONVERTED').length : null
  const activeCampaigns = campaigns ? campaigns.filter(c => c.status !== 'DRAFT').length : null
  const referralPatients = referrals ? referrals.stats.filter(s => s.source !== 'Not Recorded').reduce((sum, s) => sum + s.count, 0) : null
  const conversionRate = leads && leads.length > 0 && convertedLeads !== null ? Math.round((convertedLeads / leads.length) * 100) : null

  return (
    <div className="animate-fade-in space-y-3">

      {/* ═══ ROW 1 — Welcome + actions | KPI | KPI | KPI ═══ */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.1fr_1fr_1fr_1fr]">
        <div className="flex flex-col justify-center">
          <h2 className="text-xl font-semibold leading-tight text-clinic-navy dark:text-white">{greeting}, {displayName}! 👋</h2>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <Link href="/patients" className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm transition hover:-translate-y-0.5" style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
              <Plus size={12} /> New Patient
            </Link>
            <Link href="/scheduling" className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-clinic-navy transition hover:-translate-y-0.5 dark:border-white/10 dark:bg-white/5 dark:text-white">
              <Calendar size={12} /> Schedule Appointment
            </Link>
            <Link href="/reports" className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-clinic-navy transition hover:-translate-y-0.5 dark:border-white/10 dark:bg-white/5 dark:text-white">
              <Download size={12} /> Reports
            </Link>
          </div>
        </div>

        {/* Card 1 — Appointments This Week + real status breakdown */}
        <div className="rounded-2xl border border-gray-100 bg-white p-3.5 shadow-sm dark:border-white/10 dark:bg-white/5">
          <div className="flex items-start justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Appointments This Week</p>
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-cyan-50 text-cyan-600 dark:bg-cyan-400/10 dark:text-cyan-300"><Calendar size={13} /></span>
          </div>
          <p className="mt-1 text-2xl font-semibold leading-none text-clinic-navy dark:text-white">{weekAppts ? weekAppts.length : '—'}</p>
          <div className="mt-2 space-y-1">
            {weekCounts.map(s => (
              <div key={s.key} className="flex items-center justify-between text-[10px]">
                <span className="flex items-center gap-1 text-gray-400"><span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />{s.label}</span>
                <span className="font-semibold text-gray-600 dark:text-slate-300">{weekAppts ? s.count : '—'}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Card 2 — Treatment Pipeline summary (reused pipeline data, logic untouched) */}
        <div className="rounded-2xl border border-gray-100 bg-white p-3.5 shadow-sm dark:border-white/10 dark:bg-white/5">
          <div className="flex items-start justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Treatment Pipeline</p>
            <Link href="/treatment-pipeline" className="grid h-7 w-7 place-items-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-400/10 dark:text-blue-300"><ArrowUpRight size={13} /></Link>
          </div>
          <p className="mt-1 text-2xl font-semibold leading-none text-clinic-navy dark:text-white">
            {dentalData ? Object.values(dentalData.pipeline).reduce((s, p) => s + p.count, 0) : '—'}
          </p>
          <div className="mt-2 space-y-1">
            {PIPELINE_STATUSES.map(s => (
              <div key={s.key} className="flex items-center justify-between text-[10px]">
                <span className="flex items-center gap-1 text-gray-400"><span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />{s.label}</span>
                <span className="font-semibold text-gray-600 dark:text-slate-300">{dentalData ? (dentalData.pipeline[s.key]?.count ?? 0) : '—'}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Card 3 — Patient Live Flow (same grouping as the real <LivePatientFlow/>) */}
        <div className="rounded-2xl border border-gray-100 bg-white p-3.5 shadow-sm dark:border-white/10 dark:bg-white/5">
          <div className="flex items-start justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Patient Live Flow</p>
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-400/10 dark:text-emerald-300"><UserCheck size={13} /></span>
          </div>
          <p className="mt-1 text-2xl font-semibold leading-none text-clinic-navy dark:text-white">
            {todayAppts ? flowCounts.reduce((s, f) => s + f.count, 0) : '—'}
          </p>
          <div className="mt-2 space-y-1">
            {flowCounts.map(s => (
              <div key={s.key} className="flex items-center justify-between text-[10px]">
                <span className="flex items-center gap-1 text-gray-400"><span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />{s.label}</span>
                <span className="font-semibold text-gray-600 dark:text-slate-300">{todayAppts ? s.count : '—'}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ═══ ROW 2 — Patient Satisfaction | Financial Snapshot | CRM Growth ═══ */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[0.85fr_1.6fr_0.85fr]">

        {/* Patient Satisfaction — Google Reviews-ready card. A real, authorized
            GBP connection already exists server-side (see
            apps/api/src/routes/business-profile.ts and GET
            /business-profile/reviews/summary?accountId=&locationId=), but
            Google's Basic API Access approval is still pending, so no live
            rating can be shown honestly yet. Layout below is the FINAL
            shape — swapping the `pending` block for real
            averageRating/totalReviewCount/recentReviewCount from that
            endpoint (once an accountId/locationId are known — see
            GET /business-profile/verify) requires no redesign, only
            replacing this one branch. */}
        <CompactCard title="Patient Satisfaction" action={<span className="rounded-full bg-gray-50 px-2 py-0.5 text-[9px] font-semibold text-gray-400 dark:bg-white/5 dark:text-white/30">Google Reviews</span>}>
          <Gauge pct={null} color="#D1D5DB" />
          <p className="-mt-1 text-center text-xl font-semibold text-gray-300 dark:text-white/20">—<span className="text-xs font-normal text-gray-300 dark:text-white/20">/5</span></p>
          <p className="text-center text-[10px] text-gray-400">Google Reviews pending API approval</p>
          <p className="mt-2 text-center text-[10px] font-semibold text-gray-300 dark:text-white/20">View all reviews</p>
        </CompactCard>

        {/* Financial Snapshot — DEMO DATA, see comment above */}
        <CompactCard title="Financial Snapshot" action={<span className="rounded-full border border-gray-200 px-2.5 py-1 text-[10px] font-semibold text-gray-500 dark:border-white/10 dark:text-slate-400">Jan – Jun</span>}>
          <div className="flex gap-4">
            <div className="flex-shrink-0 space-y-2">
              <div>
                <p className="text-lg font-semibold text-clinic-navy dark:text-white">{formatUGX(DEMO_FINANCE.revenue)}</p>
                <p className="text-[10px] text-gray-400">Revenue</p>
              </div>
              <div>
                <p className="text-base font-semibold text-gray-500 dark:text-slate-300">{formatUGX(DEMO_FINANCE.expenses)}</p>
                <p className="text-[10px] text-gray-400">Expenses</p>
              </div>
              <div>
                <p className="text-base font-semibold text-emerald-600 dark:text-emerald-400">{formatUGX(DEMO_FINANCE.netIncome)}</p>
                <p className="text-[10px] text-gray-400">Net Income</p>
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <ResponsiveContainer width="100%" height={128}>
                <BarChart data={DEMO_FINANCE.trend} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <Tooltip formatter={(v: number) => [formatUGX(v), 'Revenue']} contentStyle={{ borderRadius: 8, fontSize: 11 }} />
                  <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
                    {DEMO_FINANCE.trend.map((_, i, arr) => <Cell key={i} fill={i === arr.length - 1 ? '#1A237E' : '#93C5FD'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <p className="mt-1 text-center text-[9px] text-gray-300 dark:text-white/20">Demo financial data — Accounts module not yet finished</p>
            </div>
          </div>
        </CompactCard>

        {/* CRM / Growth summary — real Leads/Referrals/Campaigns, replaces the old Sarah card */}
        <Link href="/leads" className="flex flex-col justify-between rounded-2xl p-4 text-white shadow-sm transition hover:-translate-y-0.5" style={{ background: 'linear-gradient(135deg,#0c1e50,#1A237E 45%,#29ABE2)' }}>
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-100">Growth &amp; CRM</p>
            <span className="grid h-7 w-7 place-items-center rounded-full bg-white/15"><Share2 size={13} /></span>
          </div>
          <div className="my-2 space-y-2">
            <div className="flex items-center justify-between rounded-xl bg-white/10 px-3 py-2">
              <span className="flex items-center gap-1.5 text-[11px] text-blue-100"><Users size={12} /> New Leads (7d)</span>
              <span className="text-sm font-semibold text-white">{newLeads ?? '—'}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-white/10 px-3 py-2">
              <span className="flex items-center gap-1.5 text-[11px] text-blue-100"><UserCheck size={12} /> Converted</span>
              <span className="text-sm font-semibold text-white">{convertedLeads ?? '—'}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-white/10 px-3 py-2">
              <span className="flex items-center gap-1.5 text-[11px] text-blue-100"><Share2 size={12} /> Referral Patients</span>
              <span className="text-sm font-semibold text-white">{referralPatients ?? '—'}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-white/10 px-3 py-2">
              <span className="flex items-center gap-1.5 text-[11px] text-blue-100"><Megaphone size={12} /> Active Campaigns</span>
              <span className="text-sm font-semibold text-white">{activeCampaigns ?? '—'}</span>
            </div>
          </div>
          <div className="flex items-center justify-between border-t border-white/15 pt-2">
            <span className="text-[10px] text-blue-100">{conversionRate !== null ? `${conversionRate}% lead conversion` : 'Conversion — unavailable'}</span>
            <span className="flex items-center gap-1 text-[11px] font-semibold text-white/80">Open CRM <ArrowUpRight size={12} /></span>
          </div>
        </Link>
      </div>

      {/* ═══ ROW 3 — Patients Overview | Upcoming Appointments | Utilization AI Summary ═══ */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.05fr_1.3fr_0.85fr]">

        {/* Patients Overview — real Total/Seen/Returning/New + real avatars */}
        <CompactCard title="Patients Overview" action={<Link href="/patients" className="text-[11px] font-semibold text-clinic-blue hover:underline dark:text-cyan-400">View all patients</Link>}>
          {!m ? (
            <div className="h-32 animate-pulse rounded-xl bg-gray-50 dark:bg-white/5" />
          ) : (() => {
            const segs = [
              { key: 'total', label: 'Total', value: totalPatients, color: '#1A237E', delta: null as number | null },
              { key: 'seen', label: 'Seen', value: m.activeThisMonth, color: '#29ABE2', delta: m.activeThisMonth - m.activeLastMonth },
              { key: 'returning', label: 'Returning', value: m.returningPatientsThisMonth, color: '#10B981', delta: null as number | null },
              { key: 'fresh', label: 'New', value: m.newPatientsThisMonth, color: '#F59E0B', delta: null as number | null },
            ]
            const barTotal = Math.max(m.activeThisMonth + m.returningPatientsThisMonth + m.newPatientsThisMonth, 1)
            return (
              <>
                <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-white/10">
                  <div style={{ width: `${(m.activeThisMonth / barTotal) * 100}%`, background: '#29ABE2' }} />
                  <div style={{ width: `${(m.returningPatientsThisMonth / barTotal) * 100}%`, background: '#10B981' }} />
                  <div style={{ width: `${(m.newPatientsThisMonth / barTotal) * 100}%`, background: '#F59E0B' }} />
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
                        <p className="text-lg font-semibold leading-tight text-clinic-navy dark:text-white">{s.value ?? '—'}</p>
                        <p className="text-[10px] text-gray-400">{s.label} Patients</p>
                        {s.delta !== null && (
                          <span className={cn('mt-0.5 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold', s.delta >= 0 ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-400/10 dark:text-emerald-400' : 'bg-red-50 text-red-500 dark:bg-red-400/10 dark:text-red-400')}>
                            {s.delta >= 0 ? <TrendingUp size={9} /> : <TrendingDown size={9} />}{s.delta >= 0 ? '+' : ''}{s.delta} vs last month
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            )
          })()}
        </CompactCard>

        {/* Upcoming Appointments — real scheduling data, compact timeline */}
        <CompactCard title="Upcoming Appointments" action={<Link href="/scheduling" className="text-[11px] font-semibold text-clinic-blue hover:underline dark:text-cyan-400">View all</Link>}>
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
                    const isNearest = i === 0
                    return (
                      <div key={a.id} className={cn('absolute flex items-center gap-1.5 rounded-full py-1 pl-1 pr-2.5 text-white shadow-sm', isNearest && 'ring-2 ring-clinic-blue ring-offset-1 dark:ring-cyan-400 dark:ring-offset-slate-900')} style={{ left: `${left}%`, top, background: a.service.colour || '#29ABE2' }} title={`${time} · ${a.patient.firstName} ${a.patient.lastName} · ${a.service.name}`}>
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
        </CompactCard>

        {/* Today's Utilization AI Summary — real AI Bookings/Follow-ups counts;
            Reminders has no read endpoint anywhere in this codebase (confirmed),
            so it shows a truthful unavailable state rather than a fake number.
            None of the three have a real capacity/target denominator, so the
            rings are plain activity indicators, not percentages-of-something. */}
        <CompactCard title="Today's Utilization AI Summary">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="relative mx-auto h-[52px] w-[52px]">
                <Ring pct={dashData ? 100 : null} color="#1A237E" />
                <span className="absolute inset-0 grid place-items-center text-xs font-semibold text-clinic-navy dark:text-white">{dashData ? dashData.charts.aiPerformance.appointmentsBooked : '—'}</span>
              </div>
              <p className="mt-1.5 text-[10px] text-gray-400">AI Bookings</p>
            </div>
            <div>
              <div className="relative mx-auto h-[52px] w-[52px]">
                <Ring pct={followups ? 100 : null} color="#10B981" />
                <span className="absolute inset-0 grid place-items-center text-xs font-semibold text-clinic-navy dark:text-white">{followups ? followups.messages.length : '—'}</span>
              </div>
              <p className="mt-1.5 text-[10px] text-gray-400">Follow-ups</p>
            </div>
            <div>
              <div className="relative mx-auto h-[52px] w-[52px]">
                <Ring pct={null} color="#D1D5DB" />
                <span className="absolute inset-0 grid place-items-center text-xs font-semibold text-gray-300 dark:text-white/20">—</span>
              </div>
              <p className="mt-1.5 text-[10px] text-gray-400">Reminders</p>
            </div>
          </div>
          <p className="mt-3 text-center text-[10px] text-gray-400">Reminders has no readable backend endpoint yet</p>
        </CompactCard>
      </div>
    </div>
  )
}
