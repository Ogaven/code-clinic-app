'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { MessageCircle, Search, User as UserIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Real staff work queue for CRM > Leads > Needs Attention ────────────────
// Replaces the old NeedsAttentionPanel accordion (still used, unchanged, as
// the compact Dashboard widget — see components/leads/NeedsAttentionPanel.tsx)
// with a filterable, searchable, action-oriented list. Reads the same
// GET /crm-automation/needs-attention endpoint; the entityKind/hasConversation/
// ownerName/patientId fields it reads were added to that endpoint specifically
// to support this page (see needs-attention.service.ts).
interface AttentionItem {
  id?: string
  patientId?: string | null
  name?: string | null
  firstName?: string
  lastName?: string
  phone?: string | null
  patient?: { firstName: string; lastName: string; phone: string | null } | null
  createdAt?: string
  updatedAt?: string
  startAt?: string
  source?: string | null
  ownerName?: string | null
  hasConversation?: boolean
}

interface AttentionCategory {
  key: string
  label: string
  scope: 'LEAD_OWNER' | 'CLINIC_WIDE'
  entityKind: 'LEAD' | 'APPOINTMENT' | 'PATIENT'
  count: number
  items: AttentionItem[]
}

interface AttentionResult {
  distinctLeadCount: number
  distinctPeopleCount: number
  categories: AttentionCategory[]
}

type TabKey = 'ALL' | 'LEAD' | 'APPOINTMENT' | 'PATIENT'
// No "Recall" tab: recall-overdue patients already have their own dedicated
// CRM > Patient Engagement > Recall workspace, and this endpoint's backend
// (needs-attention.service.ts) deliberately does not feed recall data into
// this queue — only showing tabs actually backed by real data here.
const TABS: { key: TabKey; label: string }[] = [
  { key: 'ALL',         label: 'All' },
  { key: 'LEAD',        label: 'Leads' },
  { key: 'APPOINTMENT', label: 'Appointments' },
  { key: 'PATIENT',     label: 'Treatments' },
]

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

export default function NeedsAttentionWorkspace({
  leadsHref, patientHref, inboxHref,
}: {
  leadsHref: string
  patientHref: (id: string) => string
  inboxHref: (phone: string) => string
}) {
  const [data, setData]       = useState<AttentionResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab]         = useState<TabKey>('ALL')
  const [query, setQuery]     = useState('')

  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const authH = { Authorization: `Bearer ${token}` }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api-proxy/crm-automation/needs-attention', { headers: authH as any })
      setData(r.ok ? await r.json() : null)
    } catch { setData(null) }
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  useEffect(() => { load() }, [load])

  const totalAttentionItems = useMemo(
    () => data ? data.categories.reduce((sum, c) => sum + c.count, 0) : 0,
    [data]
  )

  const rows = useMemo(() => {
    if (!data) return []
    const q = query.trim().toLowerCase()
    return data.categories
      .filter(c => c.count > 0 && (tab === 'ALL' || c.entityKind === tab))
      .flatMap(cat => cat.items.map(item => ({ item, cat })))
      .filter(({ item }) => {
        if (!q) return true
        return itemLabel(item).toLowerCase().includes(q) || (itemPhone(item) ?? '').toLowerCase().includes(q)
      })
  }, [data, tab, query])

  if (loading && !data) {
    return <div className="rounded-2xl border border-gray-200 dark:border-white/10 p-6 text-sm text-gray-400 dark:text-white/40">Loading needs-attention queue…</div>
  }

  if (!data || totalAttentionItems === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 p-10 text-center">
        <p className="text-sm font-semibold text-gray-700 dark:text-white/80">Nothing needs attention right now.</p>
        <p className="text-xs text-gray-400 dark:text-white/40">New leads, overdue follow-ups, no-shows and treatment opportunities will show up here.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* KPI row — unique people vs. unique leads vs. raw item count, kept
          visibly distinct so the headline can never be misread as a lead
          total (see needs-attention.service.ts's distinctLeadCount/
          distinctPeopleCount doc comments for the exact semantics). */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#152040] p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-white/50">People needing attention</p>
          <p className="text-2xl font-extrabold text-gray-800 dark:text-white mt-1">{data.distinctPeopleCount}</p>
          <p className="text-[11px] text-gray-400 dark:text-white/40 mt-0.5">Unique leads + patients, deduplicated</p>
        </div>
        <div className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#152040] p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-white/50">Leads needing attention</p>
          <p className="text-2xl font-extrabold text-gray-800 dark:text-white mt-1">{data.distinctLeadCount}</p>
          <p className="text-[11px] text-gray-400 dark:text-white/40 mt-0.5">Unique leads only</p>
        </div>
        <div className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#152040] p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-white/50">Total attention items</p>
          <p className="text-2xl font-extrabold text-gray-800 dark:text-white mt-1">{totalAttentionItems}</p>
          <p className="text-[11px] text-gray-400 dark:text-white/40 mt-0.5">One person can have more than one reason</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border border-gray-200 dark:border-white/10 overflow-hidden">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'px-3 py-1.5 text-xs font-semibold transition-colors',
                tab === t.key
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-[#152040] text-gray-600 dark:text-white/60 hover:bg-gray-50 dark:hover:bg-white/5',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search name or phone…"
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#152040] text-gray-700 dark:text-white/80 placeholder:text-gray-400"
          />
        </div>
      </div>

      {/* Work queue */}
      <div className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#152040] overflow-hidden divide-y divide-gray-50 dark:divide-white/5">
        {rows.length === 0 && (
          <div className="p-6 text-center text-sm text-gray-400 dark:text-white/40">No items match this filter.</div>
        )}
        {rows.map(({ item, cat }, i) => {
          const phone = itemPhone(item)
          return (
            <div key={`${cat.key}-${item.id ?? item.patientId ?? i}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-gray-800 dark:text-white truncate">{itemLabel(item)}</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-white/60">{cat.label}</span>
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-[11px] text-gray-400 dark:text-white/40 flex-wrap">
                  {phone && <span>{phone}</span>}
                  {item.source && <span>· {item.source}</span>}
                  {item.ownerName && <span>· {item.ownerName}</span>}
                  <span>· {itemAge(item)}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Only ever shown when a real conversation already exists —
                    never fabricated, never starts a new one on click. */}
                {item.hasConversation && phone && (
                  <a
                    href={inboxHref(phone)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-blue-50 text-blue-700 dark:bg-blue-400/15 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-400/25"
                  >
                    <MessageCircle size={12} /> Open Chat
                  </a>
                )}
                {cat.entityKind === 'LEAD' && item.id ? (
                  <a
                    href={`${leadsHref}?open=${item.id}`}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-white/70 hover:bg-gray-200 dark:hover:bg-white/20"
                  >
                    View Lead
                  </a>
                ) : item.patientId ? (
                  <a
                    href={patientHref(item.patientId)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-white/70 hover:bg-gray-200 dark:hover:bg-white/20"
                  >
                    <UserIcon size={12} /> View Patient
                  </a>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
