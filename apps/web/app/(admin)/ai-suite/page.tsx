'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Bot, MessageSquare, RefreshCw, Search, Send, User, UserCheck, UserX,
} from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────────────────

type Channel = 'WHATSAPP' | 'SMS' | 'VOICE'

interface Conversation {
  id:           string
  channel:      Channel
  phoneNumber:  string
  status:       string
  agentEnabled: boolean
  patientName:  string | null
  lastMessage:  { id: string; role: string; content: string; createdAt: string } | null
  createdAt:    string
  updatedAt:    string
}

interface Message {
  id:             string
  conversationId: string
  role:           'USER' | 'AGENT' | 'SYSTEM'
  content:        string
  createdAt:      string
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getHeaders() {
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  const h = Math.floor(mins / 60)
  if (h < 24)    return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function initials(conv: Conversation): string {
  if (conv.patientName) {
    return conv.patientName.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase()
  }
  return conv.phoneNumber.slice(-4)
}

function ChannelBadge({ channel }: { channel: Channel }) {
  const cfg: Record<Channel, { label: string; cls: string }> = {
    WHATSAPP: { label: 'WhatsApp', cls: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' },
    SMS:      { label: 'SMS',      cls: 'bg-blue-100  text-blue-700  dark:bg-blue-900/40  dark:text-blue-400'  },
    VOICE:    { label: 'Voice',    cls: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400' },
  }
  const { label, cls } = cfg[channel] ?? { label: channel, cls: 'bg-gray-100 text-gray-600' }
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${cls}`}>
      {label}
    </span>
  )
}

function avatarBg(channel: Channel): string {
  return channel === 'WHATSAPP' ? 'bg-green-500' : channel === 'SMS' ? 'bg-blue-500' : 'bg-purple-500'
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AISuitePage() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading,  setLoading]  = useState(true)
  const [search,   setSearch]   = useState('')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [draft,    setDraft]    = useState('')
  const [sending,  setSending]  = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)

  // ── Data fetching ──────────────────────────────────────────────────────────

  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch('/api-proxy/ai-suite/conversations', { headers: getHeaders() })
      if (res.ok) setConversations(await res.json())
    } catch {}
  }, [])

  const loadMessages = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api-proxy/ai-suite/conversations/${id}/messages`, { headers: getHeaders() })
      if (res.ok) setMessages(await res.json())
    } catch {}
  }, [])

  // Initial load
  useEffect(() => {
    loadConversations().finally(() => setLoading(false))
  }, [loadConversations])

  // Poll conversation list every 10s
  useEffect(() => {
    const t = setInterval(loadConversations, 10_000)
    return () => clearInterval(t)
  }, [loadConversations])

  // Poll messages every 5s when a conversation is open
  useEffect(() => {
    if (!activeId) return
    loadMessages(activeId)
    const t = setInterval(() => loadMessages(activeId), 5_000)
    return () => clearInterval(t)
  }, [activeId, loadMessages])

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ── Actions ────────────────────────────────────────────────────────────────

  async function handleTakeover() {
    if (!activeId) return
    await fetch(`/api-proxy/ai-suite/takeover/${activeId}`, { method: 'POST', headers: getHeaders() })
    await loadConversations()
  }

  async function handleHandback() {
    if (!activeId) return
    await fetch(`/api-proxy/ai-suite/handback/${activeId}`, { method: 'POST', headers: getHeaders() })
    await loadConversations()
  }

  async function handleSend() {
    if (!draft.trim() || !activeId || sending) return
    setSending(true)
    try {
      await fetch(`/api-proxy/ai-suite/conversations/${activeId}/send`, {
        method:  'POST',
        headers: getHeaders(),
        body:    JSON.stringify({ text: draft.trim() }),
      })
      setDraft('')
      await loadMessages(activeId)
    } finally {
      setSending(false)
    }
  }

  // ── Derived state ──────────────────────────────────────────────────────────

  const activeConv = conversations.find(c => c.id === activeId) ?? null

  const filtered = conversations.filter(c => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      c.patientName?.toLowerCase().includes(q) ||
      c.phoneNumber.includes(q) ||
      c.lastMessage?.content.toLowerCase().includes(q)
    )
  })

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex gap-4" style={{ height: 'calc(100vh - 9rem)' }}>

      {/* ── LEFT: Conversation list ─────────────────────────────────────────── */}
      <div className={`flex-shrink-0 flex flex-col bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden
        ${activeId ? 'hidden md:flex w-80 lg:w-96' : 'flex w-full md:w-80 lg:w-96'}`}>

        {/* Header + search */}
        <div className="px-4 pt-4 pb-3 border-b border-gray-100 dark:border-white/10 flex-shrink-0">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-gray-900 dark:text-white">Conversations</h2>
            <button
              onClick={() => loadConversations()}
              className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
            >
              <RefreshCw size={13} className="text-gray-400" />
            </button>
          </div>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search…"
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-gray-900 dark:text-white placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-blue-500/30 transition-shadow"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-20">
              <RefreshCw size={16} className="animate-spin text-gray-300 dark:text-gray-600" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <MessageSquare size={28} className="text-gray-200 dark:text-gray-700 mb-2" />
              <p className="text-xs text-gray-400">
                {search ? 'No conversations match your search' : 'No conversations yet'}
              </p>
            </div>
          ) : (
            filtered.map(conv => (
              <button
                key={conv.id}
                onClick={() => setActiveId(conv.id)}
                className={`w-full px-4 py-3 flex items-start gap-3 text-left border-b border-gray-50 dark:border-white/5 last:border-0 transition-colors
                  ${activeId === conv.id
                    ? 'bg-blue-50 dark:bg-blue-500/10'
                    : 'hover:bg-gray-50 dark:hover:bg-white/5'}`}
              >
                {/* Avatar */}
                <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-white text-[11px] font-bold ${avatarBg(conv.channel)}`}>
                  {initials(conv)}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1 mb-0.5">
                    <span className="text-xs font-semibold text-gray-900 dark:text-white truncate">
                      {conv.patientName ?? conv.phoneNumber}
                    </span>
                    <span className="text-[10px] text-gray-400 flex-shrink-0">
                      {timeAgo(conv.updatedAt)}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 mb-1">
                    <ChannelBadge channel={conv.channel} />
                    {conv.agentEnabled
                      ? <Bot  size={10} className="text-blue-500"   />
                      : <User size={10} className="text-orange-500" />
                    }
                    {!conv.agentEnabled && (
                      <span className="text-[9px] font-medium text-orange-500">takeover</span>
                    )}
                  </div>

                  {conv.lastMessage && (
                    <p className="text-[11px] text-gray-400 truncate leading-tight">
                      {conv.lastMessage.role === 'AGENT' ? '🤖 ' : ''}{conv.lastMessage.content}
                    </p>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── RIGHT: Message thread ───────────────────────────────────────────── */}
      <div className={`flex-1 flex flex-col bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden min-w-0
        ${!activeId ? 'hidden md:flex' : 'flex'}`}>

        {/* Empty state */}
        {!activeConv ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <div className="w-16 h-16 rounded-2xl bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center mb-4">
              <MessageSquare size={28} className="text-blue-300 dark:text-blue-500" />
            </div>
            <p className="text-sm font-semibold text-gray-500 dark:text-gray-400">No conversation open</p>
            <p className="text-xs text-gray-300 dark:text-gray-600 mt-1">Select one from the list</p>
          </div>
        ) : (
          <>
            {/* Thread header */}
            <div className="px-5 py-3.5 border-b border-gray-100 dark:border-white/10 flex items-center gap-3 flex-shrink-0">

              {/* Back button on mobile */}
              <button
                onClick={() => setActiveId(null)}
                className="md:hidden w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 transition-colors mr-1"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-500">
                  <polyline points="15 18 9 12 15 6"/>
                </svg>
              </button>

              <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-white text-[11px] font-bold ${avatarBg(activeConv.channel)}`}>
                {initials(activeConv)}
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-900 dark:text-white truncate">
                  {activeConv.patientName ?? activeConv.phoneNumber}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                  <ChannelBadge channel={activeConv.channel} />
                  <span className="text-[10px] text-gray-400">{activeConv.phoneNumber}</span>
                  {activeConv.agentEnabled
                    ? <span className="text-[10px] text-blue-500 font-medium">· AI active</span>
                    : <span className="text-[10px] text-orange-500 font-medium">· Human takeover</span>
                  }
                </div>
              </div>

              {activeConv.agentEnabled ? (
                <button
                  onClick={handleTakeover}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors flex-shrink-0"
                >
                  <UserX size={13} /> Take Over
                </button>
              ) : (
                <button
                  onClick={handleHandback}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-500/20 transition-colors flex-shrink-0"
                >
                  <Bot size={13} /> Hand Back to AI
                </button>
              )}
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2.5">
              {messages.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-8">No messages yet</p>
              ) : (
                messages.map(msg => {
                  if (msg.role === 'SYSTEM') {
                    return (
                      <p key={msg.id} className="text-[10px] text-gray-400 dark:text-gray-500 text-center italic py-1">
                        {msg.content}
                      </p>
                    )
                  }

                  const isAgent = msg.role === 'AGENT'

                  return (
                    <div key={msg.id} className={`flex ${isAgent ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[70%] px-3.5 py-2.5 rounded-2xl text-xs leading-relaxed ${
                        isAgent
                          ? 'bg-green-500 text-white rounded-br-sm'
                          : 'bg-gray-100 dark:bg-white/10 text-gray-800 dark:text-white rounded-bl-sm'
                      }`}>
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                        <p className={`text-[9px] mt-1 ${isAgent ? 'text-green-100' : 'text-gray-400 dark:text-gray-500'}`}>
                          {new Date(msg.createdAt).toLocaleTimeString('en-UG', {
                            hour: '2-digit', minute: '2-digit', hour12: true,
                          })}
                        </p>
                      </div>
                    </div>
                  )
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Staff input — only visible during human takeover */}
            {!activeConv.agentEnabled && (
              <div className="px-4 py-3 border-t border-gray-100 dark:border-white/10 flex-shrink-0">
                <div className="flex gap-2 items-end">
                  <textarea
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
                    }}
                    placeholder={`Reply as staff via ${activeConv.channel === 'WHATSAPP' ? 'WhatsApp' : activeConv.channel}…`}
                    rows={2}
                    className="flex-1 text-xs px-3 py-2 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-gray-900 dark:text-white placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-orange-400/40 resize-none transition-shadow"
                  />
                  <button
                    onClick={handleSend}
                    disabled={!draft.trim() || sending}
                    className="w-9 h-9 rounded-xl flex items-center justify-center bg-orange-500 hover:bg-orange-600 disabled:opacity-40 transition-colors flex-shrink-0"
                  >
                    {sending
                      ? <RefreshCw size={14} className="text-white animate-spin" />
                      : <Send size={14} className="text-white" />
                    }
                  </button>
                </div>
                <p className="text-[10px] text-orange-500 mt-1.5 flex items-center gap-1">
                  <UserX size={9} /> Human mode — AI is paused. Messages go directly to the patient.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
