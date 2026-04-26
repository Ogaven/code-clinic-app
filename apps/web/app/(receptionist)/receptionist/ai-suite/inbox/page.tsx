'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import {
  Search, Send, Paperclip, Smile, X, Loader2,
  MessageSquare, Instagram, Facebook, Globe, Bot, UserCheck,
  Image as ImageIcon, FileText, Music, Video as VideoIcon, Check, CheckCheck,
  ChevronLeft,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ── API helpers ────────────────────────────────────────────────────────────────
const API = '/api-proxy'
function authH(json = false) {
  const t = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const h: Record<string, string> = { Authorization: `Bearer ${t}` }
  if (json) h['Content-Type'] = 'application/json'
  return h
}

// ── Types ──────────────────────────────────────────────────────────────────────
type Conversation = {
  id: string; channel: string; phoneNumber: string; status: string
  agentEnabled: boolean; patientName: string | null
  lastMessage: { role: string; content: string; createdAt: string } | null
  createdAt: string; updatedAt: string
}
type Message = { id: string; role: 'USER' | 'AGENT'; content: string; createdAt: string }

// ── Channel config ─────────────────────────────────────────────────────────────
type ChannelKey = 'WHATSAPP' | 'INSTAGRAM' | 'FACEBOOK' | 'WEBSITE'
const CHANNELS: { key: ChannelKey; label: string; apiVal: string }[] = [
  { key: 'WHATSAPP',  label: 'WhatsApp',       apiVal: 'whatsapp'  },
  { key: 'INSTAGRAM', label: 'Instagram',       apiVal: 'instagram' },
  { key: 'FACEBOOK',  label: 'Facebook',        apiVal: 'facebook'  },
  { key: 'WEBSITE',   label: 'Website Chatbot', apiVal: 'website'   },
]
const CH_ICON: Record<ChannelKey, React.ComponentType<any>> = {
  WHATSAPP:  MessageSquare,
  INSTAGRAM: Instagram,
  FACEBOOK:  Facebook,
  WEBSITE:   Globe,
}
const CH_COLOR: Record<ChannelKey, string> = {
  WHATSAPP:  '#25D366',
  INSTAGRAM: '#E4405F',
  FACEBOOK:  '#1877F2',
  WEBSITE:   '#6366f1',
}

// ── Avatar ─────────────────────────────────────────────────────────────────────
const PALETTE = ['#E91E63','#1565C0','#00897B','#F57F17','#6A1B9A','#2E7D32','#AD1457','#0277BD','#4E342E','#FF6F00','#1A237E','#00695C']
function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}
function avatarColor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return PALETTE[Math.abs(h) % PALETTE.length]
}
function Avatar({ name, size = 40, online }: { name: string; size?: number; online?: boolean }) {
  return (
    <div className="relative flex-shrink-0">
      <div className="rounded-full flex items-center justify-center text-white font-bold"
        style={{ width: size, height: size, background: avatarColor(name), fontSize: size * 0.35 }}>
        {initials(name)}
      </div>
      {online && (
        <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-400 border-2 border-white dark:border-[#111B21]" />
      )}
    </div>
  )
}

// ── Time helpers ───────────────────────────────────────────────────────────────
function fmtTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diffDays === 0) return d.toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Kampala' })
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7)  return d.toLocaleDateString('en-UG', { weekday: 'short' })
  return d.toLocaleDateString('en-UG', { day: 'numeric', month: 'short' })
}
function fmtFull(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Kampala' })
}

// ── Media bubble detection ─────────────────────────────────────────────────────
function parseBubble(content: string) {
  if (/\[Patient sent an image\]|\[image\]/i.test(content))    return 'image'
  if (/\[Patient sent an audio\]|\[audio\]|\[voice\]/i.test(content)) return 'audio'
  if (/\[Patient sent a video\]|\[video\]/i.test(content))     return 'video'
  if (/\[Patient sent a document\]|\[document\]|\[file\]/i.test(content)) return 'document'
  return null
}
function MediaBubble({ type }: { type: string }) {
  const cfg: Record<string, { Icon: any; label: string }> = {
    image:    { Icon: ImageIcon,  label: 'Image'     },
    audio:    { Icon: Music,      label: 'Voice note' },
    video:    { Icon: VideoIcon,  label: 'Video'     },
    document: { Icon: FileText,   label: 'Document'  },
  }
  const { Icon, label } = cfg[type] || cfg.document
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-black/10">
      <Icon size={15} />
      <span className="text-xs font-semibold">{label}</span>
    </div>
  )
}

// ── Emoji picker ───────────────────────────────────────────────────────────────
const EMOJI_GROUPS = [
  { label: '😀', emojis: ['😀','😃','😄','😁','😅','😂','🤣','😊','😇','🙂','😉','😍','🥰','😘','😋','😎','🥸','😏','😒','😢','😭','😤','😠','🤬','🤔','🤗','🙏'] },
  { label: '👍', emojis: ['👍','👎','👌','✌️','🤞','🤝','👏','🙌','💪','🦾','✍️','👋','💅'] },
  { label: '❤️', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','💔','💕','💖','💝'] },
  { label: '🦷', emojis: ['🦷','🩺','💊','💉','🩹','😷','🏥','👩‍⚕️','👨‍⚕️','🧬','🔬','🩻'] },
  { label: '✅', emojis: ['✅','❌','⚠️','🔔','📅','🕐','🎉','✨','⭐','🔥','💡','📋','📝','📌','🔑'] },
]
function EmojiPicker({ onPick, onClose }: { onPick: (e: string) => void; onClose: () => void }) {
  const [tab, setTab] = useState(0)
  return (
    <div className="absolute bottom-14 left-0 z-50 bg-white dark:bg-[#1F2C34] border border-gray-200 dark:border-white/10 rounded-2xl shadow-2xl p-3 w-72">
      <div className="flex gap-1 mb-2">
        {EMOJI_GROUPS.map((g, i) => (
          <button key={i} onClick={() => setTab(i)}
            className={cn('w-8 h-8 flex items-center justify-center text-base rounded-lg transition-colors', tab === i ? 'bg-[#00a884]/20' : 'hover:bg-gray-100 dark:hover:bg-white/10')}>
            {g.label}
          </button>
        ))}
        <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-600 dark:hover:text-white/60"><X size={13} /></button>
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

// ── Main page ──────────────────────────────────────────────────────────────────
export default function InboxPage() {
  const [channel,    setChannel]    = useState<ChannelKey>('WHATSAPP')
  const [convs,      setConvs]      = useState<Conversation[]>([])
  const [sel,        setSel]        = useState<Conversation | null>(null)
  const [msgs,       setMsgs]       = useState<Message[]>([])
  const [reply,      setReply]      = useState('')
  const [sending,    setSending]    = useState(false)
  const [loadingC,   setLoadingC]   = useState(true)
  const [loadingM,   setLoadingM]   = useState(false)
  const [search,     setSearch]     = useState('')
  const [showEmoji,  setShowEmoji]  = useState(false)
  const [attachment, setAttachment] = useState<File | null>(null)
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list')

  const msgsEnd  = useRef<HTMLDivElement>(null)
  const fileRef  = useRef<HTMLInputElement>(null)
  const pollConv = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollMsg  = useRef<ReturnType<typeof setInterval> | null>(null)

  // Fetch conversations for selected channel
  const fetchConvs = useCallback(async () => {
    try {
      const ch = CHANNELS.find(c => c.key === channel)?.apiVal || 'whatsapp'
      const res = await fetch(`${API}/ai-suite/conversations?channel=${ch}`, { headers: authH() })
      if (!res.ok) return
      const data: Conversation[] = await res.json()
      setConvs(data)
      if (sel) {
        const updated = data.find(c => c.id === sel.id)
        if (updated) setSel(updated)
      }
    } catch {} finally { setLoadingC(false) }
  }, [channel, sel?.id])

  const fetchMsgs = useCallback(async (id: string) => {
    setLoadingM(true)
    try {
      const res = await fetch(`${API}/ai-suite/conversations/${id}/messages`, { headers: authH() })
      if (res.ok) setMsgs(await res.json())
    } catch {} finally { setLoadingM(false) }
  }, [])

  // Reset + refetch when channel changes
  useEffect(() => {
    setSel(null); setConvs([]); setMsgs([]); setLoadingC(true)
    if (pollConv.current) clearInterval(pollConv.current)
    fetchConvs()
    pollConv.current = setInterval(fetchConvs, 10000)
    return () => { if (pollConv.current) clearInterval(pollConv.current) }
  }, [channel])

  // Poll messages when conversation selected
  useEffect(() => {
    if (pollMsg.current) clearInterval(pollMsg.current)
    if (!sel) return
    fetchMsgs(sel.id)
    pollMsg.current = setInterval(() => fetchMsgs(sel.id), 5000)
    return () => { if (pollMsg.current) clearInterval(pollMsg.current) }
  }, [sel?.id])

  useEffect(() => { msgsEnd.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs])

  async function send() {
    if (!sel || (!reply.trim() && !attachment) || sending) return
    setSending(true)
    try {
      if (attachment) {
        const form = new FormData()
        form.append('file', attachment)
        form.append('conversationId', sel.id)
        await fetch(`${API}/ai-suite/conversations/${sel.id}/send-media`, {
          method: 'POST', headers: { Authorization: authH().Authorization }, body: form,
        })
        setAttachment(null)
      } else {
        await fetch(`${API}/ai-suite/conversations/${sel.id}/send`, {
          method: 'POST', headers: authH(true), body: JSON.stringify({ text: reply.trim() }),
        })
        setReply('')
      }
      fetchMsgs(sel.id)
    } catch {} finally { setSending(false) }
  }

  async function toggleTakeover() {
    if (!sel) return
    const ep = sel.agentEnabled ? 'takeover' : 'handback'
    await fetch(`${API}/ai-suite/${ep}/${sel.id}`, { method: 'POST', headers: authH() })
    fetchConvs()
  }

  function selectConv(conv: Conversation) {
    setSel(conv)
    setMobileView('chat')
  }

  const filtered = convs.filter(c => {
    if (!search) return true
    const name = (c.patientName || c.phoneNumber).toLowerCase()
    return name.includes(search.toLowerCase()) || c.phoneNumber.includes(search)
  })

  const chColor  = CH_COLOR[channel]
  const ChIcon   = CH_ICON[channel]
  const isHuman  = sel ? !sel.agentEnabled : false

  // ── Conversation list ──────────────────────────────────────────────────────
  const ConvList = (
    <div className="flex flex-col h-full" style={{ background: '#111B21' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 flex-shrink-0" style={{ background: '#202C33' }}>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: chColor + '25' }}>
            <ChIcon size={16} style={{ color: chColor }} />
          </div>
          <span className="text-sm font-bold text-white">AI Inbox</span>
        </div>
        <span className="text-xs text-white/50">{filtered.length} chats</span>
      </div>

      {/* Channel tabs */}
      <div className="flex flex-shrink-0 border-b border-white/8" style={{ background: '#111B21' }}>
        {CHANNELS.map(ch => {
          const Icon = CH_ICON[ch.key]
          const active = channel === ch.key
          return (
            <button key={ch.key} onClick={() => setChannel(ch.key)}
              className={cn('flex-1 flex flex-col items-center gap-1 py-2 text-[10px] font-bold transition-all border-b-2', active ? 'border-[#00a884] text-[#00a884]' : 'border-transparent text-white/40 hover:text-white/70')}>
              <Icon size={15} />
              <span className="hidden sm:block truncate px-0.5">{ch.label.split(' ')[0]}</span>
            </button>
          )
        })}
      </div>

      {/* Search */}
      <div className="px-3 py-2 flex-shrink-0" style={{ background: '#111B21' }}>
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: '#202C33' }}>
          <Search size={14} className="text-white/40" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search or start new chat"
            className="flex-1 bg-transparent text-sm text-white placeholder-white/30 outline-none" />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loadingC ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={22} className="animate-spin" style={{ color: chColor }} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-16 text-center">
            <ChIcon size={32} className="mx-auto mb-3 opacity-20" style={{ color: chColor }} />
            <p className="text-sm text-white/30">No {CHANNELS.find(c => c.key === channel)?.label} conversations yet</p>
          </div>
        ) : filtered.map(conv => {
          const name    = conv.patientName || conv.phoneNumber
          const last    = conv.lastMessage
          const time    = last ? fmtTime(last.createdAt) : ''
          const active  = sel?.id === conv.id
          const preview = last ? (last.role === 'AGENT' ? '🤖 ' : '') + last.content.slice(0, 50) : 'No messages'
          return (
            <button key={conv.id} onClick={() => selectConv(conv)}
              className={cn('w-full flex items-center gap-3 px-3 py-3 border-b text-left transition-all', 'border-white/5', active ? 'bg-white/8' : 'hover:bg-white/5')}>
              <Avatar name={name} size={46} online={conv.status === 'active'} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-sm font-semibold text-white truncate">{name}</span>
                  <span className="text-[11px] flex-shrink-0 ml-1" style={{ color: conv.agentEnabled ? '#8696A0' : '#FFA500' }}>{time}</span>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-white/40 truncate flex-1">{preview}</p>
                  {!conv.agentEnabled && (
                    <span className="ml-2 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white" style={{ background: '#FFA500' }}>!</span>
                  )}
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )

  // ── Message thread ─────────────────────────────────────────────────────────
  const ChatPanel = sel ? (
    <div className="flex flex-col h-full" style={{ background: '#0B141A' }}>
      {/* Chat header */}
      <div className="flex items-center gap-3 px-4 py-3 flex-shrink-0" style={{ background: '#202C33' }}>
        <button onClick={() => { setSel(null); setMobileView('list') }} className="md:hidden text-white/60 hover:text-white mr-1">
          <ChevronLeft size={20} />
        </button>
        <Avatar name={sel.patientName || sel.phoneNumber} size={40} online={sel.status === 'active'} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white truncate">{sel.patientName || sel.phoneNumber}</p>
          <p className="text-[11px] text-white/50">
            {sel.agentEnabled ? '🤖 AI is handling' : '👤 Human handling'} · {sel.phoneNumber}
          </p>
        </div>
        <button onClick={toggleTakeover}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all hover:-translate-y-0.5',
            isHuman
              ? 'text-white bg-[#00a884]'
              : 'text-white bg-[#8696A0]/30 hover:bg-[#8696A0]/50',
          )}>
          {isHuman
            ? <><Bot size={13} /> Hand Back to Sarah</>
            : <><UserCheck size={13} /> Take Over</>
          }
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
        {loadingM && msgs.length === 0 && (
          <div className="flex justify-center py-8"><Loader2 size={18} className="animate-spin text-white/30" /></div>
        )}
        {msgs.map((msg, i) => {
          const isAgent = msg.role === 'AGENT'
          const media   = parseBubble(msg.content)
          const showTime = i === msgs.length - 1 || msgs[i + 1]?.role !== msg.role
          return (
            <div key={msg.id} className={cn('flex items-end gap-2', isAgent ? 'justify-end' : 'justify-start')}>
              {!isAgent && (
                <Avatar name={sel.patientName || sel.phoneNumber} size={28} />
              )}
              <div className={cn('max-w-[65%] flex flex-col', isAgent ? 'items-end' : 'items-start')}>
                <div className={cn('px-3 py-2 rounded-2xl text-sm leading-relaxed', isAgent ? 'rounded-tr-sm' : 'rounded-tl-sm')}
                  style={{ background: isAgent ? '#005C4B' : '#202C33', color: 'white' }}>
                  {media ? <MediaBubble type={media} /> : msg.content}
                </div>
                {showTime && (
                  <span className="text-[10px] text-white/30 mt-0.5 px-1">{fmtFull(msg.createdAt)}</span>
                )}
              </div>
            </div>
          )
        })}
        <div ref={msgsEnd} />
      </div>

      {/* Bottom: AI notice OR composer */}
      {!isHuman ? (
        <div className="flex items-center gap-3 px-4 py-3 flex-shrink-0 border-t border-white/8" style={{ background: '#1F2C34' }}>
          <Bot size={18} className="text-[#00a884] flex-shrink-0" />
          <p className="flex-1 text-xs text-white/60">AI is handling this conversation — click <strong className="text-white">Take Over</strong> to reply manually</p>
          <button onClick={toggleTakeover}
            className="px-3 py-1.5 rounded-xl text-xs font-bold text-white transition-all hover:-translate-y-0.5"
            style={{ background: '#00a884' }}>
            Take Over
          </button>
        </div>
      ) : (
        <div className="flex-shrink-0 px-3 py-2 border-t border-white/8" style={{ background: '#1F2C34' }}>
          {/* Attachment preview */}
          {attachment && (
            <div className="flex items-center gap-2 mb-2 px-3 py-2 rounded-xl" style={{ background: '#202C33' }}>
              <Paperclip size={13} className="text-white/60" />
              <span className="text-xs text-white/80 flex-1 truncate">{attachment.name}</span>
              <button onClick={() => setAttachment(null)}><X size={13} className="text-white/40 hover:text-white/70" /></button>
            </div>
          )}
          <div className="flex items-center gap-2">
            {/* Emoji */}
            <div className="relative">
              <button onClick={() => setShowEmoji(s => !s)}
                className="p-2 rounded-full text-white/50 hover:text-white hover:bg-white/10 transition-colors">
                <Smile size={20} />
              </button>
              {showEmoji && <EmojiPicker onPick={e => setReply(r => r + e)} onClose={() => setShowEmoji(false)} />}
            </div>
            {/* Attach */}
            <button onClick={() => fileRef.current?.click()}
              className="p-2 rounded-full text-white/50 hover:text-white hover:bg-white/10 transition-colors">
              <Paperclip size={20} />
            </button>
            <input ref={fileRef} type="file" className="hidden" onChange={e => { if (e.target.files?.[0]) setAttachment(e.target.files[0]); e.target.value = '' }} />
            {/* Input */}
            <input value={reply} onChange={e => setReply(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              placeholder="Type a message"
              className="flex-1 px-4 py-2.5 rounded-xl text-sm text-white placeholder-white/30 outline-none"
              style={{ background: '#2A3942' }} />
            {/* Send */}
            <button onClick={send} disabled={sending || (!reply.trim() && !attachment)}
              className={cn('p-2.5 rounded-full flex items-center justify-center transition-all', reply.trim() || attachment ? 'hover:-translate-y-0.5' : 'opacity-40')}
              style={{ background: '#00a884' }}>
              {sending ? <Loader2 size={18} className="animate-spin text-white" /> : <Send size={18} className="text-white" />}
            </button>
          </div>
        </div>
      )}
    </div>
  ) : (
    // Empty state
    <div className="flex flex-col items-center justify-center h-full gap-3" style={{ background: '#0B141A' }}>
      <div className="w-20 h-20 rounded-full flex items-center justify-center" style={{ background: '#00a884' + '20' }}>
        <ChIcon size={36} style={{ color: '#00a884' }} />
      </div>
      <p className="text-white/50 text-sm font-semibold">Select a conversation to start</p>
      <p className="text-white/30 text-xs">AI Suite Inbox — {CHANNELS.find(c => c.key === channel)?.label}</p>
    </div>
  )

  return (
    <div className="flex h-full overflow-hidden">
      {/* Conversation list — hidden on mobile when chat open */}
      <div className={cn('w-full md:w-[340px] flex-shrink-0 h-full', sel ? 'hidden md:flex' : 'flex', mobileView === 'list' ? 'flex' : 'hidden md:flex')}>
        {ConvList}
      </div>
      {/* Chat panel — full width on mobile */}
      <div className={cn('flex-1 h-full min-w-0', !sel ? 'hidden md:flex' : 'flex', mobileView === 'chat' ? 'flex' : 'hidden md:flex')}>
        {ChatPanel}
      </div>
    </div>
  )
}
