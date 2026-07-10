'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, TrendingUp, AlertTriangle, Clock, CheckCircle2, Kanban, X, ArrowLeftRight, ChevronDown, ChevronUp, Trash2, History, CalendarPlus } from 'lucide-react'
import { useRouter } from 'next/navigation'

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
  totalPresentedMonth: number
  totalAccepted:       number
  conversionRate:      number
  moneyAtRisk:         number
  avgDaysToSchedule:   number
}

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

// ── Stage config ─────────────────────────────────────────────────────────────

const STAGES = [
  { id: 'Consulted',              label: 'Consulted',              headerColor: '#6B7280', headerBg: '#F3F4F6' },
  { id: 'Treatment Presented',    label: 'Treatment Presented',    headerColor: '#1D4ED8', headerBg: '#DBEAFE' },
  { id: 'Accepted & Scheduled',   label: 'Accepted & Scheduled',   headerColor: '#065F46', headerBg: '#D1FAE5' },
  { id: 'Accepted & Unscheduled', label: 'Accepted & Unscheduled', headerColor: '#92400E', headerBg: '#FDE68A' },
  { id: 'Completed',              label: 'Completed',              headerColor: '#1E3A5F', headerBg: '#BAE6FD' },
  { id: 'Declined',               label: 'Declined',               headerColor: '#991B1B', headerBg: '#FEE2E2' },
  { id: 'Follow-up Due',          label: 'Follow-up Due',          headerColor: '#5B21B6', headerBg: '#EDE9FE' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtCC(n: number) { return `CC-${String(n).padStart(4, '0')}` }

function fmtUGX(n: number) {
  if (n >= 1_000_000) return `UGX ${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `UGX ${(n / 1_000).toFixed(0)}K`
  return `UGX ${n}`
}

function urgencyBorderColor(daysSince: number, stage: string) {
  if (stage === 'Accepted & Unscheduled') return daysSince > 7  ? '#EF4444' : '#F59E0B'
  if (daysSince > 14) return '#F59E0B'
  if (daysSince > 7)  return '#D1D5DB'
  return '#E5E7EB'
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TreatmentPipelinePage() {
  const API    = '/api-proxy'
  const router = useRouter()
  const token  = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const authH  = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  const [plans,          setPlans]          = useState<Plan[]>([])
  const [metrics,        setMetrics]        = useState<Metrics | null>(null)
  const [loading,        setLoading]        = useState(true)
  const [dragId,         setDragId]         = useState<string | null>(null)
  const [dropOver,       setDropOver]       = useState<string | null>(null)
  const [movePlan,       setMovePlan]       = useState<Plan | null>(null)
  const [needsReview,    setNeedsReview]    = useState<NeedsReviewData | null>(null)
  const [reviewOpen,     setReviewOpen]     = useState(false)
  const [selectedIds,    setSelectedIds]    = useState<Set<string>>(new Set())
  const [bulkStage,      setBulkStage]      = useState('')
  const [bulkLoading,    setBulkLoading]    = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [r, rr] = await Promise.all([
        fetch(`${API}/pipeline/treatment`,   { headers: authH as any }),
        fetch(`${API}/pipeline/needs-review`, { headers: authH as any }),
      ])
      const d  = await r.json()
      const dr = await rr.json()
      setPlans(Array.isArray(d.plans) ? d.plans : [])
      setMetrics(d.metrics ?? null)
      if (!dr.error) setNeedsReview(dr)
    } catch { /* silent */ }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // ── Drag handlers ──────────────────────────────────────────────────────────

  const handleDragStart = (e: React.DragEvent, planId: string) => {
    setDragId(planId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('planId', planId)
  }

  const handleDragEnd = () => { setDragId(null); setDropOver(null) }

  // Move via modal (touch fallback)
  async function handleMove(planId: string, targetStage: string) {
    const plan = plans.find(p => p.id === planId)
    if (!plan || plan.stage === targetStage) { setMovePlan(null); return }

    // Optimistic update
    setPlans(prev => prev.map(p => p.id === planId ? { ...p, stage: targetStage } : p))
    setMovePlan(null)

    try {
      await fetch(`${API}/pipeline/treatment/${planId}/stage`, {
        method:  'PATCH',
        headers: authH as any,
        body:    JSON.stringify({ stage: targetStage }),
      })
    } catch {
      // Revert on failure
      setPlans(prev => prev.map(p => p.id === planId ? { ...p, stage: plan.stage } : p))
    }
  }

  const handleDragOver = (e: React.DragEvent, stageId: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropOver(stageId)
  }

  const handleDrop = async (e: React.DragEvent, targetStage: string) => {
    e.preventDefault()
    const planId = e.dataTransfer.getData('planId') || dragId
    setDragId(null)
    setDropOver(null)
    if (!planId) return

    const plan = plans.find(p => p.id === planId)
    if (!plan || plan.stage === targetStage) return

    // Optimistic update
    setPlans(prev => prev.map(p => p.id === planId ? { ...p, stage: targetStage } : p))

    try {
      await fetch(`${API}/pipeline/treatment/${planId}/stage`, {
        method:  'PATCH',
        headers: authH as any,
        body:    JSON.stringify({ stage: targetStage }),
      })
    } catch {
      // Revert on failure
      setPlans(prev => prev.map(p => p.id === planId ? { ...p, stage: plan.stage } : p))
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

  async function handleBulkStage(stage: string) {
    if (!stage || selectedIds.size === 0) return
    setBulkLoading(true)
    const ids = Array.from(selectedIds)
    setPlans(prev => prev.map(p => ids.includes(p.id) ? { ...p, stage } : p))
    setSelectedIds(new Set())
    try {
      await fetch(`${API}/pipeline/treatment/bulk`, {
        method:  'PATCH',
        headers: authH as any,
        body:    JSON.stringify({ ids, stage }),
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

  const plansByStage = (stageId: string) => plans.filter(p => p.stage === stageId)
  const stageTotal   = (stageId: string) => plansByStage(stageId).reduce((s, p) => s + p.value, 0)

  return (
    <div className="flex flex-col h-full gap-5">

      {/* ── Metrics strip ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 flex-shrink-0">
        <MetricCard
          label="Presented This Month"
          value={metrics ? fmtUGX(metrics.totalPresentedMonth) : '—'}
          sub="Total treatment value presented"
          icon={<TrendingUp size={18} />}
          color="#1A237E"
          loading={loading}
        />
        <MetricCard
          label="Accepted Value"
          value={metrics ? fmtUGX(metrics.totalAccepted) : '—'}
          sub={metrics ? `${metrics.conversionRate}% conversion rate` : 'of presented value'}
          icon={<CheckCircle2 size={18} />}
          color="#065F46"
          loading={loading}
        />
        <MetricCard
          label="Money at Risk"
          value={metrics ? fmtUGX(metrics.moneyAtRisk) : '—'}
          sub="Accepted but not yet scheduled"
          icon={<AlertTriangle size={18} />}
          color="#92400E"
          loading={loading}
          highlight={!!metrics && metrics.moneyAtRisk > 0}
        />
        <MetricCard
          label="Avg Days to Schedule"
          value={metrics ? `${metrics.avgDaysToSchedule}d` : '—'}
          sub="From presentation to scheduling"
          icon={<Clock size={18} />}
          color="#5B21B6"
          loading={loading}
        />
      </div>

      {/* ── Needs Review section ──────────────────────────────────────── */}
      {needsReview && needsReview.total > 0 && (
        <NeedsReviewSection
          data={needsReview}
          open={reviewOpen}
          onToggle={() => setReviewOpen(v => !v)}
          onAction={handleReviewAction}
          onNavigate={(patientId) => router.push(`/scheduling?patientId=${patientId}`)}
        />
      )}

      {/* ── Bulk action toolbar ────────────────────────────────────────── */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 bg-white border border-gray-200 rounded-2xl shadow-lg flex-shrink-0">
          <span className="text-sm font-bold text-gray-700">{selectedIds.size} plan{selectedIds.size !== 1 ? 's' : ''} selected</span>
          <div className="flex items-center gap-2 flex-1">
            <select
              value={bulkStage}
              onChange={e => setBulkStage(e.target.value)}
              className="text-xs px-2.5 py-1.5 border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-clinic-blue/20"
            >
              <option value="">Move to stage…</option>
              {STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <button
              disabled={!bulkStage || bulkLoading}
              onClick={() => handleBulkStage(bulkStage)}
              className="text-xs font-bold px-3 py-1.5 rounded-lg text-white disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}
            >
              {bulkLoading ? '…' : 'Apply'}
            </button>
            <button
              onClick={() => handleBulkStage('Completed')}
              disabled={bulkLoading}
              className="text-xs font-bold px-3 py-1.5 rounded-lg bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition-colors disabled:opacity-40"
            >
              <CheckCircle2 size={11} className="inline mr-1" />Complete
            </button>
            <button
              onClick={handleBulkDelete}
              disabled={bulkLoading}
              className="text-xs font-bold px-3 py-1.5 rounded-lg bg-red-100 text-red-600 hover:bg-red-200 transition-colors disabled:opacity-40 ml-auto"
            >
              <Trash2 size={11} className="inline mr-1" />Delete
            </button>
          </div>
          <button onClick={() => setSelectedIds(new Set())} className="text-gray-400 hover:text-gray-600">
            <X size={16} />
          </button>
        </div>
      )}

      {/* ── Kanban board ──────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-gray-400 gap-2">
          <RefreshCw size={18} className="animate-spin" />
          <span className="text-sm">Loading pipeline...</span>
        </div>
      ) : plans.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
          <Kanban size={40} className="mb-3 opacity-25" />
          <p className="text-sm font-semibold">No treatment plans yet</p>
          <p className="text-xs mt-1 text-gray-300">Plans appear here once added from a patient's clinical tab</p>
        </div>
      ) : (
        <div
          className="flex-1 overflow-x-auto pb-4 -mx-1 px-1 scrollbar-hide"
          style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
        >
          <div className="flex flex-col sm:flex-row gap-3 sm:h-full">
            {STAGES.map(stage => {
              const stagePlans = plansByStage(stage.id)
              const total      = stageTotal(stage.id)
              const isOver     = dropOver === stage.id

              return (
                <div
                  key={stage.id}
                  className="flex flex-col rounded-2xl overflow-hidden w-full sm:flex-shrink-0 sm:w-[280px] transition-all duration-150"
                  style={{
                    background: isOver ? '#F0F9FF' : '#F9FAFB',
                    border:    `1px solid ${isOver ? '#BAE6FD' : '#E5E7EB'}`,
                    boxShadow: isOver ? '0 0 0 2px #29ABE2' : 'none',
                  }}
                  onDragOver={e  => handleDragOver(e, stage.id)}
                  onDragLeave={() => setDropOver(null)}
                  onDrop={e      => handleDrop(e, stage.id)}
                >
                  {/* Column header */}
                  <div
                    className="px-3 py-2.5 flex items-center justify-between flex-shrink-0"
                    style={{ background: stage.headerBg }}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ background: stage.headerColor }}
                      />
                      <span
                        className="text-xs font-bold truncate"
                        style={{ color: stage.headerColor }}
                      >
                        {stage.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {total > 0 && (
                        <span
                          className="text-[10px] font-bold px-1.5 py-0.5 rounded-md"
                          style={{ background: stage.headerColor + '18', color: stage.headerColor }}
                        >
                          {fmtUGX(total)}
                        </span>
                      )}
                      <span
                        className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black"
                        style={{ background: stage.headerColor, color: 'white' }}
                      >
                        {stagePlans.length}
                      </span>
                    </div>
                  </div>

                  {/* Cards */}
                  <div className="sm:flex-1 sm:overflow-y-auto p-2 space-y-2">
                    {stagePlans.length === 0 && (
                      <div
                        className="h-16 rounded-xl border-2 border-dashed flex items-center justify-center text-xs text-gray-300"
                        style={{ borderColor: isOver ? '#29ABE2' : '#E5E7EB' }}
                      >
                        Drop here
                      </div>
                    )}
                    {stagePlans.map(plan => (
                      <PlanCard
                        key={plan.id}
                        plan={plan}
                        isDragging={dragId === plan.id}
                        isSelected={selectedIds.has(plan.id)}
                        onDragStart={handleDragStart}
                        onDragEnd={handleDragEnd}
                        onMove={() => setMovePlan(plan)}
                        onToggleSelect={() => toggleSelect(plan.id)}
                      />
                    ))}
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
  isDragging,
  isSelected,
  onDragStart,
  onDragEnd,
  onMove,
  onToggleSelect,
}: {
  plan:           Plan
  isDragging:     boolean
  isSelected:     boolean
  onDragStart:    (e: React.DragEvent, id: string) => void
  onDragEnd:      () => void
  onMove:         () => void
  onToggleSelect: () => void
}) {
  const [showHistory, setShowHistory] = useState(false)
  const borderColor = urgencyBorderColor(plan.daysSince, plan.stage)
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
      className="bg-white rounded-xl p-3 select-none transition-all duration-150"
      style={{
        boxShadow:   isDragging
          ? '0 8px 20px rgba(0,0,0,0.15)'
          : isSelected
          ? '0 0 0 2px #29ABE2'
          : '0 1px 3px rgba(0,0,0,0.06)',
        opacity:     isDragging ? 0.6 : 1,
        cursor:      'grab',
        border:      `1px solid ${isSelected ? '#BAE6FD' : '#F3F4F6'}`,
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
          <p className="text-sm font-bold text-gray-900 leading-tight truncate">
            {plan.patient.firstName} {plan.patient.lastName}
          </p>
          <span className="text-[10px] font-mono text-gray-400 flex-shrink-0 mt-0.5">
            {fmtCC(plan.patient.patientNumber)}
          </span>
        </div>
      </div>

      {/* Treatment */}
      <p className="text-[11px] text-gray-600 truncate leading-tight pl-5">
        {plan.treatmentName}
        {plan.toothNumber && (
          <span className="text-gray-400"> · Tooth {plan.toothNumber}</span>
        )}
      </p>

      {/* Value */}
      <p className="text-sm font-bold mt-1.5 mb-1 pl-5" style={{ color: '#1A237E' }}>
        {fmtUGX(plan.value)}
      </p>

      {/* Doctor + days + actions */}
      <div className="flex items-center justify-between gap-1 pl-5">
        <p className="text-[10px] text-gray-400 truncate flex-1">{plan.doctorName}</p>
        <span className={`text-[10px] font-semibold flex-shrink-0 ${urgentText}`}>
          {plan.daysSince}d
        </span>
        <button
          onClick={e => { e.stopPropagation(); setShowHistory(v => !v) }}
          onDragStart={e => e.stopPropagation()}
          className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-semibold text-gray-400 hover:text-purple-500 hover:bg-purple-50 transition-colors flex-shrink-0"
          title="Stage history"
        >
          <History size={10} />
        </button>
        <button
          onClick={e => { e.stopPropagation(); onMove() }}
          onDragStart={e => e.stopPropagation()}
          className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-semibold text-gray-400 hover:text-clinic-blue hover:bg-blue-50 transition-colors flex-shrink-0"
          title="Move to another stage"
        >
          <ArrowLeftRight size={10} />
          <span className="hidden sm:inline">Move</span>
        </button>
      </div>

      {/* Stage history timeline */}
      {showHistory && (
        <div className="mt-2 pt-2 border-t border-gray-100 pl-5 space-y-1">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-gray-300 flex-shrink-0" />
            <span className="text-[10px] text-gray-400">Entered pipeline: <span className="font-semibold text-gray-600">{fmt(plan.createdAt)}</span></span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 flex-shrink-0" />
            <span className="text-[10px] text-gray-400">Last updated: <span className="font-semibold text-gray-600">{fmt(plan.updatedAt)}</span></span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
            <span className="text-[10px] text-gray-400">Current stage: <span className="font-semibold text-blue-600">{plan.stage}</span></span>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Move modal (touch / keyboard fallback) ────────────────────────────────────

function MoveModal({
  plan,
  onMove,
  onClose,
}: {
  plan:    Plan
  onMove:  (planId: string, stage: string) => void
  onClose: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden animate-fade-in"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-4 pt-4 pb-3 border-b border-gray-100">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-gray-900">Move to stage</p>
            <p className="text-xs text-gray-500 truncate mt-0.5">
              {plan.patient.firstName} {plan.patient.lastName} · {plan.treatmentName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="ml-3 w-7 h-7 flex items-center justify-center rounded-xl text-gray-400 hover:bg-gray-100 transition-colors flex-shrink-0"
          >
            <X size={14} />
          </button>
        </div>

        {/* Stage list */}
        <div className="p-3 space-y-1 max-h-[60vh] overflow-y-auto">
          {STAGES.filter(s => s.id !== plan.stage).map(stage => (
            <button
              key={stage.id}
              onClick={() => onMove(plan.id, stage.id)}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-gray-50 active:bg-gray-100 transition-colors text-left"
            >
              <span
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ background: stage.headerColor }}
              />
              <span className="text-sm font-medium text-gray-700">{stage.label}</span>
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
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-amber-100/60 last:border-0 hover:bg-amber-50/30 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-bold text-gray-800 truncate">{plan.patientName}</span>
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">{plan.stage}</span>
          <span className="text-[10px] font-semibold text-red-500">{plan.daysSince}d</span>
        </div>
        <div className="text-[11px] text-gray-500 mt-0.5">
          {plan.treatmentName} · {fmtUGX(plan.value)}
          {plan.lastApptDate && <span className="ml-2 text-gray-400">Last visit: {fmt(plan.lastApptDate)}</span>}
        </div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {type === 'stuck' && (
          <button
            onClick={() => onAction(plan.id, 'complete')}
            className="text-[10px] font-bold px-2 py-1 rounded-lg bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition-colors"
            title="Mark Completed"
          >
            <CheckCircle2 size={11} className="inline mr-0.5" />Done
          </button>
        )}
        <button
          onClick={() => onAction(plan.id, 'decline')}
          className="text-[10px] font-bold px-2 py-1 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
          title="Mark Declined"
        >
          Decline
        </button>
        <button
          onClick={() => onNavigate(plan.patientId)}
          className="text-[10px] font-bold px-2 py-1 rounded-lg bg-blue-100 text-blue-700 hover:bg-blue-200 transition-colors"
          title="Book Follow-up"
        >
          <CalendarPlus size={11} className="inline mr-0.5" />Book
        </button>
        <button
          onClick={() => onAction(plan.id, 'remove')}
          className="p-1 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
          title="Remove from pipeline"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  )

  return (
    <div className="rounded-2xl border border-amber-200 overflow-hidden flex-shrink-0"
      style={{ background: 'linear-gradient(135deg,#FFFBEB,#FEF3C7)' }}>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-amber-50/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <AlertTriangle size={15} className="text-amber-600" />
          <span className="text-sm font-bold text-amber-800">Needs Review</span>
          <span className="text-xs font-black px-2 py-0.5 rounded-full bg-amber-500 text-white">
            {data.total}
          </span>
          <span className="text-xs text-amber-600">
            {data.consultOnly.length > 0 && `${data.consultOnly.length} consulted >60d`}
            {data.consultOnly.length > 0 && data.stuckPlans.length > 0 && ' · '}
            {data.stuckPlans.length > 0 && `${data.stuckPlans.length} stuck >90d`}
          </span>
        </div>
        {open ? <ChevronUp size={15} className="text-amber-600" /> : <ChevronDown size={15} className="text-amber-600" />}
      </button>

      {open && (
        <div className="bg-white border-t border-amber-200">
          {data.consultOnly.length > 0 && (
            <>
              <div className="px-4 py-1.5 bg-gray-50 border-b border-gray-100">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Consulted — no follow-up ({data.consultOnly.length})</p>
              </div>
              {data.consultOnly.map(p => <ReviewRow key={p.id} plan={p} type="consult" />)}
            </>
          )}
          {data.stuckPlans.length > 0 && (
            <>
              <div className="px-4 py-1.5 bg-gray-50 border-b border-gray-100">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Stuck / Accepted — not progressing ({data.stuckPlans.length})</p>
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
  label, value, sub, icon, color, loading, highlight,
}: {
  label:      string
  value:      string
  sub:        string
  icon:       React.ReactNode
  color:      string
  loading:    boolean
  highlight?: boolean
}) {
  return (
    <div
      className="bg-white rounded-2xl p-4 border transition-all duration-150"
      style={{
        borderColor: highlight ? '#FCA5A5' : '#F3F4F6',
        boxShadow:   highlight ? '0 0 0 2px #FCA5A5' : '0 1px 3px rgba(0,0,0,0.05)',
      }}
    >
      <div className="flex items-start justify-between mb-2">
        <p className="text-[10px] font-black uppercase tracking-[0.15em] text-gray-400">{label}</p>
        <span style={{ color }}>{icon}</span>
      </div>
      {loading ? (
        <div className="h-7 w-24 bg-gray-100 rounded-lg animate-pulse" />
      ) : (
        <p className="text-xl font-black" style={{ color }}>{value}</p>
      )}
      <p className="text-[11px] text-gray-400 mt-1">{sub}</p>
    </div>
  )
}
