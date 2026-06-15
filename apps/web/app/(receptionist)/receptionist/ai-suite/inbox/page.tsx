'use client'

import { useEffect, useRef, useState, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  Search, Send, Paperclip, Smile, X, Loader2,
  MessageSquare, Instagram, Facebook, Globe, Bot, UserCheck,
  Image as ImageIcon, FileText, Music, Video as VideoIcon, Check,
  ChevronLeft,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ── API ────────────────────────────────────────────────────────────────────────
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
  agentEnabled: boolean; patientName: string | null; waDisplayName: string | null
  lastMessage: { role: string; content: string; createdAt: string } | null
  createdAt: string; updatedAt: string
}
type Message = { id: string; role: 'USER' | 'AGENT'; content: string; createdAt: string }

// ── Channel config ─────────────────────────────────────────────────────────────
type ChannelKey = 'WHATSAPP' | 'INSTAGRAM' | 'FACEBOOK' | 'WEBSITE'
const CHANNELS: { key: ChannelKey; label: string; icon: React.ComponentType<any>; apiVal: string; color: string }[] = [
  { key: 'WHATSAPP',  label: 'WhatsApp',  icon: MessageSquare, apiVal: 'whatsapp',  color: '#25D366' },
  { key: 'INSTAGRAM', label: 'Instagram', icon: Instagram,     apiVal: 'instagram', color: '#E4405F' },
  { key: 'FACEBOOK',  label: 'Facebook',  icon: Facebook,      apiVal: 'facebook',  color: '#1877F2' },
  { key: 'WEBSITE',   label: 'Website',   icon: Globe,         apiVal: 'website',   color: '#6366f1' },
]

// ── Avatar ─────────────────────────────────────────────────────────────────────
const PALETTE = ['#E91E63','#1565C0','#00897B','#F57F17','#6A1B9A','#2E7D32','#AD1457','#0277BD','#4E342E','#FF6F00','#1A237E','#00695C']
function nameInitials(name: string | null | undefined): string {
  if (!name) return '??'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  if (parts[0]?.length >= 2) return parts[0].slice(0, 2).toUpperCase()
  return (name.slice(0, 2) || '??').toUpperCase()
}
function avatarColor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return PALETTE[Math.abs(h) % PALETTE.length]
}
function Avatar({ name, size = 40, borderColor }: { name: string | null | undefined; size?: number; borderColor?: string }) {
  const safe = name || '?'
  return (
    <div className="rounded-full flex items-center justify-center text-white font-bold flex-shrink-0"
      style={{ width: size, height: size, background: avatarColor(safe), fontSize: size * 0.35, boxShadow: borderColor ? `0 0 0 2px ${borderColor}` : undefined }}>
      {nameInitials(safe)}
    </div>
  )
}

// ── Time helpers ───────────────────────────────────────────────────────────────
function fmtTime(iso: string): string {
  const d = new Date(iso), now = new Date()
  const diff = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diff === 0) return d.toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi' })
  if (diff === 1) return 'Yesterday'
  if (diff < 7)  return d.toLocaleDateString('en-UG', { weekday: 'short' })
  return d.toLocaleDateString('en-UG', { day: 'numeric', month: 'short' })
}
function fmtFull(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi' })
}

// ── Channel identity ───────────────────────────────────────────────────────────
// Each channel stores a different kind of identifier in phoneNumber:
//   WHATSAPP  → real phone number (+256...)
//   INSTAGRAM → Meta PSID (numeric string)
//   FACEBOOK  → Meta PSID (numeric string)
//   WEBSITE   → session UUID
// Returns a human-readable label for the conversation list.
function convLabel(conv: Conversation, channel: ChannelKey): string {
  if (conv.patientName) return conv.patientName
  if (channel === 'WHATSAPP' && conv.waDisplayName) return conv.waDisplayName
  const id = conv.phoneNumber || ''
  if (channel === 'WHATSAPP') return id || 'Unknown'
  if (channel === 'INSTAGRAM') return `@${id.slice(0, 10)}`
  if (channel === 'FACEBOOK')  return `FB User ${id.slice(0, 8)}`
  if (channel === 'WEBSITE')   return `Visitor ${id.slice(0, 8)}`
  return id || 'Unknown'
}

// ── Media bubble ───────────────────────────────────────────────────────────────
function parseBubble(content: string) {
  if (content.startsWith('__MEDIA_IMAGE__:'))                            return 'image'
  if (/\[Patient sent an image\]|\[image\]/i.test(content))              return 'image'
  if (/\[Patient sent an audio\]|\[audio\]|\[voice\]/i.test(content))   return 'audio'
  if (/\[Patient sent a video\]|\[video\]/i.test(content))              return 'video'
  if (/\[Patient sent a document\]|\[document\]|\[file\]/i.test(content)) return 'document'
  return null
}
function MediaBubble({ type, content }: { type: string; content?: string }) {
  if (type === 'image' && content?.startsWith('__MEDIA_IMAGE__:')) {
    const visionIdx = content.indexOf('__VISION__')
    const src = visionIdx !== -1 ? content.slice(16, visionIdx) : content.slice(16)
    const description = visionIdx !== -1 ? content.slice(visionIdx + 10) : null
    return (
      <div className="flex flex-col gap-1">
        <img
          src={src}
          alt={description || 'Patient image'}
          className="max-w-[220px] max-h-[180px] rounded-lg object-cover"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
        />
        {description && <span className="text-xs opacity-70 italic">{description}</span>}
      </div>
    )
  }
  const cfg: Record<string, { Icon: any; label: string }> = {
    image:    { Icon: ImageIcon,  label: 'Image'      },
    audio:    { Icon: Music,      label: 'Voice note'  },
    video:    { Icon: VideoIcon,  label: 'Video'      },
    document: { Icon: FileText,   label: 'Document'   },
  }
  const { Icon, label } = cfg[type] || cfg.document
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-black/10">
      <Icon size={15} /><span className="text-xs font-semibold">{label}</span>
    </div>
  )
}

// ── Emoji picker ───────────────────────────────────────────────────────────────
const EMOJI_GROUPS = [
  { label: '😀', emojis: ['😀','😃','😄','😁','😅','😂','🤣','😊','😇','🙂','😉','😍','🥰','😘','😋','😎','😏','😒','😢','😭','😤','😠','🤔','🤗','🙏'] },
  { label: '👍', emojis: ['👍','👎','👌','✌️','🤞','🤝','👏','🙌','💪','✍️','👋','💅'] },
  { label: '❤️', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','💔','💕','💖','💝'] },
  { label: '🦷', emojis: ['🦷','🩺','💊','💉','🩹','😷','🏥','👩‍⚕️','👨‍⚕️','🧬','🔬','🩻'] },
  { label: '✅', emojis: ['✅','❌','⚠️','🔔','📅','🕐','🎉','✨','⭐','🔥','💡','📋','📝','📌','🔑'] },
]
function EmojiPicker({ onPick, onClose, dark }: { onPick: (e: string) => void; onClose: () => void; dark?: boolean }) {
  const [tab, setTab] = useState(0)
  return (
    <div className={cn('absolute bottom-14 left-0 z-50 rounded-2xl shadow-2xl p-3 w-72 border',
      dark ? 'bg-[#1F2C34] border-white/10' : 'bg-white border-gray-200')}>
      <div className="flex gap-1 mb-2">
        {EMOJI_GROUPS.map((g, i) => (
          <button key={i} onClick={() => setTab(i)}
            className={cn('w-8 h-8 flex items-center justify-center text-base rounded-lg transition-colors',
              tab === i ? 'bg-emerald-100 dark:bg-emerald-900/30' : dark ? 'hover:bg-white/10' : 'hover:bg-gray-100')}>
            {g.label}
          </button>
        ))}
        <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-600"><X size={13} /></button>
      </div>
      <div className="grid grid-cols-8 gap-0.5 max-h-40 overflow-y-auto">
        {EMOJI_GROUPS[tab].emojis.map(e => (
          <button key={e} onClick={() => { onPick(e); onClose() }}
            className={cn('w-8 h-8 flex items-center justify-center text-lg rounded-lg', dark ? 'hover:bg-white/10' : 'hover:bg-gray-100')}>
            {e}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── WhatsApp wallpaper ─────────────────────────────────────────────────────────
const WA_WALLPAPER = `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M54.627 0l.83.828-1.415 1.415L51.8 0h2.827zM5.373 0l-.83.828L5.96 2.243 8.2 0H5.374zM48.97 0l3.657 3.657-1.414 1.414L46.143 0h2.828zM11.03 0L7.372 3.657l1.415 1.414L13.857 0H11.03zm32.284 0L49.8 6.485 48.384 7.9l-7.9-7.9h2.83zM16.686 0L10.2 6.485 11.616 7.9l7.9-7.9h-2.83zm20.97 0l9.315 9.314-1.414 1.414L34.828 0h2.83zM22.344 0L13.03 9.314l1.414 1.414L25.172 0h-2.83zM32 0l12.142 12.142-1.414 1.415L30 1.413 17.272 13.557l-1.414-1.415L28 0h4zM.284 0l28 28-1.414 1.414L0 2.544v-2.26zM0 5.373l25.456 25.455-1.414 1.415L0 8.2V5.374zm0 5.656l22.627 22.627-1.414 1.414L0 13.86v-2.83zm0 5.656l19.8 19.8-1.415 1.413L0 19.514v-2.83zm0 5.657l16.97 16.97-1.414 1.415L0 25.172v-2.83zM0 28l14.142 14.142-1.414 1.414L0 30.828V28zm0 5.657L11.314 44.97l-1.414 1.415L0 36.485v-2.83zm0 5.657L8.485 47.8 7.07 49.214 0 42.143v-2.83zm0 5.657l5.657 5.657-1.414 1.415L0 47.8v-2.83zm0 5.657l2.828 2.83-1.414 1.413L0 53.456v-2.828zM54.627 60L30 35.373 5.373 60H8.2L30 38.2 51.8 60h2.827zm-5.656 0L30 41.03 11.03 60h2.828L30 43.858 46.142 60h2.83zm-5.657 0L30 46.686 16.686 60h2.83L30 49.515 40.485 60h2.83zm-5.657 0L30 52.343 22.343 60h2.83L30 55.17 34.828 60h2.83zM32 60l-2-2-2 2h4zM59.716 0l-28 28 1.414 1.414L60 2.544v-2.26zM60 5.373L34.544 30.828l1.414 1.415L60 8.2V5.374zm0 5.656L37.373 33.656l1.414 1.414L60 13.86v-2.83zm0 5.657L40.2 33.8l1.415 1.413L60 19.514v-2.83zm0 5.657L43.03 36.627l1.414 1.415L60 25.172v-2.83zM60 28L45.858 42.142l1.414 1.414L60 30.828V28zm0 5.657L48.686 44.97l1.415 1.415L60 36.485v-2.83zm0 5.657L51.515 47.8l1.414 1.413L60 42.143v-2.83zm0 5.657l-5.657 5.657 1.414 1.415L60 47.8v-2.83zm0 5.657l-2.828 2.83 1.414 1.413L60 53.456v-2.828z' fill='%23000000' fill-opacity='0.03' fill-rule='evenodd'/%3E%3C/svg%3E")`

// ── Light channel header backgrounds ──────────────────────────────────────────
const HEADER_BG: Record<ChannelKey, string> = {
  WHATSAPP:  '#075E54',
  INSTAGRAM: 'linear-gradient(135deg,#833AB4,#E4405F)',
  FACEBOOK:  '#1877F2',
  WEBSITE:   '#6366f1',
}
const BUBBLE_BG: Record<ChannelKey, string> = {
  WHATSAPP:  '#d9fdd3',
  INSTAGRAM: 'linear-gradient(135deg,#833AB4,#E4405F)',
  FACEBOOK:  '#1877F2',
  WEBSITE:   '#6366f1',
}

// ── Composer ──────────────────────────────────────────────────────────────────
// Extracted to module level so React never remounts it on parent re-renders,
// which would cause the textarea to lose focus on every keystroke.
interface ComposerProps {
  sel: Conversation
  fetchMsgs: (id: string) => void
  channel: ChannelKey
  accent: string
  dark: boolean
}

function Composer({ sel, fetchMsgs, channel, accent, dark }: ComposerProps) {
  const [reply,      setReply]      = useState('')
  const [attachment, setAttachment] = useState<File | null>(null)
  const [showEmoji,  setShowEmoji]  = useState(false)
  const [sending,    setSending]    = useState(false)
  const fileRef  = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Reset composer when switching conversations
  useEffect(() => { setReply(''); setAttachment(null); setShowEmoji(false) }, [sel.id])

  async function send() {
    if ((!reply.trim() && !attachment) || sending) return
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
    } catch {} finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  return (
    <div className={cn('fixed bottom-0 left-0 right-0 z-[60] lg:static lg:flex-shrink-0 px-3 py-2 border-t', dark ? 'border-white/8' : 'border-gray-100')}
      style={{ background: dark ? '#1F2C34' : '#f0f2f5', paddingBottom: 'env(safe-area-inset-bottom, 8px)' }}>
      {attachment && (
        <div className={cn('flex items-center gap-2 mb-2 px-3 py-2 rounded-xl', dark ? 'bg-[#2A3942]' : 'bg-white border border-gray-200')}>
          <Paperclip size={13} className={dark ? 'text-white/60' : 'text-gray-500'} />
          <span className={cn('text-xs flex-1 truncate', dark ? 'text-white/80' : 'text-gray-700')}>{attachment.name}</span>
          <button onClick={() => setAttachment(null)}><X size={13} className={dark ? 'text-white/40' : 'text-gray-400'} /></button>
        </div>
      )}
      <div className="flex items-center gap-2">
        <div className="relative">
          <button onClick={() => setShowEmoji(s => !s)}
            className={cn('p-2 rounded-full transition-colors', dark ? 'text-white/50 hover:text-white hover:bg-white/10' : 'text-gray-500 hover:bg-black/5')}>
            <Smile size={20} />
          </button>
          {showEmoji && <EmojiPicker dark={dark} onPick={e => setReply(r => r + e)} onClose={() => setShowEmoji(false)} />}
        </div>
        <button onClick={() => fileRef.current?.click()}
          className={cn('p-2 rounded-full transition-colors', dark ? 'text-white/50 hover:text-white hover:bg-white/10' : 'text-gray-500 hover:bg-black/5')}>
          <Paperclip size={20} />
        </button>
        <input ref={fileRef} type="file" className="hidden"
          onChange={e => { if (e.target.files?.[0]) setAttachment(e.target.files[0]); e.target.value = '' }} />
        <textarea
          ref={inputRef}
          value={reply}
          onChange={e => setReply(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          placeholder="Type a message"
          rows={1}
          className="flex-1 px-4 py-2.5 rounded-2xl text-sm outline-none resize-none min-h-[44px] max-h-[120px] bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 shadow-sm"
        />
        <button onClick={send} disabled={sending || (!reply.trim() && !attachment)}
          className={cn('p-2.5 rounded-full flex items-center justify-center transition-all flex-shrink-0', reply.trim() || attachment ? 'hover:-translate-y-0.5 hover:scale-105' : 'opacity-40')}
          style={{ background: channel === 'WHATSAPP' ? '#25D366' : accent }}>
          {sending ? <Loader2 size={18} className="animate-spin text-white" /> : <Send size={18} className="text-white" />}
        </button>
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────
function InboxPage() {
  const searchParams = useSearchParams()
  const phoneParam   = searchParams.get('phone')
  const [channel,    setChannel]    = useState<ChannelKey>('WHATSAPP')
  const [convs,      setConvs]      = useState<Conversation[]>([])
  const [sel,        setSel]        = useState<Conversation | null>(null)
  const [msgs,       setMsgs]       = useState<Message[]>([])
  const [loadingC,   setLoadingC]   = useState(true)
  const [loadingM,   setLoadingM]   = useState(false)
  const [search,     setSearch]     = useState('')
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list')

  const msgsEnd      = useRef<HTMLDivElement>(null)
  const pollConv     = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollMsg      = useRef<ReturnType<typeof setInterval> | null>(null)
  const isNearBottom = useRef(true)
  const prevConvId   = useRef<string | null>(null)

  // Deduplicate: one entry per phone number, keep most-recently-updated
  function dedupeByPhone(data: Conversation[]): Conversation[] {
    const map = new Map<string, Conversation>()
    for (const conv of data) {
      const key = conv.phoneNumber || conv.id
      const ex  = map.get(key)
      if (!ex || new Date(conv.updatedAt) > new Date(ex.updatedAt)) map.set(key, conv)
    }
    return Array.from(map.values()).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }

  const fetchConvs = useCallback(async () => {
    try {
      const ch  = CHANNELS.find(c => c.key === channel)?.apiVal || 'whatsapp'
      const res = await fetch(`${API}/ai-suite/conversations?channel=${ch}`, { headers: authH() })
      if (!res.ok) return
      const data: Conversation[] = await res.json()
      const deduped = dedupeByPhone(data)
      setConvs(deduped)
      if (sel) {
        const updated = deduped.find(c => c.id === sel.id)
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

  useEffect(() => {
    setSel(null); setConvs([]); setMsgs([]); setLoadingC(true)
    if (pollConv.current) clearInterval(pollConv.current)
    fetchConvs()
    pollConv.current = setInterval(fetchConvs, 10000)
    return () => { if (pollConv.current) clearInterval(pollConv.current) }
  }, [channel])

  useEffect(() => {
    if (pollMsg.current) clearInterval(pollMsg.current)
    if (!sel) return
    fetchMsgs(sel.id)
    pollMsg.current = setInterval(() => fetchMsgs(sel.id), 5000)
    return () => { if (pollMsg.current) clearInterval(pollMsg.current) }
  }, [sel?.id])

  useEffect(() => {
    const isSwitch = sel?.id !== prevConvId.current
    prevConvId.current = sel?.id ?? null
    if (isSwitch || isNearBottom.current) {
      msgsEnd.current?.scrollIntoView({ behavior: isSwitch ? 'auto' : 'smooth' })
      if (isSwitch) isNearBottom.current = true
    }
  }, [msgs])

  useEffect(() => {
    const handler = () => { if (isNearBottom.current) msgsEnd.current?.scrollIntoView({ behavior: 'smooth' }) }
    window.visualViewport?.addEventListener('resize', handler)
    return () => { window.visualViewport?.removeEventListener('resize', handler) }
  }, [])

  useEffect(() => {
    if (!phoneParam || sel || convs.length === 0) return
    const normalized = phoneParam.replace(/[\s\-]/g, '')
    const match = convs.find(c => c.phoneNumber?.replace(/[\s\-]/g, '') === normalized)
    if (match) selectConv(match)
  }, [convs, phoneParam])

  function handleMessagesScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget
    isNearBottom.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 100
  }

  async function toggleTakeover() {
    if (!sel) return
    const ep = sel.agentEnabled ? 'takeover' : 'handback'
    await fetch(`${API}/ai-suite/${ep}/${sel.id}`, { method: 'POST', headers: authH() })
    fetchConvs()
  }

  function selectConv(conv: Conversation) {
    setSel(conv); setMobileView('chat')
  }

  const filtered = convs.filter(c => {
    if (!search) return true
    const name = convLabel(c, channel).toLowerCase()
    return name.includes(search.toLowerCase()) || (c.phoneNumber || '').includes(search)
  })

  const isHuman = sel ? !sel.agentEnabled : false
  const ch      = CHANNELS.find(c => c.key === channel)!
  const accent  = ch.color
  const ChIcon  = ch.icon

  // ═══════════════════════════════════════════════════════════════════════════════
  // WHATSAPP — authentic WA styling
  // ═══════════════════════════════════════════════════════════════════════════════

  const WaConvList = (
    <div className="flex flex-col h-full bg-white">
      <div className="flex items-center justify-between px-4 py-3 flex-shrink-0" style={{ background: '#075E54' }}>
        <span className="text-sm font-bold text-white">WhatsApp</span>
        <span className="text-xs text-white/60">{filtered.length} chats</span>
      </div>
      <div className="px-3 py-2 flex-shrink-0 bg-white border-b border-gray-100">
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#f0f2f5]">
          <Search size={14} className="text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search or start new chat"
            className="flex-1 bg-transparent text-sm text-gray-800 placeholder-gray-400 outline-none" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loadingC ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={22} className="animate-spin text-[#25D366]" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-16 text-center">
            <MessageSquare size={32} className="mx-auto mb-3 text-gray-200" />
            <p className="text-sm text-gray-400">No WhatsApp conversations yet</p>
          </div>
        ) : filtered.map(conv => {
          const name    = convLabel(conv, 'WHATSAPP')
          const last    = conv.lastMessage
          const time    = fmtTime(last?.createdAt ?? conv.updatedAt)
          const active  = sel?.id === conv.id
          const preview = last ? (last.role === 'AGENT' ? '🤖 ' : '') + last.content.slice(0, 50) : 'No messages'
          return (
            <button key={conv.id} onClick={() => selectConv(conv)}
              className={cn('w-full flex items-center gap-3 px-4 py-3 border-b border-gray-50 text-left transition-colors',
                active ? 'bg-green-50' : 'hover:bg-gray-50')}>
              <div className="relative">
                <Avatar name={name} size={46} />
                <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full flex items-center justify-center shadow-sm border-2 border-white bg-[#25D366]">
                  <MessageSquare size={9} className="text-white" />
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-sm font-semibold text-gray-800 truncate">{name}</span>
                  <span className="text-[11px] flex-shrink-0 ml-1 text-gray-400">{time}</span>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-400 truncate flex-1">{preview}</p>
                  {!conv.agentEnabled && (
                    <span className="ml-2 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white bg-amber-400">!</span>
                  )}
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )

  const WaChatPanel = sel ? (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-3 px-4 py-3 flex-shrink-0" style={{ background: '#075E54' }}>
        <button onClick={() => { setSel(null); setMobileView('list') }} className="md:hidden text-white/70 hover:text-white mr-1">
          <ChevronLeft size={20} />
        </button>
        <div className="relative">
          <Avatar name={convLabel(sel, 'WHATSAPP')} size={40} />
          {sel.status === 'active' && (
            <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-[#25D366] border-2 border-[#075E54]" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white truncate">{convLabel(sel, 'WHATSAPP')}</p>
          <p className="text-[11px]" style={{ color: '#90cbb7' }}>
            {sel.agentEnabled ? '🤖 AI is handling' : '👤 Human handling'} · {sel.phoneNumber}
          </p>
        </div>
        <button onClick={toggleTakeover}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-white transition-all hover:opacity-90"
          style={{ background: isHuman ? '#06b6d4' : '#F59E0B' }}>
          {isHuman ? <><Bot size={13} /> Hand Back</> : <><UserCheck size={13} /> Take Over</>}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 px-4 pt-4 pb-20 space-y-1.5"
        onScroll={handleMessagesScroll}
        style={{ background: '#e5ddd5', backgroundImage: WA_WALLPAPER }}>
        {loadingM && msgs.length === 0 && (
          <div className="flex justify-center py-8"><Loader2 size={18} className="animate-spin text-gray-400" /></div>
        )}
        {msgs.map((msg, i) => {
          const isAgent  = msg.role === 'AGENT'
          const media    = parseBubble(msg.content)
          const showTime = i === msgs.length - 1 || msgs[i + 1]?.role !== msg.role
          return (
            <div key={msg.id} className={cn('flex', isAgent ? 'justify-end' : 'justify-start')}>
              <div className="max-w-[68%]">
                <div className="px-3 py-2 rounded-2xl shadow-sm text-sm leading-relaxed"
                  style={isAgent
                    ? { background: '#d9fdd3', borderBottomRightRadius: 4, color: '#111' }
                    : { background: '#fff',    borderBottomLeftRadius:  4, color: '#111' }}>
                  {media ? <MediaBubble type={media} content={msg.content} /> : msg.content}
                  <div className="flex items-center justify-end gap-1 mt-0.5">
                    <span className="text-[10px] text-gray-400">{fmtFull(msg.createdAt)}</span>
                    {isAgent && <Check size={12} className="text-gray-400" />}
                  </div>
                </div>
                {showTime && <div />}
              </div>
            </div>
          )
        })}
        <div ref={msgsEnd} />
      </div>

      {!isHuman ? (
        <div className="flex items-center gap-3 px-4 py-3 flex-shrink-0 border-t border-gray-200" style={{ background: '#f9fafb' }}>
          <Bot size={18} className="text-[#25D366] flex-shrink-0" />
          <p className="flex-1 text-xs text-gray-500">AI is handling this — click <strong className="text-amber-500">Take Over</strong> to reply manually</p>
          <button onClick={toggleTakeover} className="px-3 py-1.5 rounded-xl text-xs font-bold text-white bg-amber-400 hover:bg-amber-500 transition-colors">
            Take Over
          </button>
        </div>
      ) : (
        <Composer sel={sel!} fetchMsgs={fetchMsgs} channel={channel} accent={accent} dark={false} />
      )}
    </div>
  ) : (
    <div className="flex flex-col items-center justify-center h-full gap-3"
      style={{ background: '#e5ddd5', backgroundImage: WA_WALLPAPER }}>
      <div className="w-20 h-20 rounded-full flex items-center justify-center" style={{ background: '#25D36620' }}>
        <MessageSquare size={36} className="text-[#25D366]" />
      </div>
      <p className="text-gray-600 text-sm font-semibold">Select a conversation to start</p>
      <p className="text-gray-400 text-xs">WhatsApp</p>
    </div>
  )

  // ═══════════════════════════════════════════════════════════════════════════════
  // LIGHT UI — Instagram, Facebook, Website
  // ═══════════════════════════════════════════════════════════════════════════════

  const LightConvList = (
    <div className="flex flex-col h-full bg-white">
      <div className="flex items-center justify-between px-4 py-3 flex-shrink-0"
        style={{ background: HEADER_BG[channel] }}>
        <div className="flex items-center gap-2">
          <ChIcon size={16} className="text-white" />
          <span className="text-sm font-bold text-white">{ch.label}</span>
        </div>
        <span className="text-xs text-white/70">{filtered.length} chats</span>
      </div>
      <div className="px-3 py-2 flex-shrink-0 border-b border-gray-100">
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-100">
          <Search size={14} className="text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search conversations"
            className="flex-1 bg-transparent text-sm text-gray-800 placeholder-gray-400 outline-none" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loadingC ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={22} className="animate-spin" style={{ color: accent }} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-16 text-center">
            <ChIcon size={32} className="mx-auto mb-3 text-gray-200" />
            <p className="text-sm text-gray-400">No {ch.label} conversations yet</p>
          </div>
        ) : filtered.map(conv => {
          const name    = convLabel(conv, channel)
          const last    = conv.lastMessage
          const time    = fmtTime(last?.createdAt ?? conv.updatedAt)
          const active  = sel?.id === conv.id
          const preview = last ? (last.role === 'AGENT' ? '🤖 ' : '') + last.content.slice(0, 50) : 'No messages'
          return (
            <button key={conv.id} onClick={() => selectConv(conv)}
              className={cn('w-full flex items-center gap-3 px-4 py-3 border-b border-gray-50 text-left transition-colors hover:bg-gray-50')}
              style={active ? { backgroundColor: accent + '15' } : undefined}>
              <div className="relative">
                <Avatar name={name} size={46} />
                <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full flex items-center justify-center shadow-sm border-2 border-white flex-shrink-0"
                  style={{ background: channel === 'INSTAGRAM' ? 'linear-gradient(135deg,#833AB4,#E4405F)' : accent }}>
                  <ChIcon size={9} className="text-white" />
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-sm font-semibold text-gray-800 truncate">{name}</span>
                  <span className="text-[11px] flex-shrink-0 ml-1 text-gray-400">{time}</span>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-400 truncate flex-1">{preview}</p>
                  {!conv.agentEnabled && (
                    <span className="ml-2 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white bg-amber-400">!</span>
                  )}
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )

  const LightChatPanel = sel ? (
    <div className="flex flex-col h-full bg-gray-50">
      <div className="flex items-center gap-3 px-4 py-3 flex-shrink-0 bg-white border-b border-gray-100 shadow-sm">
        <button onClick={() => { setSel(null); setMobileView('list') }} className="md:hidden text-gray-500 hover:text-gray-700 mr-1">
          <ChevronLeft size={20} />
        </button>
        <Avatar name={convLabel(sel, channel)} size={40} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-800 truncate">{convLabel(sel, channel)}</p>
          <p className="text-[11px] text-gray-400">
            {sel.agentEnabled ? '🤖 AI is handling' : '👤 Human handling'}{channel === 'WHATSAPP' ? ` · ${sel.phoneNumber}` : ''}
          </p>
        </div>
        <button onClick={toggleTakeover}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-white transition-all hover:-translate-y-0.5"
          style={{ background: isHuman ? '#06b6d4' : accent }}>
          {isHuman ? <><Bot size={13} /> Hand Back</> : <><UserCheck size={13} /> Take Over</>}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-20 space-y-2" onScroll={handleMessagesScroll}>
        {loadingM && msgs.length === 0 && (
          <div className="flex justify-center py-8"><Loader2 size={18} className="animate-spin text-gray-300" /></div>
        )}
        {msgs.map((msg, i) => {
          const isAgent  = msg.role === 'AGENT'
          const media    = parseBubble(msg.content)
          const showTime = i === msgs.length - 1 || msgs[i + 1]?.role !== msg.role
          return (
            <div key={msg.id} className={cn('flex items-end gap-2', isAgent ? 'justify-end' : 'justify-start')}>
              {!isAgent && <Avatar name={convLabel(sel, channel)} size={28} />}
              <div className={cn('max-w-[65%] flex flex-col', isAgent ? 'items-end' : 'items-start')}>
                <div className={cn('px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed shadow-sm',
                  isAgent ? 'rounded-tr-sm text-white' : 'rounded-tl-sm text-gray-800 bg-white border border-gray-100')}
                  style={isAgent ? { background: BUBBLE_BG[channel] } : undefined}>
                  {media ? <MediaBubble type={media} content={msg.content} /> : msg.content}
                </div>
                {showTime && <span className="text-[10px] text-gray-400 mt-0.5 px-1">{fmtFull(msg.createdAt)}</span>}
              </div>
            </div>
          )
        })}
        <div ref={msgsEnd} />
      </div>

      {!isHuman ? (
        <div className="flex items-center gap-3 px-4 py-3 flex-shrink-0 bg-white border-t border-gray-100">
          <Bot size={18} className="flex-shrink-0" style={{ color: accent }} />
          <p className="flex-1 text-xs text-gray-500">AI is handling this — click <strong className="text-amber-500">Take Over</strong> to reply manually</p>
          <button onClick={toggleTakeover}
            className="px-3 py-1.5 rounded-xl text-xs font-bold text-white transition-all hover:-translate-y-0.5"
            style={{ background: accent }}>
            Take Over
          </button>
        </div>
      ) : (
        <Composer sel={sel!} fetchMsgs={fetchMsgs} channel={channel} accent={accent} dark={false} />
      )}
    </div>
  ) : (
    <div className="flex flex-col items-center justify-center h-full gap-3 bg-gray-50">
      <div className="w-20 h-20 rounded-full flex items-center justify-center" style={{ background: accent + '20' }}>
        <ChIcon size={36} style={{ color: accent }} />
      </div>
      <p className="text-gray-600 text-sm font-semibold">Select a conversation to start</p>
      <p className="text-gray-400 text-xs">AI Suite Inbox — {ch.label}</p>
    </div>
  )

  // ── Render ─────────────────────────────────────────────────────────────────────
  const ConvList  = channel === 'WHATSAPP' ? WaConvList  : LightConvList
  const ChatPanel = channel === 'WHATSAPP' ? WaChatPanel : LightChatPanel

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Channel tab bar */}
      <div className="flex-shrink-0 flex items-center border-b border-gray-200 bg-white px-1">
        {CHANNELS.map(c => {
          const Icon   = c.icon
          const active = channel === c.key
          return (
            <button key={c.key} onClick={() => { setChannel(c.key); setMobileView('list') }}
              className={cn('flex items-center gap-1.5 px-4 py-3 text-sm font-semibold border-b-2 -mb-px transition-all',
                active ? 'border-current' : 'border-transparent text-gray-400 hover:text-gray-600')}>
              <Icon size={14} style={active ? { color: c.color } : undefined} />
              <span className="hidden sm:inline" style={active ? { color: c.color } : undefined}>{c.label}</span>
            </button>
          )
        })}
      </div>

      {/* Split pane */}
      <div className="flex-1 flex overflow-hidden">
        <div className={cn(
          'w-full md:w-[340px] flex-shrink-0 h-full border-r border-gray-100',
          sel ? 'hidden md:flex' : 'flex',
          mobileView === 'list' ? 'flex' : 'hidden md:flex',
        )}>
          {ConvList}
        </div>
        <div className={cn(
          'flex-1 h-full min-w-0',
          !sel ? 'hidden md:flex' : 'flex',
          mobileView === 'chat' ? 'flex' : 'hidden md:flex',
        )}>
          {ChatPanel}
        </div>
      </div>
    </div>
  )
}

export default function Page() {
  return (
    <Suspense>
      <InboxPage />
    </Suspense>
  )
}
