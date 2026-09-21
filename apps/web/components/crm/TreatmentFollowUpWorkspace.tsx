'use client'

// CRM Automation — Treatment Follow-up (Patient Engagement). Reads
// Patient.treatmentPlanStatus === 'INCOMPLETE', derived in real time from
// the canonical TreatmentPlan.stage pipeline field. Owner assignment reuses
// the existing generic Task model — no new schema, no second treatment-plan
// data model.

import { useCallback, useEffect, useState } from 'react'
import { ClipboardList } from 'lucide-react'

interface StaffMember { id: string; firstName: string; lastName: string; isActive: boolean }
interface FollowUpItem {
  id: string; firstName: string; lastName: string; phone: string
  tagsUpdatedAt: string | null; ownerId: string | null; ownerName: string | null; taskStatus: string | null
  stage: 'INCOMPLETE' | 'PROPOSED_STALE'
}

const STAGE_LABEL: Record<string, string> = { INCOMPLETE: 'Follow-up due', PROPOSED_STALE: 'Stale proposal' }
const STAGE_TONE: Record<string, string> = {
  INCOMPLETE: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300',
  PROPOSED_STALE: 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/50',
}

export default function TreatmentFollowUpWorkspace({ patientHref }: { patientHref: (id: string) => string }) {
  const API = '/api-proxy'
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const authH = { Authorization: `Bearer ${token}` }

  const [items, setItems] = useState<FollowUpItem[] | null>(null)
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [assigning, setAssigning] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      fetch(`${API}/crm-automation/patient-engagement/treatment-followup`, { headers: authH as any }),
      fetch(`${API}/employees`, { headers: authH as any }),
    ]).then(async ([itemsRes, staffRes]) => {
      if (itemsRes.ok) setItems(await itemsRes.json())
      if (staffRes.ok) { const s = await staffRes.json(); setStaff(Array.isArray(s) ? s.filter((x: StaffMember) => x.isActive) : []) }
    }).catch(() => {}).finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { load() }, [load])

  async function assign(patientId: string, ownerId: string) {
    setAssigning(patientId)
    try {
      await fetch(`${API}/crm-automation/patient-engagement/treatment-followup/${patientId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authH },
        body: JSON.stringify({ ownerId: ownerId || null }),
      })
      load()
    } finally { setAssigning(null) }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-extrabold text-gray-800 dark:text-white flex items-center gap-2"><ClipboardList size={20} className="text-emerald-500" /> Treatment Follow-up</h1>
        <p className="text-sm text-gray-500 dark:text-white/50">Patients with an incomplete treatment plan awaiting follow-up, sourced from the treatment pipeline — plus patients whose treatment was proposed but never accepted or declined.</p>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400 dark:text-white/40">Loading…</p>
      ) : !items || items.length === 0 ? (
        <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 p-10 text-center">
          <p className="text-sm text-gray-400 dark:text-white/40">No incomplete treatment plans need follow-up right now.</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 dark:bg-white/5">
                <tr className="text-gray-500 dark:text-white/50 text-xs">
                  <th className="px-4 py-3 font-bold">Patient</th>
                  <th className="px-4 py-3 font-bold">Stage</th>
                  <th className="px-4 py-3 font-bold">Waiting Since</th>
                  <th className="px-4 py-3 font-bold">Owner</th>
                  <th className="px-4 py-3 font-bold">Next Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                {items.map(p => (
                  <tr key={p.id}>
                    <td className="px-4 py-3">
                      <a href={patientHref(p.id)} className="font-semibold text-gray-800 dark:text-white hover:text-blue-600 dark:hover:text-blue-400">{p.firstName} {p.lastName}</a>
                      <div className="text-[11px] text-gray-400">{p.phone}</div>
                    </td>
                    <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STAGE_TONE[p.stage]}`}>{STAGE_LABEL[p.stage]}</span></td>
                    <td className="px-4 py-3 text-gray-500 dark:text-white/60">{p.tagsUpdatedAt ? new Date(p.tagsUpdatedAt).toLocaleDateString() : '—'}</td>
                    <td className="px-4 py-3">
                      <select
                        value={p.ownerId ?? ''}
                        disabled={assigning === p.id}
                        onChange={e => assign(p.id, e.target.value)}
                        className="text-xs px-2 py-1.5 rounded-lg border border-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-white"
                      >
                        <option value="">Unassigned</option>
                        {staff.map(s => <option key={s.id} value={s.id}>{s.firstName} {s.lastName}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-white/60">{p.ownerId ? 'Contact patient to schedule' : 'Assign an owner'}</td>
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
