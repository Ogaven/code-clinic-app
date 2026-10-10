'use client'
import { useCallback, useEffect, useState } from 'react'

type Person = { id: string; firstName: string; lastName: string; role: string }
type Entry = { id: string; userId: string; userName: string; action: string; message?: string; recipientId?: string; replyToId?: string | null; instructionId?: string; createdAt: string }
const ROOT = '/api-proxy/clinical/patients/'
export default function PatientStaffInstructions({ patientId, token }: { patientId: string; token: string | null }) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [recipient, setRecipient] = useState('')
  const [message, setMessage] = useState('')
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [viewer, setViewer] = useState<{ id: string; role: string } | null>(null)
  const [error, setError] = useState('')
  const url = `${ROOT}${patientId}/staff-instructions`
  const refresh = useCallback(async () => {
    if (!token) return
    const headers = { Authorization: `Bearer ${token}` }
    const [items, staff] = await Promise.all([fetch(url, { headers }), fetch(`${url}/recipients`, { headers })])
    if (!items.ok || !staff.ok) throw new Error('Unable to load internal communication')
    setEntries(await items.json())
    setPeople(await staff.json())
  }, [token, url])
  useEffect(() => {
    try { const u = JSON.parse(localStorage.getItem('cc_user') || '{}'); setViewer({ id: u.id, role: u.role }) } catch { setViewer(null) }
  }, [])
  useEffect(() => { refresh().catch(e => setError(e.message)) }, [refresh])
  async function post() {
    if (!token || !recipient || !message.trim() || busy) return
    setBusy(true); setError('')
    try {
      const response = await fetch(url, { method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipientId: recipient, message: message.trim(), replyToId: replyTo }) })
      if (!response.ok) throw new Error((await response.json()).error || 'Unable to send')
      setMessage(''); setReplyTo(null); await refresh()
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to send') }
    finally { setBusy(false) }
  }
  async function markHandled(id: string) {
    if (!token || busy) return
    setBusy(true); setError('')
    try {
      const response = await fetch(`${url}/${id}/handled`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
      if (!response.ok) throw new Error((await response.json()).error || 'Unable to update')
      await refresh()
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to update') }
    finally { setBusy(false) }
  }
  const handled = new Set(entries.filter(e => e.action === 'STAFF_INTERNAL_INSTRUCTION_HANDLED').map(e => e.instructionId))
  return <section className="space-y-4">
    <header><h3 className="font-bold text-lg dark:text-white">Internal Staff Communication</h3>
      <p className="text-sm text-gray-500">Private instructions for clinic staff. Nothing here is sent to patients.</p></header>
    {error && <p role="alert" className="text-red-600 text-sm">{error}</p>}
    {entries.filter(e => e.action === 'STAFF_INTERNAL_INSTRUCTION').map(e => <article key={e.id} className="border rounded-xl p-4 space-y-2 dark:border-white/10">
      <div className="flex justify-between gap-3 text-sm"><strong className="dark:text-white">{e.userName}</strong><time className="text-gray-500">{new Date(e.createdAt).toLocaleString('en-UG', { timeZone: 'Africa/Kampala' })}</time></div>
      <p className="whitespace-pre-wrap break-words dark:text-white">{e.message}</p>
      <p className="text-xs text-gray-500">To: {people.find(p => p.id === e.recipientId)?.firstName || 'Staff'} {e.replyToId ? '· Reply' : ''}</p>
      <div className="flex gap-4 text-sm">
        {(viewer?.role === 'ADMIN' || viewer?.id === e.userId || viewer?.id === e.recipientId) && <button type="button" className="text-blue-600" onClick={() => { setReplyTo(e.id); setRecipient(e.userId) }}>Reply</button>}
        {handled.has(e.id) ? <span className="text-green-600">Handled</span> : (viewer?.role === 'ADMIN' || viewer?.id === e.recipientId) ? <button type="button" disabled={busy} className="text-green-600 disabled:opacity-50" onClick={() => markHandled(e.id)}>Mark handled</button> : <span className="text-gray-500">Pending</span>}
      </div>
    </article>)}
    <div className="border rounded-xl p-4 space-y-3 dark:border-white/10">
      <h4 className="font-semibold dark:text-white">{replyTo ? 'Reply to staff' : 'New internal instruction'}</h4>
      {replyTo && <button type="button" onClick={() => setReplyTo(null)} className="text-blue-600 text-sm">Cancel reply</button>}
      <select aria-label="Recipient" className="w-full border rounded-lg p-2 dark:bg-gray-900 dark:text-white" value={recipient} onChange={e => setRecipient(e.target.value)}>
        <option value="">Choose staff recipient</option>
        {people.map(p => <option key={p.id} value={p.id}>{p.firstName} {p.lastName} ({p.role === 'ADMIN' ? 'Admin / Treatment Coordinator' : p.role})</option>)}
      </select>
      <textarea aria-label="Instruction" className="w-full border rounded-lg p-2 dark:bg-gray-900 dark:text-white" rows={4} maxLength={4000} value={message} onChange={e => setMessage(e.target.value)} placeholder="Write a private staff instruction..." />
      <button type="button" onClick={post} disabled={busy || !recipient || !message.trim()} className="rounded-lg bg-blue-600 text-white px-4 py-2 disabled:opacity-50">{busy ? 'Sending...' : 'Send internally'}</button>
    </div>
  </section>
}
