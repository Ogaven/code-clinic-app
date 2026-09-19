'use client'

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Clock, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'

interface FollowUpItem {
  id: string
  title: string
  description: string | null
  dueAt: string | null
  status: string
  leadId: string
  leadName: string | null
  leadPhone: string | null
}
interface Summary {
  counts: { dueToday: number; overdue: number; upcoming: number; completed: number }
  dueToday: FollowUpItem[]
  overdue: FollowUpItem[]
  upcoming: FollowUpItem[]
  completed: FollowUpItem[]
}

const TABS: Array<{ key: keyof Summary['counts']; label: string; tone: string }> = [
  { key: 'dueToday', label: 'Due Today', tone: 'text-blue-600 dark:text-blue-300' },
  { key: 'overdue', label: 'Overdue', tone: 'text-red-600 dark:text-red-300' },
  { key: 'upcoming', label: 'Upcoming', tone: 'text-gray-600 dark:text-white/70' },
  { key: 'completed', label: 'Completed', tone: 'text-emerald-600 dark:text-emerald-300' },
]

function fmtDue(iso: string | null): string {
  if (!iso) return 'No due date'
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function FollowUpsWorkspace({ leadsHref }: { leadsHref: string }) {
  const [data, setData] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<keyof Summary['counts']>('dueToday')
  const [busyId, setBusyId] = useState<string | null>(null)

  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const authH = { Authorization: `Bearer ${token}` }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api-proxy/crm-automation/follow-ups', { headers: authH as any })
      setData(r.ok ? await r.json() : null)
    } catch { setData(null) }
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  useEffect(() => { load() }, [load])

  async function complete(id: string) {
    setBusyId(id)
    try {
      const r = await fetch(`/api-proxy/crm-automation/follow-ups/${id}/complete`, { method: 'POST', headers: authH as any })
      if (r.ok) load()
    } finally {
      setBusyId(null)
    }
  }

  const items = data ? data[tab] : []

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-extrabold text-gray-800 dark:text-white">Follow-ups</h1>
        <p className="text-sm text-gray-500 dark:text-white/50">Lead follow-up tasks created automatically on intake — nothing here is fabricated.</p>
      </div>

      <div className="flex gap-2 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={cn(
              'flex-shrink-0 rounded-xl border px-3 py-2 text-xs font-bold transition-colors',
              tab === t.key ? 'border-blue-500 bg-blue-50 dark:bg-blue-400/10' : 'border-gray-200 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/5',
            )}>
            <span className={t.tone}>{data ? data.counts[t.key] : '—'}</span>{' '}
            <span className="text-gray-600 dark:text-white/60">{t.label}</span>
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 divide-y divide-gray-50 dark:divide-white/5">
        {loading ? (
          <p className="p-6 text-sm text-gray-400 dark:text-white/40">Loading…</p>
        ) : items.length === 0 ? (
          <p className="p-6 text-sm text-gray-400 dark:text-white/40">Nothing here.</p>
        ) : items.map(item => (
          <div key={item.id} className="flex items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-800 dark:text-white truncate">{item.title}</p>
              <p className="text-xs text-gray-500 dark:text-white/50 truncate">
                {item.leadName || item.leadPhone || 'Unknown lead'} {item.leadPhone ? `· ${item.leadPhone}` : ''}
              </p>
              <p className="mt-0.5 flex items-center gap-1 text-[11px] text-gray-400 dark:text-white/30"><Clock size={11} /> {fmtDue(item.dueAt)}</p>
            </div>
            <div className="flex flex-shrink-0 items-center gap-2">
              <a href={`${leadsHref}?open=${item.leadId}`} className="rounded-lg p-2 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors" title="Open lead">
                <ExternalLink size={15} />
              </a>
              {item.status !== 'DONE' && (
                <button onClick={() => complete(item.id)} disabled={busyId === item.id}
                  className="flex items-center gap-1 rounded-lg bg-emerald-50 dark:bg-emerald-400/10 px-2.5 py-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-400/20 transition-colors disabled:opacity-50">
                  <CheckCircle2 size={13} /> Complete
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
