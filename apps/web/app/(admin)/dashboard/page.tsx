'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import NextImage from 'next/image'
import {
  Plus, Calendar, Download, Users, TrendingUp, TrendingDown, ArrowUpRight,
  UserCheck, Megaphone, Share2, MessageSquareText, Phone,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid, LabelList,
} from 'recharts'
import { cn, formatUGX, getGreeting } from '@/lib/utils'
import { readTheme, applyTheme } from '@/lib/theme'
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
  id: string; startAt: string; endAt?: string; status: string
  patient: { firstName: string; lastName: string }
  doctor: { user: { firstName: string; lastName: string } }
  service: { name: string; colour: string }
}
interface AiSnapshot {
  totalConversations: number
  customerLast:       number
  clinicLast:         number
  aiHandling:         number
  humanHandling:      number
  channels:           Record<string, number>
}
interface MiniPatient { id: string; firstName: string; lastName: string; avatarUrl?: string | null }
interface Lead { id: string; status: string; createdAt: string }
interface Campaign { id: string; status: string; sentCount: number }
interface ReferralStats { stats: { source: string; count: number; thisMonth: number }[] }

const PIPELINE_STATUSES = [
  { key: 'Planned', label: 'Planned', color: '#1D4ED8' },
  { key: 'In Progress', label: 'In Progress', color: '#D97706' },
  { key: 'Completed', label: 'Completed', color: '#059669' },
  { key: 'On Hold', label: 'On Hold', color: '#CA8A04' },
  { key: 'Declined', label: 'Declined', color: '#E11D48' },
  { key: 'Cancelled', label: 'Cancelled', color: '#9CA3AF' },
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
  { key: 'CANCELLED', label: 'Cancelled', color: '#9CA3AF' },
]

// Deliberately no 'seen' entry: there is no /patients filter matching "distinct
// patients with a COMPLETED appointment this month" (ACTIVE means the patient
// record's stored status, a different concept) — see Patients Overview below,
// which omits the avatar stack for that metric rather than show mismatched people.
const CATEGORY_FILTERS = { total: '', returning: 'returning', fresh: 'new_patient' } as const

// ── Shared visual primitives ────────────────────────────────────────────

// Compact stacked distribution bar — used by the three top KPI cards instead
// of a tall list of rows, per the "reduce height, use width" design rule.
function DistributionBar({ segments, total }: { segments: { color: string; count: number }[]; total: number }) {
  const denom = Math.max(total, 1)
  return (
    <div className="flex h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-white/10">
      {segments.filter(s => s.count > 0).map((s, i) => (
        <div key={i} style={{ width: `${(s.count / denom) * 100}%`, background: s.color }} />
      ))}
    </div>
  )
}

// Wrapping chip legend — denser than a fixed grid, so the card only takes
// the height its actual content needs rather than reserving full grid rows.
function ChipLegend({ items, loading }: { items: { label: string; count: number; color: string }[]; loading: boolean }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5">
      {items.map(it => (
        <span key={it.label} className="inline-flex items-center gap-1 text-[10px]">
          <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: it.color }} />
          <span className="text-gray-500 dark:text-slate-400">{it.label}</span>
          <span className="font-bold text-gray-700 dark:text-slate-200">{loading ? '—' : it.count}</span>
        </span>
      ))}
    </div>
  )
}

// Large semicircular satisfaction gauge — full size in both the real and
// pending states (per design rule: never collapse to a tiny placeholder).
// Gradient (red→orange→yellow→green) only paints when a real pct is given;
// the pending state shows the same size track, unfilled. The rating is
// drawn as real SVG <text>, not an HTML overlay with negative-margin
// guesswork — that was clipping the thick stroke's round end-caps against
// the viewBox edge, which is what read as "cropped".
function SatisfactionGauge({ pct, ratingLabel }: { pct: number | null; ratingLabel: string }) {
  const r = 86, cx = 110, cy = 100, sw = 22
  const circumference = Math.PI * r
  const clamped = pct === null ? 0 : Math.max(0, Math.min(100, pct))
  const offset = circumference * (1 - clamped / 100)
  const arc = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`
  return (
    <svg viewBox="0 0 220 156" className="mx-auto block w-full max-w-none overflow-visible">
      <defs>
        <linearGradient id="satisfactionGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#EF4444" />
          <stop offset="38%" stopColor="#F59E0B" />
          <stop offset="66%" stopColor="#EAB308" />
          <stop offset="100%" stopColor="#22C55E" />
        </linearGradient>
      </defs>
      <path d={arc} fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" className="text-gray-100 dark:text-white/10" />
      {pct !== null && (
        <path d={arc} fill="none" stroke="url(#satisfactionGradient)" strokeWidth={sw} strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset} style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
      )}
      <text x={cx} y={cy + 42} textAnchor="middle" fill="currentColor" className={pct === null ? 'text-gray-300 dark:text-white/25' : 'text-clinic-navy dark:text-white'}>
        <tspan fontSize="32" fontWeight="800">{ratingLabel}</tspan>
        <tspan fontSize="15" fontWeight="600" dx="3">/5</tspan>
      </text>
    </svg>
  )
}

// Real AiConversation.channel values only (packages/database/prisma/schema.prisma
// + the literal channel strings every ai-suite/* service actually writes) —
// icons/labels/colors copied verbatim from the real Conversations workspace's
// own channel list (apps/web/app/(receptionist)/receptionist/ai-suite/inbox/
// page.tsx CHANNELS array) so this card is a genuine sneak peek of it, not a
// re-invented one. FB/IG comment threads are kept as their own distinct,
// truthfully-labelled rows there — never folded into "Facebook"/"Instagram" —
// so this card does the same. Rendered only for channels that actually have
// activity (see GET /ai-suite/snapshot), never a fixed list padded with zeros.
type ChannelIcon = { imgSrc: string } | { Icon: React.ComponentType<{ size?: number | string; className?: string }> }
const CHANNEL_CONFIG: { key: string; label: string; color: string; icon: ChannelIcon }[] = [
  { key: 'WHATSAPP',          label: 'WhatsApp',    color: '#25D366', icon: { imgSrc: '/icons/whatsapp.png' } },
  { key: 'INSTAGRAM',         label: 'Instagram',   color: '#E4405F', icon: { imgSrc: '/icons/instagram.png' } },
  { key: 'FACEBOOK',          label: 'Facebook',    color: '#1877F2', icon: { imgSrc: '/icons/facebook.png' } },
  { key: 'WEBSITE',           label: 'Website',     color: '#6366F1', icon: { imgSrc: '/icons/website.png' } },
  { key: 'FACEBOOK_COMMENT',  label: 'FB Comments', color: '#1877F2', icon: { imgSrc: '/icons/facebook.png' } },
  { key: 'INSTAGRAM_COMMENT', label: 'IG Comments', color: '#E4405F', icon: { imgSrc: '/icons/instagram.png' } },
  // No brand asset for these two — they're carrier channels, not platforms —
  // so a plain recognizable Lucide icon is the honest choice.
  { key: 'SMS',   label: 'SMS',   color: '#64748B', icon: { Icon: MessageSquareText } },
  { key: 'VOICE', label: 'Voice', color: '#64748B', icon: { Icon: Phone } },
]

function ChannelIconView({ icon, label }: { icon: ChannelIcon; label: string }) {
  if ('imgSrc' in icon) {
    return <NextImage src={icon.imgSrc} alt={label} width={14} height={14} className="h-3.5 w-3.5 object-contain" />
  }
  const { Icon } = icon
  return <Icon size={13} className="text-gray-400 dark:text-white/40" />
}

// Themed Recharts tooltip content — rendered as real DOM (not inline SVG
// paint), so it can use the app's existing .dark ancestor-class mechanism
// via Tailwind dark: classes instead of a second theme system.
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-white/10 dark:bg-slate-800">
      <p className="font-bold text-gray-700 dark:text-slate-200">{label}</p>
      <p className="mt-0.5 font-medium text-gray-500 dark:text-slate-400">{formatUGX(payload[0].value)}</p>
    </div>
  )
}

function CompactCard({ title, action, children, className }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0 rounded-2xl border border-gray-100 bg-white p-3.5 shadow-sm dark:border-white/10 dark:bg-white/5', className)}>
      <div className="mb-2.5 flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-wide text-gray-700 dark:text-slate-200">{title}</p>
        {action}
      </div>
      {children}
    </div>
  )
}

export default function DashboardPage() {
  const [user, setUser] = useState<any>(null)
  // Recharts SVG paint props (stroke/fill) can't respond to CSS .dark
  // ancestor classes — only the handful of chart colors below need this;
  // everything else on the page uses Tailwind dark: classes as usual.
  const [dark, setDark] = useState(false)
  const [dashData, setDashData] = useState<DashData | null>(null)
  const [dentalData, setDentalData] = useState<DentalData | null>(null)
  const [weekAppts, setWeekAppts] = useState<Appt[] | null>(null)
  const [todayAppts, setTodayAppts] = useState<Appt[] | null>(null)
  const [upcoming, setUpcoming] = useState<Appt[] | null>(null)
  const [aiSnapshot, setAiSnapshot] = useState<AiSnapshot | null>(null)
  const [totalPatients, setTotalPatients] = useState<number | null>(null)
  const [avatars, setAvatars] = useState<Record<string, MiniPatient[]>>({})
  const [leads, setLeads] = useState<Lead[] | null>(null)
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null)
  const [referrals, setReferrals] = useState<ReferralStats | null>(null)

  useEffect(() => {
    setDark(applyTheme(readTheme()))
    const onTheme = (e: Event) => setDark(applyTheme((e as CustomEvent).detail))
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onSystem = () => { if (readTheme() === 'system') setDark(applyTheme('system')) }
    window.addEventListener('cc-theme', onTheme)
    media.addEventListener('change', onSystem)
    return () => { window.removeEventListener('cc-theme', onTheme); media.removeEventListener('change', onSystem) }
  }, [])

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

    fetch('/api-proxy/ai-suite/snapshot', { headers: auth })
      .then(r => r.ok ? r.json() : null).then(d => { if (d) setAiSnapshot(d) }).catch(() => {})

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
  // The most recent point deliberately equals the headline Revenue figure
  // (58,320,000) — the chart is a Revenue trend, so its last bar must match
  // the Revenue figure shown beside it. The other five are a sensible demo
  // progression toward that same number. Month LABELS are derived from
  // today's real date (rolling last 6 months, ending at the current month)
  // so this never goes stale the way a hardcoded "Jan – Jun" did — verified
  // 0 real Payment/Expense records exist in production (see accounts.ts's
  // GET /accounts/dashboard, which aggregates those tables and would return
  // all-zero revenue/expenses today), so there is no reliable real financial
  // data to switch to yet; only the demo range's staleness is being fixed.
  const financeNow = new Date()
  const DEMO_REVENUE_PROGRESSION = [38_000_000, 41_200_000, 44_600_000, 48_900_000, 52_300_000, 58_320_000]
  const financeMonthLabels = Array.from({ length: 6 }, (_, i) =>
    new Date(financeNow.getFullYear(), financeNow.getMonth() - (5 - i), 1).toLocaleDateString('en-US', { month: 'short' }))
  const DEMO_FINANCE = {
    revenue: DEMO_REVENUE_PROGRESSION[5], expenses: 24_000_000, netIncome: 34_320_000,
    trend: financeMonthLabels.map((month, i) => ({ month, revenue: DEMO_REVENUE_PROGRESSION[i] })),
  }
  // Demo-only growth badge — derived purely from the demo trend above, not real data.
  const demoGrowthPct = Math.round(((DEMO_FINANCE.trend[5].revenue - DEMO_FINANCE.trend[0].revenue) / DEMO_FINANCE.trend[0].revenue) * 100)

  const weekCounts = WEEK_STATUSES.map(s => ({ ...s, count: (weekAppts ?? []).filter(a => a.status === s.key).length }))
  const weekTotal = weekAppts ? weekAppts.length : 0
  const pipelineCounts = PIPELINE_STATUSES.map(s => ({ ...s, count: dentalData ? (dentalData.pipeline[s.key]?.count ?? 0) : 0 }))
  const pipelineTotal = dentalData ? Object.values(dentalData.pipeline).reduce((s, p) => s + p.count, 0) : 0
  const flowCounts = FLOW_STAGES.map(s => ({ ...s, count: (todayAppts ?? []).filter(a => s.statuses.includes(a.status)).length }))
  const flowTotal = flowCounts.reduce((s, f) => s + f.count, 0)
  const futureAppts = (upcoming ?? [])
    .filter(a => new Date(a.startAt).getTime() >= Date.now() && a.status !== 'CANCELLED')
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
    .slice(0, 8)

  const newLeads = leads ? leads.filter(l => Date.now() - new Date(l.createdAt).getTime() < 7 * 86400000).length : null
  const convertedLeads = leads ? leads.filter(l => l.status === 'CONVERTED').length : null
  const activeCampaigns = campaigns ? campaigns.filter(c => c.status !== 'DRAFT').length : null
  const referralPatients = referrals ? referrals.stats.filter(s => s.source !== 'Not Recorded').reduce((sum, s) => sum + s.count, 0) : null
  const conversionRate = leads && leads.length > 0 && convertedLeads !== null ? Math.round((convertedLeads / leads.length) * 100) : null

  // Upcoming Appointments timeline geometry — pixel-based (not %) so the
  // hour labels and blocks scroll together inside the horizontal scroller.
  const DAY_START_HOUR = 8, DAY_END_HOUR = 18, HOUR_PX = 84
  const timelineWidth = (DAY_END_HOUR - DAY_START_HOUR) * HOUR_PX
  const hourMarks = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]
  const pxOf = (t: number) => {
    const d = new Date(t)
    const hourFloat = d.getHours() + d.getMinutes() / 60
    return Math.max(0, Math.min(timelineWidth, (hourFloat - DAY_START_HOUR) * HOUR_PX))
  }
  const nowPx = pxOf(Date.now())

  return (
    <div className="animate-fade-in space-y-3">

      {/* ═══ ROW 1 — Welcome + actions | KPI | KPI | KPI ═══ */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.1fr_1fr_1fr_1fr]">
        <div className="flex flex-col justify-center">
          <h2 className="text-2xl font-bold leading-tight text-clinic-navy dark:text-white">{greeting}, {displayName}! 👋</h2>
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

        {/* Card 1 — Appointments This Week: number+sparkline-bar side by side, chip legend below */}
        <div className="min-w-0 rounded-2xl border border-gray-100 bg-white p-3.5 shadow-sm dark:border-white/10 dark:bg-white/5">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-wide text-gray-700 dark:text-slate-200">Appointments This Week</p>
            <span className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-lg bg-cyan-50 text-cyan-600 dark:bg-cyan-400/10 dark:text-cyan-300"><Calendar size={13} /></span>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <p className="text-3xl font-extrabold leading-none text-clinic-navy dark:text-white">{weekAppts ? weekTotal : '—'}</p>
            <div className="h-8 w-px flex-shrink-0 bg-gray-100 dark:bg-white/10" />
            <DistributionBar segments={weekCounts} total={weekTotal} />
          </div>
          <ChipLegend items={weekCounts} loading={!weekAppts} />
        </div>

        {/* Card 2 — Treatment Pipeline: same number+bar language, chip legend
            below. /clinical/analytics/dental-dashboard sums EVERY treatment
            plan ever created (no date filter — see clinical.ts's own comment
            "All treatment plans for pipeline"), so this is genuinely an
            all-time snapshot of the current pipeline, not a "today" figure. */}
        <div className="min-w-0 rounded-2xl border border-gray-100 bg-white p-3.5 shadow-sm dark:border-white/10 dark:bg-white/5">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-wide text-gray-700 dark:text-slate-200">Treatment Pipeline <span className="font-normal normal-case text-gray-400 dark:text-white/30">· All time</span></p>
            <Link href="/treatment-pipeline" className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-400/10 dark:text-blue-300"><ArrowUpRight size={13} /></Link>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <p className="text-3xl font-extrabold leading-none text-clinic-navy dark:text-white">{dentalData ? pipelineTotal : '—'}</p>
            <div className="h-8 w-px flex-shrink-0 bg-gray-100 dark:bg-white/10" />
            <DistributionBar segments={pipelineCounts} total={pipelineTotal} />
          </div>
          <ChipLegend items={pipelineCounts} loading={!dentalData} />
        </div>

        {/* Card 3 — Patient Live Flow: same header language, real patient journey
            stepper below. Counts are today's appointments currently sitting in a
            clinical-flow status (Arrived/Waiting/In Session/Checkout) — current
            state, not a "today total" that only grows — so labelled "Live now"
            rather than a period, matching what the numbers actually represent. */}
        <div className="min-w-0 rounded-2xl border border-gray-100 bg-white p-3.5 shadow-sm dark:border-white/10 dark:bg-white/5">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-wide text-gray-700 dark:text-slate-200">Patient Live Flow <span className="font-normal normal-case text-gray-400 dark:text-white/30">· Live now</span></p>
            <span className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-400/10 dark:text-emerald-300"><UserCheck size={13} /></span>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <p className="text-3xl font-extrabold leading-none text-clinic-navy dark:text-white">{todayAppts ? flowTotal : '—'}</p>
            <div className="h-8 w-px flex-shrink-0 bg-gray-100 dark:bg-white/10" />
            <p className="text-[10px] font-medium leading-tight text-gray-500 dark:text-slate-400">active in<br />clinic now</p>
          </div>
          <div className="mt-3.5 flex items-center">
            {flowCounts.map((s, i) => (
              <div key={s.key} className="flex flex-1 items-center last:flex-none">
                <div className="flex flex-col items-center gap-1">
                  <div className="grid h-7 w-7 place-items-center rounded-full text-[11px] font-bold text-white" style={{ background: todayAppts && s.count > 0 ? s.color : '#D1D5DB' }}>
                    {todayAppts ? s.count : '—'}
                  </div>
                  <span className="whitespace-nowrap text-[9px] font-medium text-gray-500 dark:text-slate-400">{s.label}</span>
                </div>
                {i < flowCounts.length - 1 && <div className="mx-1 mb-4 h-0.5 flex-1 rounded-full" style={{ background: s.color, opacity: 0.25 }} />}
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
            shape — the gauge is full-size in both states; swapping the
            `pending` text block for real averageRating/totalReviewCount/
            recentReviewCount from that endpoint requires no redesign. */}
        <CompactCard title="Patient Satisfaction" action={<span className="rounded-full bg-gray-50 px-2 py-0.5 text-[9px] font-bold text-gray-500 dark:bg-white/5 dark:text-white/40">Google Reviews</span>}>
          <div className="flex items-center justify-between px-1 text-[10px] font-semibold text-gray-400 dark:text-white/25">
            <span>No reviews yet</span>
            <span>&nbsp;</span>
          </div>
          <SatisfactionGauge pct={null} ratingLabel="—" />
          <div className="-mt-2 text-center">
            <p className="mx-auto max-w-[190px] text-[10px] font-semibold leading-snug text-gray-500 dark:text-slate-400">Google Reviews pending API approval</p>
            <p className="mt-2 text-[10px] font-bold text-gray-300 dark:text-white/25">View all reviews</p>
          </div>
        </CompactCard>

        {/* Financial Snapshot — DEMO DATA, see comment above. Custom header
            (not CompactCard's) because the growth badge sits beside the
            title, not as a lone top-right action like other cards. */}
        <div className="min-w-0 rounded-2xl border border-gray-100 bg-white p-3.5 shadow-sm dark:border-white/10 dark:bg-white/5">
          <div className="mb-2.5 flex items-center justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[11px] font-bold uppercase tracking-wide text-gray-700 dark:text-slate-200">Financial Snapshot</p>
              {/* Loud, unmissable — unlike the small caption alone, this
                  can't be scrolled past or missed at a glance. See DEMO_FINANCE
                  comment above: Accounts isn't live yet, so nothing here may
                  read as a real clinic balance. */}
              <span className="inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-amber-700 dark:bg-amber-400/15 dark:text-amber-400">Demo Data</span>
              <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold text-emerald-600 dark:bg-emerald-400/10 dark:text-emerald-400"><TrendingUp size={9} />{demoGrowthPct}% (demo)</span>
            </div>
            <span className="rounded-full border border-gray-200 px-2.5 py-1 text-[10px] font-bold text-gray-600 dark:border-white/10 dark:text-slate-300">{financeMonthLabels[0]} – {financeMonthLabels[5]}</span>
          </div>
          <div className="flex gap-4">
            <div className="flex w-[28%] flex-shrink-0 flex-col justify-between">
              <div className="space-y-2.5">
                <div>
                  <p className="text-xl font-extrabold leading-tight text-clinic-navy dark:text-white">{formatUGX(DEMO_FINANCE.revenue)}</p>
                  <p className="text-[10px] font-medium text-gray-500 dark:text-slate-400">Revenue</p>
                </div>
                <div>
                  <p className="text-base font-bold leading-tight text-gray-700 dark:text-slate-200">{formatUGX(DEMO_FINANCE.expenses)}</p>
                  <p className="text-[10px] font-medium text-gray-500 dark:text-slate-400">Expenses</p>
                </div>
                <div>
                  <p className="text-base font-bold leading-tight text-emerald-600 dark:text-emerald-400">{formatUGX(DEMO_FINANCE.netIncome)}</p>
                  <p className="text-[10px] font-medium text-gray-500 dark:text-slate-400">Net Income</p>
                </div>
              </div>
              <p className="text-[9px] text-gray-300 dark:text-white/20">Demo financial data</p>
            </div>
            <div className="min-w-0 flex-1">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={DEMO_FINANCE.trend} margin={{ top: 32, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="4 4" stroke={dark ? '#64748B' : '#94A3B8'} strokeOpacity={dark ? 0.3 : 0.25} />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: dark ? '#CBD5E1' : '#6B7280', fontWeight: 600 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 9, fill: dark ? '#94A3B8' : '#9CA3AF', fontWeight: 600 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${Math.round(v / 1_000_000)}M`} width={30} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: dark ? 'rgba(255,255,255,0.06)' : 'rgba(148,163,184,0.08)' }} />
                  {/* Current month uses the Code Clinic brand cyan — bright
                      enough to stay visible on both a white and a near-black
                      card surface, unlike the previous fixed navy which
                      nearly disappeared against the dark card background. */}
                  <Bar dataKey="revenue" radius={[6, 6, 0, 0]} maxBarSize={36}>
                    {DEMO_FINANCE.trend.map((_, i, arr) => <Cell key={i} fill={i === arr.length - 1 ? '#29ABE2' : (dark ? '#60A5FA' : '#93C5FD')} />)}
                    <LabelList dataKey="revenue" content={(props: any) => {
                      const { x, y, width, index, value } = props
                      if (index !== DEMO_FINANCE.trend.length - 1) return null
                      const cx = x + width / 2
                      return (
                        <g>
                          <rect x={cx - 24} y={y - 24} width={48} height={19} rx={9.5} fill="#1A237E" />
                          <text x={cx} y={y - 10.5} textAnchor="middle" fontSize={9.5} fontWeight={700} fill="#fff">{`${Math.round(value / 1_000_000)}M`}</text>
                        </g>
                      )
                    }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* CRM / Growth summary — real Leads/Referrals/Campaigns */}
        <Link href="/leads" className="flex flex-col justify-between rounded-2xl p-4 text-white shadow-sm transition hover:-translate-y-0.5" style={{ background: 'linear-gradient(135deg,#0c1e50,#1A237E 45%,#29ABE2)' }}>
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-wide text-blue-100">Growth &amp; CRM</p>
            <span className="grid h-7 w-7 place-items-center rounded-full bg-white/15"><Share2 size={13} /></span>
          </div>
          <div className="my-2.5 space-y-1.5">
            <div className="flex items-center justify-between rounded-xl bg-white/10 px-3 py-2">
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-blue-100"><Users size={12} /> New Leads (7d)</span>
              <span className="text-sm font-bold text-white">{newLeads ?? '—'}</span>
            </div>
            {/* Converted = every lead ever marked CONVERTED (leads.filter,
                full array) — genuinely all-time, unlike its "New Leads (7d)"
                sibling above, so labelled separately rather than left to look
                like it shares that 7-day window. */}
            <div className="flex items-center justify-between rounded-xl bg-white/10 px-3 py-2">
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-blue-100"><UserCheck size={12} /> Converted <span className="text-blue-200/60">(all time)</span></span>
              <span className="text-sm font-bold text-white">{convertedLeads ?? '—'}</span>
            </div>
            {/* referral-stats' `.count` (used here) is the all-time patient
                count per source — the endpoint also returns a `.thisMonth`
                field that this card deliberately does NOT use, so the label
                must say which one this is. */}
            <div className="flex items-center justify-between rounded-xl bg-white/10 px-3 py-2">
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-blue-100"><Share2 size={12} /> Referral Patients <span className="text-blue-200/60">(all time)</span></span>
              <span className="text-sm font-bold text-white">{referralPatients ?? '—'}</span>
            </div>
            {/* GET /campaigns has no complete/aggregate source (confirmed: no
                count() endpoint exists) and is hard-capped at the 100 most
                recent WhatsApp broadcast campaigns — this count can silently
                undercount if the clinic ever has more than 100 total, so it's
                marked rather than presented as a guaranteed-complete total. */}
            <div className="flex items-center justify-between rounded-xl bg-white/10 px-3 py-2">
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-blue-100"><Megaphone size={12} /> Active Campaigns</span>
              <span className="text-sm font-bold text-white" title="Based on the 100 most recently created campaigns — may undercount if older campaigns are still active">{activeCampaigns ?? '—'}{activeCampaigns !== null && <span className="ml-0.5 align-top text-[9px] font-bold text-blue-200">*</span>}</span>
            </div>
          </div>
          <div className="flex items-center justify-between border-t border-white/15 pt-2">
            <span className="text-[10px] font-medium text-blue-100">{conversionRate !== null ? `${conversionRate}% lead conversion (all time)` : 'Conversion — unavailable'}</span>
            <span className="flex items-center gap-1 text-[11px] font-bold text-white/90">Open CRM <ArrowUpRight size={12} /></span>
          </div>
          {activeCampaigns !== null && <p className="mt-1 text-center text-[8px] text-blue-200/60">*last 100 campaigns</p>}
        </Link>
      </div>

      {/* ═══ ROW 3 — Patients Overview | Upcoming Appointments | Utilization AI Summary ═══ */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.05fr_1.3fr_0.85fr]">

        {/* Patients Overview — real Total/Seen/Returning/New + real avatars */}
        <CompactCard title="Patients Overview" action={<Link href="/patients" className="text-[11px] font-bold text-clinic-blue hover:underline dark:text-cyan-400">View all patients</Link>}>
          {!m ? (
            <div className="h-32 animate-pulse rounded-xl bg-gray-50 dark:bg-white/5" />
          ) : (() => {
            // "Seen" = distinct patients with a COMPLETED appointment this
            // month — exactly newPatientsThisMonth + returningPatientsThisMonth,
            // since the backend computes those two as an exhaustive split of
            // that same completed-this-month set (see clinical.ts). This
            // replaces the old activeThisMonth binding, which counted ANY
            // non-cancelled appointment (booked/no-show included, not just
            // attended) and was mislabeled "Seen" as a result. No matching
            // last-month COMPLETED figure is returned by the API, so no
            // delta is shown here rather than compare against the old
            // (differently-defined) activeLastMonth.
            const segs = [
              { key: 'total', label: 'Total Patients', value: totalPatients, color: '#1A237E', delta: null as number | null },
              { key: 'seen', label: 'Patients Seen', value: m.newPatientsThisMonth + m.returningPatientsThisMonth, color: '#29ABE2', delta: null as number | null },
              { key: 'returning', label: 'Returning', value: m.returningPatientsThisMonth, color: '#10B981', delta: null as number | null },
              { key: 'fresh', label: 'New Patients', value: m.newPatientsThisMonth, color: '#F59E0B', delta: null as number | null },
            ]
            // Seen = Returning + New exactly (the backend computes them as an
            // exhaustive split of the same completed-this-month set — see
            // clinical.ts), so a 3-way stacked bar of Seen+Returning+New
            // would double-count: Returning and New already sum to Seen.
            // The honest 2-segment version below shows Returning + New as
            // real, non-overlapping portions of the total patient base — the
            // remaining grey is patients not seen this month.
            const seenCount = m.newPatientsThisMonth + m.returningPatientsThisMonth
            const barTotal = Math.max(totalPatients ?? seenCount, 1)
            return (
              <>
                <div className="flex items-center justify-between px-0.5 text-[9px] font-bold uppercase tracking-wide text-gray-400 dark:text-white/30">
                  <span>Returning</span>
                  <span>New</span>
                </div>
                <div className="mt-1 flex h-2.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-white/10">
                  <div style={{ width: `${(m.returningPatientsThisMonth / barTotal) * 100}%`, background: '#10B981' }} />
                  <div style={{ width: `${(m.newPatientsThisMonth / barTotal) * 100}%`, background: '#F59E0B' }} />
                </div>
                <div className="mt-4 grid grid-cols-4 gap-2">
                  {segs.map(s => {
                    const people = avatars[s.key] ?? []
                    return (
                      <div key={s.key}>
                        <div className="mb-1.5 flex items-center">
                          <div className="flex -space-x-1.5">
                            {people.length > 0 ? people.slice(0, 3).map(p => (
                              <Avatar key={p.id} firstName={p.firstName} lastName={p.lastName} avatarUrl={p.avatarUrl} size="xs" />
                            )) : <span className="grid h-6 w-6 place-items-center rounded-full bg-gray-100 text-gray-300 dark:bg-white/5"><Users size={11} /></span>}
                          </div>
                          <span className="ml-auto grid h-5 w-5 flex-shrink-0 place-items-center rounded-full bg-gray-50 text-gray-400 dark:bg-white/5 dark:text-white/30"><ArrowUpRight size={10} /></span>
                        </div>
                        <p className="text-xl font-extrabold leading-tight text-clinic-navy dark:text-white">{s.value !== null ? s.value.toLocaleString() : '—'}</p>
                        <p className="text-[9px] font-medium leading-tight text-gray-500 dark:text-slate-400">{s.label}</p>
                        {s.delta !== null ? (
                          <span className={cn('mt-1 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold', s.delta >= 0 ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-400/10 dark:text-emerald-400' : 'bg-red-50 text-red-500 dark:bg-red-400/10 dark:text-red-400')}>
                            {s.delta >= 0 ? <TrendingUp size={9} /> : <TrendingDown size={9} />}{s.delta >= 0 ? '+' : ''}{s.delta}
                          </span>
                        ) : (
                          // Dashed border deliberately distinguishes this from
                          // the solid-fill badge above — visually "preview",
                          // not a real figure. No number is shown/implied
                          // because there's no real week-over-week comparison
                          // source for this metric yet (would need a backend
                          // addition — see /clinical/analytics/dashboard).
                          <span title="Trend preview — real week-over-week comparison needs a backend addition, not implemented yet" className="mt-1 inline-flex items-center gap-0.5 rounded-full border border-dashed border-gray-300 px-1.5 py-0.5 text-[9px] font-bold text-gray-400 dark:border-white/15 dark:text-white/30">
                            <TrendingUp size={9} />—
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

        {/* Upcoming Appointments — real scheduling data, horizontally-scrollable timeline */}
        <CompactCard title="Upcoming Appointments" action={<Link href="/scheduling" className="text-[11px] font-bold text-clinic-blue hover:underline dark:text-cyan-400">View all</Link>}>
          {upcoming === null ? (
            <div className="h-36 animate-pulse rounded-xl bg-gray-50 dark:bg-white/5" />
          ) : futureAppts.length === 0 ? (
            <div className="flex h-36 flex-col items-center justify-center gap-1 text-center">
              <Calendar size={20} className="text-gray-200 dark:text-white/15" />
              <p className="text-xs font-medium text-gray-400 dark:text-slate-500">No more appointments today</p>
            </div>
          ) : (
            <div className="no-scrollbar w-full overflow-x-auto">
              <div style={{ width: timelineWidth, minWidth: '100%' }} className="relative">
                <div className="relative h-4">
                  {hourMarks.map(h => (
                    <span key={h} className="absolute -translate-x-1/2 whitespace-nowrap text-[9px] font-medium text-gray-500 dark:text-slate-400" style={{ left: (h - DAY_START_HOUR) * HOUR_PX }}>
                      {h > 12 ? h - 12 : h}{h >= 12 ? 'PM' : 'AM'}
                    </span>
                  ))}
                </div>
                <div className="relative mt-1 rounded-xl bg-gray-50 dark:bg-white/5" style={{ height: 112 }}>
                  {hourMarks.map(h => (
                    <div key={h} className="absolute top-0 bottom-0 border-l border-gray-200/70 dark:border-white/5" style={{ left: (h - DAY_START_HOUR) * HOUR_PX }} />
                  ))}
                  {nowPx >= 0 && nowPx <= timelineWidth && (
                    <div className="absolute top-0 bottom-0 z-10 w-px bg-clinic-blue dark:bg-cyan-400" style={{ left: nowPx }}>
                      <span className="absolute -top-1.5 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-clinic-blue dark:bg-cyan-400" />
                    </div>
                  )}
                  {futureAppts.map((a, i) => {
                    const left = pxOf(new Date(a.startAt).getTime())
                    const right = a.endAt ? pxOf(new Date(a.endAt).getTime()) : left + 84
                    const width = Math.max(right - left, 76)
                    const top = 8 + (i % 3) * 33
                    const time = new Date(a.startAt).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })
                    const isNearest = i === 0
                    return (
                      <div key={a.id} className={cn('absolute flex items-center gap-1.5 overflow-hidden rounded-full py-1 pl-1 pr-2.5 text-white shadow-sm', isNearest && 'ring-2 ring-clinic-blue ring-offset-1 dark:ring-cyan-400 dark:ring-offset-slate-900')} style={{ left, top, width, background: a.service.colour || '#29ABE2' }} title={`${time} · ${a.patient.firstName} ${a.patient.lastName} · ${a.service.name}`}>
                        <Avatar firstName={a.patient.firstName} lastName={a.patient.lastName} size="xs" colour="rgba(255,255,255,0.3)" />
                        <span className="truncate text-[10px] font-bold">{a.patient.firstName}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </CompactCard>

        {/* Today's AI Activity — replaces the old "Today's AI Utilization"
            ring card (AI Bookings/Reminders were permanently unavailable —
            "AI Bookings" had no today-scoped backend source and "Reminders"
            had no read endpoint at all, so two of three rings were always
            empty dashes). This reuses GET /ai-suite/snapshot (see
            takeover.routes.ts), a small read-only aggregate over today's
            AiConversation/AiMessage activity — real counts only, no invented
            "AI performance %" and no gauge for gauge's sake.
            Customer/Clinic-replied-last uses the same message-direction
            semantics already established in the inbox (lastMessage.role),
            but only over USER/AGENT messages — SYSTEM audit notices (staff
            takeover/handback, internal alert flags) are excluded server-side
            so a conversation is never counted as "clinic replied" just
            because its latest row wasn't a customer message.
            AI-vs-human handling is the separate `agentEnabled` signal the
            inbox's "🤖 AI handling / 👤 Human handling" pill already reads —
            it describes who currently OWNS the conversation, not who sent
            the last message, so the two are deliberately not conflated.
            Channel breakdown uses the same icons/labels/colors as the real
            Conversations workspace's own channel list (see CHANNEL_CONFIG
            above), including keeping FB/IG comment threads as their own
            distinct rows rather than folding them into Facebook/Instagram —
            this card is meant to genuinely match what /ai-suite shows, not
            a simplified re-interpretation of it. */}
        <CompactCard title="Today's AI Activity" action={<Link href="/ai-suite" className="flex items-center gap-0.5 text-[11px] font-bold text-clinic-blue hover:underline dark:text-cyan-400">View AI Suite <ArrowUpRight size={11} /></Link>}>
          {!aiSnapshot ? (
            <div className="h-32 animate-pulse rounded-xl bg-gray-50 dark:bg-white/5" />
          ) : (
            <>
              <div className="flex items-center gap-2.5">
                <span className="text-2xl leading-none">💬</span>
                <div>
                  <p className="text-2xl font-extrabold leading-none text-clinic-navy dark:text-white">{aiSnapshot.totalConversations}</p>
                  <p className="text-[10px] font-medium text-gray-500 dark:text-slate-400">Conversations Today</p>
                </div>
              </div>

              <div className="mt-2.5 grid grid-cols-2 gap-1.5">
                <div className="rounded-xl bg-red-50 dark:bg-red-400/10 px-2.5 py-1.5">
                  <p className="text-base font-extrabold leading-none text-red-600 dark:text-red-400">{aiSnapshot.customerLast}</p>
                  <p className="mt-1 text-[9px] font-semibold leading-tight text-red-500/80 dark:text-red-300/70">Customer replied last</p>
                </div>
                <div className="rounded-xl bg-blue-50 dark:bg-blue-400/10 px-2.5 py-1.5">
                  <p className="text-base font-extrabold leading-none text-blue-600 dark:text-blue-400">{aiSnapshot.clinicLast}</p>
                  <p className="mt-1 text-[9px] font-semibold leading-tight text-blue-500/80 dark:text-blue-300/70">Clinic replied last</p>
                </div>
              </div>

              <div className="mt-2.5 flex items-center justify-between text-[10px] font-semibold text-gray-500 dark:text-slate-400">
                <span>🤖 {aiSnapshot.aiHandling} AI handling</span>
                <span>🙋 {aiSnapshot.humanHandling} Human handling</span>
              </div>

              {CHANNEL_CONFIG.some(c => aiSnapshot.channels[c.key] > 0) && (
                <div className="mt-2.5 space-y-1 border-t border-gray-100 dark:border-white/10 pt-2">
                  {CHANNEL_CONFIG.filter(c => aiSnapshot.channels[c.key] > 0).map(c => (
                    <div key={c.key} className="flex items-center justify-between text-[10px]">
                      <span className="flex items-center gap-1.5 text-gray-500 dark:text-slate-400">
                        <ChannelIconView icon={c.icon} label={c.label} /> {c.label}
                      </span>
                      <span className="font-bold text-gray-700 dark:text-slate-200">{aiSnapshot.channels[c.key]}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </CompactCard>
      </div>
    </div>
  )
}
