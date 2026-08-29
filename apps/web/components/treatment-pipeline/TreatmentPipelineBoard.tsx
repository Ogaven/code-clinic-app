'use client'

// Shared Treatment Pipeline implementation, extracted out of
// apps/web/app/(admin)/treatment-pipeline/page.tsx so it can be rendered by
// both Admin (apps/web/app/(admin)/treatment-pipeline/page.tsx) and
// Receptionist (apps/web/app/(receptionist)/receptionist/treatment-pipeline/
// page.tsx) with the exact same calculations, periods, stages, search/
// filters, pagination and financial semantics — only the two internal
// navigation targets differ, via role-aware props. This lives outside any
// app/.../page.tsx file deliberately: a page.tsx's default export must
// satisfy Next's generated PageProps for its own route, which rejects a
// custom prop signature like this one.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw, TrendingUp, AlertTriangle, Clock, CheckCircle2, Kanban, X, ArrowLeftRight, ChevronDown, ChevronUp, Trash2, History, CalendarPlus, Search } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'

// ── Types ────────────────────────────────────────────────────────────────────

interface Plan {
  id:            string
  patientId:     string
  patient:       { id: string; firstName: string; lastName: string; patientNumber: number }
  serviceId:     string | null
  treatmentName: string
  stage:         string
  status:        string
  toothNumber:   string | null
  quantity:      number
  costPerUnit:   number
  discount:      number
  value:         number
  notes:         string | null
  doctorName:    string
  createdAt:     string
  updatedAt:     string
  daysSince:     number
}

interface Metrics {
  presentedValue:    number
  acceptedValue:     number
  conversionRate:    number
  moneyAtRisk:       number
  avgDaysToSchedule: number
}

interface PeriodInfo {
  key:   string
  start: string | null
  end:   string | null
  label: string
}

type PeriodKey = 'today' | 'week' | 'month' | 'all'

interface ReviewPlan {
  id:            string
  patientId:     string
  patientName:   string
  patientNumber: number
  phone:         string
  stage:         string
  daysSince:     number
  createdAt:     string
  updatedAt:     string
  lastApptDate:  string | null
  treatmentName: string
  value:         number
}

interface NeedsReviewData {
  consultOnly: ReviewPlan[]
  stuckPlans:  ReviewPlan[]
  total:       number
}

// ── Stage config (Needs Review section only — untouched, still stage-based) ───

const STAGES = [
  { id: 'Consulted',              label: 'Consulted',              headerColor: '#6B7280', headerBg: '#F3F4F6' },
  { id: 'Treatment Presented',    label: 'Treatment Presented',    headerColor: '#1D4ED8', headerBg: '#DBEAFE' },
  { id: 'Accepted & Scheduled',   label: 'Accepted & Scheduled',   headerColor: '#065F46', headerBg: '#D1FAE5' },
  { id: 'Accepted & Unscheduled', label: 'Accepted & Unscheduled', headerColor: '#92400E', headerBg: '#FDE68A' },
  { id: 'Completed',              label: 'Completed',              headerColor: '#1E3A5F', headerBg: '#BAE6FD' },
  { id: 'Declined',               label: 'Declined',               headerColor: '#991B1B', headerBg: '#FEE2E2' },
  { id: 'Follow-up Due',          label: 'Follow-up Due',          headerColor: '#5B21B6', headerBg: '#EDE9FE' },
]

// ── Status config — the board's columns. Same 6 values as the Treatment Plan
// status dropdown (patient profile) and Case Acceptance's report, so all three
// stay genuinely in sync — this is the shared field, not a separate copy.

const STATUSES = [
  { id: 'Planned',     label: 'Planned',     headerColor: '#1D4ED8', headerBg: '#DBEAFE' },
  { id: 'In Progress', label: 'In Progress', headerColor: '#92400E', headerBg: '#FDE68A' },
  { id: 'Completed',   label: 'Completed',   headerColor: '#065F46', headerBg: '#D1FAE5' },
  { id: 'On Hold',     label: 'On Hold',     headerColor: '#854D0E', headerBg: '#FEF9C3' },
  { id: 'Declined',    label: 'Declined',    headerColor: '#9F1239', headerBg: '#FFE4E6' },
  { id: 'Cancelled',   label: 'Cancelled',   headerColor: '#991B1B', headerBg: '#FEE2E2' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtCC(n: number) { return `CC-${String(n).padStart(4, '0')}` }

function fmtUGX(n: number) {
  if (n >= 1_000_000) return `UGX ${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `UGX ${(n / 1_000).toFixed(0)}K`
  return `UGX ${n}`
}

function urgencyBorderColor(daysSince: number) {
  if (daysSince > 14) return '#F59E0B'
  if (daysSince > 7)  return '#D1D5DB'
  return '#E5E7EB'
}

const COLUMN_PAGE_SIZE = 40

// ── Main board ─────────────────────────────────────────────────────────────────

export default function TreatmentPipelineBoard({
  patientBasePath = '/patients',
  schedulingBasePath = '/scheduling',
}: { patientBasePath?: string; schedulingBasePath?: string } = {}) {
  const API    = '/api-proxy'
  const router = useRouter()
  const token  = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const authH  = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  const [plans,          setPlans]          = useState<Plan[]>([])
  const [metrics,        setMetrics]        = useState<Metrics | null>(null)
  const [period,         setPeriod]         = useState<PeriodInfo | null>(null)
  const [periodKey,      setPeriodKey]      = useState<PeriodKey>('month')
  const [loading,        setLoading]        = useState(true)
  const [dragId,         setDragId]         = useState<string | null>(null)
  const [dropOver,       setDropOver]       = useState<string | null>(null)
  const [movePlan,       setMovePlan]       = useState<Plan | null>(null)
  const [needsReview,    setNeedsReview]    = useState<NeedsReviewData | null>(null)
  const [reviewOpen,     setReviewOpen]     = useState(false)
  const [selectedIds,    setSelectedIds]    = useState<Set<string>>(new Set())
  const [bulkStatus,     setBulkStatus]     = useState('')
  const [bulkLoading,    setBulkLoading]    = useState(false)
  const [dark,           setDark]           = useState(false)
  const [search,         setSearch]         = useState('')
  const [doctorFilter,   setDoctorFilter]   = useState('all')
  const [stageFilter,    setStageFilter]    = useState('all')
  // Columns render only the first COLUMN_PAGE_SIZE cards until expanded — an
  // "All time" board can hold years of plans, and rendering hundreds of full
  // drag-and-drop cards at once per column is the kind of DOM cost the page
  // shouldn't pay just because a column happens to be long.
  const [expandedColumns, setExpandedColumns] = useState<Set<string>>(new Set())

  useEffect(() => {
    const sync = () => setDark(document.documentElement.classList.contains('dark'))
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [r, rr] = await Promise.all([
        fetch(`${API}/pipeline/treatment?period=${periodKey}`, { headers: authH as any }),
        fetch(`${API}/pipeline/needs-review`, { headers: authH as any }),
      ])
      const d  = await r.json()
      const dr = await rr.json()
      setPlans(Array.isArray(d.plans) ? d.plans : [])
      setMetrics(d.metrics ?? null)
      setPeriod(d.period ?? null)
      if (!dr.error) setNeedsReview(dr)
    } catch { /* silent */ }
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodKey])

  useEffect(() => { load() }, [load])

  // ── Drag handlers ──────────────────────────────────────────────────────────

  const handleDragStart = (e: React.DragEvent, planId: string) => {
    setDragId(planId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('planId', planId)
  }

  const handleDragEnd = () => { setDragId(null); setDropOver(null) }

  // Move via modal (touch fallback) — updates the real Treatment Plan status
  async function handleMove(planId: string, targetStatus: string) {
    const plan = plans.find(p => p.id === planId)
    if (!plan || plan.status === targetStatus) { setMovePlan(null); return }

    // Optimistic update
    setPlans(prev => prev.map(p => p.id === planId ? { ...p, status: targetStatus } : p))
    setMovePlan(null)

    try {
      await fetch(`${API}/pipeline/treatment/${planId}/status`, {
        method:  'PATCH',
        headers: authH as any,
        body:    JSON.stringify({ status: targetStatus }),
      })
    } catch {
      // Revert on failure
      setPlans(prev => prev.map(p => p.id === planId ? { ...p, status: plan.status } : p))
    }
  }

  const handleDragOver = (e: React.DragEvent, statusId: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropOver(statusId)
  }

  const handleDrop = async (e: React.DragEvent, targetStatus: string) => {
    e.preventDefault()
    const planId = e.dataTransfer.getData('planId') || dragId
    setDragId(null)
    setDropOver(null)
    if (!planId) return

    const plan = plans.find(p => p.id === planId)
    if (!plan || plan.status === targetStatus) return

    // Optimistic update — this is the write that keeps Treatment Plan status,
    // Pipeline's board, and Case Acceptance's report all reading one live field.
    setPlans(prev => prev.map(p => p.id === planId ? { ...p, status: targetStatus } : p))

    try {
      await fetch(`${API}/pipeline/treatment/${planId}/status`, {
        method:  'PATCH',
        headers: authH as any,
        body:    JSON.stringify({ status: targetStatus }),
      })
    } catch {
      // Revert on failure
      setPlans(prev => prev.map(p => p.id === planId ? { ...p, status: plan.status } : p))
    }
  }

  // ── Bulk actions ──────────────────────────────────────────────────────────

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function handleBulkStatus(status: string) {
    if (!status || selectedIds.size === 0) return
    setBulkLoading(true)
    const ids = Array.from(selectedIds)
    setPlans(prev => prev.map(p => ids.includes(p.id) ? { ...p, status } : p))
    setSelectedIds(new Set())
    try {
      await fetch(`${API}/pipeline/treatment/bulk-status`, {
        method:  'PATCH',
        headers: authH as any,
        body:    JSON.stringify({ ids, status }),
      })
    } catch { load() }
    setBulkLoading(false)
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return
    setBulkLoading(true)
    const ids = Array.from(selectedIds)
    setPlans(prev => prev.filter(p => !ids.includes(p.id)))
    setSelectedIds(new Set())
    try {
      await fetch(`${API}/pipeline/treatment/bulk`, {
        method:  'DELETE',
        headers: authH as any,
        body:    JSON.stringify({ ids }),
      })
    } catch { load() }
    setBulkLoading(false)
  }

  async function handleReviewAction(planId: string, action: 'complete' | 'decline' | 'remove') {
    if (action === 'remove') {
      setNeedsReview(prev => prev ? {
        ...prev,
        consultOnly: prev.consultOnly.filter(p => p.id !== planId),
        stuckPlans:  prev.stuckPlans.filter(p => p.id !== planId),
        total: prev.total - 1,
      } : prev)
      await fetch(`${API}/pipeline/treatment/${planId}`, { method: 'DELETE', headers: authH as any })
      setPlans(prev => prev.filter(p => p.id !== planId))
      return
    }
    const stage = action === 'complete' ? 'Completed' : 'Declined'
    setNeedsReview(prev => prev ? {
      ...prev,
      consultOnly: prev.consultOnly.filter(p => p.id !== planId),
      stuckPlans:  prev.stuckPlans.filter(p => p.id !== planId),
      total: prev.total - 1,
    } : prev)
    setPlans(prev => prev.map(p => p.id === planId ? { ...p, stage } : p))
    await fetch(`${API}/pipeline/treatment/${planId}/stage`, {
      method:  'PATCH',
      headers: authH as any,
      body:    JSON.stringify({ stage }),
    })
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  // Real doctor names already present on the fetched plans — never a
  // separate hard-coded list.
  const doctorNames = useMemo(
    () => [...new Set(plans.map(p => p.doctorName).filter(n => n && n !== '—'))].sort(),
    [plans],
  )

  const filteredPlans = useMemo(() => {
    const q = search.trim().toLowerCase()
    return plans.filter(p => {
      if (doctorFilter !== 'all' && p.doctorName !== doctorFilter) return false
      if (stageFilter !== 'all' && p.stage !== stageFilter) return false
      if (q) {
        const hay = `${p.patient.firstName} ${p.patient.lastName} ${p.treatmentName}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [plans, search, doctorFilter, stageFilter])

  const plansByStatus = (statusId: string) => filteredPlans.filter(p => p.status === statusId)
  const statusTotal   = (statusId: string) => plansByStatus(statusId).reduce((s, p) => s + p.value, 0)

  // "Today" | "This Week" | "This Month" | "All Time" — drives both the KPI
  // card labels and the board heading, so they can never disagree.
  const periodSuffix = period?.label ?? 'This Month'

  return (
    <div className="flex flex-col gap-5">

      {/* ── Period selector + KPI cards ───────────────────────────────── */}
      <div className="flex flex-col gap-2 flex-shrink-0">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h1 className="text-sm font-bold text-gray-500 dark:text-white/50">
            Treatment Pipeline <span className="font-normal text-gray-400 dark:text-white/30">· {periodSuffix}</span>
          </h1>
          <div className="flex items-center gap-1 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 p-1">
            {(['today', 'week', 'month', 'all'] as PeriodKey[]).map(p => (
              <button key={p} onClick={() => setPeriodKey(p)}
                className={cn('px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors',
                  periodKey === p ? 'bg-clinic-navy text-white dark:bg-cyan-600' : 'text-gray-500 dark:text-white/50 hover:bg-gray-100 dark:hover:bg-white/10')}>
                {p === 'today' ? 'Today' : p === 'week' ? 'Week' : p === 'month' ? 'Month' : 'All time'}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard
            label={`Presented ${periodSuffix}`}
            value={metrics ? fmtUGX(metrics.presentedValue) : '—'}
            sub="treatment value presented"
            icon={<TrendingUp size={14} />}
            color="#1A237E"
            loading={loading}
            dark={dark}
          />
          <MetricCard
            label={`Accepted ${periodSuffix}`}
            value={metrics ? fmtUGX(metrics.acceptedValue) : '—'}
            sub={metrics ? `${metrics.conversionRate}% conversion` : '—'}
            icon={<CheckCircle2 size={14} />}
            color="#065F46"
            loading={loading}
            dark={dark}
          />
          <MetricCard
            label="Money at Risk"
            value={metrics ? fmtUGX(metrics.moneyAtRisk) : '—'}
            sub="All time · unscheduled"
            icon={<AlertTriangle size={14} />}
            color="#92400E"
            loading={loading}
            highlight={!!metrics && metrics.moneyAtRisk > 0}
            dark={dark}
          />
          <MetricCard
            label="Avg Days to Schedule"
            value={metrics ? `${metrics.avgDaysToSchedule}d` : '—'}
            sub="All time"
            icon={<Clock size={14} />}
            color="#5B21B6"
            loading={loading}
            dark={dark}
          />
        </div>
      </div>

      {/* ── Filters ────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-2.5 flex-shrink-0">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search patient or treatment..."
            className="w-full pl-8 pr-4 py-2 text-sm bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 dark:text-white dark:placeholder-white/30 rounded-xl focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all"
          />
        </div>
        <select
          value={doctorFilter}
          onChange={e => setDoctorFilter(e.target.value)}
          className="text-sm px-3 py-2 border border-gray-200 dark:border-white/10 rounded-xl bg-white dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20">
          <option value="all" className="dark:bg-[#152040]">All doctors</option>
          {doctorNames.map(n => <option key={n} value={n} className="dark:bg-[#152040]">{n}</option>)}
        </select>
        <select
          value={stageFilter}
          onChange={e => setStageFilter(e.target.value)}
          className="text-sm px-3 py-2 border border-gray-200 dark:border-white/10 rounded-xl bg-white dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20">
          <option value="all" className="dark:bg-[#152040]">All stages</option>
          {STAGES.map(s => <option key={s.id} value={s.id} className="dark:bg-[#152040]">{s.label}</option>)}
        </select>
      </div>

      {/* ── Needs Review section ──────────────────────────────────────── */}
      {needsReview && needsReview.total > 0 && (
        <NeedsReviewSection
          data={needsReview}
          open={reviewOpen}
          onToggle={() => setReviewOpen(v => !v)}
          onAction={handleReviewAction}
          onNavigate={(patientId) => router.push(`${schedulingBasePath}?patientId=${patientId}`)}
        />
      )}

      {/* ── Bulk action toolbar ────────────────────────────────────────── */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-2xl shadow-lg flex-shrink-0">
          <span className="text-sm font-bold text-gray-700 dark:text-white">{selectedIds.size} plan{selectedIds.size !== 1 ? 's' : ''} selected</span>
          <div className="flex items-center gap-2 flex-1">
            <select
              value={bulkStatus}
              onChange={e => setBulkStatus(e.target.value)}
              className="text-xs px-2.5 py-1.5 border border-gray-200 dark:border-white/10 rounded-lg bg-gray-50 dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-clinic-blue/20"
            >
              <option value="" className="dark:bg-[#152040]">Move to status…</option>
              {STATUSES.map(s => <option key={s.id} value={s.id} className="dark:bg-[#152040]">{s.label}</option>)}
            </select>
            <button
              disabled={!bulkStatus || bulkLoading}
              onClick={() => handleBulkStatus(bulkStatus)}
              className="text-xs font-bold px-3 py-1.5 rounded-lg text-white disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}
            >
              {bulkLoading ? '…' : 'Apply'}
            </button>
            <button
              onClick={() => handleBulkStatus('Completed')}
              disabled={bulkLoading}
              className="text-xs font-bold px-3 py-1.5 rounded-lg bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-400/15 dark:text-emerald-300 dark:hover:bg-emerald-400/25 transition-colors disabled:opacity-40"
            >
              <CheckCircle2 size={11} className="inline mr-1" />Complete
            </button>
            <button
              onClick={handleBulkDelete}
              disabled={bulkLoading}
              className="text-xs font-bold px-3 py-1.5 rounded-lg bg-red-100 text-red-600 hover:bg-red-200 dark:bg-red-400/15 dark:text-red-300 dark:hover:bg-red-400/25 transition-colors disabled:opacity-40 ml-auto"
            >
              <Trash2 size={11} className="inline mr-1" />Delete
            </button>
          </div>
          <button onClick={() => setSelectedIds(new Set())} className="text-gray-400 hover:text-gray-600 dark:hover:text-white">
            <X size={16} />
          </button>
        </div>
      )}

      {/* ── Kanban board ──────────────────────────────────────────────── */}
      {/* Board now shares the exact same createdAt cohort as the KPI cards
          above (see GET /pipeline/treatment) — selecting Today/Week/Month
          filters both together, so this heading is never contradicted by
          what's actually rendered below it. */}
      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-white/30 -mb-1">
        Active treatment pipeline · {periodSuffix}
      </p>
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-gray-400 dark:text-white/40">
          <RefreshCw size={18} className="animate-spin" />
          <span className="text-sm">Loading pipeline...</span>
        </div>
      ) : filteredPlans.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-white/40">
          <Kanban size={40} className="mb-3 opacity-25" />
          <p className="text-sm font-semibold">
            {plans.length > 0
              ? 'No plans match the current filters'
              : periodKey === 'all'
              ? 'No treatment plans yet'
              : `No treatments for ${periodSuffix.toLowerCase()}`}
          </p>
          <p className="text-xs mt-1 text-gray-300 dark:text-white/20">
            {plans.length > 0
              ? 'Try clearing the search, doctor, or stage filter'
              : periodKey === 'all'
              ? "Plans appear here once added from a patient's clinical tab"
              : 'Try a different period, or switch to All time'}
          </p>
        </div>
      ) : (
        <div
          className="overflow-x-auto pb-4 -mx-1 px-1 scrollbar-hide"
          style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
        >
          <div className="flex flex-col sm:flex-row sm:items-start gap-3">
            {STATUSES.map(status => {
              const statusPlans = plansByStatus(status.id)
              const total       = statusTotal(status.id)
              const isOver      = dropOver === status.id
              const isExpanded  = expandedColumns.has(status.id)
              const visiblePlans = isExpanded ? statusPlans : statusPlans.slice(0, COLUMN_PAGE_SIZE)
              const hiddenCount  = statusPlans.length - visiblePlans.length

              return (
                <div
                  key={status.id}
                  className="flex flex-col rounded-2xl overflow-hidden w-full sm:flex-shrink-0 sm:w-[280px] transition-all duration-150"
                  style={{
                    background: dark ? (isOver ? 'rgba(41,171,226,0.08)' : 'rgba(255,255,255,0.03)') : (isOver ? '#F0F9FF' : '#F9FAFB'),
                    border:    `1px solid ${dark ? (isOver ? 'rgba(41,171,226,0.4)' : 'rgba(255,255,255,0.08)') : (isOver ? '#BAE6FD' : '#E5E7EB')}`,
                    boxShadow: isOver ? '0 0 0 2px #29ABE2' : 'none',
                  }}
                  onDragOver={e  => handleDragOver(e, status.id)}
                  onDragLeave={() => setDropOver(null)}
                  onDrop={e      => handleDrop(e, status.id)}
                >
                  {/* Column header */}
                  <div
                    className="px-3 py-2.5 flex items-center justify-between flex-shrink-0"
                    style={{ background: dark ? status.headerColor + '26' : status.headerBg }}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ background: status.headerColor }}
                      />
                      <span
                        className="text-xs font-bold truncate"
                        style={{ color: dark ? '#fff' : status.headerColor }}
                      >
                        {status.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {total > 0 && (
                        <span
                          className="text-[10px] font-bold px-1.5 py-0.5 rounded-md"
                          style={{ background: status.headerColor + '18', color: dark ? '#fff' : status.headerColor }}
                        >
                          {fmtUGX(total)}
                        </span>
                      )}
                      <span
                        className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black"
                        style={{ background: status.headerColor, color: 'white' }}
                      >
                        {statusPlans.length}
                      </span>
                    </div>
                  </div>

                  {/* Cards — page grows naturally with the tallest column
                      (no internal vertical scrollbar); only the row of
                      columns scrolls horizontally. */}
                  <div className="p-2 space-y-2">
                    {statusPlans.length === 0 && (
                      <div
                        className="h-16 rounded-xl border-2 border-dashed flex items-center justify-center text-xs text-gray-300 dark:text-white/15"
                        style={{ borderColor: isOver ? '#29ABE2' : dark ? 'rgba(255,255,255,0.1)' : '#E5E7EB' }}
                      >
                        Drop here
                      </div>
                    )}
                    {visiblePlans.map(plan => (
                      <PlanCard
                        key={plan.id}
                        plan={plan}
                        dark={dark}
                        isDragging={dragId === plan.id}
                        isSelected={selectedIds.has(plan.id)}
                        onDragStart={handleDragStart}
                        onDragEnd={handleDragEnd}
                        onMove={() => setMovePlan(plan)}
                        onToggleSelect={() => toggleSelect(plan.id)}
                        onOpenPatient={() => router.push(`${patientBasePath}/${plan.patientId}`)}
                      />
                    ))}
                    {hiddenCount > 0 && (
                      <button
                        onClick={() => setExpandedColumns(prev => new Set(prev).add(status.id))}
                        className="w-full rounded-xl border border-dashed py-2 text-[11px] font-bold text-gray-500 dark:text-white/50 hover:bg-white dark:hover:bg-white/5 transition-colors"
                        style={{ borderColor: dark ? 'rgba(255,255,255,0.15)' : '#E5E7EB' }}
                      >
                        Show {hiddenCount} more
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Move modal (touch fallback) ────────────────────────────────── */}
      {movePlan && (
        <MoveModal
          plan={movePlan}
          dark={dark}
          onMove={handleMove}
          onClose={() => setMovePlan(null)}
        />
      )}
    </div>
  )
}

// ── Plan card ─────────────────────────────────────────────────────────────────

function PlanCard({
  plan,
  dark,
  isDragging,
  isSelected,
  onDragStart,
  onDragEnd,
  onMove,
  onToggleSelect,
  onOpenPatient,
}: {
  plan:           Plan
  dark:           boolean
  isDragging:     boolean
  isSelected:     boolean
  onDragStart:    (e: React.DragEvent, id: string) => void
  onDragEnd:      () => void
  onMove:         () => void
  onToggleSelect: () => void
  onOpenPatient:  () => void
}) {
  const [showHistory, setShowHistory] = useState(false)
  const borderColor = urgencyBorderColor(plan.daysSince)
  const urgentText  = plan.daysSince > 14
    ? 'text-red-500'
    : plan.daysSince > 7
    ? 'text-amber-500'
    : 'text-gray-400'

  const fmt = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })

  return (
    <div
      draggable
      onDragStart={e => onDragStart(e, plan.id)}
      onDragEnd={onDragEnd}
      className="bg-white dark:bg-[#152040] rounded-xl p-3 select-none transition-all duration-150"
      style={{
        boxShadow:   isDragging
          ? '0 8px 20px rgba(0,0,0,0.15)'
          : isSelected
          ? '0 0 0 2px #29ABE2'
          : dark ? '0 1px 3px rgba(0,0,0,0.3)' : '0 1px 3px rgba(0,0,0,0.06)',
        opacity:     isDragging ? 0.6 : 1,
        cursor:      'grab',
        border:      `1px solid ${isSelected ? '#BAE6FD' : dark ? 'rgba(255,255,255,0.08)' : '#F3F4F6'}`,
        borderLeft:  `3px solid ${borderColor}`,
      }}
    >
      {/* Checkbox + Patient */}
      <div className="flex items-start gap-1.5 mb-1">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggleSelect}
          onClick={e => e.stopPropagation()}
          onDragStart={e => e.stopPropagation()}
          className="mt-0.5 w-3.5 h-3.5 rounded accent-cyan-500 cursor-pointer flex-shrink-0"
        />
        <div className="flex items-start justify-between gap-1 flex-1 min-w-0">
          <button
            onClick={e => { e.stopPropagation(); onOpenPatient() }}
            onDragStart={e => e.stopPropagation()}
            className="text-sm font-bold text-gray-900 dark:text-white leading-tight truncate hover:underline text-left"
            title="Open patient record"
          >
            {plan.patient.firstName} {plan.patient.lastName}
          </button>
          <span className="text-[10px] font-mono text-gray-400 dark:text-white/40 flex-shrink-0 mt-0.5">
            {fmtCC(plan.patient.patientNumber)}
          </span>
        </div>
      </div>

      {/* Treatment */}
      <p className="text-[11px] text-gray-600 dark:text-white/60 truncate leading-tight pl-5">
        {plan.treatmentName}
        {plan.toothNumber && (
          <span className="text-gray-400 dark:text-white/40"> · Tooth {plan.toothNumber}</span>
        )}
      </p>

      {/* Value */}
      <p className="text-sm font-bold mt-1.5 mb-1 pl-5" style={{ color: dark ? '#7CB3FF' : '#1A237E' }}>
        {fmtUGX(plan.value)}
      </p>

      {/* Doctor + days + actions */}
      <div className="flex items-center justify-between gap-1 pl-5">
        <p className="text-[10px] text-gray-400 dark:text-white/40 truncate flex-1">{plan.doctorName}</p>
        <span className={`text-[10px] font-semibold flex-shrink-0 ${urgentText}`}>
          {plan.daysSince}d
        </span>
        <button
          onClick={e => { e.stopPropagation(); setShowHistory(v => !v) }}
          onDragStart={e => e.stopPropagation()}
          className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-semibold text-gray-400 dark:text-white/40 hover:text-purple-500 hover:bg-purple-50 dark:hover:bg-purple-400/10 transition-colors flex-shrink-0"
          title="Stage history"
        >
          <History size={10} />
        </button>
        <button
          onClick={e => { e.stopPropagation(); onMove() }}
          onDragStart={e => e.stopPropagation()}
          className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-semibold text-gray-400 dark:text-white/40 hover:text-clinic-blue hover:bg-blue-50 dark:hover:bg-blue-400/10 transition-colors flex-shrink-0"
          title="Move to another status"
        >
          <ArrowLeftRight size={10} />
          <span className="hidden sm:inline">Move</span>
        </button>
      </div>

      {/* Stage history timeline */}
      {showHistory && (
        <div className="mt-2 pt-2 border-t border-gray-100 dark:border-white/10 pl-5 space-y-1">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-white/20 flex-shrink-0" />
            <span className="text-[10px] text-gray-400 dark:text-white/40">Entered pipeline: <span className="font-semibold text-gray-600 dark:text-white/70">{fmt(plan.createdAt)}</span></span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 flex-shrink-0" />
            <span className="text-[10px] text-gray-400 dark:text-white/40">Last updated: <span className="font-semibold text-gray-600 dark:text-white/70">{fmt(plan.updatedAt)}</span></span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
            <span className="text-[10px] text-gray-400 dark:text-white/40">Current status: <span className="font-semibold text-blue-600 dark:text-cyan-400">{plan.status}</span></span>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Move modal (touch / keyboard fallback) ────────────────────────────────────

function MoveModal({
  plan,
  dark,
  onMove,
  onClose,
}: {
  plan:    Plan
  dark:    boolean
  onMove:  (planId: string, status: string) => void
  onClose: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-[#152040] w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden animate-fade-in"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-4 pt-4 pb-3 border-b border-gray-100 dark:border-white/10">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-gray-900 dark:text-white">Move to status</p>
            <p className="text-xs text-gray-500 dark:text-white/50 truncate mt-0.5">
              {plan.patient.firstName} {plan.patient.lastName} · {plan.treatmentName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="ml-3 w-7 h-7 flex items-center justify-center rounded-xl text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors flex-shrink-0"
          >
            <X size={14} />
          </button>
        </div>

        {/* Status list */}
        <div className="p-3 space-y-1 max-h-[60vh] overflow-y-auto">
          {STATUSES.filter(s => s.id !== plan.status).map(status => (
            <button
              key={status.id}
              onClick={() => onMove(plan.id, status.id)}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-gray-50 dark:hover:bg-white/5 active:bg-gray-100 dark:active:bg-white/10 transition-colors text-left"
            >
              <span
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ background: status.headerColor }}
              />
              <span className="text-sm font-medium text-gray-700 dark:text-white/80">{status.label}</span>
            </button>
          ))}
        </div>

        {/* Safe-area spacer on iOS */}
        <div className="h-safe-bottom sm:hidden" style={{ height: 'env(safe-area-inset-bottom)' }} />
      </div>
    </div>
  )
}

// ── Needs Review Section ──────────────────────────────────────────────────────

function NeedsReviewSection({
  data, open, onToggle, onAction, onNavigate,
}: {
  data:       NeedsReviewData
  open:       boolean
  onToggle:   () => void
  onAction:   (planId: string, action: 'complete' | 'decline' | 'remove') => void
  onNavigate: (patientId: string) => void
}) {
  const fmt = (d: string | null) =>
    d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'

  const ReviewRow = ({ plan, type }: { plan: ReviewPlan; type: string }) => (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-amber-100/60 dark:border-amber-400/10 last:border-0 hover:bg-amber-50/30 dark:hover:bg-amber-400/5 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-bold text-gray-800 dark:text-white truncate">{plan.patientName}</span>
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300">{plan.stage}</span>
          <span className="text-[10px] font-semibold text-red-500">{plan.daysSince}d</span>
        </div>
        <div className="text-[11px] text-gray-500 dark:text-white/50 mt-0.5">
          {plan.treatmentName} · {fmtUGX(plan.value)}
          {plan.lastApptDate && <span className="ml-2 text-gray-400 dark:text-white/30">Last visit: {fmt(plan.lastApptDate)}</span>}
        </div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {type === 'stuck' && (
          <button
            onClick={() => onAction(plan.id, 'complete')}
            className="text-[10px] font-bold px-2 py-1 rounded-lg bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-400/15 dark:text-emerald-300 dark:hover:bg-emerald-400/25 transition-colors"
            title="Mark Completed"
          >
            <CheckCircle2 size={11} className="inline mr-0.5" />Done
          </button>
        )}
        <button
          onClick={() => onAction(plan.id, 'decline')}
          className="text-[10px] font-bold px-2 py-1 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-white/10 dark:text-white/60 dark:hover:bg-white/15 transition-colors"
          title="Mark Declined"
        >
          Decline
        </button>
        <button
          onClick={() => onNavigate(plan.patientId)}
          className="text-[10px] font-bold px-2 py-1 rounded-lg bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-400/15 dark:text-blue-300 dark:hover:bg-blue-400/25 transition-colors"
          title="Book Follow-up"
        >
          <CalendarPlus size={11} className="inline mr-0.5" />Book
        </button>
        <button
          onClick={() => onAction(plan.id, 'remove')}
          className="p-1 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:text-white/30 dark:hover:bg-red-400/10 transition-colors"
          title="Remove from pipeline"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  )

  return (
    <div className="rounded-2xl border border-amber-200 dark:border-amber-400/20 overflow-hidden flex-shrink-0 bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-400/10 dark:to-amber-400/5">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-amber-50/50 dark:hover:bg-amber-400/10 transition-colors"
      >
        <div className="flex items-center gap-2">
          <AlertTriangle size={15} className="text-amber-600 dark:text-amber-400" />
          <span className="text-sm font-bold text-amber-800 dark:text-amber-300">Needs Review</span>
          {/* This is an operational backlog, not a reporting-period cohort —
              it never shrinks just because the KPI/board period above is set
              to Today, so it's labelled explicitly to avoid implying it did. */}
          <span className="text-[9px] font-bold uppercase tracking-wide text-amber-500/80 dark:text-amber-400/60">· All-time backlog</span>
          <span className="text-xs font-black px-2 py-0.5 rounded-full bg-amber-500 text-white">
            {data.total}
          </span>
          <span className="text-xs text-amber-600 dark:text-amber-400">
            {data.consultOnly.length > 0 && `${data.consultOnly.length} consulted >60d`}
            {data.consultOnly.length > 0 && data.stuckPlans.length > 0 && ' · '}
            {data.stuckPlans.length > 0 && `${data.stuckPlans.length} stuck >90d`}
          </span>
        </div>
        {open ? <ChevronUp size={15} className="text-amber-600 dark:text-amber-400" /> : <ChevronDown size={15} className="text-amber-600 dark:text-amber-400" />}
      </button>

      {open && (
        <div className="bg-white dark:bg-[#0e1f4d] border-t border-amber-200 dark:border-amber-400/20">
          {data.consultOnly.length > 0 && (
            <>
              <div className="px-4 py-1.5 bg-gray-50 dark:bg-white/5 border-b border-gray-100 dark:border-white/10">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-white/40">Consulted — no follow-up ({data.consultOnly.length})</p>
              </div>
              {data.consultOnly.map(p => <ReviewRow key={p.id} plan={p} type="consult" />)}
            </>
          )}
          {data.stuckPlans.length > 0 && (
            <>
              <div className="px-4 py-1.5 bg-gray-50 dark:bg-white/5 border-b border-gray-100 dark:border-white/10">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-white/40">Stuck / Accepted — not progressing ({data.stuckPlans.length})</p>
              </div>
              {data.stuckPlans.map(p => <ReviewRow key={p.id} plan={p} type="stuck" />)}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Metric card ───────────────────────────────────────────────────────────────

function MetricCard({
  label, value, sub, icon, color, loading, highlight, dark,
}: {
  label:      string
  value:      string
  sub:        string
  icon:       React.ReactNode
  color:      string
  loading:    boolean
  highlight?: boolean
  dark:       boolean
}) {
  return (
    <div
      className="bg-white dark:bg-white/5 rounded-xl p-2.5 border transition-all duration-150 min-w-0"
      style={{
        borderColor: highlight ? '#FCA5A5' : dark ? 'rgba(255,255,255,0.1)' : '#F3F4F6',
        boxShadow:   highlight ? '0 0 0 2px #FCA5A5' : dark ? 'none' : '0 1px 3px rgba(0,0,0,0.05)',
      }}
    >
      <div className="flex items-center justify-between gap-1 mb-1">
        <p className="text-[9px] font-black uppercase tracking-wider text-gray-400 dark:text-white/40 truncate">{label}</p>
        <span className="flex-shrink-0" style={{ color: dark ? '#fff' : color }}>{icon}</span>
      </div>
      {loading ? (
        <div className="h-5 w-16 bg-gray-100 dark:bg-white/10 rounded-lg animate-pulse" />
      ) : (
        <p className="text-lg font-black leading-none truncate" style={{ color }}>{value}</p>
      )}
      <p className="text-[9px] text-gray-400 dark:text-white/40 mt-0.5 truncate">{sub}</p>
    </div>
  )
}
