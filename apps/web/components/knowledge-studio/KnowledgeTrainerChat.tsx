'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Bot, Send, Sparkles, Copy, Check, RotateCcw, ThumbsUp, ThumbsDown,
  X, BookOpen, Plus, History, Pencil, Trash2, AlertTriangle,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type Role = 'user' | 'assistant'

interface Source { id: string; title: string; sourceUrl: string | null }

interface ChatMessage {
  id: string
  role: Role
  content: string
  sources?: Source[]
  grounded?: boolean
  suggestSave?: boolean
  suggestedContent?: string
  feedback?: 'CORRECT' | 'NEEDS_CORRECTION' | null
  correctionSaved?: boolean
  error?: boolean
  pending?: boolean
}

interface ConversationSummary {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

const CATEGORIES = ['Hours', 'Pricing', 'Services', 'Policies', 'Doctors', 'Location', 'Insurance', 'Other']

function uid() { return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }

function authHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  return { Authorization: `Bearer ${token}` }
}

// ── Correction composer ────────────────────────────────────────────────────
function CorrectionComposer({
  conversationId, messageId, initialContent, onCancel, onSaved,
}: { conversationId: string | null; messageId: string; initialContent: string; onCancel: () => void; onSaved: () => void }) {
  const [step, setStep] = useState<'edit' | 'review'>('edit')
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState(CATEGORIES[0])
  const [content, setContent] = useState(initialContent)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    setSaving(true); setError('')
    try {
      const res = await fetch('/api-proxy/ai-suite/knowledge-studio/save', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, messageId, title, category, content, notes }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || 'Failed to save'); return }
      onSaved()
    } catch { setError('Network error — please try again.') } finally { setSaving(false) }
  }

  return (
    <div className="mt-2 rounded-2xl border border-cyan-200 dark:border-cyan-500/30 bg-cyan-50/50 dark:bg-cyan-900/10 p-3.5 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-cyan-700 dark:text-cyan-300 flex items-center gap-1.5">
          <BookOpen size={13} /> {step === 'edit' ? 'Teach the correct answer' : 'Review before saving'}
        </p>
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 dark:hover:text-white/70"><X size={14} /></button>
      </div>

      {step === 'edit' ? (
        <>
          <div>
            <label className="text-[10px] font-bold text-gray-500 dark:text-white/40 uppercase tracking-wide mb-1 block">Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Saturday closing time"
              className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-gray-500 dark:text-white/40 uppercase tracking-wide mb-1 block">Category</label>
            <select value={category} onChange={e => setCategory(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 dark:text-white focus:outline-none">
              {CATEGORIES.map(c => <option key={c} value={c} className="dark:bg-gray-800">{c}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-gray-500 dark:text-white/40 uppercase tracking-wide mb-1 block">Correct information</label>
            <textarea value={content} onChange={e => setContent(e.target.value)} rows={3}
              placeholder="Write the accurate clinic information exactly as the AI should state it..."
              className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20 resize-none" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-gray-500 dark:text-white/40 uppercase tracking-wide mb-1 block">Notes / context (optional)</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Why this correction, or where it came from"
              className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onCancel} className="px-3.5 py-2 rounded-xl text-xs font-semibold text-gray-500 dark:text-white/50 hover:bg-white dark:hover:bg-white/5">Cancel</button>
            <button disabled={!title.trim() || !content.trim()} onClick={() => setStep('review')}
              className="px-3.5 py-2 rounded-xl text-xs font-bold text-white disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg,#0c1e50,#29ABE2)' }}>Review</button>
          </div>
        </>
      ) : (
        <>
          <div className="rounded-xl bg-white dark:bg-white/5 border border-gray-100 dark:border-white/10 p-3 space-y-2 text-xs">
            <p><span className="font-bold text-gray-500 dark:text-white/40">Title: </span><span className="text-gray-800 dark:text-white">{title}</span></p>
            <p><span className="font-bold text-gray-500 dark:text-white/40">Category: </span><span className="text-gray-800 dark:text-white">{category}</span></p>
            <p><span className="font-bold text-gray-500 dark:text-white/40">Content: </span><span className="text-gray-800 dark:text-white whitespace-pre-wrap">{content}</span></p>
            {notes && <p><span className="font-bold text-gray-500 dark:text-white/40">Notes: </span><span className="text-gray-800 dark:text-white">{notes}</span></p>}
          </div>
          {error && <p className="text-xs text-red-500 font-semibold">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setStep('edit')} className="px-3.5 py-2 rounded-xl text-xs font-semibold text-gray-500 dark:text-white/50 hover:bg-white dark:hover:bg-white/5">Back</button>
            <button disabled={saving} onClick={save}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold text-white disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg,#059669,#10b981)' }}>
              {saving ? <><span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Saving...</> : <>Save as Knowledge</>}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ── Single message bubble ───────────────────────────────────────────────────
function MessageBubble({
  msg, conversationId, onFeedback, onRetry, showComposerFor, setShowComposerFor, onSaved,
}: {
  msg: ChatMessage
  conversationId: string | null
  onFeedback: (id: string, feedback: 'CORRECT' | 'NEEDS_CORRECTION') => void
  onRetry: (id: string) => void
  showComposerFor: string | null
  setShowComposerFor: (id: string | null) => void
  onSaved: (id: string) => void
}) {
  const [copied, setCopied] = useState(false)
  const isUser = msg.role === 'user'

  function copy() {
    navigator.clipboard?.writeText(msg.content).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
  }

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-tr-sm px-3.5 py-2.5 text-sm text-white" style={{ background: 'linear-gradient(135deg,#29ABE2,#1A237E)' }}>
          {msg.content}
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-start gap-2.5">
      <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: msg.error ? '#EF4444' : 'linear-gradient(135deg,#0d9488,#14b8a6)' }}>
        <Bot size={13} className="text-white" />
      </div>
      <div className="flex-1 min-w-0 max-w-[92%]">
        <div className={cn(
          'rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-sm whitespace-pre-wrap',
          msg.error ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400' : 'bg-gray-100 dark:bg-white/[0.06] text-gray-800 dark:text-white',
        )}>
          {msg.content}
        </div>

        {!msg.error && msg.grounded === false && (
          <p className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
            <AlertTriangle size={11} /> Not found in the knowledge base — this answer isn't grounded.
          </p>
        )}

        {!!msg.sources?.length && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-bold text-gray-400 dark:text-white/30">Sources used:</span>
            {msg.sources.map(s => (
              <span key={s.id} className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-cyan-50 dark:bg-cyan-900/20 text-cyan-700 dark:text-cyan-300">{s.title}</span>
            ))}
          </div>
        )}

        {msg.error ? (
          <div className="mt-1.5">
            <button onClick={() => onRetry(msg.id)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors">
              <RotateCcw size={12} /> Retry
            </button>
          </div>
        ) : (
          <div className="mt-1.5 flex items-center gap-1">
            <button onClick={copy} title="Copy response" className="w-6 h-6 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10 hover:text-gray-600 dark:hover:text-white/70 transition-colors">
              {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
            </button>
            <button onClick={() => onRetry(msg.id)} title="Retry" className="w-6 h-6 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10 hover:text-gray-600 dark:hover:text-white/70 transition-colors">
              <RotateCcw size={12} />
            </button>
            <span className="w-px h-3.5 bg-gray-200 dark:bg-white/10 mx-1" />
            <button onClick={() => onFeedback(msg.id, 'CORRECT')}
              className={cn('flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition-colors',
                msg.feedback === 'CORRECT' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10 hover:text-gray-600')}>
              <ThumbsUp size={11} /> Correct
            </button>
            <button onClick={() => { onFeedback(msg.id, 'NEEDS_CORRECTION'); setShowComposerFor(msg.id) }}
              className={cn('flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition-colors',
                msg.feedback === 'NEEDS_CORRECTION' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10 hover:text-gray-600')}>
              <ThumbsDown size={11} /> Needs correction
            </button>
          </div>
        )}

        {msg.suggestSave && !msg.correctionSaved && showComposerFor !== msg.id && (
          <button onClick={() => setShowComposerFor(msg.id)}
            className="mt-2 w-full flex items-center gap-2 rounded-xl border border-dashed border-cyan-300 dark:border-cyan-500/40 bg-cyan-50/40 dark:bg-cyan-900/10 px-3 py-2 text-left hover:bg-cyan-50 dark:hover:bg-cyan-900/20 transition-colors">
            <Sparkles size={13} className="text-cyan-500 flex-shrink-0" />
            <span className="text-xs font-semibold text-cyan-700 dark:text-cyan-300">It sounds like you're teaching me something — save this to the Knowledge Base?</span>
          </button>
        )}

        {msg.correctionSaved && (
          <p className="mt-1.5 flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
            <Check size={11} /> Saved to the Knowledge Base
          </p>
        )}

        {showComposerFor === msg.id && !msg.correctionSaved && (
          <CorrectionComposer
            conversationId={conversationId}
            messageId={msg.id}
            initialContent={msg.suggestedContent || ''}
            onCancel={() => setShowComposerFor(null)}
            onSaved={() => { onSaved(msg.id); setShowComposerFor(null) }}
          />
        )}
      </div>
    </div>
  )
}

// ── History panel ────────────────────────────────────────────────────────────
function HistoryPanel({
  conversations, activeId, loading, onSelect, onNew, onRename, onDelete, onClose,
}: {
  conversations: ConversationSummary[]
  activeId: string | null
  loading: boolean
  onSelect: (id: string) => void
  onNew: () => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
  onClose: () => void
}) {
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [pendingDelete, setPendingDelete] = useState<ConversationSummary | null>(null)

  function startRename(c: ConversationSummary) { setRenamingId(c.id); setRenameValue(c.title) }
  function commitRename() {
    if (renamingId && renameValue.trim()) onRename(renamingId, renameValue.trim())
    setRenamingId(null)
  }

  return (
    <div className="absolute right-0 top-full mt-2 w-72 max-h-96 overflow-y-auto rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0e2045] shadow-xl z-20">
      <div className="p-2 border-b border-gray-100 dark:border-white/10">
        <button onClick={onNew} className="w-full flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-bold text-cyan-600 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-900/20 hover:bg-cyan-100 dark:hover:bg-cyan-900/30 transition-colors">
          <Plus size={13} /> New Chat
        </button>
      </div>
      <div className="py-1">
        {loading ? (
          <div className="px-3 py-6 text-center text-xs text-gray-400">Loading…</div>
        ) : conversations.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-gray-400">No previous chats yet</div>
        ) : conversations.map(c => (
          <div key={c.id}
            className={cn('group flex items-center gap-1 px-2 py-1.5 mx-1 rounded-lg cursor-pointer',
              c.id === activeId ? 'bg-cyan-50 dark:bg-cyan-900/20' : 'hover:bg-gray-50 dark:hover:bg-white/5')}>
            {renamingId === c.id ? (
              <input autoFocus value={renameValue} onChange={e => setRenameValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingId(null) }}
                onBlur={commitRename}
                className="flex-1 min-w-0 px-1.5 py-0.5 text-xs rounded border border-cyan-300 dark:border-cyan-500/40 bg-white dark:bg-white/10 dark:text-white focus:outline-none" />
            ) : (
              <button onClick={() => onSelect(c.id)} className="flex-1 min-w-0 text-left text-xs font-semibold text-gray-700 dark:text-white/80 truncate py-0.5">
                {c.title}
              </button>
            )}
            <button onClick={() => startRename(c)} title="Rename" className="opacity-0 group-hover:opacity-100 w-6 h-6 flex-shrink-0 flex items-center justify-center rounded text-gray-400 hover:text-gray-600 dark:hover:text-white/70">
              <Pencil size={11} />
            </button>
            <button onClick={() => setPendingDelete(c)} title="Delete" className="opacity-0 group-hover:opacity-100 w-6 h-6 flex-shrink-0 flex items-center justify-center rounded text-gray-400 hover:text-red-500">
              <Trash2 size={11} />
            </button>
          </div>
        ))}
      </div>

      {pendingDelete && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setPendingDelete(null)}>
          <div onClick={e => e.stopPropagation()} className="bg-white dark:bg-[#0e2045] rounded-2xl shadow-2xl border border-gray-100 dark:border-white/10 w-full max-w-sm p-5 space-y-3">
            <div className="w-10 h-10 rounded-xl bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
              <AlertTriangle size={18} className="text-red-500" />
            </div>
            <h3 className="text-sm font-bold text-gray-800 dark:text-white">Delete this chat?</h3>
            <p className="text-sm text-gray-500 dark:text-white/50">
              <span className="font-semibold text-gray-700 dark:text-white/70">{pendingDelete.title}</span> and all its messages will be permanently deleted. This can't be undone.
            </p>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setPendingDelete(null)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold border border-gray-200 dark:border-white/10 text-gray-600 dark:text-white/60">Cancel</button>
              <button onClick={() => { onDelete(pendingDelete.id); setPendingDelete(null) }} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold text-white bg-red-500 hover:bg-red-600 transition-colors">
                <Trash2 size={13} /> Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main panel ───────────────────────────────────────────────────────────────
export default function KnowledgeTrainerChat() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [conversationsLoading, setConversationsLoading] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  const [conversationId, setConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loadingConversation, setLoadingConversation] = useState(false)

  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [showComposerFor, setShowComposerFor] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => { scrollRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, sending])
  useEffect(() => { loadConversations() }, [])

  async function loadConversations() {
    setConversationsLoading(true)
    try {
      const res = await fetch('/api-proxy/ai-suite/knowledge-studio/conversations', { headers: authHeaders() })
      if (res.ok) { const d = await res.json(); setConversations(d.conversations || []) }
    } catch {} finally { setConversationsLoading(false) }
  }

  async function selectConversation(id: string) {
    setShowHistory(false)
    setLoadingConversation(true)
    setConversationId(id)
    setShowComposerFor(null)
    try {
      const res = await fetch(`/api-proxy/ai-suite/knowledge-studio/conversations/${id}`, { headers: authHeaders() })
      if (!res.ok) { setMessages([]); return }
      const d = await res.json()
      setMessages((d.messages || []).map((m: any): ChatMessage => ({
        id: m.id, role: m.role, content: m.content, feedback: m.feedback ?? null,
      })))
    } catch { setMessages([]) } finally { setLoadingConversation(false) }
  }

  function startNewChat() {
    setShowHistory(false)
    setConversationId(null)
    setMessages([])
    setShowComposerFor(null)
    setInput('')
  }

  async function renameConversation(id: string, title: string) {
    setConversations(cs => cs.map(c => c.id === id ? { ...c, title } : c))
    try {
      await fetch(`/api-proxy/ai-suite/knowledge-studio/conversations/${id}`, {
        method: 'PATCH', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ title }),
      })
    } catch {}
  }

  async function deleteConversation(id: string) {
    setConversations(cs => cs.filter(c => c.id !== id))
    if (conversationId === id) startNewChat()
    try {
      await fetch(`/api-proxy/ai-suite/knowledge-studio/conversations/${id}`, { method: 'DELETE', headers: authHeaders() })
    } catch {}
  }

  async function sendMessage(text: string) {
    const trimmed = text.trim()
    if (!trimmed || sending) return
    const userMsg: ChatMessage = { id: uid(), role: 'user', content: trimmed }
    setMessages(m => [...m, userMsg])
    setInput('')
    setSending(true)
    try {
      const res = await fetch('/api-proxy/ai-suite/knowledge-studio/chat', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed, conversationId: conversationId || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        // The server persisted the USER turn even on failure — replace our
        // optimistic local id with the real one so Retry targets the actual row.
        if (data.userMessageId) setMessages(m => m.map(x => x.id === userMsg.id ? { ...x, id: data.userMessageId } : x))
        if (data.conversationId && !conversationId) { setConversationId(data.conversationId); loadConversations() }
        setMessages(m => [...m, { id: uid(), role: 'assistant', content: data.error || 'Something went wrong.', error: true }])
        return
      }
      if (data.conversationId && data.conversationId !== conversationId) { setConversationId(data.conversationId); loadConversations() }
      else loadConversations()
      setMessages(m => [
        ...m.map(x => x.id === userMsg.id ? { ...x, id: data.userMessageId } : x),
        { id: data.messageId, role: 'assistant', content: data.reply, sources: data.sources, grounded: data.grounded, suggestSave: data.suggestSave, suggestedContent: data.suggestedContent },
      ])
    } catch {
      setMessages(m => [...m, { id: uid(), role: 'assistant', content: "Couldn't reach the clinic AI — please try again.", error: true }])
    } finally { setSending(false) }
  }

  // Retry regenerates a reply for an existing unanswered USER message rather
  // than resending it as a brand-new turn — the server rejects retryOf if
  // anything already followed that message, so this only ever applies to a
  // genuinely stuck/failed last turn.
  async function retryMessage(anchorId: string) {
    if (sending) return
    const anchor = messages.find(m => m.id === anchorId)
    const targetUserId = anchor?.role === 'user' ? anchor.id : [...messages].reverse().find(m => m.role === 'user')?.id
    if (!targetUserId) return

    const idx = messages.findIndex(m => m.id === targetUserId)
    setMessages(messages.slice(0, idx + 1))
    setSending(true)
    try {
      const res = await fetch('/api-proxy/ai-suite/knowledge-studio/chat', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ retryOf: targetUserId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessages(m => [...m, { id: uid(), role: 'assistant', content: data.error || 'Something went wrong.', error: true }])
        return
      }
      setMessages(m => [...m, {
        id: data.messageId, role: 'assistant', content: data.reply,
        sources: data.sources, grounded: data.grounded, suggestSave: data.suggestSave, suggestedContent: data.suggestedContent,
      }])
      loadConversations()
    } catch {
      setMessages(m => [...m, { id: uid(), role: 'assistant', content: "Couldn't reach the clinic AI — please try again.", error: true }])
    } finally { setSending(false) }
  }

  async function onFeedback(id: string, feedback: 'CORRECT' | 'NEEDS_CORRECTION') {
    setMessages(m => m.map(msg => msg.id === id ? { ...msg, feedback } : msg))
    try {
      await fetch(`/api-proxy/ai-suite/knowledge-studio/messages/${id}/feedback`, {
        method: 'PATCH', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ feedback }),
      })
    } catch {}
  }

  function onSaved(id: string) {
    setMessages(m => m.map(msg => msg.id === id ? { ...msg, correctionSaved: true } : msg))
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  return (
    <div className="flex h-full flex-col bg-white dark:bg-white/[0.03] border border-gray-100 dark:border-white/10 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-100 dark:border-white/8 flex-shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg,#0c1e50,#29ABE2)' }}>
            <Sparkles size={15} className="text-white" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-black text-gray-800 dark:text-white truncate">AI Knowledge Trainer</h2>
            <p className="text-[11px] text-gray-400 dark:text-white/35 truncate">Reflects WhatsApp, Website, Messenger &amp; Instagram DM knowledge — not Voice, SMS or Comments yet.</p>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <div className="relative">
            <button onClick={() => setShowHistory(s => !s)} title="Previous chats"
              className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10 hover:text-gray-600 dark:hover:text-white/70 transition-colors">
              <History size={15} />
            </button>
            {showHistory && (
              <HistoryPanel
                conversations={conversations}
                activeId={conversationId}
                loading={conversationsLoading}
                onSelect={selectConversation}
                onNew={startNewChat}
                onRename={renameConversation}
                onDelete={deleteConversation}
                onClose={() => setShowHistory(false)}
              />
            )}
          </div>
          <button onClick={startNewChat} title="New chat"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold text-cyan-600 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-900/20 hover:bg-cyan-100 dark:hover:bg-cyan-900/30 transition-colors">
            <Plus size={13} /> New Chat
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {loadingConversation ? (
          <div className="h-full flex items-center justify-center">
            <div className="w-5 h-5 border-2 border-gray-200 dark:border-white/10 border-t-cyan-500 rounded-full animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center gap-2 py-10">
            <Bot size={28} className="text-gray-200 dark:text-white/10" />
            <p className="text-sm font-semibold text-gray-500 dark:text-white/40">Ask the clinic AI or teach it something</p>
            <p className="text-xs text-gray-400 dark:text-white/25 max-w-[240px]">Answers are grounded in the same Knowledge Base WhatsApp, the website and social AI use.</p>
          </div>
        ) : messages.map(msg => (
          <MessageBubble key={msg.id} msg={msg} conversationId={conversationId} onFeedback={onFeedback} onRetry={retryMessage}
            showComposerFor={showComposerFor} setShowComposerFor={setShowComposerFor} onSaved={onSaved} />
        ))}
        {sending && (
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg,#0d9488,#14b8a6)' }}>
              <Bot size={13} className="text-white" />
            </div>
            <div className="rounded-2xl rounded-tl-sm px-4 py-3 bg-gray-100 dark:bg-white/[0.06]">
              <div className="flex gap-1 items-center h-3">
                {[0, 1, 2].map(i => <span key={i} className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-white/40 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />)}
              </div>
            </div>
          </div>
        )}
        <div ref={scrollRef} />
      </div>

      {/* Composer */}
      <div className="flex items-end gap-2 px-3.5 py-3 border-t border-gray-100 dark:border-white/8 flex-shrink-0">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder="Ask the clinic AI or teach it something..."
          className="flex-1 resize-none max-h-32 px-3.5 py-2.5 text-sm rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 dark:text-white placeholder-gray-400 dark:placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500"
        />
        <button
          disabled={!input.trim() || sending}
          onClick={() => sendMessage(input)}
          className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-xl text-white transition-all disabled:opacity-40"
          style={{ background: 'linear-gradient(135deg,#29ABE2,#1A237E)' }}>
          <Send size={16} />
        </button>
      </div>
    </div>
  )
}
