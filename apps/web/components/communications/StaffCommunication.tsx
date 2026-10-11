'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Send, RefreshCw, MessageSquare } from 'lucide-react'

type Message = { id: string; fromUserId: string; toRole?: string | null; toUserId?: string | null; body: string; subject?: string | null; createdAt: string; fromUser?: { firstName: string; lastName: string; role: string } | null }
type Role = 'ADMIN' | 'RECEPTIONIST' | 'DOCTOR'

export default function StaffCommunication({ role }: { role: Role }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [target, setTarget] = useState<Role>(role === 'DOCTOR' ? 'ADMIN' : 'DOCTOR')
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const bottom = useRef<HTMLDivElement>(null)
  const me = typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('cc_user') || '{}').id : null
  const load = useCallback(async () => {
    const token = localStorage.getItem('cc_token')
    if (!token) return
    try {
      const res = await fetch('/api-proxy/receptionist/messages', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      if (!res.ok) throw new Error('Could not load staff messages')
      const data = await res.json()
      setMessages(Array.isArray(data) ? data : [])
      setError('')
    } catch { setError('Unable to sync messages. Please check your connection.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => {
    load()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') load() }, 3000)
    const wake = () => { if (document.visibilityState === 'visible') load() }
    window.addEventListener('focus', wake)
    window.addEventListener('online', wake)
    return () => { clearInterval(timer); window.removeEventListener('focus', wake); window.removeEventListener('online', wake) }
  }, [load])
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages.length, target])
  const thread = messages.filter(m =>
    (m.fromUserId === me && m.toRole === target) ||
    (m.fromUser?.role === target && (m.toRole === role || m.toUserId === me)) ||
    (role !== 'DOCTOR' && target === 'DOCTOR' && m.fromUser?.role === 'DOCTOR' && (m.toRole === 'ADMIN' || m.toRole === 'RECEPTIONIST'))
  )
  async function send() {
    if (!draft.trim() || busy) return
    const token = localStorage.getItem('cc_token')
    if (!token) return
    setBusy(true)
    const body = draft.trim()
    try {
      const res = await fetch('/api-proxy/receptionist/messages/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ toRole: target, subject: 'Staff Communication', body }),
      })
      if (!res.ok) throw new Error('Send failed')
      setDraft('')
      await load()
    } catch { setError('Message not sent. Please retry.') }
    finally { setBusy(false) }
  }
  return <section className="mx-auto max-w-5xl space-y-4">
    <header className="flex items-center justify-between gap-3">
      <div><h1 className="text-2xl font-bold text-clinic-navy dark:text-white">Communication</h1><p className="text-sm text-gray-500">Private staff messages between doctors, administration and reception.</p></div>
      <button type="button" onClick={load} className="rounded-xl border p-2" aria-label="Refresh messages"><RefreshCw size={18}/></button>
    </header>
    <div className="rounded-2xl border bg-white shadow-sm dark:border-white/10 dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-3 border-b p-4 dark:border-white/10">
        <label htmlFor="staff-recipient" className="text-sm font-medium">Message</label>
        <select id="staff-recipient" value={target} onChange={e => setTarget(e.target.value as Role)} className="rounded-xl border bg-white px-3 py-2 text-sm text-gray-900 dark:bg-slate-800 dark:text-white">
          {role === 'DOCTOR' ? <><option value="ADMIN">Administration</option><option value="RECEPTIONIST">Reception</option></> : <option value="DOCTOR">Doctors</option>}
        </select>
        <span className="ml-auto text-xs text-gray-500">Auto-sync every 3 seconds</span>
      </div>
      {error && <p role="alert" className="px-4 pt-3 text-sm text-red-600">{error}</p>}
      <div className="h-[min(55vh,520px)] space-y-3 overflow-y-auto p-4" aria-live="polite">
        {loading ? <p className="text-sm text-gray-500">Loading messages…</p> : thread.length === 0 ? <div className="flex h-full flex-col items-center justify-center gap-2 text-gray-500"><MessageSquare/><p>No messages yet. Start a staff conversation.</p></div> : thread.map(m => <div key={m.id} className={`flex ${m.fromUserId === me ? 'justify-end' : 'justify-start'}`}>
          <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${m.fromUserId === me ? 'bg-blue-700 text-white' : 'bg-gray-100 text-gray-900 dark:bg-slate-800 dark:text-white'}`}>
            <p className="mb-1 text-xs font-semibold opacity-75">{m.fromUserId === me ? 'You' : [m.fromUser?.firstName, m.fromUser?.lastName].filter(Boolean).join(' ') || 'Staff'}</p>
            <p className="whitespace-pre-wrap break-words">{m.body}</p>
            <p className="mt-1 text-right text-[10px] opacity-70">{new Date(m.createdAt).toLocaleString('en-UG', { timeZone: 'Africa/Kampala', dateStyle: 'short', timeStyle: 'short' })}</p>
          </div>
        </div>)}
        <div ref={bottom}/>
      </div>
      <div className="flex items-end gap-3 border-t p-4 dark:border-white/10">
        <textarea aria-label="Staff message" value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }} rows={2} maxLength={5000} placeholder="Type a message about your concern…" className="min-h-12 flex-1 resize-y rounded-xl border bg-white p-3 text-sm text-gray-900 dark:bg-slate-800 dark:text-white"/>
        <button type="button" onClick={send} disabled={busy || !draft.trim()} className="flex items-center gap-2 rounded-xl bg-blue-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"><Send size={16}/>Send</button>
      </div>
    </div>
  </section>
}
