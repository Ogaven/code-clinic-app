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
  treatmentPlanId: string; procedure: string; dentistNote: string | null
  followUpReason: string | null; followUpNote: string | null; followUpAt: string
  ownerId: string | null; ownerName: string | null; taskStatus: string | null
}

export default function TreatmentFollowUpWorkspace({ patientHref }: { patientHref: (id: string) => string }) {
  const API = '/api-proxy'
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const authH = { Authorization: `Bearer ${token}` }

  const [items, setItems] = useState<FollowUpItem[] | null>(null)
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [assigning, setAssigning] = useState<string | null>(null)
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null)
  const [attempts, setAttempts] = useState<any[]>([])
  const [method, setMethod] = useState('PHONE')
  const [outcome, setOutcome] = useState('NO_ANSWER')
  const [comment, setComment] = useState('')
  const [nextReminderAt, setNextReminderAt] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function openAttempts(planId: string) {
    setSelectedPlan(planId); setError('')
    const response = await fetch(`${API}/crm-automation/patient-engagement/treatment-followup/plans/${planId}/attempts`, { headers: authH })
    if (response.ok) setAttempts(await response.json())
    else setError('Unable to load contact history')
  }

  async function saveAttempt() {
    if (!selectedPlan || !comment.trim()) { setError('Enter an outcome comment'); return }
    setSaving(true); setError('')
    try {
      const response = await fetch(`${API}/crm-automation/patient-engagement/treatment-followup/plans/${selectedPlan}/attempts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authH },
        body: JSON.stringify({ method, outcome, comment, nextReminderAt: nextReminderAt ? new Date(nextReminderAt).toISOString() : null }),
      })
      if (!response.ok) { setError((await response.json()).error || 'Save failed'); return }
      setComment(''); setNextReminderAt('')
      await openAttempts(selectedPlan)
    } catch { setError('Unable to save contact attempt') }
    finally { setSaving(false) }
  }

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
        <p className="text-sm text-gray-500 dark:text-white/50">Treatment plans scheduled for follow-up in the Treatment Pipeline. Dentist notes, reasons and dates are shown below. No automatic patient contact.</p>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400 dark:text-white/40">Loading…</p>
      ) : !items || items.length === 0 ? (
        <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 p-10 text-center">
          <p className="text-sm text-gray-400 dark:text-white/40">No treatment plans are currently scheduled for follow-up.</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 dark:bg-white/5">
                <tr className="text-gray-500 dark:text-white/50 text-xs">
                  <th className="px-4 py-3 font-bold">Patient</th>
                  <th className="px-4 py-3 font-bold">Procedure / Notes</th>
                  <th className="px-4 py-3 font-bold">Reminder Date</th>
                  <th className="px-4 py-3 font-bold">Owner</th>
                  <th className="px-4 py-3 font-bold">Contact History</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                {items.map(p => (
                  <tr key={p.treatmentPlanId}>
                    <td className="px-4 py-3">
                      <a href={patientHref(p.id)} className="font-semibold text-gray-800 dark:text-white hover:text-blue-600 dark:hover:text-blue-400">{p.firstName} {p.lastName}</a>
                      <div className="text-[11px] text-gray-400">{p.phone}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-white/70"><div className="font-semibold">{p.procedure}</div><div className="text-xs">{p.followUpReason || "No follow-up reason recorded"}</div>{p.dentistNote && <div className="text-xs">Dentist: {p.dentistNote}</div>}{p.followUpNote && <div className="text-xs">Follow-up: {p.followUpNote}</div>}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-white/60">{new Date(p.followUpAt).toLocaleDateString()}</td>
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
                    <td className="px-4 py-3"><button type="button" onClick={() => openAttempts(p.treatmentPlanId)} className="text-emerald-700 font-semibold underline">View / Log attempts</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {selectedPlan && <div className="rounded-2xl border border-emerald-200 dark:border-white/10 p-5 space-y-3 bg-white dark:bg-white/5">
        <div className="flex justify-between"><h2 className="font-bold text-gray-800 dark:text-white">Contact attempts — {attempts.length} recorded</h2><button type="button" onClick={() => setSelectedPlan(null)} className="text-sm underline">Close</button></div>
        <p className="text-xs text-gray-500">Each attempt is saved separately with staff attribution. No messages are sent and no treatment stages change.</p>
        {attempts.map((a: any, i: number) => <div key={a.id} className="border-b border-gray-100 dark:border-white/10 py-2 text-sm">
          <strong>Attempt {i + 1}</strong> — {a.method} / {a.outcome} — {new Date(a.attemptedAt).toLocaleString()} — {a.staffName}
          <div>{a.comment}</div>{a.nextReminderAt && <div className="text-xs">Next reminder: {new Date(a.nextReminderAt).toLocaleString()}</div>}
        </div>)}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="text-xs">Contact method<select value={method} onChange={e => setMethod(e.target.value)} className="block w-full rounded-lg border p-2 dark:bg-gray-900">{['PHONE','WHATSAPP','SMS','EMAIL','IN_PERSON','OTHER'].map(x => <option key={x}>{x}</option>)}</select></label>
          <label className="text-xs">Outcome<select value={outcome} onChange={e => setOutcome(e.target.value)} className="block w-full rounded-lg border p-2 dark:bg-gray-900">{['NO_ANSWER','REACHED','CALL_BACK','DECLINED','OTHER'].map(x => <option key={x}>{x}</option>)}</select></label>
          <label className="text-xs">Next reminder (optional)<input type="datetime-local" value={nextReminderAt} onChange={e => setNextReminderAt(e.target.value)} className="block w-full rounded-lg border p-2 dark:bg-gray-900" /></label>
        </div>
        <textarea value={comment} onChange={e => setComment(e.target.value)} maxLength={2000} placeholder="Record what happened during this attempt…" className="w-full rounded-lg border p-2 dark:bg-gray-900" />
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <button type="button" disabled={saving || !comment.trim()} onClick={saveAttempt} className="rounded-lg bg-emerald-700 px-4 py-2 text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save contact attempt'}</button>
      </div>}
    </div>
  )
}
