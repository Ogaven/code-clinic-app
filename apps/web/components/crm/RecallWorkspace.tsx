'use client'

// CRM Automation — Recall (Patient Engagement). Reads Patient.recallStatus,
// computed daily by the existing patient-tags derivation job — this page
// does not compute anything itself and never activates the (DRAFT) recall
// messaging sequences from the prior milestone.

import { useEffect, useState } from 'react'
import { CalendarClock, Info, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

interface RecallPatient { id: string; firstName: string; lastName: string; phone: string; recallInterval: string | null; estimated: boolean; lastCompletedAt: string | null; dueAt: string | null }
interface RecallBucket { key: string; label: string; count: number; patients: RecallPatient[] }

const BUCKET_TONE: Record<string, string> = {
  DUE: 'bg-blue-50 text-blue-700 dark:bg-blue-400/15 dark:text-blue-300',
  OVERDUE_30: 'bg-amber-50 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300',
  OVERDUE_90: 'bg-orange-50 text-orange-700 dark:bg-orange-400/15 dark:text-orange-300',
  OVERDUE_180_PLUS: 'bg-red-50 text-red-600 dark:bg-red-400/15 dark:text-red-300',
}

export default function RecallWorkspace({ patientHref }: { patientHref: (id: string) => string }) {
  const [buckets, setBuckets] = useState<RecallBucket[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>('OVERDUE_180_PLUS')
  const [refreshKey, setRefreshKey] = useState(0)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
    fetch('/api-proxy/crm-automation/patient-engagement/recall', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) { setBuckets(d.buckets); setUpdatedAt(new Date()) } })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [refreshKey])

  const dueCount = buckets?.reduce((total, bucket) => total + bucket.count, 0) ?? 0
  const estimatedCount = buckets?.reduce((total, bucket) => total + bucket.patients.filter(patient => patient.estimated).length, 0) ?? 0

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-extrabold text-gray-800 dark:text-white flex items-center gap-2"><CalendarClock size={20} className="text-blue-500" /> Recall</h1>
        <p className="text-sm text-gray-500 dark:text-white/50">Daily staff worklist of patients due or overdue for recall. Review each patient's clinical history and recall eligibility before contacting them.</p>
      </div>

      <p className="flex items-start gap-1.5 text-[11px] text-gray-400 dark:text-white/30">
        <Info size={13} className="mt-0.5 flex-shrink-0" />
        This is a status view, not a messaging tool — no reminder is sent from this page. Patients tagged "ESTIMATED" have no confirmed recall interval on file; their status is a read-time estimate from their last completed visit against a default 6-month cadence, not a precise figure.
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3 dark:border-blue-400/20 dark:bg-blue-400/5">
        <div>
          <p className="text-sm font-bold text-gray-800 dark:text-white">Today's recall review worklist: {dueCount} patients</p>
          <p className="text-xs text-gray-500 dark:text-white/50">{estimatedCount} estimated dates require staff confirmation. Internal review only — no messages are sent automatically.{updatedAt ? ` Last refreshed ${updatedAt.toLocaleTimeString('en-GB', { timeZone: 'Africa/Kampala', hour: '2-digit', minute: '2-digit' })} EAT.` : ''}</p>
        </div>
        <button type="button" disabled={loading} onClick={() => { setLoading(true); setRefreshKey(key => key + 1) }} className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700 disabled:opacity-50 dark:border-blue-400/20 dark:bg-white/10 dark:text-blue-300"><RefreshCw size={13} /> Refresh worklist</button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400 dark:text-white/40">Loading…</p>
      ) : !buckets || buckets.every(b => b.count === 0) ? (
        <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 p-10 text-center">
          <p className="text-sm text-gray-400 dark:text-white/40">No patients are currently due or overdue for recall.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {buckets.map(b => (
            <div key={b.key} className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 p-4">
              <span className={cn('inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold', BUCKET_TONE[b.key])}>{b.label}</span>
              <p className="mt-2 text-2xl font-black text-gray-800 dark:text-white">{b.count}</p>
            </div>
          ))}
        </div>
      )}

      {buckets && buckets.map(b => b.count > 0 && (
        <div key={b.key} className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 overflow-hidden">
          <button onClick={() => setExpanded(v => v === b.key ? null : b.key)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-white/5">
            <span className="text-sm font-bold text-gray-800 dark:text-white">{b.label} ({b.count})</span>
            <span className="text-xs text-gray-400">{expanded === b.key ? 'Hide' : 'Show'}</span>
          </button>
          {expanded === b.key && (
            <div className="divide-y divide-gray-50 dark:divide-white/5">
              {b.patients.map(p => (
                <a key={p.id} href={patientHref(p.id)} className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-gray-50 dark:hover:bg-white/5">
                  <span className="font-semibold text-gray-700 dark:text-white/80 flex items-center gap-1.5">
                    {p.firstName} {p.lastName}
                    {p.estimated && (
                      <span title="No recall interval set — estimated from a default 6-month checkup cadence against their last completed appointment." className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/50">ESTIMATED</span>
                    )}
                  </span>
                  <span className="text-xs text-gray-400">{p.phone}{p.recallInterval ? ` · ${p.recallInterval.replace('_', ' ').toLowerCase()}` : ''}{p.dueAt ? ` · Recall due ${new Date(p.dueAt).toLocaleDateString('en-GB', { timeZone: 'Africa/Kampala', day: '2-digit', month: 'short', year: 'numeric' })}` : ''}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
