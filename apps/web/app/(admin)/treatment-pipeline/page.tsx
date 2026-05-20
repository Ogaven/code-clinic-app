'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, TrendingUp, AlertTriangle, Clock, CheckCircle2, Kanban } from 'lucide-react'

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
  const API   = '/api-proxy'
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const authH = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  const [plans,    setPlans]    = useState<Plan[]>([])
  const [metrics,  setMetrics]  = useState<Metrics | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [dragId,   setDragId]   = useState<string | null>(null)
  const [dropOver, setDropOver] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`${API}/pipeline/treatment`, { headers: authH as any })
      const d = await r.json()
      setPlans(Array.isArray(d.plans) ? d.plans : [])
      setMetrics(d.metrics ?? null)
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

  // ── Render ─────────────────────────────────────────────────────────────────

  const plansByStage = (stageId: string) => plans.filter(p => p.stage === stageId)
  const stageTotal   = (stageId: string) => plansByStage(stageId).reduce((s, p) => s + p.value, 0)

  return (
    <div className="flex flex-col h-full gap-5">

      {/* ── Metrics strip ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 flex-shrink-0">
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
        <div className="flex-1 overflow-x-auto pb-4 -mx-1 px-1">
          <div className="flex gap-3 h-full" style={{ minWidth: `${STAGES.length * 292}px` }}>
            {STAGES.map(stage => {
              const stagePlans = plansByStage(stage.id)
              const total      = stageTotal(stage.id)
              const isOver     = dropOver === stage.id

              return (
                <div
                  key={stage.id}
                  className="flex flex-col rounded-2xl overflow-hidden flex-shrink-0 transition-all duration-150"
                  style={{
                    width:     280,
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
                  <div className="flex-1 overflow-y-auto p-2 space-y-2">
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
                        onDragStart={handleDragStart}
                        onDragEnd={handleDragEnd}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Plan card ─────────────────────────────────────────────────────────────────

function PlanCard({
  plan,
  isDragging,
  onDragStart,
  onDragEnd,
}: {
  plan:        Plan
  isDragging:  boolean
  onDragStart: (e: React.DragEvent, id: string) => void
  onDragEnd:   () => void
}) {
  const borderColor = urgencyBorderColor(plan.daysSince, plan.stage)
  const urgentText  = plan.daysSince > 14
    ? 'text-red-500'
    : plan.daysSince > 7
    ? 'text-amber-500'
    : 'text-gray-400'

  return (
    <div
      draggable
      onDragStart={e => onDragStart(e, plan.id)}
      onDragEnd={onDragEnd}
      className="bg-white rounded-xl p-3 select-none transition-all duration-150"
      style={{
        borderLeft:  `3px solid ${borderColor}`,
        boxShadow:   isDragging
          ? '0 8px 20px rgba(0,0,0,0.15)'
          : '0 1px 3px rgba(0,0,0,0.06)',
        opacity:     isDragging ? 0.6 : 1,
        cursor:      'grab',
        border:      `1px solid #F3F4F6`,
        borderLeft:  `3px solid ${borderColor}`,
      }}
    >
      {/* Patient */}
      <div className="flex items-start justify-between gap-1 mb-1">
        <p className="text-xs font-bold text-gray-900 leading-tight">
          {plan.patient.firstName} {plan.patient.lastName}
        </p>
        <span className="text-[10px] font-mono text-gray-400 flex-shrink-0">
          {fmtCC(plan.patient.patientNumber)}
        </span>
      </div>

      {/* Treatment */}
      <p className="text-[11px] text-gray-600 truncate leading-tight">
        {plan.treatmentName}
        {plan.toothNumber && (
          <span className="text-gray-400"> · Tooth {plan.toothNumber}</span>
        )}
      </p>

      {/* Value */}
      <p className="text-sm font-bold mt-1.5 mb-1" style={{ color: '#1A237E' }}>
        {fmtUGX(plan.value)}
      </p>

      {/* Doctor + age */}
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-gray-400 truncate flex-1">{plan.doctorName}</p>
        <span className={`text-[10px] font-semibold flex-shrink-0 ml-1 ${urgentText}`}>
          {plan.daysSince}d
        </span>
      </div>
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
