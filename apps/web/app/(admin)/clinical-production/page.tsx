'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

type Entry = { id: string; patientId: string; deliveredAt: string; amountUGX: number; kind: string; note: string; recordedById: string; createdAt: string }
type CurrentUser = { id: string; role: string }

export default function ClinicalProductionApprovalsPage() {
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [patientId, setPatientId] = useState('')
  const [appointmentId, setAppointmentId] = useState('')
  const [amountUGX, setAmountUGX] = useState('')
  const [deliveredAt, setDeliveredAt] = useState('')
  const [deliveryNote, setDeliveryNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submissionKey, setSubmissionKey] = useState<string | null>(null)

  async function load() {
    const token = localStorage.getItem('cc_token')
    if (!token) { setError('Sign in to view clinical production approvals.'); setLoading(false); return }
    try {
      const response = await fetch('/api-proxy/clinical-production/entries/pending', { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' })
      if (!response.ok) throw new Error('Unable to load pending entries (' + response.status + ')')
      const data = await response.json()
      setEntries(data.entries || [])
      setError('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load pending entries') }
    finally { setLoading(false) }
  }

  useEffect(() => {
    try { const raw = localStorage.getItem('cc_user'); if (raw) setUser(JSON.parse(raw)) } catch { /* no saved user */ }
    void load()
  }, [])

  async function decide(entry: Entry, decision: 'APPROVED' | 'REJECTED') {
    const note = (notes[entry.id] || '').trim()
    if (note.length < 3) { setError('Enter a review reason of at least 3 characters.'); return }
    if (!window.confirm((decision === 'APPROVED' ? 'Approve' : 'Reject') + ' this clinical production entry?')) return
    setBusy(entry.id)
    setError('')
    setNotice('')
    try {
      const token = localStorage.getItem('cc_token')
      const response = await fetch('/api-proxy/clinical-production/entries/' + encodeURIComponent(entry.id) + '/decision', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ decision, note }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Decision could not be saved')
      setNotice('Decision saved: ' + decision.toLowerCase() + '.')
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Decision could not be saved') }
    finally { setBusy(null) }
  }

  async function submitDelivery(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const amount = Number(amountUGX)
    const deliveryInstant = new Date(deliveredAt + '+03:00')
    if (!Number.isInteger(amount) || amount < 1 || amount > 2147483647 || !patientId.trim() || deliveryNote.trim().length < 3 || !deliveredAt || !Number.isFinite(deliveryInstant.getTime())) {
      setError('Enter a patient reference, valid delivery time, UGX amount and treatment description.')
      return
    }
    if (!window.confirm('Confirm that treatment was actually delivered? This creates a pending entry requiring another administrator’s approval.')) return
    const key = submissionKey || crypto.randomUUID()
    if (!submissionKey) setSubmissionKey(key)
    setSubmitting(true)
    setError('')
    setNotice('')
    try {
      const token = localStorage.getItem('cc_token')
      const response = await fetch('/api-proxy/clinical-production/entries', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({
          patientId: patientId.trim(), ...(appointmentId.trim() ? { appointmentId: appointmentId.trim() } : {}),
          deliveredAt: deliveryInstant.toISOString(), amountUGX: amount, kind: 'DELIVERY',
          sourceKey: key, note: deliveryNote.trim(),
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Unable to submit treatment delivery')
      setNotice('Treatment delivery submitted for independent approval.')
      setAmountUGX('')
      setDeliveryNote('')
      setSubmissionKey(null)
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to submit treatment delivery') }
    finally { setSubmitting(false) }
  }

  if (user === null) return <main className="p-6"><p>Checking administrator access…</p></main>
  if (user?.role !== 'ADMIN') return <main className="p-6"><h1 className="text-xl font-bold">Clinical production approvals</h1><p className="mt-3 text-sm">Administrator access required.</p></main>
  return <main className="mx-auto max-w-5xl space-y-5 p-4 md:p-8">
    <div><Link href="/dashboard" className="text-sm text-cyan-700">← Dashboard</Link><h1 className="mt-2 text-2xl font-bold">Clinical production approvals</h1><p className="mt-1 text-sm text-gray-500">Review explicitly recorded treatment delivery and corrections. Recording an entry does not approve it.</p></div>
    <form onSubmit={event => void submitDelivery(event)} className="space-y-3 rounded-xl border bg-white p-5 dark:bg-slate-900">
      <h2 className="text-lg font-semibold">Record completed treatment delivery</h2>
      <p className="text-sm text-gray-500">Use the patient and appointment references from the clinical record. Do not record invoices, bookings or unperformed treatments as delivered production.</p>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm">Patient ID *<input required value={patientId} onChange={e => { setPatientId(e.target.value); setSubmissionKey(null) }} className="mt-1 w-full rounded-lg border p-2 dark:bg-slate-800" /></label>
        <label className="text-sm">Completed appointment ID (optional)<input value={appointmentId} onChange={e => { setAppointmentId(e.target.value); setSubmissionKey(null) }} className="mt-1 w-full rounded-lg border p-2 dark:bg-slate-800" /></label>
        <label className="text-sm">Delivered at (Kampala local time) *<input required type="datetime-local" value={deliveredAt} onChange={e => { setDeliveredAt(e.target.value); setSubmissionKey(null) }} className="mt-1 w-full rounded-lg border p-2 dark:bg-slate-800" /></label>
        <label className="text-sm">Delivered value (UGX) *<input required type="number" min="1" max="2147483647" step="1" value={amountUGX} onChange={e => { setAmountUGX(e.target.value); setSubmissionKey(null) }} className="mt-1 w-full rounded-lg border p-2 dark:bg-slate-800" /></label>
      </div>
      <label className="block text-sm">Treatment delivered and supporting note *<textarea required minLength={3} maxLength={2000} rows={3} value={deliveryNote} onChange={e => { setDeliveryNote(e.target.value); setSubmissionKey(null) }} className="mt-1 w-full rounded-lg border p-2 dark:bg-slate-800" /></label>
      <button type="submit" disabled={submitting} className="rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{submitting ? 'Submitting…' : 'Submit for approval'}</button>
    </form>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
    {loading ? <p>Loading pending entries…</p> : entries.length === 0 ? <p className="rounded-xl border p-5">No pending entries in the current queue.</p> : <div className="space-y-4">{entries.map(entry => <section key={entry.id} className="rounded-xl border bg-white p-5 shadow-sm dark:bg-slate-900">
      <div className="flex flex-wrap justify-between gap-3"><div><p className="font-semibold">{entry.kind} · UGX {entry.amountUGX.toLocaleString('en-UG')}</p><p className="text-xs text-gray-500">Patient reference: {entry.patientId}</p><p className="text-xs text-gray-500">Delivered: {new Date(entry.deliveredAt).toLocaleString('en-UG', { timeZone: 'Africa/Kampala' })}</p></div><p className="text-xs text-gray-500">Recorded {new Date(entry.createdAt).toLocaleString('en-UG', { timeZone: 'Africa/Kampala' })}</p></div>
      <p className="mt-3 whitespace-pre-wrap text-sm">{entry.note}</p>
      {user.id === entry.recordedById ? <p className="mt-3 text-sm text-amber-700">Another administrator must review this entry.</p> : <div className="mt-4 space-y-2"><label htmlFor={'reason-' + entry.id} className="block text-sm font-medium">Decision reason</label><textarea id={'reason-' + entry.id} className="w-full rounded-lg border p-2 text-sm dark:bg-slate-800" rows={2} maxLength={2000} value={notes[entry.id] || ''} onChange={e => setNotes(previous => ({ ...previous, [entry.id]: e.target.value }))} placeholder="Explain why this delivery or correction is accepted or rejected"/><div className="flex flex-wrap gap-2"><button disabled={busy !== null} onClick={() => void decide(entry, 'APPROVED')} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Approve</button><button disabled={busy !== null} onClick={() => void decide(entry, 'REJECTED')} className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Reject</button></div></div>}
    </section>)}</div>}
    {entries.length === 100 && <p className="text-sm text-amber-700">Showing the first 100 pending entries. Review these to load more.</p>}
  </main>
}
