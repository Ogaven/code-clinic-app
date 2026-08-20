'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { MessageSquare, Instagram, Facebook, Globe, ChevronRight, Bot } from 'lucide-react'

interface Props {
  patientId: string
  token: string | null
  inboxBasePath: string // '/receptionist/ai-suite/inbox' or '/ai-suite/inbox'
}

type AiMessage = { id: string; role: string; content: string; createdAt: string }
type AiConversationPreview = {
  found: boolean
  conversationId?: string
  channel?: string
  phoneNumber?: string
  updatedAt?: string
  messages?: AiMessage[]
}

const CHANNEL_META: Record<string, { label: string; icon: any; color: string }> = {
  WHATSAPP:          { label: 'WhatsApp',   icon: MessageSquare, color: '#25D366' },
  INSTAGRAM:         { label: 'Instagram',  icon: Instagram,     color: '#E4405F' },
  FACEBOOK:          { label: 'Facebook',   icon: Facebook,      color: '#1877F2' },
  WEBSITE:           { label: 'Website',    icon: Globe,         color: '#6366f1' },
  FACEBOOK_COMMENT:  { label: 'FB Comment', icon: Facebook,      color: '#1877F2' },
  INSTAGRAM_COMMENT: { label: 'IG Comment', icon: Instagram,     color: '#E4405F' },
  SMS:               { label: 'SMS',        icon: MessageSquare, color: '#0ea5e9' },
}

function fmtWhen(iso: string): string {
  const d = new Date(iso), now = new Date()
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi' })
  if (diffDays === 0) return `Today ${time}`
  if (diffDays === 1) return `Yesterday ${time}`
  if (diffDays < 7)   return d.toLocaleDateString('en-GB', { weekday: 'short' }) + ` ${time}`
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function stripMediaMarkers(content: string): string {
  if (content.startsWith('__MEDIA_IMAGE__:')) return '📷 Image'
  if (/^\[Patient sent an? (image|audio|video|document|sticker|voice note)\]/i.test(content)) return content
  if (/^Reacted with /i.test(content)) return content
  return content
}

export default function RecentAiConversation({ patientId, token, inboxBasePath }: Props) {
  const router = useRouter()
  const [data, setData]       = useState<AiConversationPreview | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api-proxy/patients/${patientId}/ai-conversation`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => res.ok ? res.json() : { found: false })
      .then(json => { if (!cancelled) setData(json) })
      .catch(() => { if (!cancelled) setData({ found: false }) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [patientId, token])

  const meta = data?.channel ? CHANNEL_META[data.channel] ?? CHANNEL_META.WHATSAPP : CHANNEL_META.WHATSAPP
  const Icon = meta.icon

  function openInInbox() {
    if (!data?.phoneNumber) return
    router.push(`${inboxBasePath}?phone=${encodeURIComponent(data.phoneNumber)}`)
  }

  return (
    <div className="bg-indigo-50 dark:bg-indigo-900/10 border border-indigo-100 dark:border-indigo-700/30 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wide text-indigo-600 flex items-center gap-1.5">
          <Bot size={13} /> Recent AI Conversation
        </p>
        {data?.found && (
          <button onClick={openInInbox}
            className="text-xs text-indigo-600 hover:text-indigo-800 dark:hover:text-indigo-300 font-semibold flex items-center gap-1 transition-colors">
            Open full thread <ChevronRight size={11} />
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-xs text-indigo-400 animate-pulse">Loading…</p>
      ) : !data?.found ? (
        <p className="text-xs text-indigo-600/60 dark:text-indigo-400/60 italic">
          No AI conversation with Sarah yet.
        </p>
      ) : (
        <button onClick={openInInbox} className="w-full text-left space-y-2 group">
          <div className="flex items-center gap-1.5 text-[11px] text-indigo-500">
            <Icon size={12} style={{ color: meta.color }} />
            <span className="font-semibold">{meta.label}</span>
            <span>·</span>
            <span>{data.updatedAt ? fmtWhen(data.updatedAt) : ''}</span>
          </div>
          <div className="space-y-1.5">
            {(data.messages ?? []).map(m => (
              <div key={m.id} className={m.role === 'AGENT' ? 'flex justify-end' : 'flex justify-start'}>
                <div className={
                  m.role === 'AGENT'
                    ? 'max-w-[85%] px-2.5 py-1.5 rounded-lg text-xs bg-indigo-100 dark:bg-indigo-800/40 text-indigo-800 dark:text-indigo-100'
                    : 'max-w-[85%] px-2.5 py-1.5 rounded-lg text-xs bg-white dark:bg-white/5 border border-indigo-100 dark:border-indigo-700/20 text-slate-700 dark:text-white/80'
                }>
                  {stripMediaMarkers(m.content).slice(0, 140)}
                </div>
              </div>
            ))}
            {(data.messages ?? []).length === 0 && (
              <p className="text-xs text-indigo-400 italic">Conversation exists but has no messages yet.</p>
            )}
          </div>
          <p className="text-[10px] text-indigo-400 group-hover:text-indigo-600 transition-colors pt-0.5">
            View full thread in AI Suite Inbox →
          </p>
        </button>
      )}
    </div>
  )
}
