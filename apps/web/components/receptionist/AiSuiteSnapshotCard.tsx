'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import NextImage from 'next/image'
import { Bot, User, MessageCircle, ArrowUpRight } from 'lucide-react'
import { CompactCard } from './DashboardPrimitives'

interface Snapshot {
  totalConversations: number
  customerLast: number
  clinicLast: number
  aiHandling: number
  humanHandling: number
  channels: Record<string, number>
}

// Real AiConversation.channel values only, matching the real Conversations
// workspace's own channel list (apps/web/app/(receptionist)/receptionist/
// ai-suite/inbox/page.tsx CHANNELS array) — FB/IG comment threads kept as
// their own distinct rows, never folded into Facebook/Instagram. Real brand
// PNG icons only, no emoji substitutes.
const CHANNELS: { key: string; apiVal: string; label: string; iconSrc: string; isComment?: boolean; color: string }[] = [
  { key: 'WHATSAPP',          apiVal: 'whatsapp',          label: 'WhatsApp',          iconSrc: '/icons/whatsapp.png',  color: '#25D366' },
  { key: 'FACEBOOK',          apiVal: 'facebook',          label: 'Facebook DM',       iconSrc: '/icons/facebook.png',  color: '#1877F2' },
  { key: 'INSTAGRAM',         apiVal: 'instagram',         label: 'Instagram DM',      iconSrc: '/icons/instagram.png', color: '#E4405F' },
  { key: 'FACEBOOK_COMMENT',  apiVal: 'facebook_comment',  label: 'Facebook Comments', iconSrc: '/icons/facebook.png',  color: '#1877F2', isComment: true },
  { key: 'INSTAGRAM_COMMENT', apiVal: 'instagram_comment', label: 'Instagram Comments',iconSrc: '/icons/instagram.png', color: '#E4405F', isComment: true },
  { key: 'WEBSITE',           apiVal: 'website',           label: 'Website',           iconSrc: '/icons/website.png',   color: '#6366F1' },
]

// Preserves the exact backend semantics established for this endpoint (see
// GET /ai-suite/snapshot, takeover.routes.ts): Conversations Today = distinct
// AiConversation with a message today (Kampala day). Latest meaningful
// message role: USER -> Customer replied last, AGENT -> Clinic replied last
// (SYSTEM messages are excluded server-side, never counted either way).
// agentEnabled === true -> AI handling, false -> Human handling. Nothing
// here re-derives or reinterprets those values client-side.
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

  return (
    <CompactCard title="Today's AI Activity" action={<Link href="/receptionist/ai-suite/inbox" className="flex items-center gap-0.5 text-[11px] font-bold text-clinic-blue hover:underline dark:text-cyan-400">View AI Suite <ArrowUpRight size={11} /></Link>}>
      {!data ? (
        <div className="h-40 animate-pulse rounded-xl bg-gray-50 dark:bg-white/5" />
      ) : (
        <>
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-400/10 dark:text-emerald-300"><Bot size={16} /></span>
            <div>
              <p className="text-2xl font-extrabold leading-none text-clinic-navy dark:text-white">{total}</p>
              <p className="text-[10px] font-medium text-gray-500 dark:text-slate-400">Conversations Today</p>
            </div>
          </div>

          <div className="mt-2.5 grid grid-cols-2 gap-1.5">
            <div className="rounded-xl bg-red-50 px-2.5 py-1.5 dark:bg-red-400/10">
              <p className="text-base font-extrabold leading-none text-red-600 dark:text-red-400">{data.customerLast}</p>
              <p className="mt-1 text-[9px] font-semibold leading-tight text-red-500/80 dark:text-red-300/70">Customer replied last</p>
            </div>
            <div className="rounded-xl bg-blue-50 px-2.5 py-1.5 dark:bg-blue-400/10">
              <p className="text-base font-extrabold leading-none text-blue-600 dark:text-blue-400">{data.clinicLast}</p>
              <p className="mt-1 text-[9px] font-semibold leading-tight text-blue-500/80 dark:text-blue-300/70">Clinic replied last</p>
            </div>
          </div>

          <div className="mt-2.5 flex items-center justify-between text-[10px] font-semibold text-gray-500 dark:text-slate-400">
            <span className="flex items-center gap-1"><Bot size={11} className="text-emerald-500" /> {data.aiHandling} AI handling</span>
            <span className="flex items-center gap-1"><User size={11} className="text-amber-500" /> {data.humanHandling} Human handling</span>
          </div>

          <div className="mt-2.5 space-y-1 border-t border-gray-100 pt-2 dark:border-white/10">
            {CHANNELS.map(c => {
              const count = data.channels?.[c.key] ?? 0
              const pct = total > 0 ? Math.round((count / total) * 100) : 0
              return (
                <Link key={c.key} href={`/receptionist/ai-suite/inbox?channel=${c.apiVal}`}
                  className="flex items-center justify-between rounded-lg px-1 py-0.5 text-[10px] transition-colors hover:bg-gray-50 dark:hover:bg-white/5">
                  <span className="flex items-center gap-1.5 text-gray-500 dark:text-slate-400">
                    <span className="relative grid h-4 w-4 flex-shrink-0 place-items-center">
                      <NextImage src={c.iconSrc} alt={c.label} width={14} height={14} className="h-3.5 w-3.5 object-contain" />
                      {c.isComment && (
                        <span className="absolute -bottom-1 -right-1 grid h-2.5 w-2.5 place-items-center rounded-full bg-white shadow-sm ring-1 ring-gray-100 dark:bg-[#0b1a36] dark:ring-white/10">
                          <MessageCircle size={6} style={{ color: c.color }} />
                        </span>
                      )}
                    </span>
                    {c.label}
                  </span>
                  <span className={count > 0 ? 'font-bold text-gray-700 dark:text-slate-200' : 'text-gray-300 dark:text-white/25'}>
                    {count}{count > 0 ? ` · ${pct}%` : ''}
                  </span>
                </Link>
              )
            })}
          </div>
        </>
      )}
    </CompactCard>
  )
}
