'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Bot, MessageCircle, User, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Snapshot {
  period: { key: string; start: string; end: string }
  totalConversations: number
  customerLast: number
  clinicLast: number
  aiHandling: number
  humanHandling: number
  channels: Record<string, number>
}

// All six requested surfaces map 1:1 onto the real AiConversation.channel
// enum (WHATSAPP, FACEBOOK, INSTAGRAM, FACEBOOK_COMMENT, INSTAGRAM_COMMENT,
// WEBSITE — confirmed in packages/database/prisma/schema.prisma and already
// used by the Conversations workspace's CHANNELS array). Real brand PNG
// assets (not generic Lucide glyphs) so a tile here always matches its tab
// there; Comments variants reuse their parent platform's icon with a small
// comment-bubble badge, since there's no distinct "FB/IG comments" asset.
const TILES: { dbChannel: string; apiVal: string; label: string; iconSrc: string; isComment?: boolean; color: string }[] = [
  { dbChannel: 'WHATSAPP',           apiVal: 'whatsapp',          label: 'WhatsApp',          iconSrc: '/icons/whatsapp.png',  color: '#25D366' },
  { dbChannel: 'FACEBOOK',           apiVal: 'facebook',          label: 'Facebook DM',       iconSrc: '/icons/facebook.png',  color: '#1877F2' },
  { dbChannel: 'INSTAGRAM',          apiVal: 'instagram',         label: 'Instagram DM',      iconSrc: '/icons/instagram.png', color: '#E4405F' },
  { dbChannel: 'FACEBOOK_COMMENT',   apiVal: 'facebook_comment',  label: 'Facebook Comments', iconSrc: '/icons/facebook.png',  color: '#1877F2', isComment: true },
  { dbChannel: 'INSTAGRAM_COMMENT',  apiVal: 'instagram_comment', label: 'Instagram Comments',iconSrc: '/icons/instagram.png', color: '#E4405F', isComment: true },
  { dbChannel: 'WEBSITE',            apiVal: 'website',           label: 'Website',           iconSrc: '/icons/website.png',   color: '#6366f1' },
]

export default function AiSuiteSnapshotCard() {
  const [data, setData] = useState<Snapshot | null>(null)

  useEffect(() => {
    const token = localStorage.getItem('cc_token')
    fetch('/api-proxy/ai-suite/snapshot', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(setData)
      .catch(() => {})
  }, [])

  const total = data?.totalConversations ?? 0
  const loading = data === null

  return (
    <div className="bg-white dark:bg-white/[0.04] rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-white/8">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg,#059669,#10b981)' }}>
            <Bot size={13} className="text-white" />
          </div>
          <h3 className="text-sm font-bold text-gray-800 dark:text-white">AI Suite Activity</h3>
          <span className="text-[10px] font-semibold text-gray-400 dark:text-white/30">Today · Africa/Kampala</span>
        </div>
        <Link href="/receptionist/ai-suite/inbox" className="text-[11px] font-semibold text-cyan-600 dark:text-cyan-400 hover:underline flex items-center gap-0.5">
          Conversations <ChevronRight size={11} />
        </Link>
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-3 divide-x divide-gray-100 dark:divide-white/8 border-b border-gray-100 dark:border-white/8">
        <SummaryStat label="Conversations" sub="Today" value={total} loading={loading} />
        <SummaryStat label="AI Handling" sub="agentEnabled" value={data?.aiHandling ?? 0} loading={loading} icon={<Bot size={11} className="text-emerald-500" />} />
        <SummaryStat label="Human Handling" sub="takeover" value={data?.humanHandling ?? 0} loading={loading} icon={<User size={11} className="text-amber-500" />} />
      </div>

      {/* Six channel tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-3">
        {TILES.map(tile => {
          const count = data?.channels?.[tile.dbChannel] ?? 0
          const pct = total > 0 ? Math.round((count / total) * 100) : 0
          return (
            <Link key={tile.dbChannel} href={`/receptionist/ai-suite/inbox?channel=${tile.apiVal}`}
              className="group flex items-center gap-2 rounded-xl border border-gray-100 dark:border-white/8 p-2 hover:border-gray-200 dark:hover:border-white/20 hover:shadow-sm transition-all">
              <div className="relative w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: tile.color + '18' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={tile.iconSrc} alt="" className="w-4 h-4 object-contain" />
                {tile.isComment && (
                  <span className="absolute -bottom-1 -right-1 grid h-3.5 w-3.5 place-items-center rounded-full bg-white dark:bg-[#0b1a36] shadow-sm ring-1 ring-gray-100 dark:ring-white/10">
                    <MessageCircle size={8} style={{ color: tile.color }} />
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold text-gray-700 dark:text-white/70 truncate">{tile.label}</p>
                {loading ? (
                  <div className="h-3 w-12 mt-1 bg-gray-100 dark:bg-white/10 rounded animate-pulse" />
                ) : (
                  <p className="text-[9px] text-gray-400 dark:text-white/35 tabular-nums">
                    <span className="font-bold text-gray-600 dark:text-white/60">{count}</span> · {pct}%
                  </p>
                )}
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

function SummaryStat({ label, sub, value, loading, icon }: { label: string; sub: string; value: number; loading: boolean; icon?: React.ReactNode }) {
  return (
    <div className="px-4 py-3 text-center">
      {loading ? (
        <div className="h-6 w-8 mx-auto bg-gray-100 dark:bg-white/10 rounded-lg animate-pulse" />
      ) : (
        <p className="text-xl font-black text-gray-800 dark:text-white tabular-nums flex items-center justify-center gap-1">{icon}{value}</p>
      )}
      <p className="text-[10px] font-semibold text-gray-500 dark:text-white/40 mt-0.5">{label}</p>
      <p className={cn('text-[9px] text-gray-400 dark:text-white/25 uppercase tracking-wide')}>{sub}</p>
    </div>
  )
}
