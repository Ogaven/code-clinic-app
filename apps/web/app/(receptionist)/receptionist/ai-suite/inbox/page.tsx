'use client'

import { useEffect, useRef, useState } from 'react'
import { MessageSquare, Phone, Globe, Instagram, Facebook, Bot, User, Send, Loader2, Smile, Paperclip, X, Image, FileText, Music, Video } from 'lucide-react'
import { cn } from '@/lib/utils'

type Conversation = {
  id: string; channel: string; phoneNumber: string; status: string
  agentEnabled: boolean; patientName: string | null
  lastMessage: { role: string; content: string; createdAt: string } | null
  createdAt: string; updatedAt: string
}
type Message = { id: string; role: 'USER' | 'AGENT'; content: string; createdAt: string }

const CH: Record<string, { icon: any; color: string; bg: string }> = {
  WHATSAPP:  { icon: MessageSquare, color: '#25D366', bg: '#25D36618' },
  SMS:       { icon: Phone,         color: '#0891b2', bg: '#0891b218' },
  WEBSITE:   { icon: Globe,         color: '#6366f1', bg: '#6366f118' },
  FACEBOOK:  { icon: Facebook,      color: '#1877F2', bg: '#1877F218' },
  INSTAGRAM: { icon: Instagram,     color: '#E4405F', bg: '#E4405F18' },
}

// ── Inline emoji picker ────────────────────────────────────────────────────────

const EMOJI_GROUPS = [
  { label: 'Smileys', emojis: ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🥸','🤩','🥳','😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬'] },
  { label: 'Gestures', emojis: ['👍','👎','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍','👏','🙌','🤲','🤝','🙏','✍️','💅','🤳','💪','🦾','🦵','🦶','👃','👁️','👅','👋','🤚','🖐️','✋','🖖'] },
  { label: 'Hearts', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❤️‍🔥','❤️‍🩹','💕','💞','💓','💗','💖','💘','💝','💟','❣️','♥️'] },
  { label: 'Health', emojis: ['🦷','🩺','💊','💉','🩹','🩻','🧬','🔬','😷','🤒','🤕','🤑','🏥','👩‍⚕️','👨‍⚕️','🩴','🪥','🫀','🫁','🧠'] },
  { label: 'Others', emojis: ['👋','🙏','💬','📞','📱','✅','❌','⚠️','🔔','📅','🕐','🎉','🎊','✨','⭐','🌟','💫','🔥','👀','💡','📋','📝','📌','🔑'] },
]

function EmojiPicker({ onPick, onClose }: { onPick: (e: string) => void; onClose: () => void }) {
  const [tab, setTab] = useState(0)
  return (
    <div className="absolute bottom-14 left-0 z-50 bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/10 rounded-2xl shadow-2xl p-3 w-72">
      <div className="flex gap-1 mb-2 overflow-x-auto">
        {EMOJI_GROUPS.map((g, i) => (
          <button key={g.label} onClick={() => setTab(i)}
            className={cn('px-2 py-1 text-[10px] font-bold rounded-lg whitespace-nowrap transition-colors',
              tab === i ? 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-600 dark:text-cyan-400' : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10')}>
            {g.label}
          </button>
        ))}
        <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-600 dark:hover:text-white/60 transition-colors"><X size={13} /></button>
      </div>
      <div className="grid grid-cols-8 gap-0.5 max-h-40 overflow-y-auto">
        {EMOJI_GROUPS[tab].emojis.map(e => (
          <button key={e} onClick={() => { onPick(e); onClose() }}
            className="w-8 h-8 flex items-center justify-center text-lg hover:bg-gray-100 dark:hover:bg-white/10 rounded-lg transition-colors">
            {e}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Reaction bar (emoji reactions on hover) ────────────────────────────────────

const QUICK_REACTIONS = ['❤️', '😂', '😮', '😢', '🙏', '👍']

function ReactionBar({ onReact }: { onReact: (e: string) => void }) {
  return (
    <div className="absolute -top-9 left-0 flex items-center gap-0.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-white/10 rounded-full px-1.5 py-1 shadow-lg z-10">
      {QUICK_REACTIONS.map(e => (
        <button key={e} onClick={() => onReact(e)}
          className="w-7 h-7 flex items-center justify-center text-base hover:scale-125 transition-transform rounded-full">
          {e}
        </button>
      ))}
    </div>
  )
}

// ── Rich media bubble ──────────────────────────────────────────────────────────

function parseBubble(content: string) {
  if (/\[Patient sent an image\]|\[image\]/i.test(content))    return { type: 'image'    as const, caption: '' }
  if (/\[Patient sent an audio\]|\[audio\]|\[voice\]/i.test(content)) return { type: 'audio' as const, caption: '' }
  if (/\[Patient sent a video\]|\[video\]/i.test(content))    return { type: 'video'    as const, caption: '' }
  if (/\[Patient sent a document\]|\[document\]|\[file\]/i.test(content)) return { type: 'document' as const, caption: '' }
  return null
}

function MediaBubble({ type }: { type: 'image' | 'audio' | 'video' | 'document' }) {
  const cfg = {
    image:    { icon: Image,    label: 'Image',    bg: '#dcfce7', color: '#16a34a' },
    audio:    { icon: Music,    label: 'Voice note', bg: '#fef9c3', color: '#ca8a04' },
    video:    { icon: Video,    label: 'Video',    bg: '#dbeafe', color: '#2563eb' },
    document: { icon: FileText, label: 'Document', bg: '#f3e8ff', color: '#9333ea' },
  }[type]
  const Icon = cfg.icon
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: cfg.bg }}>
      <Icon size={16} style={{ color: cfg.color }} />
      <span className="text-xs font-semibold" style={{ color: cfg.color }}>{cfg.label}</span>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function InboxPage() {
  const API = '/api-proxy'
  function authH(json = false) {
    const t = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
    const h: Record<string, string> = { Authorization: `Bearer ${t}` }
    if (json) h['Content-Type'] = 'application/json'
    return h
  }

  const [convs, setConvs]         = useState<Conversation[]>([])
  const [sel, setSel]             = useState<Conversation | null>(null)
  const [msgs, setMsgs]           = useState<Message[]>([])
  const [reply, setReply]         = useState('')
  const [sending, setSending]     = useState(false)
  const [loadingC, setLoadingC]   = useState(true)
  const [loadingM, setLoadingM]   = useState(false)
  const [filter, setFilter]       = useState<'all' | 'agent' | 'human'>('all')
  const [showEmoji, setShowEmoji] = useState(false)
  const [attachment, setAttachment] = useState<File | null>(null)
  const [hoverMsg, setHoverMsg]   = useState<string | null>(null)
  const [reactions, setReactions] = useState<Record<string, string>>({})
  const msgsEnd                   = useRef<HTMLDivElement>(null)
  const fileRef                   = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchConvs()
    const t = setInterval(fetchConvs, 10000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!sel) return
    fetchMsgs(sel.id)
    const t = setInterval(() => fetchMsgs(sel.id), 5000)
    return () => clearInterval(t)
  }, [sel?.id])

  useEffect(() => { msgsEnd.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs])

  async function fetchConvs() {
    try {
      const res = await fetch(`${API}/ai-suite/conversations`, { headers: authH() })
      if (!res.ok) return
      const data: Conversation[] = await res.json()
      setConvs(data)
      if (sel) {
        const updated = data.find(c => c.id === sel.id)
        if (updated) setSel(updated)
      }
    } catch {} finally { setLoadingC(false) }
  }

  async function fetchMsgs(id: string) {
    setLoadingM(true)
    try {
      const res = await fetch(`${API}/ai-suite/conversations/${id}/messages`, { headers: authH() })
      if (res.ok) setMsgs(await res.json())
    } catch {} finally { setLoadingM(false) }
  }

  async function send() {
    if (!sel || (!reply.trim() && !attachment) || sending) return
    setSending(true)
    try {
      if (attachment) {
        // Upload media first then send
        const form = new FormData()
        form.append('file', attachment)
        form.append('conversationId', sel.id)
        const uploadRes = await fetch(`${API}/ai-suite/conversations/${sel.id}/send-media`, {
          method: 'POST',
          headers: { Authorization: authH().Authorization },
          body: form,
        })
        if (uploadRes.ok) { setAttachment(null); fetchMsgs(sel.id) }
      } else {
        const res = await fetch(`${API}/ai-suite/conversations/${sel.id}/send`, {
          method: 'POST', headers: authH(true),
          body: JSON.stringify({ text: reply.trim() }),
        })
        if (res.ok) { setReply(''); fetchMsgs(sel.id) }
      }
    } catch {} finally { setSending(false) }
  }

  async function toggleTakeover() {
    if (!sel) return
    const ep = sel.agentEnabled ? 'takeover' : 'handback'
    await fetch(`${API}/ai-suite/${ep}/${sel.id}`, { method: 'POST', headers: authH() })
    fetchConvs()
  }

  function handleReact(msgId: string, emoji: string) {
    setReactions(r => ({ ...r, [msgId]: emoji }))
    // Best-effort: send WhatsApp reaction if channel supports it
    if (sel?.channel === 'WHATSAPP') {
      fetch(`${API}/ai-suite/conversations/${sel.id}/react`, {
        method: 'POST', headers: authH(true),
        body: JSON.stringify({ messageId: msgId, emoji }),
      }).catch(() => {})
    }
  }

  const filtered = convs.filter(c => {
    if (filter === 'agent') return c.agentEnabled
    if (filter === 'human') return !c.agentEnabled
    return true
  })

  return (
    <div className="flex h-full bg-white dark:bg-transparent">

      {/* ── Conversation list ──────────────────────────────────── */}
      <div className="w-80 flex-shrink-0 border-r border-gray-100 dark:border-white/8 flex flex-col">
        <div className="p-4 border-b border-gray-100 dark:border-white/8 space-y-3">
          <h1 className="text-base font-black text-gray-800 dark:text-white">Inbox</h1>
          <div className="flex gap-1 p-1 bg-gray-100 dark:bg-white/8 rounded-xl">
            {(['all', 'agent', 'human'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={cn(
                  'flex-1 py-1.5 text-xs font-bold rounded-lg transition-all',
                  filter === f
                    ? 'bg-white dark:bg-white/15 text-gray-800 dark:text-white shadow-sm'
                    : 'text-gray-500 dark:text-white/50',
                )}>
                {f === 'agent' ? '🤖 AI' : f === 'human' ? '👤 Human' : 'All'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loadingC ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={20} className="animate-spin text-cyan-500" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <MessageSquare size={28} className="mx-auto mb-2 text-gray-200 dark:text-white/10" />
              <p className="text-sm text-gray-400">No conversations yet</p>
            </div>
          ) : filtered.map(conv => {
            const ch   = CH[conv.channel] ?? CH.SMS
            const Icon = ch.icon
            const name = conv.patientName || conv.phoneNumber
            const last = conv.lastMessage
            const time = last
              ? new Date(last.createdAt).toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Kampala' })
              : ''
            return (
              <button key={conv.id} onClick={() => setSel(conv)}
                className={cn(
                  'w-full flex items-start gap-3 px-4 py-3.5 border-b border-gray-50 dark:border-white/5 text-left transition-all',
                  sel?.id === conv.id ? 'bg-cyan-50 dark:bg-cyan-900/10' : 'hover:bg-gray-50 dark:hover:bg-white/5',
                )}>
                <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: ch.bg }}>
                  <Icon size={16} style={{ color: ch.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-sm font-semibold text-gray-800 dark:text-white truncate">{name}</span>
                    <span className="text-[10px] text-gray-400 dark:text-white/40 flex-shrink-0 ml-1">{time}</span>
                  </div>
                  <p className="text-xs text-gray-400 dark:text-white/40 truncate">
                    {last ? (last.role === 'AGENT' ? '🤖 ' : '') + last.content : 'No messages'}
                  </p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md"
                      style={{ background: ch.bg, color: ch.color }}>
                      {conv.channel}
                    </span>
                    {!conv.agentEnabled && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400">
                        Human
                      </span>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Message thread ─────────────────────────────────────── */}
      {sel ? (
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 dark:border-white/8">
            {(() => {
              const ch = CH[sel.channel] ?? CH.SMS
              const Icon = ch.icon
              return (
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: ch.bg }}>
                    <Icon size={18} style={{ color: ch.color }} />
                  </div>
                  <div>
                    <p className="font-bold text-gray-800 dark:text-white">{sel.patientName || sel.phoneNumber}</p>
                    <p className="text-xs text-gray-400 dark:text-white/40">{sel.channel} · {sel.phoneNumber}</p>
                  </div>
                </div>
              )
            })()}
            <button onClick={toggleTakeover}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all border',
                sel.agentEnabled
                  ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-700/40 hover:bg-amber-100'
                  : 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-700/40 hover:bg-emerald-100',
              )}>
              {sel.agentEnabled ? <><User size={13} /> Take Over</> : <><Bot size={13} /> Hand Back to AI</>}
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{ background: '#f0f2f5' }}>
            {loadingM && msgs.length === 0 ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={20} className="animate-spin text-gray-400" />
              </div>
            ) : msgs.length === 0 ? (
              <p className="text-center text-sm text-gray-400 py-12">No messages yet</p>
            ) : msgs.map(msg => {
              const isUser = msg.role === 'USER'
              const time = new Date(msg.createdAt).toLocaleTimeString('en-UG', {
                hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Kampala',
              })
              const media = parseBubble(msg.content)
              const rxn   = reactions[msg.id]
              return (
                <div key={msg.id} className={cn('flex', isUser ? 'justify-start' : 'justify-end')}
                  onMouseEnter={() => setHoverMsg(msg.id)}
                  onMouseLeave={() => setHoverMsg(null)}>
                  <div className="relative group">
                    {/* Reaction bar on hover */}
                    {hoverMsg === msg.id && (
                      <ReactionBar onReact={e => handleReact(msg.id, e)} />
                    )}
                    <div className={cn(
                      'max-w-[70%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed shadow-sm',
                      isUser ? 'bg-white text-gray-800 rounded-tl-none' : 'text-white rounded-tr-none',
                    )}
                      style={isUser ? {} : { background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
                      {media ? (
                        <MediaBubble type={media.type} />
                      ) : (
                        <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                      )}
                      <p className={cn('text-[10px] mt-1', isUser ? 'text-gray-400' : 'text-white/60')}>
                        {isUser ? '' : '🤖 '}{time}
                      </p>
                    </div>
                    {/* Reaction display */}
                    {rxn && (
                      <div className={cn('absolute -bottom-3 text-sm bg-white dark:bg-gray-800 rounded-full px-1.5 py-0.5 shadow border border-gray-100 dark:border-white/10', isUser ? 'right-0' : 'left-0')}>
                        {rxn}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
            <div ref={msgsEnd} />
          </div>

          {/* Composer */}
          <div className="border-t border-gray-100 dark:border-white/8 bg-white dark:bg-transparent">
            {/* Attachment preview chip */}
            {attachment && (
              <div className="flex items-center gap-2 px-4 pt-3">
                <div className="flex items-center gap-2 bg-gray-100 dark:bg-white/10 rounded-full px-3 py-1.5 text-xs font-semibold text-gray-600 dark:text-white/70">
                  <Paperclip size={11} />
                  <span className="max-w-[160px] truncate">{attachment.name}</span>
                  <button onClick={() => setAttachment(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-white transition-colors"><X size={11} /></button>
                </div>
              </div>
            )}

            <div className="flex items-end gap-3 p-4 relative">
              {sel.agentEnabled && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-black/40 backdrop-blur-sm z-10">
                  <span className="text-xs text-gray-500 dark:text-white/50 bg-gray-100 dark:bg-white/10 px-3 py-1.5 rounded-full">
                    AI is active — click &ldquo;Take Over&rdquo; to reply manually
                  </span>
                </div>
              )}

              {/* Emoji button */}
              <div className="relative">
                <button onClick={() => setShowEmoji(e => !e)}
                  className={cn('w-9 h-9 rounded-full flex items-center justify-center transition-colors flex-shrink-0',
                    showEmoji ? 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-600' : 'bg-gray-100 dark:bg-white/10 text-gray-500 hover:bg-gray-200 dark:hover:bg-white/15 dark:text-white/60')}>
                  <Smile size={17} />
                </button>
                {showEmoji && (
                  <EmojiPicker
                    onPick={e => setReply(r => r + e)}
                    onClose={() => setShowEmoji(false)}
                  />
                )}
              </div>

              {/* Attachment button */}
              <button onClick={() => fileRef.current?.click()}
                className="w-9 h-9 rounded-full flex items-center justify-center bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-white/60 hover:bg-gray-200 dark:hover:bg-white/15 transition-colors flex-shrink-0">
                <Paperclip size={16} />
              </button>
              <input ref={fileRef} type="file" className="hidden"
                accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.txt"
                onChange={e => { if (e.target.files?.[0]) setAttachment(e.target.files[0]); e.target.value = '' }} />

              <textarea
                value={reply}
                onChange={e => setReply(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                placeholder="Type a message…"
                rows={2}
                className="flex-1 px-4 py-3 text-sm border border-gray-200 dark:border-white/10 rounded-2xl bg-gray-50 dark:bg-white/5 dark:text-white resize-none focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all"
              />
              <button onClick={send} disabled={(!reply.trim() && !attachment) || sending}
                className="w-11 h-11 rounded-full flex items-center justify-center text-white flex-shrink-0 transition-all hover:scale-105 disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
                {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <MessageSquare size={48} className="mx-auto mb-4 text-gray-200 dark:text-white/10" />
            <p className="font-bold text-gray-400 dark:text-white/40">Select a conversation</p>
            <p className="text-sm text-gray-300 dark:text-white/20 mt-1">Choose from the list on the left</p>
          </div>
        </div>
      )}
    </div>
  )
}
