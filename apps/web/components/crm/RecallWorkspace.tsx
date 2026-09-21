'use client'

// CRM Automation — Recall (Patient Engagement). Reads Patient.recallStatus,
// computed daily by the existing patient-tags derivation job — this page
// does not compute anything itself and never activates the (DRAFT) recall
// messaging sequences from the prior milestone.

import { useEffect, useState } from 'react'
import { CalendarClock, Info } from 'lucide-react'
import { cn } from '@/lib/utils'

interface RecallPatient { id: string; firstName: string; lastName: string; phone: string; recallInterval: string | null }
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

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
    fetch('/api-proxy/crm-automation/patient-engagement/recall', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setBuckets(d.buckets) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-extrabold text-gray-800 dark:text-white flex items-center gap-2"><CalendarClock size={20} className="text-blue-500" /> Recall</h1>
        <p className="text-sm text-gray-500 dark:text-white/50">Patients due or overdue for their next check-up, by recall interval.</p>
      </div>

      <p className="flex items-start gap-1.5 text-[11px] text-gray-400 dark:text-white/30">
        <Info size={13} className="mt-0.5 flex-shrink-0" />
        This is a status view, not a messaging tool — no reminder is sent from this page.
      </p>

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
                  <span className="font-semibold text-gray-700 dark:text-white/80">{p.firstName} {p.lastName}</span>
                  <span className="text-xs text-gray-400">{p.phone}{p.recallInterval ? ` · ${p.recallInterval.replace('_', ' ').toLowerCase()}` : ''}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
