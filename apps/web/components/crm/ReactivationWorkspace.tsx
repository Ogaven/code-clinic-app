'use client'

// CRM Automation — Reactivation (Patient Engagement). Read-only view of
// disengaged patients: dormant by recall (180+ days overdue) or a repeat
// no-show/late-cancel pattern. Does NOT mass-enrol anyone into the (DRAFT)
// dormant-reactivation sequence from the prior milestone — activating that
// sequence is a separate, deliberate admin action requiring approved copy.

import { useEffect, useState } from 'react'
import { RotateCcw, Info } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Candidate {
  id: string; firstName: string; lastName: string; phone: string
  reason: 'DORMANT_180_PLUS' | 'REPEATED_NO_SHOW'; recallStatus: string; noShowCount: number; lateCancelCount: number
}

const REASON_LABEL: Record<string, string> = { DORMANT_180_PLUS: 'Dormant 180+ days', REPEATED_NO_SHOW: 'Repeated no-show / late-cancel' }
const REASON_TONE: Record<string, string> = {
  DORMANT_180_PLUS: 'bg-red-50 text-red-600 dark:bg-red-400/15 dark:text-red-300',
  REPEATED_NO_SHOW: 'bg-orange-50 text-orange-700 dark:bg-orange-400/15 dark:text-orange-300',
}

export default function ReactivationWorkspace({ patientHref }: { patientHref: (id: string) => string }) {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
    fetch('/api-proxy/crm-automation/patient-engagement/reactivation', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setCandidates(d) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-extrabold text-gray-800 dark:text-white flex items-center gap-2"><RotateCcw size={20} className="text-red-500" /> Reactivation</h1>
        <p className="text-sm text-gray-500 dark:text-white/50">Patients who have gone quiet — dormant on recall, or a repeated no-show/late-cancel pattern.</p>
      </div>

      <p className="flex items-start gap-1.5 text-[11px] text-gray-400 dark:text-white/30">
        <Info size={13} className="mt-0.5 flex-shrink-0" />
        This is a status view for staff outreach — no patient is automatically messaged from this page or this list.
      </p>

      {loading ? (
        <p className="text-sm text-gray-400 dark:text-white/40">Loading…</p>
      ) : !candidates || candidates.length === 0 ? (
        <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 p-10 text-center">
          <p className="text-sm text-gray-400 dark:text-white/40">No patients currently need reactivation outreach.</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 dark:bg-white/5">
                <tr className="text-gray-500 dark:text-white/50 text-xs">
                  <th className="px-4 py-3 font-bold">Patient</th>
                  <th className="px-4 py-3 font-bold">Reason</th>
                  <th className="px-4 py-3 font-bold text-right">No-shows</th>
                  <th className="px-4 py-3 font-bold text-right">Late Cancels</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                {candidates.map(c => (
                  <tr key={c.id}>
                    <td className="px-4 py-3">
                      <a href={patientHref(c.id)} className="font-semibold text-gray-800 dark:text-white hover:text-blue-600 dark:hover:text-blue-400">{c.firstName} {c.lastName}</a>
                      <div className="text-[11px] text-gray-400">{c.phone}</div>
                    </td>
                    <td className="px-4 py-3"><span className={cn('px-2 py-0.5 rounded-full text-[10px] font-bold', REASON_TONE[c.reason])}>{REASON_LABEL[c.reason]}</span></td>
                    <td className="px-4 py-3 text-right text-gray-600 dark:text-white/60">{c.noShowCount}</td>
                    <td className="px-4 py-3 text-right text-gray-600 dark:text-white/60">{c.lateCancelCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
