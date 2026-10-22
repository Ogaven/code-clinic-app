'use client'

import { useEffect, useState } from 'react'

type Assignment = {
  id: string
  title: string
  description: string | null
  proposedAction: string | null
  approvalStatus: string | null
  createdAt: string
}

export default function MyPracticeAssignmentsPage() {
  const [tasks, setTasks] = useState<Assignment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const token = localStorage.getItem('cc_token')
        if (!token) throw new Error('Please sign in to view your assignments.')
        const response = await fetch('/api-proxy/practice-intelligence-tasks/my-assignments', {
          headers: { Authorization: 'Bearer ' + token }, cache: 'no-store',
        })
        if (!response.ok) throw new Error(response.status === 403 ? 'Your account cannot view these assignments.' : 'Unable to load assignments (' + response.status + ').')
        const result = await response.json() as { tasks: Assignment[] }
        if (active) setTasks(result.tasks)
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Unable to load assignments.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [])

  return (
    <main className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold text-clinic-navy dark:text-white">My AI Practice Intelligence assignments</h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
          Approved recommendations assigned to you for manual review. These are advisory tasks only:
          nothing here contacts patients, changes appointments or executes an action.
        </p>
      </div>
      {loading ? <p role="status">Loading your assignments…</p> : error ? (
        <p role="alert" className="rounded-xl border border-amber-300 p-4 text-sm text-amber-800 dark:text-amber-300">{error}</p>
      ) : tasks.length === 0 ? (
        <p className="rounded-xl border border-gray-200 p-5 text-sm text-gray-600 dark:text-gray-300">
          You have no approved recommendations assigned to you.
        </p>
      ) : (
        <div className="space-y-3">
          {tasks.map(task => (
            <section key={task.id} className="rounded-xl border border-gray-200 bg-white p-5 dark:border-white/10 dark:bg-white/5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold text-clinic-navy dark:text-white">{task.title}</h2>
                <span className="text-xs font-medium text-gray-600 dark:text-gray-300">Approved · Manual review</span>
              </div>
              {task.description && <p className="mt-2 whitespace-pre-wrap text-sm text-gray-600 dark:text-gray-300">{task.description}</p>}
              <p className="mt-3 text-xs text-gray-500">
                Suggested investigation: {task.proposedAction?.replaceAll('_', ' ') || 'Review evidence'}
                {' · '}Submitted {new Date(task.createdAt).toLocaleString()}
              </p>
            </section>
          ))}
        </div>
      )}
    </main>
  )
}
