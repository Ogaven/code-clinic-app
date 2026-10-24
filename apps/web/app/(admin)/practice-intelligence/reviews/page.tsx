'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

type ReviewTask = {
  id: string
  title: string
  description: string | null
  proposedAction: string | null
  approvalStatus: string | null
  createdAt: string
  reviewedAt: string | null
  reviewNotes: string | null
  assignedToId: string | null
}

export default function PracticeIntelligenceReviewsPage() {
  const [tasks, setTasks] = useState<ReviewTask[]>([])
  const [assignees, setAssignees] = useState<{ id: string; firstName: string; lastName: string; role: string }[]>([])
  const [selectedAssignee, setSelectedAssignee] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [workingId, setWorkingId] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const load = useCallback(async () => {
    const user = JSON.parse(localStorage.getItem('cc_user') || 'null') as { role?: string } | null
    const token = localStorage.getItem('cc_token')
    if (user?.role !== 'ADMIN' || !token) {
      setError('Administrator sign-in is required.')
      setLoading(false)
      return
    }
    try {
      const response = await fetch('/api-proxy/practice-intelligence-tasks/recommendations', {
        headers: { Authorization: 'Bearer ' + token }, cache: 'no-store',
      })
      if (!response.ok) throw new Error('Unable to load recommendations (' + response.status + ').')
      const result = await response.json() as { tasks: ReviewTask[] }
      setTasks(result.tasks)
      const assigneeResponse = await fetch('/api-proxy/practice-intelligence-tasks/assignees', {
        headers: { Authorization: 'Bearer ' + token }, cache: 'no-store',
      })
      if (assigneeResponse.ok) {
        const staff = await assigneeResponse.json() as { users: typeof assignees }
        setAssignees(staff.users)
      }
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load recommendations.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function assign(task: ReviewTask) {
    const assignedToId = selectedAssignee[task.id]
    const token = localStorage.getItem('cc_token')
    if (assignedToId === undefined || !token || workingId) return
    setWorkingId(task.id)
    try {
      const response = await fetch('/api-proxy/practice-intelligence-tasks/recommendations/' + encodeURIComponent(task.id) + '/assign', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignedToId: assignedToId || null }),
      })
      if (!response.ok) throw new Error('Unable to assign staff (' + response.status + ').')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to assign staff.')
    } finally {
      setWorkingId(null)
    }
  }

  async function decide(task: ReviewTask, decision: 'APPROVED' | 'REJECTED') {
    if (workingId) return
    if (!window.confirm(decision === 'APPROVED'
      ? 'Approve this recommendation for staff review only? No operational action will run.'
      : 'Reject this recommendation?')) return
    const token = localStorage.getItem('cc_token')
    if (!token) { setError('Please sign in again.'); return }
    setWorkingId(task.id)
    try {
      const response = await fetch('/api-proxy/practice-intelligence-tasks/recommendations/' + encodeURIComponent(task.id) + '/decision', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, notes: notes[task.id] || '' }),
      })
      if (!response.ok) throw new Error('Review could not be recorded (' + response.status + ').')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to record decision.')
    } finally {
      setWorkingId(null)
    }
  }

  return (
    <main className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <Link href="/practice-intelligence" className="text-sm font-semibold text-clinic-blue hover:underline">← AI Practice Intelligence</Link>
      <div>
        <h1 className="text-2xl font-bold text-clinic-navy dark:text-white">AI recommendation reviews</h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
          Administrator review queue. Approval records a decision only — it never contacts a patient, reschedules an appointment or executes a proposed action.
        </p>
      </div>
      {error && <p role="alert" className="rounded-xl border border-amber-300 p-3 text-sm text-amber-800 dark:text-amber-300">{error}</p>}
      {loading ? <p>Loading recommendations…</p> : error ? <p className="rounded-xl border p-5 text-sm text-gray-600 dark:text-gray-300">Review data is temporarily unavailable. Please retry after the service is restored.</p> : tasks.length === 0 ? (
        <p className="rounded-xl border p-5 text-sm text-gray-600 dark:text-gray-300">No recommendations have been submitted for review. Findings in the dashboard are not automatically tasks.</p>
      ) : (
        <div className="space-y-3">
          {tasks.map(task => (
            <section key={task.id} className="rounded-xl border border-gray-200 bg-white p-5 dark:border-white/10 dark:bg-white/5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-bold text-clinic-navy dark:text-white">{task.title}</h2>
                <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">{task.approvalStatus?.replaceAll('_', ' ')}</span>
              </div>
              {task.description && <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{task.description}</p>}
              <p className="mt-2 text-xs text-gray-500">Proposed review: {task.proposedAction?.replaceAll('_', ' ') || 'Unspecified'} · Submitted {new Date(task.createdAt).toLocaleString()}</p>
              {(task.approvalStatus === 'PENDING_REVIEW' || task.approvalStatus === 'APPROVED') && (
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <label className="text-sm font-medium">Assigned staff
                    <select className="mt-1 block max-w-full rounded-lg border border-gray-300 bg-transparent p-2 text-sm"
                      value={selectedAssignee[task.id] ?? task.assignedToId ?? ''}
                      onChange={event => setSelectedAssignee(previous => ({ ...previous, [task.id]: event.target.value }))}>
                      <option value="">Unassigned</option>
                      {assignees.map(staff => <option key={staff.id} value={staff.id}>{staff.firstName} {staff.lastName} ({staff.role})</option>)}
                    </select>
                  </label>
                  <button type="button" disabled={workingId !== null || selectedAssignee[task.id] === undefined || selectedAssignee[task.id] === (task.assignedToId ?? '')}
                    onClick={() => void assign(task)} className="rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-50">Save assignment</button>
                </div>
              )}
              {task.approvalStatus === 'PENDING_REVIEW' ? (
                <div className="mt-4 space-y-3">
                  <label className="block text-sm font-medium">Review notes (optional)
                    <textarea maxLength={2000} value={notes[task.id] || ''} onChange={event => setNotes(previous => ({ ...previous, [task.id]: event.target.value }))} rows={2} className="mt-1 w-full rounded-lg border border-gray-300 bg-transparent p-2" />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={workingId !== null} onClick={() => void decide(task, 'APPROVED')} className="rounded-lg bg-clinic-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Approve for staff review</button>
                    <button type="button" disabled={workingId !== null} onClick={() => void decide(task, 'REJECTED')} className="rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-50">Reject</button>
                  </div>
                </div>
              ) : <p className="mt-3 text-sm text-gray-500">Reviewed {task.reviewedAt ? new Date(task.reviewedAt).toLocaleString() : 'previously'}{task.reviewNotes ? ' · ' + task.reviewNotes : ''}</p>}
            </section>
          ))}
        </div>
      )}
    </main>
  )
}
