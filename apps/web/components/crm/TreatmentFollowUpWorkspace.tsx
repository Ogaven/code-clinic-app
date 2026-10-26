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
  patientDecision?: string | null
  decisionReason?: string | null
  coordinatorId?: string | null
  nextAction?: string | null
  clinicalReviewRequired?: boolean
}

export default function TreatmentFollowUpWorkspace({ patientHref }: { patientHref: (id: string) => string }) {
  const [items, setItems] = useState<FollowUpPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [view, setView] = useState<'due' | 'upcoming' | 'all'>('due')
  const [savingId, setSavingId] = useState<string | null>(null)
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

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Kampala' })
  const filtered = items.filter(item => {
    if (!item.followUpAt) return false
    const day = new Date(item.followUpAt).toLocaleDateString('en-CA', { timeZone: 'Africa/Kampala' })
    return view === 'all' || (view === 'due' ? day <= today : day > today)
  })
  const saveOutcome = async (item: FollowUpPlan) => {
    const outcome = window.prompt('Record follow-up outcome (required):')?.trim()
    if (!outcome) return
    setSavingId(item.id)
    setError('')
    try {
      const token = localStorage.getItem('cc_token')
      const response = await fetch(`/api-proxy/pipeline/treatment/${item.id}/follow-up/resolve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution: 'COMPLETED', note: outcome }),
      })
      if (!response.ok) throw new Error('Could not record outcome')
      await load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to save outcome') }
    finally { setSavingId(null) }
  }

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
      <div className="flex flex-wrap gap-2">{(['due', 'upcoming', 'all'] as const).map(key => <button key={key} type="button" onClick={() => setView(key)} className={`rounded-lg border px-3 py-2 text-sm ${view === key ? 'bg-blue-700 text-white' : 'bg-white text-gray-700'}`}>{key === 'due' ? 'Due / overdue' : key === 'upcoming' ? 'Upcoming' : 'All outstanding'}</button>)}</div>
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
        {error} <button type="button" onClick={() => void load()} className="ml-2 underline">Retry</button>
      </div>}
      {loading ? <p className="text-sm text-gray-500">Loading live follow-ups…</p> : !error && items.length === 0
        ? <p className="rounded-xl border bg-white p-8 text-sm text-gray-500 dark:bg-white/5">No outstanding follow-ups in the Treatment Pipeline.</p>
        : !error && <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white dark:border-white/10 dark:bg-white/5">
          <div className="border-b px-4 py-3 text-sm font-semibold text-gray-700 dark:text-white">{filtered.length} {view === 'due' ? 'due or overdue' : view === 'upcoming' ? 'upcoming' : 'outstanding'} follow-up{filtered.length === 1 ? '' : 's'}</div>
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 dark:bg-white/5"><tr>
              <th className="px-4 py-3">Patient</th><th className="px-4 py-3">Treatment / Notes</th>
              <th className="px-4 py-3">Follow-up Date</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Doctor</th><th className="px-4 py-3">Coordination</th><th className="px-4 py-3">Action</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/10">
              {filtered.map(p => <tr key={p.id}>
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
                <td className="px-4 py-3 text-xs"><div>{p.patientDecision || 'Decision not recorded'}</div><div>{p.nextAction || 'Next action not recorded'}</div><div>{p.coordinatorId ? 'Coordinator assigned' : 'Coordinator unassigned'}</div></td>
                <td className="px-4 py-3"><button type="button" disabled={savingId === p.id} onClick={() => void saveOutcome(p)} className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Record outcome</button></td>
              </tr>)}
            </tbody>
          </table>
        </div>}
    </div>
  )
}
