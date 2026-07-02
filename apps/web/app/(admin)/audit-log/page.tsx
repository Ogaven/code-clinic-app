'use client'

import { useEffect, useState, useCallback } from 'react'
import { Search, Filter, ChevronLeft, ChevronRight } from 'lucide-react'

const API = '/api-proxy'

const ACTION_LABELS: Record<string, string> = {
  POST:   'Created',
  PUT:    'Updated',
  PATCH:  'Updated',
  DELETE: 'Deleted',
}

const RESOURCE_OPTIONS = [
  'patients', 'appointments', 'invoices', 'payments', 'employees',
  'services', 'stocks', 'campaigns', 'accounts', 'scheduling',
]

interface AuditLog {
  id: string
  action: string
  resource: string
  resourceId: string | null
  metadata: string | null
  ip: string | null
  createdAt: string
  user: { firstName: string; lastName: string; email: string; role: string } | null
}

interface PageData {
  logs: AuditLog[]
  total: number
  page: number
  limit: number
  pages: number
}

export default function AuditLogPage() {
  const [data, setData]       = useState<PageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage]       = useState(1)
  const [search, setSearch]   = useState('')
  const [action, setAction]   = useState('')
  const [resource, setResource] = useState('')
  const [from, setFrom]       = useState('')
  const [to, setTo]           = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const token = localStorage.getItem('cc_token') || ''
      const params = new URLSearchParams({ page: String(page), limit: '50' })
      if (search)   params.set('q',        search)
      if (action)   params.set('action',   action)
      if (resource) params.set('resource', resource)
      if (from)     params.set('from',     from)
      if (to)       params.set('to',       to)
      const res = await fetch(`${API}/audit-logs?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) setData(await res.json())
    } finally {
      setLoading(false)
    }
  }, [page, search, action, resource, from, to])

  useEffect(() => { load() }, [load])

  // Reset to page 1 when filters change
  const applyFilter = (fn: () => void) => { fn(); setPage(1) }

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })

  const getActionBadge = (act: string) => {
    const map: Record<string, string> = {
      POST: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
      PUT:  'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
      PATCH:'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
      DELETE:'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    }
    return map[act] || 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex flex-wrap gap-3 items-end">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search by user or resource..."
              value={search}
              onChange={e => applyFilter(() => setSearch(e.target.value))}
              className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Action */}
          <select
            value={action}
            onChange={e => applyFilter(() => setAction(e.target.value))}
            className="py-2 px-3 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Actions</option>
            <option value="POST">Created</option>
            <option value="PUT">Updated (PUT)</option>
            <option value="PATCH">Updated (PATCH)</option>
            <option value="DELETE">Deleted</option>
          </select>

          {/* Resource */}
          <select
            value={resource}
            onChange={e => applyFilter(() => setResource(e.target.value))}
            className="py-2 px-3 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Resources</option>
            {RESOURCE_OPTIONS.map(r => (
              <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
            ))}
          </select>

          {/* Date from */}
          <input
            type="date"
            value={from}
            onChange={e => applyFilter(() => setFrom(e.target.value))}
            className="py-2 px-3 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-gray-400 text-sm self-center">to</span>
          <input
            type="date"
            value={to}
            onChange={e => applyFilter(() => setTo(e.target.value))}
            className="py-2 px-3 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          {(search || action || resource || from || to) && (
            <button
              onClick={() => { setSearch(''); setAction(''); setResource(''); setFrom(''); setTo(''); setPage(1) }}
              className="py-2 px-3 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 border border-gray-200 dark:border-gray-600 rounded-lg"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-gray-400 text-sm">Loading...</div>
        ) : !data || data.logs.length === 0 ? (
          <div className="py-16 text-center text-gray-400 text-sm">No audit logs found</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-750">
                    <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Timestamp</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">User</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Role</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Action</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Resource</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Resource ID</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {data.logs.map(log => (
                    <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-300 whitespace-nowrap">
                        {formatTime(log.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        {log.user ? (
                          <div>
                            <div className="font-medium text-gray-800 dark:text-gray-200">
                              {log.user.firstName} {log.user.lastName}
                            </div>
                            <div className="text-xs text-gray-400">{log.user.email}</div>
                          </div>
                        ) : (
                          <span className="text-gray-400 italic text-xs">System</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wide">
                        {log.user?.role || '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getActionBadge(log.action)}`}>
                          {ACTION_LABELS[log.action] || log.action}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300 capitalize">
                        {log.resource}
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs font-mono truncate max-w-[140px]">
                        {log.resourceId || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {data.pages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700">
                <span className="text-xs text-gray-400">
                  {((data.page - 1) * data.limit) + 1}–{Math.min(data.page * data.limit, data.total)} of {data.total} entries
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={data.page <= 1}
                    className="p-1.5 rounded border border-gray-200 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <span className="text-xs text-gray-600 dark:text-gray-300">
                    Page {data.page} / {data.pages}
                  </span>
                  <button
                    onClick={() => setPage(p => Math.min(data.pages, p + 1))}
                    disabled={data.page >= data.pages}
                    className="p-1.5 rounded border border-gray-200 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
