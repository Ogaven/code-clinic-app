'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ClipboardList, RefreshCw } from 'lucide-react'

interface FollowUpPlan {
  id: string
  patientId: string
  patient: { firstName: string; lastName: string; patientNumber?: number }
  treatmentName: string
  stage: string
  status: string
  doctorName: string
  followUpAt: string | null
  followUpReason: string | null
  followUpNote: string | null
  notes: string | null
}

export default function TreatmentFollowUpWorkspace({ patientHref }: { patientHref: (id: string) => string }) {
  const [items, setItems] = useState<FollowUpPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const token = localStorage.getItem('cc_token')
      const response = await fetch('/api-proxy/pipeline/treatment?period=all', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      if (!response.ok) throw new Error('Unable to load treatment follow-ups')
      const data = await response.json()
      if (!Array.isArray(data.followUps)) throw new Error('Invalid Treatment Pipeline response')
      setItems(data.followUps)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load treatment follow-ups')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const pipelineHref = typeof window !== 'undefined' && window.location.pathname.startsWith('/receptionist')
    ? '/receptionist/treatment-pipeline' : '/treatment-pipeline'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-extrabold text-gray-800 dark:text-white">
            <ClipboardList size={20} className="text-emerald-500" /> Treatment Follow-up
          </h1>
          <p className="text-sm text-gray-500 dark:text-white/50">
            Live outstanding follow-ups from the Treatment Pipeline. No demo patients or automatic patient messages.
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <button type="button" onClick={() => void load()} disabled={loading}
            className="flex items-center gap-1 rounded-lg border px-3 py-2 disabled:opacity-50">
            <RefreshCw size={14} /> Refresh
          </button>
          <Link href={pipelineHref} className="font-semibold text-blue-600 hover:underline">Open Treatment Pipeline</Link>
        </div>
      </div>
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
        {error} <button type="button" onClick={() => void load()} className="ml-2 underline">Retry</button>
      </div>}
      {loading ? <p className="text-sm text-gray-500">Loading live follow-ups…</p> : !error && items.length === 0
        ? <p className="rounded-xl border bg-white p-8 text-sm text-gray-500 dark:bg-white/5">No outstanding follow-ups in the Treatment Pipeline.</p>
        : !error && <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white dark:border-white/10 dark:bg-white/5">
          <div className="border-b px-4 py-3 text-sm font-semibold text-gray-700 dark:text-white">{items.length} outstanding follow-up{items.length === 1 ? '' : 's'}</div>
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 dark:bg-white/5"><tr>
              <th className="px-4 py-3">Patient</th><th className="px-4 py-3">Treatment / Notes</th>
              <th className="px-4 py-3">Follow-up Date</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Doctor</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/10">
              {items.map(p => <tr key={p.id}>
                <td className="px-4 py-3"><Link href={patientHref(p.patientId)} className="font-semibold text-blue-700 hover:underline dark:text-blue-300">
                  {p.patient?.firstName} {p.patient?.lastName}</Link>
                  {p.patient?.patientNumber != null && <div className="text-xs text-gray-400">CC-{String(p.patient.patientNumber).padStart(4, '0')}</div>}</td>
                <td className="px-4 py-3 text-gray-700 dark:text-white/80">
                  <div className="font-semibold">{p.treatmentName}</div>
                  {p.followUpReason && <div className="text-xs">Reason: {p.followUpReason}</div>}
                  {p.followUpNote && <div className="text-xs">Follow-up: {p.followUpNote}</div>}
                  {p.notes && <div className="text-xs">Treatment: {p.notes}</div>}
                </td>
                <td className="px-4 py-3 text-gray-600 dark:text-white/70">{p.followUpAt ? new Date(p.followUpAt).toLocaleDateString('en-GB', { timeZone: 'Africa/Kampala', day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</td>
                <td className="px-4 py-3 text-gray-600 dark:text-white/70">{p.status}<div className="text-xs text-gray-400">{p.stage}</div></td>
                <td className="px-4 py-3 text-gray-600 dark:text-white/70">{p.doctorName || 'Unassigned'}</td>
              </tr>)}
            </tbody>
          </table>
        </div>}
    </div>
  )
}
