'use client'

import { useEffect, useRef, useState, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import NextImage from 'next/image'
import {
  Search, Send, Paperclip, Smile, X, Loader2,
  MessageSquare, Instagram, Facebook, Globe, Bot, UserCheck,
  Image as ImageIcon, FileText, Music, Video as VideoIcon, Check, CheckCheck,
  ChevronLeft, Plus, Archive, ArchiveRestore, Trash2, MoreVertical,
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
  displayName: string | null
  profilePictureUrl: string | null
  postCaption: string | null
  archivedAt: string | null
  lastMessage: { id: string; role: string; content: string; createdAt: string; metadata?: string | null } | null
  createdAt: string; updatedAt: string
}
type Message = { id: string; role: 'USER' | 'AGENT'; content: string; createdAt: string; status?: string | null; wamid?: string | null }

// ── Channel config ─────────────────────────────────────────────────────────────
type ChannelKey = 'WHATSAPP' | 'INSTAGRAM' | 'FACEBOOK' | 'WEBSITE' | 'FB_COMMENTS' | 'IG_COMMENTS'
const CHANNELS: { key: ChannelKey; label: string; icon: React.ComponentType<any>; imgSrc: string; apiVal: string; color: string }[] = [
  { key: 'WHATSAPP',    label: 'WhatsApp',    icon: MessageSquare, imgSrc: '/icons/whatsapp.png',  apiVal: 'whatsapp',         color: '#25D366' },
  { key: 'INSTAGRAM',   label: 'Instagram',   icon: Instagram,     imgSrc: '/icons/instagram.png', apiVal: 'instagram',        color: '#E4405F' },
  { key: 'FACEBOOK',    label: 'Facebook',    icon: Facebook,      imgSrc: '/icons/facebook.png',  apiVal: 'facebook',         color: '#1877F2' },
  { key: 'WEBSITE',     label: 'Website',     icon: Globe,         imgSrc: '/icons/website.png',   apiVal: 'website',          color: '#6366f1' },
  { key: 'FB_COMMENTS', label: 'FB Comments', icon: Facebook,      imgSrc: '/icons/facebook.png',  apiVal: 'facebook_comment', color: '#1877F2' },
  { key: 'IG_COMMENTS', label: 'IG Comments', icon: Instagram,     imgSrc: '/icons/instagram.png', apiVal: 'instagram_comment', color: '#E4405F' },
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
function Avatar({ name, size = 40, borderColor, pictureUrl }: { name: string | null | undefined; size?: number; borderColor?: string; pictureUrl?: string | null }) {
  const [imgOk, setImgOk] = useState(true)
  const safe = name || '?'
  if (pictureUrl && imgOk) {
    return (
      <img src={pictureUrl} alt={safe} referrerPolicy="no-referrer" onError={() => setImgOk(false)}
        className="rounded-full object-cover flex-shrink-0"
        style={{ width: size, height: size, boxShadow: borderColor ? `0 0 0 2px ${borderColor}` : undefined }} />
    )
  }
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
  if (diff === 0) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi' })
  if (diff === 1) return 'Yesterday'
  if (diff < 7)  return d.toLocaleDateString('en-GB', { weekday: 'short' })
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}
function fmtFull(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi' })
}
function msgTimestamp(iso: string): string {
  const eat    = new Date(new Date(iso).getTime() + 3 * 60 * 60 * 1000)
  const nowEat = new Date(Date.now()              + 3 * 60 * 60 * 1000)
  const toDateStr = (d: Date) => d.toISOString().slice(0, 10)
  const h = eat.getUTCHours(), m = eat.getUTCMinutes()
  const timePart = `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
  const eatDate = toDateStr(eat)
  if (eatDate === toDateStr(nowEat)) return timePart
  if (eatDate === toDateStr(new Date(nowEat.getTime() - 86400000))) return `Yesterday ${timePart}`
  const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (nowEat.getTime() - eat.getTime() < 7 * 86400000) return `${DAYS[eat.getUTCDay()]} ${timePart}`
  return `${DAYS[eat.getUTCDay()]} ${eat.getUTCDate()} ${MONTHS[eat.getUTCMonth()]} ${timePart}`
}

// ── Channel identity ───────────────────────────────────────────────────────────
// Each channel stores a different kind of identifier in phoneNumber:
//   WHATSAPP  → real phone number (+256...)
//   INSTAGRAM → Meta PSID (numeric string)
//   FACEBOOK  → Meta PSID (numeric string)
//   WEBSITE   → session UUID
// Numbers can reach the UI in several raw forms — Meta webhook wa_id (digits,
// no +), or a manually-entered patient/guardian phone that was never run
// through backend normalization (e.g. local "0712..." format). Naive "+"
// prefixing upstream turns the latter into malformed "+0712...". Never
// display that — always resolve to a clean +256... (or +<digits>) format.
// Digits-only normalization shared by display formatting AND lead↔conversation
// phone matching below — one place that decides "0712..." (local) and
// "256712..."/"+256712..." (international) are the same number, so matching
// logic never has to reimplement it separately.
function normalizePhoneDigits(raw: string): string {
  let digits = raw.replace(/\D/g, '')
  if (digits.startsWith('0') && digits.length >= 9) digits = '256' + digits.slice(1)
  return digits
}

function formatPhoneDisplay(raw: string): string {
  if (!raw) return 'Unknown'
  const digits = normalizePhoneDigits(raw)
  if (!digits) return raw
  return `+${digits}`
}

// Returns a human-readable label for the conversation list.
function convLabel(conv: Conversation, channel: ChannelKey): string {
  if (conv.patientName) return conv.patientName
  if (channel === 'WHATSAPP' && conv.waDisplayName) return conv.waDisplayName
  if (conv.displayName) return conv.displayName
  const id = conv.phoneNumber || ''
  if (channel === 'WHATSAPP') return formatPhoneDisplay(id)
  if (channel === 'INSTAGRAM') return `@${id.slice(0, 10)}`
  if (channel === 'FACEBOOK')  return `FB User ${id.slice(0, 8)}`
  if (channel === 'WEBSITE')   return `Visitor ${id.slice(0, 8)}`
  return id || 'Unknown'
}

// ── Work-state derivation ────────────────────────────────────────────────────
// Purely computed from fields that already exist on Conversation — no new
// schema, no new endpoint, no new backend logic. Deliberately describes only
// what the data actually shows (message direction + archivedAt), not an
// inferred workflow/ownership judgement:
//
//   - archivedAt set        → "Resolved" — an explicit staff action, not inferred.
//   - no lastMessage at all → "No activity" — nothing has been said yet
//     (e.g. a conversation staff just started via "Start a new chat" before
//     either side has sent anything), so it is neither awaiting a reply nor
//     already replied to.
//   - lastMessage.role === 'USER'  → "Awaiting reply" — the customer's message
//     is currently last in the thread. This does NOT claim any particular
//     staff member must respond, only that the thread currently ends on a
//     customer message.
//   - lastMessage.role === 'AGENT' (or anything else) → "Clinic replied" —
//     either Sarah or a human staff member sent the latest message
//     (takeover.routes.ts:369 confirms staff replies via the takeover flow
//     use the same AGENT role as bot replies — AiMessage.role never
//     distinguishes them). This is NOT labelled Resolved/Handled: Sarah's
//     staff-escalation tool (alertStaffOfConcern in agent.service.ts) can
//     leave an unresolved escalation open while still replying to the
//     patient in parallel, and nothing in the data returned by
//     GET /ai-suite/conversations lets the frontend tell that apart from an
//     ordinary reply — so this state only reports message direction, never a
//     resolution/ownership claim.
//
// Human-vs-AI ownership (agentEnabled / status === 'HUMAN_TAKEOVER') is a
// separate, already-authoritative signal and stays separate — shown as its
// own "🤖 AI handling" / "👤 Human handling" pill in the chat header, not
// merged into this dot/label.
type WorkState = 'resolved' | 'no_activity' | 'awaiting_reply' | 'clinic_replied'
const WORK_STATE_META: Record<WorkState, { label: string; dot: string; badgeClass: string }> = {
  resolved:       { label: 'Resolved',       dot: '#10B981', badgeClass: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-400/10 dark:text-emerald-400' },
  no_activity:    { label: 'No activity',    dot: '#94A3B8', badgeClass: 'bg-gray-50 text-gray-500 dark:bg-white/5 dark:text-slate-400' },
  awaiting_reply: { label: 'Awaiting reply', dot: '#EF4444', badgeClass: 'bg-red-50 text-red-600 dark:bg-red-400/10 dark:text-red-400' },
  clinic_replied: { label: 'Clinic replied', dot: '#3B82F6', badgeClass: 'bg-blue-50 text-blue-600 dark:bg-blue-400/10 dark:text-blue-400' },
}

function getWorkState(conv: Conversation): WorkState {
  if (conv.archivedAt) return 'resolved'
  const last = conv.lastMessage
  if (!last) return 'no_activity'
  if (last.role === 'USER') return 'awaiting_reply'
  return 'clinic_replied'
}

// Neutral, non-authoritative "time since last activity" — informational only,
// never used to classify or badge a conversation's work state.
function lastActivityLabel(iso?: string): string | null {
  if (!iso) return null
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 0) return null
  const mins = Math.floor(ms / 60000)
  if (mins < 1)  return 'Last activity just now'
  if (mins < 60) return `Last activity ${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `Last activity ${hours}h ago`
  const days = Math.floor(hours / 24)
  return `Last activity ${days}d ago`
}

// ── Media bubble ───────────────────────────────────────────────────────────────
function parseBubble(content: string) {
  if (content.startsWith('__MEDIA_IMAGE__:'))                                    return 'image'
  if (/\[Patient sent an image\]|\[image\]/i.test(content))                      return 'image'
  if (/\[Patient sent an audio\]|\[audio\]|\[voice\]/i.test(content))           return 'audio'
  if (/\[Patient sent a video\]|\[video\]/i.test(content))                      return 'video'
  if (/\[Patient sent a document\]|\[document\]|\[file\]/i.test(content))       return 'document'
  if (/\[Patient sent a sticker\]/i.test(content))                               return 'sticker'
  if (/^Reacted with /i.test(content))                                           return 'reaction'
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
  if (type === 'sticker') {
    return <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-black/10"><span className="text-xl">🎭</span><span className="text-xs font-semibold">Sticker</span></div>
  }
  if (type === 'reaction' && content) {
    const emoji = content.replace(/^Reacted with /i, '').trim()
    return <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-black/10 text-sm">{emoji}</div>
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

function MsgStatus({ status }: { status?: string | null }) {
  if (status === 'read')      return <CheckCheck size={12} className="text-[#53bdeb]" />
  if (status === 'delivered') return <CheckCheck size={12} className="text-gray-400" />
  if (status === 'failed')    return <X size={10} className="text-red-400" />
  return <Check size={12} className="text-gray-400" />
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
  WHATSAPP:    '#075E54',
  INSTAGRAM:   'linear-gradient(135deg,#833AB4,#E4405F)',
  FACEBOOK:    '#1877F2',
  WEBSITE:     '#6366f1',
  FB_COMMENTS: '#1877F2',
  IG_COMMENTS: 'linear-gradient(135deg,#833AB4,#E4405F)',
}
const BUBBLE_BG: Record<ChannelKey, string> = {
  WHATSAPP:    '#d9fdd3',
  INSTAGRAM:   'linear-gradient(135deg,#833AB4,#E4405F)',
  FACEBOOK:    '#1877F2',
  WEBSITE:     '#6366f1',
  FB_COMMENTS: '#1877F2',
  IG_COMMENTS: 'linear-gradient(135deg,#833AB4,#E4405F)',
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

// ── Chat management: archive / unarchive / delete ────────────────────────────
function ChatMenu({ sel, onChanged, dark = true }: { sel: Conversation; onChanged: () => void; dark?: boolean }) {
  const [open, setOpen]   = useState(false)
  const [busy, setBusy]   = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const archived = !!sel.archivedAt

  async function doArchiveToggle() {
    setBusy(true)
    try {
      await fetch(`${API}/ai-suite/conversations/${sel.id}/${archived ? 'unarchive' : 'archive'}`, {
        method: 'PATCH', headers: authH(),
      })
      setOpen(false)
      onChanged()
    } catch {} finally { setBusy(false) }
  }

  async function doDelete() {
    if (!window.confirm('Permanently delete this conversation and all its messages? This cannot be undone.')) return
    setBusy(true)
    try {
      await fetch(`${API}/ai-suite/conversations/${sel.id}`, { method: 'DELETE', headers: authH() })
      setOpen(false)
      onChanged()
    } catch {} finally { setBusy(false) }
  }

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)} disabled={busy}
        className={cn('w-8 h-8 flex items-center justify-center rounded-full transition-colors flex-shrink-0',
          dark ? 'text-white/80 hover:text-white hover:bg-white/10' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100')}
        title="Chat options">
        <MoreVertical size={17} />
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-50 w-48 rounded-xl shadow-2xl border border-gray-100 bg-white overflow-hidden text-gray-700">
          <button onClick={doArchiveToggle} disabled={busy}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-gray-50 transition-colors text-left">
            {archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
            {archived ? 'Unarchive' : 'Archive'}
          </button>
          <button onClick={doDelete} disabled={busy}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-red-50 text-red-600 transition-colors text-left border-t border-gray-100">
            <Trash2 size={15} />
            Delete
          </button>
        </div>
      )}
    </div>
  )
}

// ── Per-row archive / delete menu ────────────────────────────────────────────
// Fixed-positioned dropdown so it escapes the list's overflow-y:auto clipping.
function RowChatMenu({ conv, onChanged }: { conv: Conversation; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [pos,  setPos]  = useState({ x: 0, y: 0 })
  const [busy, setBusy] = useState(false)
  const btnRef  = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return
      if (btnRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function openMenu(e: React.MouseEvent) {
    e.stopPropagation()
    if (!btnRef.current) return
    const r   = btnRef.current.getBoundingClientRect()
    const dropH = 88
    const y   = r.bottom + 4 + dropH > window.innerHeight ? r.top - dropH - 4 : r.bottom + 4
    setPos({ x: r.right, y })
    setOpen(o => !o)
  }

  const archived = !!conv.archivedAt

  async function doArchive(e: React.MouseEvent) {
    e.stopPropagation()
    setBusy(true)
    try {
      await fetch(`${API}/ai-suite/conversations/${conv.id}/${archived ? 'unarchive' : 'archive'}`, {
        method: 'PATCH', headers: authH(),
      })
      setOpen(false); onChanged()
    } catch {} finally { setBusy(false) }
  }

  async function doDelete(e: React.MouseEvent) {
    e.stopPropagation()
    if (!window.confirm('Permanently delete this conversation? This cannot be undone.')) return
    setBusy(true)
    try {
      await fetch(`${API}/ai-suite/conversations/${conv.id}`, { method: 'DELETE', headers: authH() })
      setOpen(false); onChanged()
    } catch {} finally { setBusy(false) }
  }

  return (
    <>
      <button ref={btnRef} onClick={openMenu} disabled={busy}
        className="w-6 h-6 flex items-center justify-center rounded-full text-gray-300 hover:text-gray-500 hover:bg-gray-100 transition-colors flex-shrink-0"
        title="Archive or delete">
        {busy ? <Loader2 size={11} className="animate-spin text-gray-400" /> : <MoreVertical size={14} />}
      </button>
      {open && (
        <div ref={menuRef}
          className="fixed z-[200] w-40 rounded-xl shadow-2xl border border-gray-100 bg-white overflow-hidden"
          style={{ left: pos.x - 160, top: pos.y }}>
          <button onClick={doArchive} disabled={busy}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-gray-700 hover:bg-gray-50 transition-colors text-left">
            {archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
            {archived ? 'Unarchive' : 'Archive'}
          </button>
          <button onClick={doDelete} disabled={busy}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-red-600 hover:bg-red-50 transition-colors text-left border-t border-gray-100">
            <Trash2 size={13} />
            Delete
          </button>
        </div>
      )}
    </>
  )
}

// ── New outbound WhatsApp chat ───────────────────────────────────────────────
function NewChatModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [phone,   setPhone]   = useState('')
  const [name,    setName]    = useState('')
  const [busy,    setBusy]    = useState(false)
  const [error,   setError]   = useState('')

  async function submit() {
    if (!phone.trim() || busy) return
    setBusy(true); setError('')
    try {
      const res = await fetch(`${API}/ai-suite/conversations`, {
        method: 'POST', headers: authH(true),
        body: JSON.stringify({ phoneNumber: phone.trim(), displayName: name.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Could not start chat'); return }
      onCreated(data.id)
      onClose()
    } catch { setError('Could not reach the server') } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-gray-800">Start new WhatsApp chat</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>
        <label className="block text-xs font-semibold text-gray-500 mb-1">Phone number</label>
        <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="e.g. 0712345678 or +256712345678"
          className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:border-[#25D366] mb-3" autoFocus />
        <label className="block text-xs font-semibold text-gray-500 mb-1">Name (optional)</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Contact name"
          className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:border-[#25D366] mb-1" />
        {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
        <p className="text-[11px] text-gray-400 mt-2">
          If this number hasn't messaged the clinic before, WhatsApp may block the first message
          until they reply (24-hour messaging policy) — the chat will still be created so you can
          have it ready.
        </p>
        <button onClick={submit} disabled={busy || !phone.trim()}
          className="w-full mt-4 py-2.5 rounded-xl text-sm font-bold text-white bg-[#25D366] hover:bg-[#1fb959] disabled:opacity-50 transition-colors">
          {busy ? 'Starting…' : 'Start Chat'}
        </button>
      </div>
    </div>
  )
}

// ── Inbox push notification ────────────────────────────────────────────────────
function fireInboxNotification(title: string, body: string) {
  if (typeof window === 'undefined') return
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  const path = window.location.pathname
  const url  = path.includes('/receptionist/') ? '/receptionist/ai-suite/inbox' : '/ai-suite/inbox'
  const opts: NotificationOptions = { body, icon: '/icon.png', badge: '/icon.png', tag: 'inbox-message', data: { url } }
  if (navigator.serviceWorker?.controller) {
    navigator.serviceWorker.ready.then(reg => reg.showNotification(title, opts)).catch(() => {})
    return
  }
  try {
    const n = new Notification(title, opts)
    n.onclick = () => { window.focus(); window.location.href = url }
  } catch {}
}

// ── Threaded post view — types ─────────────────────────────────────────────────
type PostMsg  = { id: string; role: string; content: string; createdAt: string; metadata?: string | null }
type PostConv = { id: string; displayName: string | null; profilePictureUrl: string | null; agentEnabled: boolean; updatedAt: string; messages: PostMsg[] }
type PostThread = { postId: string; caption: string | null; thumbnailUrl: string | null; latestAt: string; commentCount: number; conversations: PostConv[] }

// ── Single commenter thread inside a post ─────────────────────────────────────
function CommentThread({ conv, onRefresh }: { conv: PostConv; onRefresh: () => void }) {
  const [reply,    setReply]    = useState('')
  const [sending,  setSending]  = useState(false)
  const [toggling, setToggling] = useState(false)
  const name = conv.displayName || 'Anonymous'

  async function sendReply() {
    if (!reply.trim() || sending) return
    setSending(true)
    try {
      await fetch(`${API}/ai-suite/conversations/${conv.id}/send`, {
        method: 'POST', headers: authH(true), body: JSON.stringify({ text: reply.trim() }),
      })
      setReply(''); onRefresh()
    } catch {} finally { setSending(false) }
  }

  async function doToggle() {
    setToggling(true)
    const ep = conv.agentEnabled ? 'takeover' : 'handback'
    try {
      await fetch(`${API}/ai-suite/${ep}/${conv.id}`, { method: 'POST', headers: authH() })
      onRefresh()
    } catch {} finally { setToggling(false) }
  }

  return (
    <div className="border border-gray-100 rounded-2xl overflow-hidden bg-white shadow-sm">
      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-100">
        <div className="flex items-center gap-2.5">
          <Avatar name={name} size={30} pictureUrl={conv.profilePictureUrl} />
          <div>
            <p className="text-sm font-semibold text-gray-800 leading-tight">{name}</p>
            <p className="text-[10px] text-gray-400">{fmtTime(conv.updatedAt)}</p>
          </div>
        </div>
        <button onClick={doToggle} disabled={toggling}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-white flex-shrink-0"
          style={{ background: conv.agentEnabled ? '#F59E0B' : '#06b6d4' }}>
          {toggling ? <Loader2 size={11} className="animate-spin" /> :
            conv.agentEnabled ? <><UserCheck size={11} /> Take Over</> : <><Bot size={11} /> Hand Back</>}
        </button>
      </div>
      <div className="px-4 py-3 space-y-2.5">
        {conv.messages.map(msg => {
          const isAgent = msg.role === 'AGENT'
          return (
            <div key={msg.id} className={cn('flex items-start gap-2', isAgent ? 'pl-5' : '')}>
              {isAgent
                ? <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5"><Bot size={12} className="text-blue-600" /></div>
                : <Avatar name={name} size={24} pictureUrl={conv.profilePictureUrl} />}
              <div className="flex-1 min-w-0">
                <div className={cn('inline-block px-3 py-2 rounded-2xl text-sm leading-snug',
                  isAgent ? 'bg-blue-50 text-gray-800' : 'bg-gray-100 text-gray-800')}>
                  {msg.content}
                </div>
                <p className="text-[10px] text-gray-400 mt-0.5 pl-1">{msgTimestamp(msg.createdAt)}</p>
              </div>
            </div>
          )
        })}
      </div>
      {!conv.agentEnabled && (
        <div className="px-4 pb-3 flex items-end gap-2 border-t border-gray-50 pt-2">
          <textarea value={reply} onChange={e => setReply(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply() } }}
            placeholder="Reply publicly as Code Clinic…" rows={1}
            className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-xl resize-none outline-none focus:border-blue-400 bg-gray-50 placeholder-gray-400" />
          <button onClick={sendReply} disabled={sending || !reply.trim()}
            className="p-2 rounded-xl text-white flex-shrink-0 disabled:opacity-40"
            style={{ background: '#1877F2' }}>
            {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Post-grouped comment view ──────────────────────────────────────────────────
function CommentPostView({ channel, accent }: { channel: 'FB_COMMENTS' | 'IG_COMMENTS'; accent: string }) {
  const apiChannel = channel === 'FB_COMMENTS' ? 'facebook_comment' : 'instagram_comment'
  const [posts,      setPosts]     = useState<PostThread[]>([])
  const [loading,    setLoading]   = useState(true)
  const [selPost,    setSelPost]   = useState<PostThread | null>(null)
  const [mobilePane, setMobilePane]= useState<'list' | 'thread'>('list')
  const selPostId = useRef<string | null>(null)

  const fetchPosts = useCallback(async () => {
    try {
      const res = await fetch(`${API}/ai-suite/posts?channel=${apiChannel}`, { headers: authH() })
      if (!res.ok) return
      const data: PostThread[] = await res.json()
      setPosts(data)
      if (selPostId.current) {
        const updated = data.find(p => p.postId === selPostId.current)
        if (updated) setSelPost(updated)
      }
    } catch {} finally { setLoading(false) }
  }, [apiChannel])

  useEffect(() => {
    setPosts([]); setSelPost(null); setLoading(true); selPostId.current = null
    fetchPosts()
    const t = setInterval(fetchPosts, 15000)
    return () => clearInterval(t)
  }, [channel])

  function selectPost(p: PostThread) { setSelPost(p); selPostId.current = p.postId; setMobilePane('thread') }

  const ch = CHANNELS.find(c => c.key === channel)!
  const ChIcon = ch.icon

  const PostList = (
    <div className="flex flex-col h-full bg-white">
      <div className="flex items-center justify-between px-4 py-3 flex-shrink-0" style={{ background: HEADER_BG[channel] }}>
        <div className="flex items-center gap-2">
          <ChIcon size={16} className="text-white" />
          <span className="text-sm font-bold text-white">{ch.label}</span>
        </div>
        <span className="text-xs text-white/70">{posts.length} post{posts.length !== 1 ? 's' : ''}</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 size={22} className="animate-spin" style={{ color: accent }} /></div>
        ) : posts.length === 0 ? (
          <div className="px-4 py-16 text-center">
            <ChIcon size={32} className="mx-auto mb-3 text-gray-200" />
            <p className="text-sm text-gray-400">No {ch.label} yet</p>
          </div>
        ) : posts.map(post => (
          <button key={post.postId} onClick={() => selectPost(post)}
            className="w-full flex items-start gap-3 px-4 py-3 border-b border-gray-50 text-left transition-colors hover:bg-gray-50"
            style={selPost?.postId === post.postId ? { backgroundColor: accent + '15' } : undefined}>
            <div className="w-12 h-12 rounded-xl flex-shrink-0 overflow-hidden bg-gray-100 border border-gray-100">
              {post.thumbnailUrl
                ? <img src={post.thumbnailUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                : <div className="w-full h-full flex items-center justify-center"><ChIcon size={16} className="text-gray-300" /></div>}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-1 mb-1">
                <p className="text-xs font-semibold text-gray-800 leading-snug line-clamp-2 flex-1">
                  {post.caption ? post.caption.slice(0, 60) + (post.caption.length > 60 ? '…' : '') : 'Post'}
                </p>
                <span className="text-[10px] text-gray-400 flex-shrink-0 whitespace-nowrap pl-1">{fmtTime(post.latestAt)}</span>
              </div>
              <span className="inline-flex text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
                {post.commentCount} comment{post.commentCount !== 1 ? 's' : ''}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  )

  const ThreadPanel = selPost ? (
    <div className="flex flex-col h-full bg-gray-50">
      <div className="flex items-center gap-3 px-4 py-3 flex-shrink-0 bg-white border-b border-gray-100 shadow-sm">
        <button onClick={() => setMobilePane('list')} className="md:hidden text-gray-400 hover:text-gray-600 mr-1"><ChevronLeft size={18} /></button>
        {selPost.thumbnailUrl
          ? <img src={selPost.thumbnailUrl} alt="" referrerPolicy="no-referrer"
              className="w-10 h-10 rounded-xl object-cover flex-shrink-0 border border-gray-100"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
          : <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0"><ChIcon size={16} style={{ color: accent }} /></div>}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-gray-800 line-clamp-2 leading-snug">
            {selPost.caption ? selPost.caption.slice(0, 100) + (selPost.caption.length > 100 ? '…' : '') : 'Post'}
          </p>
          <p className="text-[10px] text-gray-400 mt-0.5">
            {selPost.commentCount} comment{selPost.commentCount !== 1 ? 's' : ''} · {fmtTime(selPost.latestAt)}
          </p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {selPost.conversations.length === 0
          ? <p className="text-sm text-gray-400 text-center py-8">No comments yet</p>
          : selPost.conversations.map(conv => (
              <CommentThread key={conv.id} conv={conv} onRefresh={fetchPosts} />
            ))}
      </div>
    </div>
  ) : (
    <div className="flex flex-col items-center justify-center h-full gap-3 bg-gray-50">
      <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: accent + '20' }}>
        <ChIcon size={28} style={{ color: accent }} />
      </div>
      <p className="text-gray-600 text-sm font-semibold">Select a post to see its comments</p>
    </div>
  )

  return (
    <div className="flex h-full overflow-hidden">
      <div className={cn('w-full md:w-[300px] flex-shrink-0 h-full border-r border-gray-100',
        mobilePane === 'list' ? 'flex' : 'hidden md:flex')}>
        {PostList}
      </div>
      <div className={cn('flex-1 h-full min-w-0',
        mobilePane === 'thread' ? 'flex' : 'hidden md:flex')}>
        {ThreadPanel}
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────
function InboxPage() {
  const [dark, setDark] = useState(false)
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

  const msgsEnd        = useRef<HTMLDivElement>(null)
  const pollConv       = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollMsg        = useRef<ReturnType<typeof setInterval> | null>(null)
  const isNearBottom   = useRef(true)
  const prevConvId     = useRef<string | null>(null)
  const prevConvsRef   = useRef<Map<string, string>>(new Map())
  const [showArchived, setShowArchived] = useState(false)
  const [showNewChat,  setShowNewChat]  = useState(false)
  const pendingSelectId = useRef<string | null>(null)
  const listPanelRef    = useRef<HTMLDivElement>(null)

  // Lead badge — matches conversations to CRM leads by phone number (the
  // only relation available; Lead and AiConversation have no foreign key
  // between them). Real GET /leads data, client-side join only. Only
  // meaningful on WHATSAPP, where phoneNumber is an actual phone number
  // (other channels store a Meta PSID or session UUID there instead).
  const [leadPhones, setLeadPhones] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (channel !== 'WHATSAPP') { setLeadPhones(new Set()); return }
    fetch(`${API}/crm/leads`, { headers: authH() })
      .then(r => r.ok ? r.json() : [])
      .then((leads: { phone?: string; status?: string }[]) => {
        if (!Array.isArray(leads)) return
        const active = leads.filter(l => l.phone && l.status !== 'CONVERTED' && l.status !== 'LOST')
        setLeadPhones(new Set(active.map(l => normalizePhoneDigits(l.phone as string))))
      }).catch(() => {})
  }, [channel])
  function isLeadConversation(conv: Conversation): boolean {
    if (channel !== 'WHATSAPP' || !conv.phoneNumber) return false
    return leadPhones.has(normalizePhoneDigits(conv.phoneNumber))
  }

  function onDividerMouseDown(e: React.MouseEvent) {
    e.preventDefault()
    const startX = e.clientX
    const startW = listPanelRef.current?.offsetWidth ?? 320
    const onMove = (ev: MouseEvent) => {
      const newW = Math.min(520, Math.max(240, startW + ev.clientX - startX))
      if (listPanelRef.current) listPanelRef.current.style.width = `${newW}px`
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

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
      const res = await fetch(`${API}/ai-suite/conversations?channel=${ch}${showArchived ? '&archived=true' : ''}`, { headers: authH() })
      if (!res.ok) return
      const data: Conversation[] = await res.json()
      const deduped = dedupeByPhone(data)
      // Detect new incoming patient messages and fire browser notifications
      if (prevConvsRef.current.size > 0 && document.hidden && Notification.permission === 'granted') {
        for (const conv of deduped) {
          const lm = conv.lastMessage
          if (!lm || lm.role !== 'USER') continue
          const prev = prevConvsRef.current.get(conv.id)
          if (prev && lm.createdAt > prev) {
            const name    = convLabel(conv, channel)
            const preview = name + ': ' + lm.content.replace(/\n/g, ' ').slice(0, 60)
            fireInboxNotification('New Message — Code Clinic', preview)
          }
        }
      }
      for (const conv of deduped) {
        const lm = conv.lastMessage
        prevConvsRef.current.set(conv.id, lm ? lm.createdAt : conv.updatedAt)
      }
      setConvs(deduped)
      if (pendingSelectId.current) {
        const toSelect = deduped.find(c => c.id === pendingSelectId.current)
        if (toSelect) { setSel(toSelect); setMobileView('chat'); pendingSelectId.current = null }
      } else if (sel) {
        const updated = deduped.find(c => c.id === sel.id)
        // Not found here anymore (deleted, or archived/unarchived out of the current view) — deselect.
        setSel(updated ?? null)
      }
    } catch {} finally { setLoadingC(false) }
  }, [channel, showArchived, sel?.id])

  // After a chat-management action (archive/unarchive/delete/new chat), refresh
  // the list immediately rather than waiting for the next poll tick.
  function handleConvChanged() {
    fetchConvs()
  }

  function handleNewChatCreated(id: string) {
    setShowArchived(false)
    pendingSelectId.current = id
    fetchConvs()
  }

  const fetchMsgs = useCallback(async (id: string) => {
    setLoadingM(true)
    try {
      const res = await fetch(`${API}/ai-suite/conversations/${id}/messages`, { headers: authH() })
      if (res.ok) setMsgs(await res.json())
    } catch {} finally { setLoadingM(false) }
  }, [])

  useEffect(() => {
    setSel(null); setConvs([]); setMsgs([]); setLoadingC(true)
    prevConvsRef.current.clear()
    if (pollConv.current) clearInterval(pollConv.current)
    fetchConvs()
    pollConv.current = setInterval(fetchConvs, 10000)
    return () => { if (pollConv.current) clearInterval(pollConv.current) }
  }, [channel, showArchived])

  useEffect(() => {
    const syncTheme = () => setDark(document.documentElement.classList.contains('dark'))
    syncTheme()
    const observer = new MutationObserver(syncTheme)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    window.addEventListener('cc-theme', syncTheme)
    return () => { observer.disconnect(); window.removeEventListener('cc-theme', syncTheme) }
  }, [])

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
        <div className="flex items-center gap-3">
          <span className="text-xs text-white/60">{filtered.length} chats</span>
          <button onClick={() => setShowNewChat(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold text-white bg-white/20 hover:bg-white/30 transition-colors">
            <Plus size={13} />
            New Chat
          </button>
        </div>
      </div>
      <div className="px-3 py-2 flex-shrink-0 bg-white border-b border-gray-100 flex items-center gap-2">
        <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl bg-[#f0f2f5]">
          <Search size={14} className="text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search or start new chat"
            className="flex-1 bg-transparent text-sm text-gray-800 placeholder-gray-400 outline-none" />
        </div>
        <button onClick={() => setShowArchived(a => !a)}
          className={cn('flex-shrink-0 text-[11px] font-semibold px-2.5 py-2 rounded-xl transition-colors',
            showArchived ? 'bg-[#075E54] text-white' : 'bg-[#f0f2f5] text-gray-500 hover:bg-gray-200')}>
          {showArchived ? 'Active' : 'Archived'}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loadingC ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={22} className="animate-spin text-[#25D366]" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-16 text-center">
            <MessageSquare size={32} className="mx-auto mb-3 text-gray-200" />
            <p className="text-sm text-gray-400 mb-4">No WhatsApp conversations yet</p>
            <button onClick={() => setShowNewChat(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-white bg-[#25D366] hover:bg-[#1fb959] transition-colors">
              <Plus size={14} /> Start a new chat
            </button>
          </div>
        ) : filtered.map(conv => {
          const name    = convLabel(conv, 'WHATSAPP')
          const last    = conv.lastMessage
          const time    = fmtTime(last?.createdAt ?? conv.updatedAt)
          const active  = sel?.id === conv.id
          const preview = last ? (last.role === 'AGENT' ? '🤖 ' : '') + last.content.slice(0, 50) : 'No messages'
          const ws     = getWorkState(conv)
          const wsMeta = WORK_STATE_META[ws]
          const isLead = isLeadConversation(conv)
          return (
            <div key={conv.id}
              className={cn('flex items-center gap-3 border-b border-l-[3px] border-b-gray-50 px-3.5 py-3 cursor-pointer transition-colors select-none dark:border-b-white/[0.04]',
                active ? 'border-l-[#25D366] bg-[#f4fbf3] dark:bg-[#0f2a1c]' : 'border-l-transparent hover:bg-gray-50 dark:hover:bg-white/[0.04]')}
              onClick={() => selectConv(conv)}
              role="button" tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter') selectConv(conv) }}>
              <div className="relative flex-shrink-0">
                <Avatar name={name} size={44} />
                <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full border-2 border-white shadow-sm overflow-hidden flex items-center justify-center bg-white">
                  <NextImage src="/icons/whatsapp.png" alt="WhatsApp" width={16} height={16} className="block w-full h-full object-contain mix-blend-multiply" />
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5 gap-1">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="text-sm font-semibold text-gray-800 dark:text-white truncate">{name}</span>
                    {isLead && <span className="flex-shrink-0 rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-bold text-violet-600 dark:bg-violet-400/10 dark:text-violet-400">Lead</span>}
                  </span>
                  <span className="text-[11px] flex-shrink-0 ml-1 text-gray-400">{time}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-gray-400 truncate flex-1">{preview}</p>
                  <span className="flex-shrink-0 h-2 w-2 rounded-full" style={{ background: wsMeta.dot }} title={wsMeta.label} />
                </div>
              </div>
              <div onClick={e => e.stopPropagation()} className="flex-shrink-0 ml-1">
                <RowChatMenu conv={conv} onChanged={handleConvChanged} />
              </div>
            </div>
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
        {/* No online/last-seen indicator — WhatsApp's Business API does not expose
            contact presence to businesses (a peer-to-peer WhatsApp privacy feature,
            never extended to the Cloud API). Showing a dot here would be fake. */}
        <Avatar name={convLabel(sel, 'WHATSAPP')} size={40} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white truncate">{convLabel(sel, 'WHATSAPP')}</p>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px]" style={{ color: '#90cbb7' }}>
            <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-1.5 py-0.5 font-medium text-white/85">
              {sel.agentEnabled ? '🤖 AI handling' : '👤 Human handling'}
            </span>
            <span className="truncate">{formatPhoneDisplay(sel.phoneNumber)}</span>
            {lastActivityLabel(sel.lastMessage?.createdAt) && (
              <span className="truncate opacity-75">· {lastActivityLabel(sel.lastMessage?.createdAt)}</span>
            )}
          </div>
        </div>
        <ChatMenu sel={sel} onChanged={handleConvChanged} />
        <button onClick={toggleTakeover}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white transition-all hover:opacity-90"
          style={{ background: isHuman ? '#06b6d4' : '#F59E0B' }}>
          {isHuman ? <><Bot size={13} /> Hand Back</> : <><UserCheck size={13} /> Take Over</>}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 px-4 pt-4 pb-20 space-y-1.5"
        onScroll={handleMessagesScroll}
        style={{ background: dark ? '#0b1f38' : '#e5ddd5', backgroundImage: WA_WALLPAPER }}>
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
                  <div className={cn('flex items-center gap-1 mt-0.5', isAgent ? 'justify-end' : 'justify-start')}>
                    <span className="text-[10px] text-gray-400">{msgTimestamp(msg.createdAt)}</span>
                    {isAgent && <MsgStatus status={msg.status} />}
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
        <div className="flex items-center gap-3 px-4 py-3 flex-shrink-0 border-t border-gray-200" style={{ background: dark ? '#0c1b32' : '#f9fafb' }}>
          <Bot size={18} className="text-[#25D366] flex-shrink-0" />
          <p className="flex-1 text-xs text-gray-500">AI is handling this — click <strong className="text-amber-500">Take Over</strong> to reply manually</p>
          <button onClick={toggleTakeover} className="px-3 py-1.5 rounded-xl text-xs font-bold text-white bg-amber-400 hover:bg-amber-500 transition-colors">
            Take Over
          </button>
        </div>
      ) : (
        <Composer sel={sel!} fetchMsgs={fetchMsgs} channel={channel} accent={accent} dark={dark} />
      )}
    </div>
  ) : (
    <div className="flex flex-col items-center justify-center h-full gap-3"
      style={{ background: dark ? '#0b1f38' : '#e5ddd5', backgroundImage: WA_WALLPAPER }}>
      <div className="w-20 h-20 rounded-full flex items-center justify-center" style={{ background: '#25D36620' }}>
        <MessageSquare size={36} className="text-[#25D366]" />
      </div>
      <p className="text-gray-600 dark:text-slate-300 text-sm font-semibold">Select a conversation to start</p>
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
      <div className="px-3 py-2 flex-shrink-0 border-b border-gray-100 flex items-center gap-2">
        <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-100">
          <Search size={14} className="text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search conversations"
            className="flex-1 bg-transparent text-sm text-gray-800 placeholder-gray-400 outline-none" />
        </div>
        <button onClick={() => setShowArchived(a => !a)}
          className={cn('flex-shrink-0 text-[11px] font-semibold px-2.5 py-2 rounded-xl transition-colors',
            showArchived ? 'text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200')}
          style={showArchived ? { background: accent } : undefined}>
          {showArchived ? 'Active' : 'Archived'}
        </button>
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
          const isCommentCh = channel === 'FB_COMMENTS' || channel === 'IG_COMMENTS'
          const ws     = getWorkState(conv)
          const wsMeta = WORK_STATE_META[ws]
          return (
            <div key={conv.id}
              className={cn('flex items-center gap-3 border-b border-l-[3px] border-b-gray-50 px-3.5 py-3 cursor-pointer transition-colors select-none dark:border-b-white/[0.04]',
                active ? 'dark:bg-white/[0.05]' : 'border-l-transparent hover:bg-gray-50 dark:hover:bg-white/[0.04]')}
              style={{ borderLeftColor: active ? accent : 'transparent', backgroundColor: active ? accent + '0d' : undefined }}
              onClick={() => selectConv(conv)}
              role="button" tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter') selectConv(conv) }}>
              <div className="relative flex-shrink-0">
                <Avatar name={name} size={44} pictureUrl={conv.profilePictureUrl} />
                <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full border-2 border-white shadow-sm overflow-hidden flex items-center justify-center bg-white flex-shrink-0">
                  <NextImage src={ch.imgSrc} alt={ch.label} width={16} height={16}
                    className={cn('block w-full h-full object-contain', ch.key === 'INSTAGRAM' ? 'rounded-full' : 'mix-blend-multiply')} />
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-sm font-semibold text-gray-800 dark:text-white truncate">{name}</span>
                  <span className="text-[11px] flex-shrink-0 ml-1 text-gray-400">{time}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-gray-400 truncate flex-1">{preview}</p>
                  <span className="flex-shrink-0 h-2 w-2 rounded-full" style={{ background: wsMeta.dot }} title={wsMeta.label} />
                </div>
                {isCommentCh && conv.postCaption && (
                  <p className="text-[10px] text-gray-300 truncate mt-0.5">📄 {conv.postCaption.slice(0, 55)}</p>
                )}
              </div>
              <div onClick={e => e.stopPropagation()} className="flex-shrink-0 ml-1">
                <RowChatMenu conv={conv} onChanged={handleConvChanged} />
              </div>
            </div>
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
        <Avatar name={convLabel(sel, channel)} size={40} pictureUrl={sel.profilePictureUrl} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-800 dark:text-white truncate">{convLabel(sel, channel)}</p>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-gray-400">
            <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-1.5 py-0.5 font-medium text-gray-500 dark:bg-white/10 dark:text-slate-300">
              {sel.agentEnabled ? '🤖 AI handling' : '👤 Human handling'}
            </span>
            {channel === 'WHATSAPP' && <span className="truncate">{formatPhoneDisplay(sel.phoneNumber)}</span>}
            {lastActivityLabel(sel.lastMessage?.createdAt) && (
              <span className="truncate opacity-75">· {lastActivityLabel(sel.lastMessage?.createdAt)}</span>
            )}
          </div>
        </div>
        <ChatMenu sel={sel} onChanged={handleConvChanged} dark={dark} />
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
          return (
            <div key={msg.id} className={cn('flex items-end gap-2', isAgent ? 'justify-end' : 'justify-start')}>
              {!isAgent && <Avatar name={convLabel(sel, channel)} size={28} pictureUrl={sel.profilePictureUrl} />}
              <div className={cn('max-w-[65%] flex flex-col', isAgent ? 'items-end' : 'items-start')}>
                <div className={cn('px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed shadow-sm',
                  isAgent ? 'rounded-tr-sm text-white' : 'rounded-tl-sm text-gray-800 bg-white border border-gray-100')}
                  style={isAgent ? { background: BUBBLE_BG[channel] } : undefined}>
                  {media ? <MediaBubble type={media} content={msg.content} /> : msg.content}
                </div>
                <span className={cn('text-[10px] text-gray-400 mt-0.5 px-1', isAgent ? 'text-right' : 'text-left')}>{msgTimestamp(msg.createdAt)}</span>
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
        <Composer sel={sel!} fetchMsgs={fetchMsgs} channel={channel} accent={accent} dark={dark} />
      )}
    </div>
  ) : (
    <div className="flex flex-col items-center justify-center h-full gap-3 bg-gray-50">
      <div className="w-20 h-20 rounded-full flex items-center justify-center" style={{ background: accent + '20' }}>
        <ChIcon size={36} style={{ color: accent }} />
      </div>
      <p className="text-gray-600 text-sm font-semibold">Select a conversation to start</p>
      <p className="text-gray-400 text-xs">Conversations — {ch.label}</p>
    </div>
  )

  // ── Render ─────────────────────────────────────────────────────────────────────
  const ConvList  = channel === 'WHATSAPP' ? WaConvList  : LightConvList
  const ChatPanel = channel === 'WHATSAPP' ? WaChatPanel : LightChatPanel

  return (
    <div className="conversations-ui flex flex-col h-full overflow-hidden bg-white dark:bg-[#08162f]">
      {/* Channel tab bar */}
      <div className="flex-shrink-0 flex items-center gap-0.5 border-b border-gray-200 bg-white px-2 py-1.5">
        {CHANNELS.map(c => {
          const active = channel === c.key
          return (
            <button key={c.key} onClick={() => { setChannel(c.key); setMobileView('list') }}
              className={cn('flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-all',
                active ? 'font-semibold' : 'text-gray-400 hover:bg-gray-50 hover:text-gray-600 dark:hover:bg-white/5')}
              style={active ? { color: c.color, backgroundColor: c.color + '12' } : undefined}>
              <NextImage
                src={c.imgSrc}
                alt={c.label}
                width={30}
                height={30}
                className={cn(
                  'object-contain flex-shrink-0 transition-opacity',
                  c.key === 'INSTAGRAM' ? 'rounded-full' : 'mix-blend-multiply dark:mix-blend-normal',
                  active ? 'opacity-100' : 'opacity-40'
                )}
              />
              <span className="hidden sm:inline">{c.label}</span>
            </button>
          )
        })}
      </div>

      {/* Split pane */}
      <div className="flex-1 flex overflow-hidden">
        {(channel === 'FB_COMMENTS' || channel === 'IG_COMMENTS') ? (
          <CommentPostView channel={channel as 'FB_COMMENTS' | 'IG_COMMENTS'} accent={accent} />
        ) : (
          <>
            <div ref={listPanelRef} className={cn(
              'w-full md:w-[320px] flex-shrink-0 h-full border-r border-gray-100',
              sel ? 'hidden md:flex' : 'flex',
              mobileView === 'list' ? 'flex' : 'hidden md:flex',
            )}>
              {ConvList}
            </div>
            {/* Drag handle — desktop only */}
            <div
              onMouseDown={onDividerMouseDown}
              title="Drag to resize"
              className="hidden md:flex w-[5px] cursor-col-resize flex-shrink-0 items-center justify-center group"
              style={{ touchAction: 'none' }}>
              <div className="w-[3px] h-10 rounded-full bg-gray-200 group-hover:bg-[#25D366] transition-colors" />
            </div>
            <div className={cn(
              'flex-1 h-full min-w-0',
              !sel ? 'hidden md:flex' : 'flex',
              mobileView === 'chat' ? 'flex' : 'hidden md:flex',
            )}>
              {ChatPanel}
            </div>
          </>
        )}
      </div>

      {showNewChat && (
        <NewChatModal onClose={() => setShowNewChat(false)} onCreated={handleNewChatCreated} />
      )}
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
