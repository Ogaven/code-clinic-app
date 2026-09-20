'use client'

// CRM Automation — Collections staff workspace (Part F/E).
// The backend (CollectionsCase auto-open/close, owner assignment) already
// existed and worked before this file — see patient-tags.service.ts's
// syncCollectionsCase() and collections.service.ts. This is purely the
// missing staff-facing screen: GET /crm-automation/collections and
// POST /crm-automation/collections/:patientId/assign were both previously
// unreachable from any page in the app.

import { useCallback, useEffect, useState } from 'react'
import { Wallet, Info } from 'lucide-react'
import { formatUGX, cn } from '@/lib/utils'

interface StaffMember { id: string; firstName: string; lastName: string; isActive: boolean }

interface CollectionsCase {
  id: string
  patientId: string
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED'
  reason: string
  createdAt: string
  ownerId: string | null
  patient: { id: string; firstName: string; lastName: string; phone: string; accountBalance: number; balanceAgingBucket: string | null }
  owner: { id: string; firstName: string; lastName: string } | null
}

const STATUS_TONE: Record<string, string> = {
  OPEN:        'bg-red-50 text-red-600 dark:bg-red-400/15 dark:text-red-300',
  IN_PROGRESS: 'bg-amber-50 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300',
}

function daysAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  return days === 0 ? 'Today' : `${days}d`
}

export default function CollectionsWorkspace() {
  const API = '/api-proxy'
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const authH = { Authorization: `Bearer ${token}` }

  const [cases, setCases] = useState<CollectionsCase[] | null>(null)
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [assigning, setAssigning] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      fetch(`${API}/crm-automation/collections`, { headers: authH as any }),
      fetch(`${API}/employees`, { headers: authH as any }),
    ]).then(async ([casesRes, staffRes]) => {
      if (casesRes.status === 403) { setForbidden(true); return }
      if (casesRes.ok) setCases(await casesRes.json())
      if (staffRes.ok) { const s = await staffRes.json(); setStaff(Array.isArray(s) ? s.filter((x: StaffMember) => x.isActive) : []) }
    }).catch(() => {}).finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { load() }, [load])

  async function assign(patientId: string, ownerId: string) {
    setAssigning(patientId)
    try {
      await fetch(`${API}/crm-automation/collections/${patientId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authH },
        body: JSON.stringify({ ownerId: ownerId || null }),
      })
      load()
    } finally {
      setAssigning(null)
    }
  }

  if (forbidden) {
    return <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 p-10 text-center">
      <p className="text-sm font-semibold text-gray-700 dark:text-white/80">Collections is restricted to Accounts and Admin.</p>
    </div>
  }

  const totalOwing = (cases ?? []).reduce((sum, c) => sum + (c.patient?.accountBalance ?? 0), 0)

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-extrabold text-gray-800 dark:text-white">Collections</h1>
        <p className="text-sm text-gray-500 dark:text-white/50">Patients who owe a balance AND have an incomplete treatment plan. These cases open and close automatically as balance and treatment status change.</p>
      </div>

      <p className="flex items-start gap-1.5 text-[11px] text-gray-400 dark:text-white/30">
        <Info size={13} className="mt-0.5 flex-shrink-0" />
        Patients with an open collections case are automatically excluded from marketing and recall/treatment reminder sequences — they only receive collections follow-up, never a promotional message, while their case is open.
      </p>

      {loading ? (
        <p className="text-sm text-gray-400 dark:text-white/40">Loading…</p>
      ) : !cases || cases.length === 0 ? (
        <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 p-10 text-center">
          <p className="text-sm text-gray-400 dark:text-white/40">No open collections cases.</p>
        </div>
      ) : (
        <>
          <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 p-4 inline-flex items-center gap-2">
            <Wallet size={14} className="text-gray-400" />
            <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-white/50">Total Owing (open cases)</span>
            <span className="text-lg font-extrabold text-gray-800 dark:text-white">{formatUGX(totalOwing)}</span>
          </div>

          <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 dark:bg-white/5">
                  <tr className="text-gray-500 dark:text-white/50 text-xs">
                    <th className="px-4 py-3 font-bold">Patient</th>
                    <th className="px-4 py-3 font-bold text-right">Amount Owing</th>
                    <th className="px-4 py-3 font-bold">Aging</th>
                    <th className="px-4 py-3 font-bold">Status</th>
                    <th className="px-4 py-3 font-bold">Waiting</th>
                    <th className="px-4 py-3 font-bold">Owner</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                  {cases.map(c => (
                    <tr key={c.id}>
                      <td className="px-4 py-3 font-semibold text-gray-800 dark:text-white">
                        {c.patient.firstName} {c.patient.lastName}
                        <div className="text-[11px] font-normal text-gray-400">{c.patient.phone}</div>
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-gray-700 dark:text-white/80">{formatUGX(c.patient.accountBalance)}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-white/60">{c.patient.balanceAgingBucket ?? '—'}</td>
                      <td className="px-4 py-3">
                        <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-bold', STATUS_TONE[c.status] ?? 'bg-gray-100 text-gray-600')}>
                          {c.status === 'IN_PROGRESS' ? 'In Progress' : 'Open'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 dark:text-white/60">{daysAgo(c.createdAt)}</td>
                      <td className="px-4 py-3">
                        <select
                          value={c.ownerId ?? ''}
                          disabled={assigning === c.patientId}
                          onChange={e => assign(c.patientId, e.target.value)}
                          className="text-xs px-2 py-1.5 rounded-lg border border-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-white"
                        >
                          <option value="">Unassigned</option>
                          {staff.map(s => <option key={s.id} value={s.id}>{s.firstName} {s.lastName}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
