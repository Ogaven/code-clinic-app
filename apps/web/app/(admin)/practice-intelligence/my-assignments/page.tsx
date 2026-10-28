'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

type Assignment = {
  id: string
  title: string
  description: string | null
  proposedAction: string | null
  approvalStatus: string | null
  createdAt: string
}

export default function MyPracticeIntelligenceAssignments() {
  const [tasks, setTasks] = useState<Assignment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    const token = localStorage.getItem('cc_token')
    const raw = localStorage.getItem('cc_user')
    let role: string | undefined
    try { role = raw ? (JSON.parse(raw) as { role?: string }).role : undefined } catch { role = undefined }
    if (!token || !['ADMIN', 'DOCTOR', 'RECEPTIONIST'].includes(role ?? '')) {
      setError('Sign in as an authorized staff member to view your assignments.')
      setLoading(false)
      return
    }
    try {
      const response = await fetch('/api-proxy/practice-intelligence-tasks/my-assignments', {
        headers: { Authorization: 'Bearer ' + token }, cache: 'no-store',
      })
      if (!response.ok) throw new Error('Unable to load assignments (' + response.status + ').')
      const result = await response.json() as { tasks: Assignment[] }
      setTasks(result.tasks)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load assignments.')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void load() }, [load])
  return (
    <main className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <Link href="/practice-intelligence" className="text-sm font-semibold text-clinic-blue hover:underline">← AI Practice Intelligence</Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-clinic-navy dark:text-white">My approved investigations</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">Only recommendations approved and assigned to your account are shown. These are investigation requests, not instructions to change patient records.</p>
        </div>
        <button type="button" onClick={() => { setLoading(true); void load() }} className="rounded-lg border px-4 py-2 text-sm font-semibold">Refresh</button>
      </div>
      {error && <p role="alert" className="text-sm text-amber-700">{error}</p>}
      {loading ? <p role="status">Loading assignments…</p> : !error && tasks.length === 0 ? (
        <p className="rounded-xl border p-4 text-sm">No approved investigations are currently assigned to you.</p>
      ) : (
        <div className="space-y-3">{tasks.map(task => (
          <section key={task.id} className="rounded-xl border border-gray-200 bg-white p-5 dark:border-white/10 dark:bg-white/5">
            <h2 className="font-semibold text-clinic-navy dark:text-white">{task.title}</h2>
            {task.description && <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{task.description}</p>}
            <p className="mt-2 text-xs text-gray-500">Approved for staff investigation · {task.proposedAction?.replaceAll('_', ' ') ?? 'Review'} · Submitted {new Date(task.createdAt).toLocaleString()}</p>
            <p className="mt-2 text-xs text-gray-500">Investigation completion tracking is not yet available. Report findings to the clinic administrator; do not treat approval as completion.</p>
          </section>
        ))}</div>
      )}
    </main>
  )
}
