'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { ArrowLeft, Send, RefreshCw, CheckCheck } from 'lucide-react'

function fmtTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString('en-UG', {
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi',
  })
}

function fmtDay(dateStr: string) {
  const d = new Date(dateStr)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return 'Today'
  const y = new Date(today); y.setDate(y.getDate() - 1)
  if (d.toDateString() === y.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-UG', { day: 'numeric', month: 'short', year: 'numeric' })
}

interface Msg {
  id: string
  type: 'sent' | 'received'
  text: string
  createdAt: string
}

export default function DoctorMessagesPage() {
  const [messages, setMessages] = useState<Msg[]>([])
  const [loading, setLoading]   = useState(true)
  const [compose, setCompose]   = useState('')
  const [sending, setSending]   = useState(false)
  const [toast, setToast]       = useState('')
  const bottomRef               = useRef<HTMLDivElement>(null)
  const textareaRef             = useRef<HTMLTextAreaElement>(null)

  const token  = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const userId = typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('cc_user') || '{}').id : null

  const fetchMessages = useCallback(async () => {
    if (!token) return
    try {
      const r = await fetch('/api-proxy/receptionist/messages', { headers: { Authorization: `Bearer ${token}` } })
      if (!r.ok) return
      const data: any[] = await r.json()
      const msgs: Msg[] = data.map(m => ({
        id: m.id,
        type: m.fromUserId === userId ? 'sent' : 'received',
        text: m.body,
        createdAt: m.createdAt,
      }))
      setMessages(msgs)
    } catch {} finally { setLoading(false) }
  }, [token, userId])

  useEffect(() => { fetchMessages() }, [fetchMessages])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    const t = setInterval(fetchMessages, 10000)
    return () => clearInterval(t)
  }, [fetchMessages])

  async function send() {
    if (!compose.trim() || !token) return
    setSending(true)
    const text = compose.trim()
    setCompose('')
    try {
      await fetch('/api-proxy/receptionist/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ toRole: 'RECEPTIONIST', body: text, subject: 'Doctor Message' }),
      })
      await fetchMessages()
      textareaRef.current?.focus()
    } catch {
      setToast('Failed to send. Try again.')
      setTimeout(() => setToast(''), 3000)
    } finally { setSending(false) }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  const groups: { day: string; msgs: Msg[] }[] = []
  for (const m of messages) {
    const day = fmtDay(m.createdAt)
    const last = groups[groups.length - 1]
    if (last?.day === day) last.msgs.push(m)
    else groups.push({ day, msgs: [m] })
  }

  return (
    <div className="flex flex-col h-[calc(100vh-56px)] bg-gray-50 dark:bg-[#0A0F1E]">

      {toast && (
        <div className="fixed top-4 right-4 z-[99999] bg-red-600 text-white px-5 py-3 rounded-2xl shadow-2xl text-sm font-semibold">
          {toast}
        </div>
      )}

      <div className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-[#0d1526] border-b border-gray-100 dark:border-white/[0.06] flex-shrink-0">
        <Link href="/doctor/dashboard"
          className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 text-gray-400 md:hidden min-h-[44px] min-w-[44px] flex items-center justify-center">
          <ArrowLeft size={15} />
        </Link>
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
          RC
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-gray-800 dark:text-white text-sm">Reception & Admin</p>
          <p className="text-[10px] text-emerald-500 font-medium">● Online</p>
        </div>
        <button onClick={fetchMessages}
          className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-white/10 text-gray-400">
          <RefreshCw size={13} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
        {loading ? (
          <div className="space-y-3 pt-4">
            {[1,2,3].map(i => (
              <div key={i} className={`flex ${i % 2 === 0 ? 'justify-end' : ''}`}>
                <div className="h-12 w-52 bg-gray-200 dark:bg-white/10 rounded-2xl animate-pulse" />
              </div>
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 text-center py-12">
            <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-white/5 flex items-center justify-center mb-4">
              <span className="text-3xl">💬</span>
            </div>
            <p className="font-semibold text-sm">No messages yet</p>
            <p className="text-xs mt-1">Send a message to the reception team below</p>
          </div>
        ) : (
          groups.map(({ day, msgs }) => (
            <div key={day}>
              <div className="flex items-center gap-3 py-3">
                <div className="flex-1 h-px bg-gray-200 dark:bg-white/10" />
                <span className="text-[10px] font-semibold text-gray-400 px-2">{day}</span>
                <div className="flex-1 h-px bg-gray-200 dark:bg-white/10" />
              </div>
              <div className="space-y-2">
                {msgs.map((m) => (
                  <div key={m.id} className={`flex ${m.type === 'sent' ? 'justify-end' : 'justify-start'}`}>
                    {m.type === 'received' && (
                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 mt-auto mr-2 mb-0.5">
                        RC
                      </div>
                    )}
                    <div className={`max-w-[75%] ${m.type === 'sent' ? 'items-end' : 'items-start'} flex flex-col`}>
                      <div className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed shadow-sm ${
                        m.type === 'sent'
                          ? 'bg-blue-600 text-white rounded-br-sm'
                          : 'bg-white dark:bg-[#0d1526] text-gray-800 dark:text-gray-100 border border-gray-100 dark:border-white/10 rounded-bl-sm'
                      }`}>
                        {m.text}
                      </div>
                      <div className={`flex items-center gap-1 mt-0.5 px-1 ${m.type === 'sent' ? 'flex-row-reverse' : ''}`}>
                        <span className="text-[9px] text-gray-400">{fmtTime(m.createdAt)}</span>
                        {m.type === 'sent' && <CheckCheck size={10} className="text-blue-400" />}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <div className="flex-shrink-0 bg-white dark:bg-[#0d1526] border-t border-gray-100 dark:border-white/[0.06] px-4 py-3 flex items-end gap-3"
        style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
        <textarea
          ref={textareaRef}
          value={compose}
          onChange={e => setCompose(e.target.value)}
          onKeyDown={handleKey}
          rows={1}
          placeholder="Message reception…"
          className="flex-1 px-4 py-2.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white border border-gray-200 dark:border-gray-600 rounded-2xl resize-none focus:ring-2 focus:ring-blue-500 focus:outline-none placeholder-gray-400 dark:placeholder-gray-400 max-h-[120px] overflow-y-auto"
          style={{ fontSize: 16 }}
        />
        <button onClick={send} disabled={sending || !compose.trim()}
          className="w-11 h-11 flex-shrink-0 rounded-2xl flex items-center justify-center text-white transition-all disabled:opacity-40 hover:-translate-y-0.5 hover:shadow-md"
          style={{ background: compose.trim() ? 'linear-gradient(135deg,#1A237E,#29ABE2)' : '#9CA3AF' }}>
          {sending
            ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            : <Send size={15} />}
        </button>
      </div>
    </div>
  )
}
