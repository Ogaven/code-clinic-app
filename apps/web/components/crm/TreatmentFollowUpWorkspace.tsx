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
  const [coordinators, setCoordinators] = useState<{ id: string; firstName: string; lastName: string }[]>([])
  const [ownerId, setOwnerId] = useState('')
  const [history, setHistory] = useState<{ eventType: string; actorId: string; createdAt: string; newValues: unknown; outcome?: string | null }[]>([])
  const [historyFor, setHistoryFor] = useState<FollowUpPlan | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [view, setView] = useState<'due' | 'upcoming' | 'all'>('due')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [editing, setEditing] = useState<FollowUpPlan | null>(null)
  const [outcome, setOutcome] = useState('')
  const [resolution, setResolution] = useState<'COMPLETED' | 'RESCHEDULED'>('COMPLETED')
  const [rescheduleDate, setRescheduleDate] = useState('')
  const [coordination, setCoordination] = useState<FollowUpPlan | null>(null)
  const [decision, setDecision] = useState('')
  const [reason, setReason] = useState('')
  const [nextAction, setNextAction] = useState('')
  const [dueDate, setDueDate] = useState('')
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
      const owners = await fetch('/api-proxy/pipeline/treatment/coordinators', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      if (owners.ok) { const result = await owners.json(); setCoordinators(Array.isArray(result.coordinators) ? result.coordinators : []) }
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
    if (!outcome.trim() || (resolution === 'RESCHEDULED' && !rescheduleDate)) return
    setSavingId(item.id)
    setError('')
    try {
      const token = localStorage.getItem('cc_token')
      const response = await fetch(`/api-proxy/pipeline/treatment/${item.id}/follow-up/resolve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution, note: outcome.trim(), ...(resolution === 'RESCHEDULED' ? { rescheduleTo: `${rescheduleDate}T09:00:00+03:00` } : {}) }),
      })
      if (!response.ok) throw new Error('Could not record outcome')
      setEditing(null)
      setOutcome('')
      await load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to save outcome') }
    finally { setSavingId(null) }
  }

  const editCoordination = (item: FollowUpPlan) => {
    setCoordination(item)
    setDecision(item.patientDecision || '')
    setOwnerId(item.coordinatorId || '')
    setReason(item.decisionReason || '')
    setNextAction(item.nextAction || '')
    setDueDate(item.followUpAt ? new Date(item.followUpAt).toLocaleDateString('en-CA', { timeZone: 'Africa/Kampala' }) : '')
  }
  const saveCoordination = async () => {
    if (!coordination) return
    setSavingId(coordination.id)
    setError('')
    try {
      const response = await fetch(`/api-proxy/pipeline/treatment/${coordination.id}/coordination`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${localStorage.getItem('cc_token')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ patientDecision: decision || null, decisionReason: reason, nextAction, coordinatorId: ownerId || null, followUpAt: dueDate ? `${dueDate}T09:00:00+03:00` : null }),
      })
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || 'Could not save coordination') }
      setCoordination(null)
      await load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to save coordination') }
    finally { setSavingId(null) }
  }

  const showHistory = async (item: FollowUpPlan) => {
    setError('')
    try {
      const response = await fetch(`/api-proxy/pipeline/treatment/${item.id}/coordination-history`, { headers: { Authorization: `Bearer ${localStorage.getItem('cc_token')}` }, cache: 'no-store' })
      if (!response.ok) throw new Error('Unable to load coordination history')
      const data = await response.json()
      setHistory(Array.isArray(data.events) ? data.events : [])
      setHistoryFor(item)
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to load history') }
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
      {historyFor && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <section role="dialog" aria-modal="true" aria-labelledby="history-title" className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl dark:bg-gray-900">
          <h2 id="history-title" className="text-lg font-bold dark:text-white">Coordination history</h2>
          <p className="mt-1 text-sm text-gray-500">{historyFor.patient.firstName} {historyFor.patient.lastName}</p>
          <div className="mt-4 max-h-80 space-y-3 overflow-y-auto">{history.length === 0 ? <p className="text-sm text-gray-500">No coordination events recorded yet.</p> : history.map((event, index) => <div key={index} className="rounded-lg border p-3 text-sm dark:text-white"><div className="font-semibold">{event.eventType}</div><div className="text-xs text-gray-500">{new Date(event.createdAt).toLocaleString('en-GB', { timeZone: 'Africa/Kampala' })}</div>{event.outcome && <p className="mt-2 whitespace-pre-wrap">Outcome: {event.outcome}</p>}<pre className="mt-2 whitespace-pre-wrap break-words text-xs">{JSON.stringify(event.newValues, null, 2)}</pre></div>)}</div>
          <div className="mt-4 text-right"><button type="button" onClick={() => setHistoryFor(null)} className="rounded-lg border px-4 py-2 dark:text-white">Close</button></div>
        </section>
      </div>}
      {coordination && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <section role="dialog" aria-modal="true" aria-labelledby="coordination-title" className="w-full max-w-lg space-y-3 rounded-2xl bg-white p-6 shadow-xl dark:bg-gray-900">
          <h2 id="coordination-title" className="text-lg font-bold dark:text-white">Edit treatment coordination</h2>
          <p className="text-sm text-gray-500">{coordination.patient.firstName} {coordination.patient.lastName} — {coordination.treatmentName}</p>
          <label className="block text-sm font-semibold dark:text-white">Patient decision</label>
          <select value={decision} onChange={e => setDecision(e.target.value)} className="w-full rounded-lg border p-2 text-gray-900"><option value="">Not recorded</option>{['Accepted', 'Partially Accepted', 'Undecided', 'Deferred', 'Declined'].map(d => <option key={d} value={d}>{d}</option>)}</select>
          <label className="block text-sm font-semibold dark:text-white">Assigned coordinator</label><select value={ownerId} onChange={e => setOwnerId(e.target.value)} className="w-full rounded-lg border p-2 text-gray-900"><option value="">Unassigned</option>{coordinators.map(user => <option key={user.id} value={user.id}>{user.firstName} {user.lastName}</option>)}</select>
          <label className="block text-sm font-semibold dark:text-white">Decision reason</label><textarea value={reason} maxLength={2000} onChange={e => setReason(e.target.value)} className="w-full rounded-lg border p-2 text-gray-900" rows={2} />
          <label className="block text-sm font-semibold dark:text-white">Next action</label><textarea value={nextAction} maxLength={2000} onChange={e => setNextAction(e.target.value)} className="w-full rounded-lg border p-2 text-gray-900" rows={2} />
          <label className="block text-sm font-semibold dark:text-white">Follow-up date</label><input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="w-full rounded-lg border p-2 text-gray-900" />
          <div className="flex justify-end gap-2"><button type="button" disabled={!!savingId} onClick={() => setCoordination(null)} className="rounded-lg border px-4 py-2 dark:text-white">Cancel</button><button type="button" disabled={!!savingId} onClick={() => void saveCoordination()} className="rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white disabled:opacity-50">Save changes</button></div>
        </section>
      </div>}
      {editing && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget && !savingId) setEditing(null) }}>
        <section role="dialog" aria-modal="true" aria-labelledby="followup-outcome-title" className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl dark:bg-gray-900">
          <h2 id="followup-outcome-title" className="text-lg font-bold text-gray-900 dark:text-white">Record follow-up outcome</h2>
          <p className="mt-1 text-sm text-gray-500">{editing.patient.firstName} {editing.patient.lastName} — {editing.treatmentName}</p>
          <label className="mt-4 block text-sm font-semibold text-gray-800 dark:text-white">Action</label>
          <select value={resolution} onChange={e => setResolution(e.target.value as 'COMPLETED' | 'RESCHEDULED')} className="mt-1 w-full rounded-lg border p-2 text-gray-900">
            <option value="COMPLETED">Completed follow-up</option><option value="RESCHEDULED">Reschedule follow-up</option>
          </select>
          {resolution === 'RESCHEDULED' && <><label className="mt-4 block text-sm font-semibold dark:text-white">New follow-up date</label><input type="date" value={rescheduleDate} onChange={e => setRescheduleDate(e.target.value)} className="mt-1 w-full rounded-lg border p-2 text-gray-900" /></>}
          <label className="mt-4 block text-sm font-semibold dark:text-white">Outcome notes (required)</label>
          <textarea value={outcome} onChange={e => setOutcome(e.target.value)} maxLength={2000} rows={4} className="mt-1 w-full rounded-lg border p-2 text-gray-900" placeholder="What happened and what was agreed?" />
          <div className="mt-5 flex justify-end gap-2"><button type="button" disabled={!!savingId} onClick={() => setEditing(null)} className="rounded-lg border px-4 py-2 dark:text-white">Cancel</button><button type="button" disabled={!!savingId || !outcome.trim() || (resolution === 'RESCHEDULED' && !rescheduleDate)} onClick={() => void saveOutcome(editing)} className="rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white disabled:opacity-50">{savingId ? 'Saving…' : 'Save outcome'}</button></div>
        </section>
      </div>}
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
                <td className="px-4 py-3"><div className="flex flex-col gap-2"><button type="button" onClick={() => editCoordination(p)} className="rounded-lg border px-3 py-2 text-xs font-semibold dark:text-white">Edit coordination</button><button type="button" onClick={() => void showHistory(p)} className="rounded-lg border px-3 py-2 text-xs dark:text-white">History</button><button type="button" disabled={savingId === p.id} onClick={() => { setEditing(p); setOutcome(''); setResolution('COMPLETED'); setRescheduleDate('') }} className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Record outcome</button></div></td>
              </tr>)}
            </tbody>
          </table>
        </div>}
    </div>
  )
}
