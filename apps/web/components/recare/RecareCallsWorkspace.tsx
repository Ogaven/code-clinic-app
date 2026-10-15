'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

type Weekly = { start: string; totals: { contacted: number; answered: number; booked: number; came: number; rescheduled: number }; calls: Call[] }
type Call = {
  id: string; patientId: string; contactMethod: string; contactedAt: string;
  reached: string; appointmentSet: boolean; appointmentDate: string | null;
  attendance: string; rescheduledDate: string | null; comment: string | null;
  recordedByName: string; patient: { id: string; firstName: string; lastName: string; phone: string }
}
const empty = { patientId: '', contactMethod: 'Call', contactedAt: '', reached: 'Not Tried', appointmentSet: false, appointmentDate: '', attendance: 'PENDING', rescheduledDate: '', comment: '' }
function toISO(value: string) { return value ? new Date(value).toISOString() : null }
export default function RecareCallsWorkspace() {
  const [calls, setCalls] = useState<Call[]>([])
  const [form, setForm] = useState(empty)
  const [search, setSearch] = useState('')
  const [patients, setPatients] = useState<{id:string;firstName:string;lastName:string;phone:string}[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [weekStart, setWeekStart] = useState('')
  const [weekly, setWeekly] = useState<Weekly | null>(null)
  const [weeklyError, setWeeklyError] = useState('')
  const token = () => typeof window === 'undefined' ? '' : localStorage.getItem('cc_token') || ''
  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api-proxy/crm-automation/patient-engagement/recare-calls', { headers: { Authorization: `Bearer ${token()}` } })
      if (!r.ok) throw new Error('Unable to load recare call records')
      const data = await r.json()
      setCalls(data.calls || [])
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load records') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (search.trim().length < 2) { setPatients([]); return }
    const controller = new AbortController()
    const id = setTimeout(async () => {
      try {
        const r = await fetch(`/api-proxy/patients?q=${encodeURIComponent(search.trim())}&limit=15`, { headers: { Authorization: `Bearer ${token()}` }, signal: controller.signal })
        if (!r.ok) return
        const data = await r.json()
        const rows = Array.isArray(data) ? data : (data.patients || data.data || [])
        setPatients(rows)
      } catch { /* Search is optional; do not expose errors from aborted queries. */ }
    }, 250)
    return () => { clearTimeout(id); controller.abort() }
  }, [search])
  async function loadWeekly() {
    if (!weekStart) return
    setWeeklyError('')
    try {
      const r = await fetch(`/api-proxy/crm-automation/patient-engagement/recare-calls/weekly?start=${encodeURIComponent(weekStart)}`, { headers: { Authorization: `Bearer ${token()}` } })
      if (!r.ok) throw new Error('Unable to load weekly report')
      setWeekly(await r.json())
    } catch (e) { setWeeklyError(e instanceof Error ? e.message : 'Unable to load weekly report') }
  }
  function exportWeeklyCsv() {
    if (!weekly) return
    const escapeCsv = (value: unknown) => '"' + String(value ?? '').replace(/"/g, '""') + '"'
    const rows = [
      ['Patient ID','Patient name','Contacted','Method','Reached','Booked','Attendance','Recorded by'],
      ...weekly.calls.map(c => [c.patient.id, `${c.patient.firstName} ${c.patient.lastName}`, c.contactedAt, c.contactMethod, c.reached, c.appointmentSet ? 'Yes' : 'No', c.attendance, c.recordedByName]),
    ]
    const csv = rows.map(row => row.map(escapeCsv).join(',')).join('\\r\\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url; a.download = `recare-week-${weekly.start}.csv`; a.click()
    URL.revokeObjectURL(url)
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError('')
    if (!form.patientId || !form.contactedAt) { setError('Select a patient and contact date.'); return }
    setSaving(true)
    try {
      const r = await fetch('/api-proxy/crm-automation/patient-engagement/recare-calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({
          patientId: form.patientId, contactMethod: form.contactMethod, contactedAt: toISO(form.contactedAt),
          reached: form.reached, appointmentSet: form.appointmentSet,
          appointmentDate: toISO(form.appointmentDate), attendance: form.attendance,
          rescheduledDate: toISO(form.rescheduledDate), comment: form.comment || null,
        }),
      })
      if (!r.ok) { const data = await r.json().catch(() => ({})); throw new Error(data.error || 'Could not save call') }
      setForm(empty); setSearch(''); setPatients([]); await refresh()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save call') }
    finally { setSaving(false) }
  }
  const field = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 dark:border-white/20 dark:bg-gray-900 dark:text-white'
  const label = 'space-y-1 text-xs font-semibold text-gray-600 dark:text-gray-300'
  return <div className="space-y-6">
    <header><h1 className="text-2xl font-bold text-gray-900 dark:text-white">Patient Recare Calls Tracker</h1>
      <p className="text-sm text-gray-500">Record staff outreach against existing patient files. No automatic calls or messages are sent.</p></header>
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-gray-200 bg-white p-5 dark:border-white/10 dark:bg-gray-900">
      <h2 className="font-bold dark:text-white">Record a recare contact</h2>
      <div className="grid gap-4 md:grid-cols-3">
        <label className={label}>Find patient<input className={field} value={search} onChange={e => {setSearch(e.target.value);setForm(f=>({...f,patientId:''}))}} placeholder="Search by patient name or ID" />
          {patients.length > 0 && <select className={field} value={form.patientId} onChange={e => setForm(f=>({...f,patientId:e.target.value}))}><option value="">Select existing patient</option>{patients.map(p=><option key={p.id} value={p.id}>{p.firstName} {p.lastName} — {p.phone}</option>)}</select>}
        </label>
        <label className={label}>Contact method<select className={field} value={form.contactMethod} onChange={e=>setForm(f=>({...f,contactMethod:e.target.value}))}>{['Call','Text','WhatsApp','Other'].map(x=><option key={x}>{x}</option>)}</select></label>
        <label className={label}>Date contacted<input required type="datetime-local" className={field} value={form.contactedAt} onChange={e=>setForm(f=>({...f,contactedAt:e.target.value}))}/></label>
        <label className={label}>Response<select className={field} value={form.reached} onChange={e=>setForm(f=>({...f,reached:e.target.value}))}>{['Not Tried','Yes','No'].map(x=><option key={x}>{x}</option>)}</select></label>
        <label className={label}>Appointment booked<select className={field} value={String(form.appointmentSet)} onChange={e=>setForm(f=>({...f,appointmentSet:e.target.value==='true'}))}><option value="false">No</option><option value="true">Yes</option></select></label>
        <label className={label}>Appointment date<input type="datetime-local" className={field} value={form.appointmentDate} onChange={e=>setForm(f=>({...f,appointmentDate:e.target.value}))}/></label>
        <label className={label}>Attendance<select className={field} value={form.attendance} onChange={e=>setForm(f=>({...f,attendance:e.target.value}))}>{[['PENDING','Pending'],['CAME','Came'],['NO_SHOW','Did not come'],['RESCHEDULED','Rescheduled'],['CANCELED','Canceled']].map(([v,t])=><option value={v} key={v}>{t}</option>)}</select></label>
        <label className={label}>Rescheduled date<input type="datetime-local" className={field} value={form.rescheduledDate} onChange={e=>setForm(f=>({...f,rescheduledDate:e.target.value}))}/></label>
        <label className={label}>Comments<textarea maxLength={2000} className={field} value={form.comment} onChange={e=>setForm(f=>({...f,comment:e.target.value}))}/></label>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <button disabled={saving || !form.patientId} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving?'Saving…':'Save recare call'}</button>
    </form>
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-5 dark:border-white/10 dark:bg-gray-900">
      <h2 className="font-bold dark:text-white">Weekly recare report</h2>
      <p className="text-xs text-gray-500">Select the first day of a seven-day period (Kampala time). Counts reflect recorded outreach entries, not unique patients.</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className={label}>Week starting<input type="date" className={field} value={weekStart} onChange={e => { setWeekStart(e.target.value); setWeekly(null) }} /></label>
        <button onClick={()=>void loadWeekly()} disabled={!weekStart} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Load report</button>
        {weekly && <button onClick={exportWeeklyCsv} className="rounded-lg border border-gray-300 px-4 py-2 text-sm dark:text-white">Export CSV</button>}
      </div>
      {weeklyError && <p role="alert" className="text-sm text-red-600">{weeklyError}</p>}
      {weekly && <div className="grid grid-cols-2 gap-3 md:grid-cols-5">{Object.entries(weekly.totals).map(([name, value])=><div key={name} className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800"><p className="text-xs capitalize text-gray-500">{name}</p><p className="text-2xl font-bold dark:text-white">{value}</p></div>)}</div>}
    </section>
    <section className="overflow-x-auto rounded-xl border border-gray-200 dark:border-white/10">
      <div className="flex items-center justify-between p-4"><h2 className="font-bold dark:text-white">Recent recare contacts</h2><button onClick={()=>void refresh()} className="text-sm text-blue-600">Refresh</button></div>
      {loading ? <p className="p-4 text-sm">Loading…</p> : calls.length===0 ? <p className="p-4 text-sm text-gray-500">No recare calls recorded yet.</p> :
      <table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-gray-50 text-gray-600 dark:bg-gray-800"><tr>{['Patient','Contacted','Method','Response','Booked','Attendance','Recorded by','Notes'].map(x=><th className="p-3" key={x}>{x}</th>)}</tr></thead><tbody>{calls.map(c=><tr key={c.id} className="border-t border-gray-100 dark:border-white/10"><td className="p-3"><Link className="text-blue-600 hover:underline" href={`/patients/${c.patientId}`}>{c.patient.firstName} {c.patient.lastName}</Link></td><td className="p-3">{new Date(c.contactedAt).toLocaleString('en-UG')}</td><td className="p-3">{c.contactMethod}</td><td className="p-3">{c.reached}</td><td className="p-3">{c.appointmentSet?'Yes':'No'}</td><td className="p-3">{c.attendance}</td><td className="p-3">{c.recordedByName}</td><td className="p-3">{c.comment||'—'}</td></tr>)}</tbody></table>}
    </section>
  </div>
}
