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

  if (user?.role !== 'ADMIN') return <main className="p-6"><h1 className="text-xl font-bold">Clinical production approvals</h1><p className="mt-3 text-sm">Administrator access required.</p></main>
  return <main className="mx-auto max-w-5xl space-y-5 p-4 md:p-8">
    <div><Link href="/dashboard" className="text-sm text-cyan-700">← Dashboard</Link><h1 className="mt-2 text-2xl font-bold">Clinical production approvals</h1><p className="mt-1 text-sm text-gray-500">Review explicitly recorded treatment delivery and corrections. Recording an entry does not approve it.</p></div>
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
