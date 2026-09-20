'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Types ────────────────────────────────────────────────────────
interface AttentionItem {
  id?: string
  patientId?: string
  name?: string | null
  firstName?: string
  lastName?: string
  phone?: string | null
  patient?: { firstName: string; lastName: string; phone: string | null } | null
  createdAt?: string
  updatedAt?: string
  startAt?: string
  slaState?: string | null
}

interface AttentionCategory {
  key: string
  label: string
  scope: 'LEAD_OWNER' | 'CLINIC_WIDE'
  count: number
  items: AttentionItem[]
}

interface AttentionResult {
  generatedAt: string
  ownerId: string | null
  totalItems: number
  categories: AttentionCategory[]
}

const CATEGORY_TONE: Record<string, string> = {
  UNANSWERED_NEW:        'bg-blue-50 text-blue-700 dark:bg-blue-400/15 dark:text-blue-300',
  OVERDUE_FOLLOWUP:      'bg-red-50 text-red-600 dark:bg-red-400/15 dark:text-red-300',
  STALE_UNTOUCHED:       'bg-amber-50 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300',
  QUALIFIED_UNBOOKED:    'bg-cyan-50 text-cyan-700 dark:bg-cyan-400/15 dark:text-cyan-300',
  UNASSIGNED:            'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-white/60',
  NO_SHOW:               'bg-orange-50 text-orange-700 dark:bg-orange-400/15 dark:text-orange-300',
  CANCELLED_UNREBOOKED:  'bg-purple-50 text-purple-700 dark:bg-purple-400/15 dark:text-purple-300',
  TREATMENT_OPPORTUNITY: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300',
}

function itemLabel(item: AttentionItem): string {
  const patient = item.patient
  if (patient) return `${patient.firstName} ${patient.lastName}`.trim() || patient.phone || 'Patient'
  if (item.firstName || item.lastName) return `${item.firstName ?? ''} ${item.lastName ?? ''}`.trim()
  return item.name || item.phone || 'Unknown'
}

function itemPhone(item: AttentionItem): string | null {
  return item.phone ?? item.patient?.phone ?? null
}

function itemAge(item: AttentionItem): string {
  const ts = item.createdAt || item.updatedAt || item.startAt
  if (!ts) return ''
  const ms = Date.now() - new Date(ts).getTime()
  const hours = Math.floor(ms / 3_600_000)
  if (hours < 1) return '<1h'
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

// Scoped to ADMIN/RECEPTIONIST leads pages only — reads GET
// /crm-automation/needs-attention, gated adminAndReceptionist server-side.
export default function NeedsAttentionPanel({ ownerId, onSelectLead, emptyState }: { ownerId?: string | null; onSelectLead?: (leadId: string) => void; emptyState?: React.ReactNode }) {
  const [data,    setData]    = useState<AttentionResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)

  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const authH = { Authorization: `Bearer ${token}` }
  const API   = '/api-proxy'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (ownerId) params.set('ownerId', ownerId)
      const r = await fetch(`${API}/crm-automation/needs-attention?${params}`, { headers: authH as any })
      setData(r.ok ? await r.json() : null)
    } catch { setData(null) }
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId, token])

  useEffect(() => { load() }, [load])

  if (loading && !data) {
    return <div className="rounded-2xl border border-gray-200 dark:border-white/10 p-4 text-sm text-gray-400 dark:text-white/40">Loading needs-attention queue…</div>
  }
  if (!data || data.totalItems === 0) return emptyState ?? null

  const active = data.categories.filter(c => c.count > 0)

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#152040] overflow-hidden mb-4">
      <button
        onClick={() => setCollapsed(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <AlertCircle size={16} className="text-amber-500" />
          <span className="text-sm font-bold text-gray-800 dark:text-white">Needs Attention</span>
          <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300">
            {data.totalItems}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={e => { e.stopPropagation(); load() }}
            className="p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-white/70 transition-colors"
            title="Refresh"
          >
            <RefreshCw size={13} />
          </button>
          {collapsed ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronUp size={16} className="text-gray-400" />}
        </div>
      </button>

      {!collapsed && (
        <div className="px-4 pb-4 space-y-2">
          {active.map(cat => (
            <div key={cat.key} className="border border-gray-100 dark:border-white/5 rounded-xl overflow-hidden">
              <button
                onClick={() => setExpanded(v => v === cat.key ? null : cat.key)}
                className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-bold', CATEGORY_TONE[cat.key] ?? 'bg-gray-100 text-gray-600')}>
                    {cat.count}
                  </span>
                  <span className="text-xs font-semibold text-gray-700 dark:text-white/80">{cat.label}</span>
                  {cat.scope === 'CLINIC_WIDE' && (
                    <span className="text-[10px] text-gray-400 dark:text-white/30">clinic-wide</span>
                  )}
                </div>
                {expanded === cat.key ? <ChevronUp size={13} className="text-gray-400" /> : <ChevronDown size={13} className="text-gray-400" />}
              </button>
              {expanded === cat.key && (
                <div className="border-t border-gray-100 dark:border-white/5 divide-y divide-gray-50 dark:divide-white/5 max-h-64 overflow-y-auto">
                  {cat.items.slice(0, 50).map((item, i) => {
                    const clickable = !!(item.id && onSelectLead)
                    const Tag = clickable ? 'button' : 'div'
                    return (
                      <Tag
                        key={item.id ?? item.patientId ?? i}
                        onClick={clickable ? () => onSelectLead!(item.id!) : undefined}
                        className={cn(
                          'w-full flex items-center justify-between px-3 py-2 text-left transition-colors',
                          clickable && 'hover:bg-gray-50 dark:hover:bg-white/5',
                        )}
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-gray-700 dark:text-white/80 truncate">{itemLabel(item)}</div>
                          {itemPhone(item) && <div className="text-[10px] text-gray-400 dark:text-white/40">{itemPhone(item)}</div>}
                        </div>
                        <span className="text-[10px] text-gray-400 dark:text-white/30 flex-shrink-0 ml-2">{itemAge(item)}</span>
                      </Tag>
                    )
                  })}
                  {cat.items.length > 50 && (
                    <div className="px-3 py-2 text-[11px] text-gray-400 dark:text-white/40">+{cat.items.length - 50} more</div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
