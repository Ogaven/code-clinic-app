'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, CheckCheck, MessageCircle, Search, Send, RefreshCw, ArrowLeft } from 'lucide-react'

type Role = 'DOCTOR' | 'ADMIN' | 'RECEPTIONIST'
type Contact = { id: string; firstName: string; lastName: string; role: Role; avatarUrl?: string | null }
type Msg = { id: string; fromUserId: string; toUserId: string; body: string; createdAt: string; isRead: boolean }
const fullName = (c: Contact) => `${c.firstName} ${c.lastName}`
const initials = (c: Contact) => `${c.firstName?.[0] || ''}${c.lastName?.[0] || ''}`.toUpperCase()

export default function StaffCommunication({ role }: { role: Role }) {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [messages, setMessages] = useState<Msg[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [mobileChat, setMobileChat] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)
  const me = typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('cc_user') || '{}').id as string : ''
  const load = useCallback(async () => {
    const token = localStorage.getItem('cc_token')
    if (!token) return
    try {
      const headers = { Authorization: `Bearer ${token}` }
      const [cr, mr] = await Promise.all([
        fetch('/api-proxy/receptionist/messages/contacts', { headers, cache: 'no-store' }),
        fetch('/api-proxy/receptionist/messages', { headers, cache: 'no-store' }),
      ])
      if (!cr.ok || !mr.ok) throw Error('Sync failed')
      const [people, items] = await Promise.all([cr.json(), mr.json()])
      setContacts(Array.isArray(people) ? people : [])
      setMessages(Array.isArray(items) ? items : [])
      setError('')
    } catch { setError('Connection interrupted. Trying to reconnect…') }
  }, [])
  useEffect(() => {
    void load()
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void load() }, 2000)
    const wake = () => { if (document.visibilityState === 'visible') void load() }
    window.addEventListener('focus', wake); window.addEventListener('online', wake)
    return () => { clearInterval(timer); window.removeEventListener('focus', wake); window.removeEventListener('online', wake) }
  }, [load])
  const people = useMemo(() => contacts.map(c => {
    const chat = messages.filter(m => (m.fromUserId === me && m.toUserId === c.id) || (m.fromUserId === c.id && m.toUserId === me))
    return { ...c, last: chat[chat.length - 1], unread: chat.filter(m => m.toUserId === me && !m.isRead).length }
  }).filter(c => fullName(c).toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (b.last?.createdAt || '').localeCompare(a.last?.createdAt || '')), [contacts, messages, me, search])
  const person = contacts.find(c => c.id === selected)
  const thread = messages.filter(m => (m.fromUserId === me && m.toUserId === selected) || (m.fromUserId === selected && m.toUserId === me))
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }) }, [selected, thread.length])
  useEffect(() => {
    if (!selected) return
    const unread = thread.filter(m => m.toUserId === me && !m.isRead)
    if (!unread.length) return
    const token = localStorage.getItem('cc_token')
    if (!token) return
    void Promise.all(unread.map(m => fetch(`/api-proxy/receptionist/messages/${encodeURIComponent(m.id)}/read`, { method: 'PUT', headers: { Authorization: `Bearer ${token}` } })))
      .then(() => setMessages(current => current.map(m => unread.some(u => u.id === m.id) ? { ...m, isRead: true } : m)))
  }, [selected, messages, me])
  async function send() {
    if (!selected || !draft.trim() || busy) return
    const token = localStorage.getItem('cc_token')
    if (!token) return
    setBusy(true)
    const body = draft.trim()
    try {
      const res = await fetch('/api-proxy/receptionist/messages/send', { method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ toUserId: selected, body }) })
      if (!res.ok) throw Error('Send failed')
      setDraft(''); await load()
    } catch { setError('Message could not be sent. Please retry.') }
    finally { setBusy(false) }
  }
  return <section className="mx-auto max-w-6xl space-y-3">
    <div className="flex items-center justify-between">
      <div><h1 className="text-2xl font-bold text-clinic-navy dark:text-white">Communication</h1><p className="text-sm text-gray-500">Private staff conversations</p></div>
      <button aria-label="Refresh conversations" onClick={() => void load()} className="rounded-xl border p-2 dark:border-white/10"><RefreshCw size={18}/></button>
    </div>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    <div className="flex h-[min(74vh,720px)] overflow-hidden rounded-2xl border bg-white shadow-sm dark:border-white/10 dark:bg-slate-900">
      <aside className={`${mobileChat ? 'hidden md:flex' : 'flex'} w-full flex-col border-r dark:border-white/10 md:w-[340px]`}>
        <div className="border-b p-4 dark:border-white/10"><p className="mb-3 font-bold">Chats</p><div className="flex items-center gap-2 rounded-xl bg-gray-100 px-3 py-2 dark:bg-slate-800"><Search size={16}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search staff…" className="w-full bg-transparent text-sm outline-none"/></div></div>
        <div className="flex-1 overflow-y-auto">{people.map(c => <button key={c.id} onClick={() => { setSelected(c.id); setMobileChat(true) }} className={`flex w-full items-center gap-3 border-b px-4 py-3 text-left hover:bg-blue-50 dark:border-white/5 dark:hover:bg-slate-800 ${selected === c.id ? 'bg-blue-50 dark:bg-slate-800' : ''}`}>
          <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-blue-100 font-semibold text-blue-900">{c.avatarUrl ? <img src={c.avatarUrl} alt="" className="h-full w-full object-cover"/> : initials(c)}</div>
          <div className="min-w-0 flex-1"><div className="flex justify-between gap-2"><span className="truncate text-sm font-semibold">{fullName(c)}</span><span className="shrink-0 text-[10px] text-gray-400">{c.last ? new Date(c.last.createdAt).toLocaleTimeString('en-UG',{hour:'2-digit',minute:'2-digit',timeZone:'Africa/Kampala'}) : ''}</span></div><p className="text-xs text-gray-500">{c.role === 'DOCTOR' ? 'Doctor' : c.role === 'ADMIN' ? 'Admin' : 'Receptionist'}</p><p className="truncate text-xs text-gray-400">{c.last?.body || 'Start a conversation'}</p></div>
          {c.unread > 0 && <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-xs text-white">{c.unread}</span>}
        </button>)}</div>
      </aside>
      <div className={`${mobileChat ? 'flex' : 'hidden md:flex'} min-w-0 flex-1 flex-col`}>
        {person ? <>
          <div className="flex items-center gap-3 border-b p-4 dark:border-white/10"><button onClick={() => setMobileChat(false)} aria-label="Back to chats" className="md:hidden"><ArrowLeft size={20}/></button><div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 font-bold text-blue-900">{initials(person)}</div><div><p className="font-semibold">{fullName(person)}</p><p className="text-xs text-gray-500">{person.role === 'DOCTOR' ? 'Doctor' : person.role === 'ADMIN' ? 'Admin' : 'Receptionist'}</p></div></div>
          <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50 p-4 dark:bg-slate-950">{thread.map(m => <div key={m.id} className={`flex ${m.fromUserId === me ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm shadow-sm ${m.fromUserId === me ? 'bg-blue-700 text-white' : 'bg-white text-gray-900 dark:bg-slate-800 dark:text-white'}`}><p className="whitespace-pre-wrap break-words">{m.body}</p><div className="mt-1 flex items-center justify-end gap-1 text-[10px] opacity-70">{new Date(m.createdAt).toLocaleTimeString('en-UG',{hour:'2-digit',minute:'2-digit',timeZone:'Africa/Kampala'})}{m.fromUserId === me && (m.isRead ? <CheckCheck size={13}/> : <Check size={13}/>)}</div></div></div>)}<div ref={bottom}/></div>
          <div className="flex items-end gap-2 border-t p-3 dark:border-white/10"><textarea value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }} rows={2} maxLength={5000} placeholder="Type a message…" className="min-w-0 flex-1 resize-none rounded-xl border bg-white p-3 text-sm text-gray-900 dark:bg-slate-800 dark:text-white"/><button onClick={() => void send()} disabled={!draft.trim() || busy} className="rounded-xl bg-blue-700 p-3 text-white disabled:opacity-50" aria-label="Send message"><Send size={20}/></button></div>
        </> : <div className="flex flex-1 flex-col items-center justify-center gap-2 text-gray-400"><MessageCircle size={42}/><p>Select a staff member to start chatting</p></div>}
      </div>
    </div>
  </section>
}
