'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, MessageSquare, Check, CheckCheck, RefreshCw, Send, Inbox } from 'lucide-react'
import { cn } from '@/lib/utils'

function timeAgo(dateStr: string) {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return new Date(dateStr).toLocaleDateString('en-UG', { day: 'numeric', month: 'short' })
}

const ROLE_COLORS: Record<string, string> = {
  ADMIN: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  RECEPTIONIST: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  SYSTEM: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-400',
  DOCTOR: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
}

type Tab = 'inbox' | 'sent'

export default function DoctorMessagesPage() {
  const [tab, setTab]              = useState<Tab>('inbox')
  const [notifications, setNotifs] = useState<any[]>([])
  const [selected, setSelected]   = useState<any | null>(null)
  const [unread, setUnread]       = useState(0)
  const [loading, setLoading]     = useState(true)
  const [marking, setMarking]     = useState(false)

  // Compose / Sent state
  const [composeMsg, setCompose]  = useState('')
  const [sending, setSending]     = useState(false)
  const [sendToast, setSendToast] = useState('')
  const [sentMsgs, setSentMsgs]   = useState<{ text: string; time: string }[]>([])

  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null

  const fetchNotifs = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const r = await fetch('/api-proxy/receptionist/notifications', { headers: { Authorization: `Bearer ${token}` } })
      const d = await r.json()
      setNotifs(d.notifications || [])
      setUnread(d.unread || 0)
    } catch {} finally { setLoading(false) }
  }, [token])

  useEffect(() => { fetchNotifs() }, [fetchNotifs])

  async function markAllRead() {
    if (!token) return
    setMarking(true)
    try {
      await fetch('/api-proxy/receptionist/notifications/mark-read', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      })
      setUnread(0)
      setNotifs(n => n.map(x => ({ ...x, isRead: true })))
    } catch {} finally { setMarking(false) }
  }

  function markOne(n: any) {
    setSelected(n)
    if (!n.isRead) {
      setNotifs(prev => prev.map(x => x.id === n.id ? { ...x, isRead: true } : x))
      setUnread(u => Math.max(0, u - 1))
    }
  }

  async function sendToAdmin() {
    if (!composeMsg.trim() || !token) return
    setSending(true)
    try {
      await fetch('/api-proxy/receptionist/notifications/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title: 'Doctor Message', body: composeMsg.trim(), type: 'DOCTOR' }),
      })
      setSentMsgs(prev => [{ text: composeMsg.trim(), time: new Date().toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kampala' }) }, ...prev])
      setCompose('')
      setSendToast('Message sent to admin!')
      setTimeout(() => setSendToast(''), 3000)
    } catch {
      setSendToast('Failed to send. Try again.')
      setTimeout(() => setSendToast(''), 3000)
    } finally { setSending(false) }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-56px)] animate-fade-in">

      {/* Toast */}
      {sendToast && (
        <div className="fixed top-4 right-4 z-[99999] bg-emerald-600 text-white px-5 py-3 rounded-2xl shadow-2xl text-sm font-semibold">
          {sendToast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-gray-100 dark:border-white/[0.06] bg-white dark:bg-[#0d1526] flex-shrink-0">
        <div className="flex items-center gap-2">
          <Link href="/doctor/dashboard"
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 text-gray-400 md:hidden min-h-[44px] min-w-[44px] flex items-center justify-center">
            <ArrowLeft size={15} />
          </Link>
          <div>
            <h1 className="font-bold text-gray-800 dark:text-white text-sm">Communications</h1>
            {unread > 0 && <p className="text-[10px] text-blue-500 font-semibold">{unread} unread</p>}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={fetchNotifs}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 text-gray-400">
            <RefreshCw size={13} />
          </button>
          {tab === 'inbox' && unread > 0 && (
            <button onClick={markAllRead} disabled={marking}
              className="text-[10px] font-semibold text-blue-500 hover:underline px-2 py-1 min-h-[36px]">
              Mark all read
            </button>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex bg-gray-100 dark:bg-white/5 mx-4 mt-3 mb-0 rounded-2xl p-1 gap-1 flex-shrink-0">
        <button onClick={() => { setTab('inbox'); setSelected(null) }}
          className={cn(
            'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all min-h-[44px]',
            tab === 'inbox'
              ? 'bg-white dark:bg-white/10 text-blue-600 dark:text-blue-300 shadow-sm'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200',
          )}>
          <Inbox size={14} />
          Inbox
          {unread > 0 && (
            <span className="text-[10px] font-bold bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center flex-shrink-0">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
        <button onClick={() => { setTab('sent'); setSelected(null) }}
          className={cn(
            'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all min-h-[44px]',
            tab === 'sent'
              ? 'bg-white dark:bg-white/10 text-blue-600 dark:text-blue-300 shadow-sm'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200',
          )}>
          <Send size={14} />
          Sent
        </button>
      </div>

      {/* ── INBOX TAB ───────────────────────────────────────────────────────── */}
      {tab === 'inbox' && (
        <div className="flex flex-1 min-h-0 mt-3">

          {/* LEFT: message list */}
          <div className={cn('flex flex-col border-r border-gray-100 dark:border-white/[0.06] bg-white dark:bg-[#0d1526]',
            selected ? 'hidden md:flex md:w-80 lg:w-96' : 'flex flex-1 md:w-80 lg:w-96')}>
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="p-4 space-y-2">
                  {[1,2,3,4].map(i => <div key={i} className="h-16 bg-gray-100 dark:bg-white/5 rounded-xl animate-pulse" />)}
                </div>
              ) : notifications.length === 0 ? (
                <div className="py-16 text-center text-gray-400">
                  <MessageSquare size={32} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No messages yet</p>
                </div>
              ) : (
                notifications.map((n) => {
                  const isSelected = selected?.id === n.id
                  const senderRole = n.type === 'SYSTEM' ? 'SYSTEM' : 'ADMIN'
                  return (
                    <button key={n.id} onClick={() => markOne(n)}
                      className={cn(
                        'w-full text-left px-4 py-3.5 border-b border-gray-50 dark:border-white/[0.04] transition-colors min-h-[68px]',
                        isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-gray-50 dark:hover:bg-white/[0.03]',
                        !n.isRead && 'bg-blue-50/50 dark:bg-blue-900/10',
                      )}>
                      <div className="flex items-start gap-3">
                        <div className={cn('w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5',
                          senderRole === 'SYSTEM' ? 'bg-gray-100 dark:bg-white/10 text-gray-500' : 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300')}>
                          {senderRole === 'SYSTEM' ? '⚙️' : '👤'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 mb-0.5">
                            <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full', ROLE_COLORS[senderRole] || ROLE_COLORS.SYSTEM)}>
                              {n.title || senderRole}
                            </span>
                            <span className="text-[9px] text-gray-400 flex-shrink-0">{timeAgo(n.createdAt)}</span>
                          </div>
                          <p className={cn('text-xs truncate', n.isRead ? 'text-gray-500 dark:text-gray-400' : 'text-gray-800 dark:text-white font-semibold')}>
                            {n.body}
                          </p>
                        </div>
                        {!n.isRead && <div className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0 mt-1.5" />}
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          </div>

          {/* RIGHT: message detail */}
          <div className={cn('flex-1 flex flex-col bg-gray-50 dark:bg-[#0A0F1E]', !selected && 'hidden md:flex')}>
            {selected ? (
              <>
                <div className="flex items-center gap-3 px-5 py-3.5 bg-white dark:bg-[#0d1526] border-b border-gray-100 dark:border-white/[0.06]">
                  <button onClick={() => setSelected(null)}
                    className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 text-gray-400 md:hidden min-h-[44px] min-w-[44px] flex items-center justify-center">
                    <ArrowLeft size={15} />
                  </button>
                  <div className="flex-1">
                    <p className="font-bold text-gray-800 dark:text-white text-sm">{selected.title || 'Notification'}</p>
                    <p className="text-[10px] text-gray-400">{timeAgo(selected.createdAt)}</p>
                  </div>
                  {selected.isRead
                    ? <CheckCheck size={15} className="text-blue-400" />
                    : <Check size={15} className="text-gray-400" />}
                </div>
                <div className="flex-1 overflow-y-auto p-6 flex items-start justify-center">
                  <div className="bg-white dark:bg-[#0d1526] rounded-2xl border border-gray-100 dark:border-white/10 p-6 max-w-lg w-full shadow-sm">
                    <div className="flex items-center gap-2 mb-4">
                      <span className={cn('text-xs font-bold px-2.5 py-1 rounded-full', ROLE_COLORS[selected.type] || ROLE_COLORS.SYSTEM)}>
                        {selected.type}
                      </span>
                      <span className="text-xs text-gray-400">
                        {new Date(selected.createdAt).toLocaleString('en-UG', { timeZone: 'Africa/Kampala' })}
                      </span>
                    </div>
                    <h2 className="font-bold text-gray-800 dark:text-white mb-3">{selected.title}</h2>
                    <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{selected.body}</p>
                    {selected.href && (
                      <Link href={selected.href} className="inline-flex items-center gap-1.5 mt-4 text-sm font-semibold text-blue-600 hover:underline">
                        View details →
                      </Link>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-center text-gray-400 p-8">
                <div>
                  <MessageSquare size={48} className="mx-auto mb-3 opacity-20" />
                  <p className="text-base font-semibold">Select a message to read</p>
                  <p className="text-sm mt-1">Choose from the list on the left</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── SENT TAB ────────────────────────────────────────────────────────── */}
      {tab === 'sent' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Compose box */}
          <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-50 dark:border-white/[0.06]">
              <h2 className="font-bold text-gray-800 dark:text-white text-sm">Message Admin / Reception</h2>
              <p className="text-xs text-gray-400 mt-0.5">Send a note to the admin or reception team</p>
            </div>
            <div className="p-4 space-y-3">
              <textarea
                value={composeMsg}
                onChange={e => setCompose(e.target.value)}
                rows={4}
                placeholder="Type your message…"
                className="w-full px-4 py-3 text-sm bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl resize-none focus:ring-2 focus:ring-blue-500 focus:outline-none dark:text-white placeholder-gray-400"
                style={{ fontSize: 16 }}
              />
              <button onClick={sendToAdmin} disabled={sending || !composeMsg.trim()}
                className="flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-sm bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition-colors min-h-[44px]">
                <Send size={14} /> {sending ? 'Sending…' : 'Send Message'}
              </button>
            </div>
          </div>

          {/* Sent messages log */}
          {sentMsgs.length > 0 && (
            <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-50 dark:border-white/[0.06]">
                <p className="text-xs font-bold uppercase tracking-wide text-gray-400">Sent this session</p>
              </div>
              <div className="divide-y divide-gray-50 dark:divide-white/[0.04]">
                {sentMsgs.map((m, i) => (
                  <div key={i} className="flex items-start gap-3 px-5 py-3.5">
                    <div className="w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-xs flex-shrink-0 mt-0.5">
                      <Send size={11} className="text-blue-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-700 dark:text-gray-200">{m.text}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">Sent at {m.time}</p>
                    </div>
                    <CheckCheck size={13} className="text-blue-400 flex-shrink-0 mt-1" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {sentMsgs.length === 0 && (
            <div className="text-center py-12 text-gray-400">
              <Send size={36} className="mx-auto mb-2 opacity-20" />
              <p className="text-sm">No sent messages yet</p>
              <p className="text-xs mt-1">Use the form above to message admin</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
