'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

type Visit = { id: string; firstName: string; lastName: string; totalVisits: number; firstVisit: string | null; lastVisit: string | null; daysSince: number | null; priority: string }
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
  const [visits, setVisits] = useState<Visit[]>([])
  const [visitError, setVisitError] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('ALL')
  const [repeatOnly, setRepeatOnly] = useState(false)
  const [tab, setTab] = useState<'tracker' | 'weekly'>('tracker')
  const [contactSearch, setContactSearch] = useState('')
  const [outcomeFilter, setOutcomeFilter] = useState('ALL')
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
    let active = true
    fetch('/api-proxy/crm-automation/patient-engagement/recare-visit-summary', { headers: { Authorization: `Bearer ${token()}` } })
      .then(async r => { if (!r.ok) throw new Error('Could not load visit summary'); return r.json() })
      .then(data => { if (active) setVisits(data.patients || []) })
      .catch(() => { if (active) setVisitError('Visit summary unavailable') })
    return () => { active = false }
  }, [])
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
  function shiftWeek(days: number) {
    if (!weekStart) return
    const d = new Date(`${weekStart}T12:00:00Z`)
    if (Number.isNaN(d.getTime())) return
    d.setUTCDate(d.getUTCDate() + days)
    setWeekStart(d.toISOString().slice(0, 10))
    setWeekly(null)
  }
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
    const csv = rows.map(row => row.map(escapeCsv).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url; a.download = `recare-week-${weekly.start}.csv`; a.click()
    URL.revokeObjectURL(url)
  }
  function printWeeklyReport() {
    if (!weekly) return
    const safe = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c))
    const rows = weekly.calls.map(c => '<tr>' + [`${c.patient.firstName} ${c.patient.lastName}`, new Date(c.contactedAt).toLocaleDateString('en-UG'), c.contactMethod, c.reached, c.appointmentSet ? 'Yes' : 'No', c.attendance, c.recordedByName].map(v => `<td>${safe(v)}</td>`).join('') + '</tr>').join('')
    const staff = Object.entries(weekly.calls.reduce<Record<string, number>>((a, c) => { a[c.recordedByName] = (a[c.recordedByName] || 0) + 1; return a }, {})).map(([name, count]) => `<li>${safe(name)}: ${count} contacts</li>`).join('')
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Recare weekly report ${safe(weekly.start)}</title><style>body{font:13px Arial,sans-serif;padding:24px;color:#123}h1{color:#126b64}table{border-collapse:collapse;width:100%;margin-top:16px}td,th{border:1px solid #ddd;padding:7px;text-align:left}th{background:#edf7f5}ul{line-height:1.8}@page{size:A4 landscape;margin:12mm}</style></head><body><h1>Code Clinic — Weekly Recare Report</h1><p>Week starting ${safe(weekly.start)} (Kampala time). Counts represent outreach entries, not unique patients.</p><p>Contacted: ${weekly.totals.contacted} · Answered: ${weekly.totals.answered} · Booked: ${weekly.totals.booked} · Came: ${weekly.totals.came} · Rescheduled: ${weekly.totals.rescheduled}</p><h2>Patient outreach</h2><table><thead><tr><th>Patient</th><th>Contacted</th><th>Method</th><th>Response</th><th>Booked</th><th>Attendance</th><th>Staff</th></tr></thead><tbody>${rows}</tbody></table><h2>Staff activity</h2><ul>${staff}</ul><p>Confidential patient information — authorized staff only.</p></body></html>`
    const popup = window.open('', '_blank')
    if (!popup) { setWeeklyError('Allow pop-ups to print or save the weekly report as PDF.'); return }
    popup.document.open(); popup.document.write(html); popup.document.close(); popup.focus(); popup.print()
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
  const visibleVisits = visits.filter(p =>
    (priorityFilter === 'ALL' || p.priority === priorityFilter) &&
    (!repeatOnly || p.totalVisits >= 2) &&
    `${p.firstName} ${p.lastName}`.toLowerCase().includes(contactSearch.toLowerCase())
  ).sort((a, b) => (b.daysSince ?? -1) - (a.daysSince ?? -1))
  const repeatPatients = visits.filter(p => p.totalVisits >= 2).length
  const overduePatients = visits.filter(p => p.priority === 'High' || p.priority === 'Medium').length
  const visibleCalls = calls.filter(c => {
    const name = `${c.patient.firstName} ${c.patient.lastName}`.toLowerCase()
    return (!contactSearch || name.includes(contactSearch.toLowerCase())) && (outcomeFilter === 'ALL' || c.attendance === outcomeFilter)
  })
  const outcomes = [
    ['CAME', 'Came'], ['PENDING', 'Pending'], ['RESCHEDULED', 'Rescheduled'], ['CANCELED', 'Canceled'], ['NO_SHOW', 'Did not come'],
  ] as const
  const field = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 dark:border-white/20 dark:bg-gray-900 dark:text-white'
  const label = 'space-y-1 text-xs font-semibold text-gray-600 dark:text-gray-300'
  return <div className="space-y-6">
    <header><h1 className="text-2xl font-bold text-gray-900 dark:text-white">Patient Recare Calls Tracker</h1>
      <p className="text-sm text-gray-500">Record staff outreach against existing patient files. No automatic calls or messages are sent.</p></header>
    <nav aria-label="Recare tracker sections" className="flex gap-2 border-b border-gray-200 pb-2 dark:border-white/10">
      <button type="button" onClick={() => setTab('tracker')} className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === 'tracker' ? 'bg-teal-700 text-white' : 'bg-white text-gray-600 dark:bg-gray-800 dark:text-gray-200'}`}>Recall Tracker</button>
      <button type="button" onClick={() => setTab('weekly')} className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === 'weekly' ? 'bg-teal-700 text-white' : 'bg-white text-gray-600 dark:bg-gray-800 dark:text-gray-200'}`}>Weekly Report</button>
    </nav>
    {tab === 'tracker' && <>
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-5 dark:border-white/10 dark:bg-gray-900">
      <h2 className="font-bold text-teal-800 dark:text-teal-300">Recare Outcomes</h2>
      <p className="text-xs text-gray-500">Based on the most recent {calls.length} recorded contacts. Select an outcome to filter the list.</p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">{outcomes.map(([value, label]) => <button key={value} type="button" onClick={() => setOutcomeFilter(f => f === value ? 'ALL' : value)} className={`rounded-lg border p-3 text-left ${outcomeFilter === value ? 'border-teal-600 bg-teal-50 dark:bg-teal-900/30' : 'border-gray-200 dark:border-white/10'}`}><div className="text-2xl font-bold text-teal-800 dark:text-teal-300">{calls.filter(c => c.attendance === value).length}</div><div className="text-xs text-gray-600 dark:text-gray-300">{label}</div></button>)}</div>
    </section>
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-5 dark:border-white/10 dark:bg-gray-900">
      <h2 className="font-bold text-teal-800 dark:text-teal-300">EMR Visit Summary & Recall Priorities</h2>
      <p className="text-xs text-gray-500">Verified EMR completed appointments only. Shows up to 100 recently updated patients, sorted by days since last visit; not a clinic-wide exhaustive overdue list or the historic periodontal therapy file. Priority bands are provisional time-since-visit categories, not prescribed recall intervals.</p>
      <div className="flex flex-wrap gap-3"><input className={field + ' max-w-xs'} value={contactSearch} onChange={e=>setContactSearch(e.target.value)} placeholder="Find patient…" aria-label="Find patient in visit summary"/><select className={field + ' max-w-xs'} value={priorityFilter} onChange={e=>setPriorityFilter(e.target.value)} aria-label="Filter visit priority"><option value="ALL">All priorities</option>{['High','Medium','Low','Recent'].map(p=><option key={p}>{p}</option>)}</select><label className="flex items-center gap-2 text-sm dark:text-white"><input type="checkbox" checked={repeatOnly} onChange={e=>setRepeatOnly(e.target.checked)}/>Repeat patients only</label></div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[['Patients in summary',visits.length],['Repeat patients',repeatPatients],['180+ days since visit',overduePatients],['Matching filters',visibleVisits.length]].map(([name,count])=><div key={name} className="rounded-lg bg-teal-50 p-3 dark:bg-gray-800"><p className="text-xs text-gray-600 dark:text-gray-300">{name}</p><p className="text-xl font-bold text-teal-800 dark:text-teal-300">{count}</p></div>)}</div>
      {visitError && <p role="alert" className="text-sm text-red-600">{visitError}</p>}
      <div className="overflow-x-auto"><table className="w-full min-w-[780px] text-left text-sm"><thead className="bg-teal-50 text-teal-900 dark:bg-gray-800 dark:text-teal-200"><tr>{['Patient','Repeat?','Total visits','First visit','Last visit','Days since','Priority'].map(h=><th key={h} className="p-3">{h}</th>)}</tr></thead><tbody>{visibleVisits.map(p=><tr key={p.id} className="border-t border-gray-100 dark:border-white/10"><td className="p-3"><Link href={`/patients/${p.id}`} className="text-blue-600 hover:underline">{p.firstName} {p.lastName}</Link></td><td className="p-3">{p.totalVisits>=2?'Yes':'No'}</td><td className="p-3">{p.totalVisits}</td><td className="p-3">{p.firstVisit?new Date(p.firstVisit).toLocaleDateString('en-UG'):'—'}</td><td className="p-3">{p.lastVisit?new Date(p.lastVisit).toLocaleDateString('en-UG'):'—'}</td><td className="p-3">{p.daysSince??'—'}</td><td className="p-3">{p.priority}</td></tr>)}</tbody></table></div>
      {visits.length===0&&!visitError&&<p className="text-xs text-gray-500">No verified completed-visit summary entries returned.</p>}
    </section>
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
    </>}
    {tab === 'weekly' && <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-5 dark:border-white/10 dark:bg-gray-900">
      <h2 className="font-bold dark:text-white">Weekly recare report</h2>
      <p className="text-xs text-gray-500">Select the first day of a seven-day period (Kampala time). Counts reflect recorded outreach entries, not unique patients.</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className={label}>Week starting<input type="date" className={field} value={weekStart} onChange={e => { setWeekStart(e.target.value); setWeekly(null) }} /></label>
        <button type="button" onClick={()=>shiftWeek(-7)} disabled={!weekStart} className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:text-white">← Previous week</button>
        <button type="button" onClick={()=>shiftWeek(7)} disabled={!weekStart} className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:text-white">Next week →</button>
        <button onClick={()=>void loadWeekly()} disabled={!weekStart} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Load report</button>
        {weekly && <button onClick={exportWeeklyCsv} className="rounded-lg border border-gray-300 px-4 py-2 text-sm dark:text-white">Export CSV</button>}
        {weekly && <button type="button" onClick={printWeeklyReport} className="rounded-lg border border-gray-300 px-4 py-2 text-sm dark:text-white">Print / Save PDF</button>}
      </div>
      {weeklyError && <p role="alert" className="text-sm text-red-600">{weeklyError}</p>}
      {weekly && <div className="grid grid-cols-2 gap-3 md:grid-cols-5">{Object.entries(weekly.totals).map(([name, value])=><div key={name} className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800"><p className="text-xs capitalize text-gray-500">{name}</p><p className="text-2xl font-bold dark:text-white">{value}</p></div>)}</div>}
      {weekly && <div className="overflow-x-auto"><h3 className="mb-2 font-semibold dark:text-white">Patient outreach this week</h3><table className="w-full min-w-[850px] text-left text-sm"><thead className="bg-teal-50 text-teal-900 dark:bg-gray-800 dark:text-teal-200"><tr>{['Patient','Contacted','Method','Response','Booked','Attendance','Staff'].map(h=><th key={h} className="p-3">{h}</th>)}</tr></thead><tbody>{weekly.calls.map(c=><tr key={c.id} className="border-t border-gray-100 dark:border-white/10"><td className="p-3"><Link className="text-blue-600 hover:underline" href={`/patients/${c.patient.id}`}>{c.patient.firstName} {c.patient.lastName}</Link></td><td className="p-3">{new Date(c.contactedAt).toLocaleDateString('en-UG')}</td><td className="p-3">{c.contactMethod}</td><td className="p-3">{c.reached}</td><td className="p-3">{c.appointmentSet?'Yes':'No'}</td><td className="p-3">{c.attendance}</td><td className="p-3">{c.recordedByName}</td></tr>)}</tbody></table>{weekly.calls.length===0&&<p className="p-3 text-sm text-gray-500">No outreach recorded for this period.</p>}</div>}
      {weekly && <div className="space-y-2"><h3 className="font-semibold dark:text-white">Staff outreach activity</h3><div className="flex flex-wrap gap-2">{Object.entries(weekly.calls.reduce<Record<string,number>>((acc,c)=>{acc[c.recordedByName]=(acc[c.recordedByName]||0)+1;return acc},{})).map(([name,count])=><span key={name} className="rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-gray-800 dark:text-white">{name}: {count} contacts</span>)}{weekly.calls.length===0&&<span className="text-sm text-gray-500">No staff activity recorded.</span>}</div></div>}
    </section>}
    {tab === 'tracker' && <section className="overflow-x-auto rounded-xl border border-gray-200 dark:border-white/10">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4"><div><h2 className="font-bold text-teal-800 dark:text-teal-300">Recorded Recare Contacts</h2><p className="text-xs text-gray-500">Showing {visibleCalls.length} of the {calls.length} most recent entries. This is not yet the full historical overdue recall list.</p></div><button onClick={()=>void refresh()} className="text-sm text-blue-600">Refresh</button></div>
      <div className="flex flex-wrap gap-3 px-4 pb-4"><input aria-label="Search recorded patients" value={contactSearch} onChange={e=>setContactSearch(e.target.value)} placeholder="Search patient name…" className={field + ' max-w-sm'} /><select aria-label="Filter recare outcomes" value={outcomeFilter} onChange={e=>setOutcomeFilter(e.target.value)} className={field + ' max-w-xs'}><option value="ALL">All outcomes</option>{outcomes.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></div>
      {loading ? <p className="p-4 text-sm">Loading…</p> : visibleCalls.length===0 ? <p className="p-4 text-sm text-gray-500">No recare calls recorded yet.</p> :
      <table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-gray-50 text-gray-600 dark:bg-gray-800"><tr>{['Patient','Contacted','Method','Response','Booked','Attendance','Recorded by','Notes'].map(x=><th className="p-3" key={x}>{x}</th>)}</tr></thead><tbody>{visibleCalls.map(c=><tr key={c.id} className="border-t border-gray-100 dark:border-white/10"><td className="p-3"><Link className="text-blue-600 hover:underline" href={`/patients/${c.patientId}`}>{c.patient.firstName} {c.patient.lastName}</Link></td><td className="p-3">{new Date(c.contactedAt).toLocaleString('en-UG')}</td><td className="p-3">{c.contactMethod}</td><td className="p-3">{c.reached}</td><td className="p-3">{c.appointmentSet?'Yes':'No'}</td><td className="p-3">{c.attendance}</td><td className="p-3">{c.recordedByName}</td><td className="p-3">{c.comment||'—'}</td></tr>)}</tbody></table>}
    </section>}
  </div>
}
