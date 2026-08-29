'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Bot, Send, Sparkles, Copy, Check, RotateCcw, ThumbsUp, ThumbsDown,
  X, BookOpen, Plus, History, Info,
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
  feedback?: 'correct' | 'needs_correction'
  correctionSaved?: boolean
  error?: boolean
}

const CATEGORIES = ['Hours', 'Pricing', 'Services', 'Policies', 'Doctors', 'Location', 'Insurance', 'Other']

function uid() { return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }

// ── Correction composer ────────────────────────────────────────────────────
function CorrectionComposer({
  initialContent, onCancel, onSaved,
}: { initialContent: string; onCancel: () => void; onSaved: () => void }) {
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
      const token = localStorage.getItem('cc_token')
      const res = await fetch('/api-proxy/ai-suite/knowledge-studio/save', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, category, content, notes }),
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
  msg, onFeedback, onRetry, showComposerFor, setShowComposerFor, onSaved,
}: {
  msg: ChatMessage
  onFeedback: (id: string, feedback: 'correct' | 'needs_correction') => void
  onRetry: () => void
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
            <Info size={11} /> Not found in the knowledge base — this answer isn't grounded.
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

        {!msg.error && (
          <div className="mt-1.5 flex items-center gap-1">
            <button onClick={copy} title="Copy response" className="w-6 h-6 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10 hover:text-gray-600 dark:hover:text-white/70 transition-colors">
              {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
            </button>
            <button onClick={onRetry} title="Retry" className="w-6 h-6 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10 hover:text-gray-600 dark:hover:text-white/70 transition-colors">
              <RotateCcw size={12} />
            </button>
            <span className="w-px h-3.5 bg-gray-200 dark:bg-white/10 mx-1" />
            <button onClick={() => onFeedback(msg.id, 'correct')}
              className={cn('flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition-colors',
                msg.feedback === 'correct' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10 hover:text-gray-600')}>
              <ThumbsUp size={11} /> Correct
            </button>
            <button onClick={() => { onFeedback(msg.id, 'needs_correction'); setShowComposerFor(msg.id) }}
              className={cn('flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition-colors',
                msg.feedback === 'needs_correction' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10 hover:text-gray-600')}>
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
            initialContent={msg.suggestedContent || ''}
            onCancel={() => setShowComposerFor(null)}
            onSaved={() => { onSaved(msg.id); setShowComposerFor(null) }}
          />
        )}
      </div>
    </div>
  )
}

// ── Main panel ───────────────────────────────────────────────────────────────
export default function KnowledgeTrainerChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [showComposerFor, setShowComposerFor] = useState<string | null>(null)
  const [showHistoryNote, setShowHistoryNote] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => { scrollRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading])

  // `baseMessages` defaults to current state for the normal composer-driven
  // send, but retryLast() passes an explicit array instead of relying on it —
  // React state setters are async, so reading the `messages` closure right
  // after calling setMessages() would still see the pre-update value.
  async function sendMessage(text: string, baseMessages: ChatMessage[] = messages) {
    const trimmed = text.trim()
    if (!trimmed || loading) return
    const userMsg: ChatMessage = { id: uid(), role: 'user', content: trimmed }
    const nextMessages = [...baseMessages, userMsg]
    setMessages(nextMessages)
    setInput('')
    setLoading(true)
    try {
      const token = localStorage.getItem('cc_token')
      // History is prior turns ONLY — the new message is sent separately as
      // `message` and the backend appends it as the final turn itself.
      // Including it in history too would send it to Claude twice.
      const history = baseMessages.slice(-10).map(m => ({ role: m.role, content: m.content }))
      const res = await fetch('/api-proxy/ai-suite/knowledge-studio/chat', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed, history }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setMessages(m => [...m, { id: uid(), role: 'assistant', content: d.error || 'Something went wrong.', error: true }])
        return
      }
      const data = await res.json()
      setMessages(m => [...m, {
        id: uid(), role: 'assistant', content: data.reply,
        sources: data.sources, grounded: data.grounded,
        suggestSave: data.suggestSave, suggestedContent: data.suggestedContent,
      }])
    } catch {
      setMessages(m => [...m, { id: uid(), role: 'assistant', content: "Couldn't reach the clinic AI — please try again.", error: true }])
    } finally { setLoading(false) }
  }

  function retryLast() {
    const lastUser = [...messages].reverse().find(m => m.role === 'user')
    if (!lastUser) return
    // Drop everything from the last user message onward, then resend it —
    // `base` is passed explicitly into sendMessage rather than left to the
    // `messages` state/closure, which wouldn't reflect this truncation yet.
    const idx = messages.findIndex(m => m.id === lastUser.id)
    const base = messages.slice(0, idx)
    setMessages(base)
    sendMessage(lastUser.content, base)
  }

  function startNewChat() {
    setMessages([])
    setShowComposerFor(null)
    setInput('')
  }

  function onFeedback(id: string, feedback: 'correct' | 'needs_correction') {
    setMessages(m => m.map(msg => msg.id === id ? { ...msg, feedback } : msg))
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
            <p className="text-[11px] text-gray-400 dark:text-white/35 truncate">Test, correct and improve what Code Clinic AI knows.</p>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <div className="relative">
            <button onClick={() => setShowHistoryNote(s => !s)} title="Previous chats"
              className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10 hover:text-gray-600 dark:hover:text-white/70 transition-colors">
              <History size={15} />
            </button>
            {showHistoryNote && (
              <div className="absolute right-0 top-full mt-2 w-64 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0e2045] shadow-xl p-3 z-20 text-[11px] text-gray-500 dark:text-white/50">
                Persistent chat history isn't available yet — it needs a small, separate database table that's pending approval. Right now each chat lives only for this browser session.
              </div>
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
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center gap-2 py-10">
            <Bot size={28} className="text-gray-200 dark:text-white/10" />
            <p className="text-sm font-semibold text-gray-500 dark:text-white/40">Ask the clinic AI or teach it something</p>
            <p className="text-xs text-gray-400 dark:text-white/25 max-w-[240px]">Answers are grounded in the same Knowledge Base WhatsApp, the website and social AI use.</p>
          </div>
        )}
        {messages.map(msg => (
          <MessageBubble key={msg.id} msg={msg} onFeedback={onFeedback} onRetry={retryLast}
            showComposerFor={showComposerFor} setShowComposerFor={setShowComposerFor} onSaved={onSaved} />
        ))}
        {loading && (
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
          disabled={!input.trim() || loading}
          onClick={() => sendMessage(input)}
          className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-xl text-white transition-all disabled:opacity-40"
          style={{ background: 'linear-gradient(135deg,#29ABE2,#1A237E)' }}>
          <Send size={16} />
        </button>
      </div>
    </div>
  )
}
