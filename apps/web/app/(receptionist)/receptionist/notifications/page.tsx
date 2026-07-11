'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, Bell, CheckCheck, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

function timeAgo(dateStr: string) {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

const TYPE_COLORS: Record<string, string> = {
  ESCALATION:   'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  APPOINTMENT:  'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  CONFIRMATION: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  MESSAGE:      'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  SYSTEM:       'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-400',
}

const TYPE_EMOJI: Record<string, string> = {
  ESCALATION: '🚨', APPOINTMENT: '📅', CONFIRMATION: '✅', MESSAGE: '💬', SYSTEM: '⚙️',
}

export default function ReceptionistNotificationsPage() {
  const [notifs,  setNotifs]  = useState<any[]>([])
  const [unread,  setUnread]  = useState(0)
  const [loading, setLoading] = useState(true)
  const [marking, setMarking] = useState(false)

  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null

  const fetchNotifs = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const r = await fetch('/api-proxy/receptionist/notifications', { headers: { Authorization: `Bearer ${token}` } })
      const d = await r.json()
      setNotifs(d.notifications || [])
      setUnread(d.unread || 0)
    } catch {} finally { setLoading(false) }
  }, [token])

  useEffect(() => { fetchNotifs() }, [fetchNotifs])

  async function markAllRead() {
    if (!token) return
    setMarking(true)
    try {
      await fetch('/api-proxy/receptionist/notifications/mark-read', { method: 'PUT', headers: { Authorization: `Bearer ${token}` } })
      setUnread(0)
      setNotifs(n => n.map(x => ({ ...x, isRead: true })))
    } catch {} finally { setMarking(false) }
  }

  return (
    <div className="space-y-4 p-4 md:p-6 pb-24 md:pb-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <Link href="/receptionist/dashboard"
          className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-white/10 text-gray-400 transition-colors">
          <ArrowLeft size={16} />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-800 dark:text-white">Notifications</h1>
          <p className="text-sm text-gray-400 mt-0.5">{unread > 0 ? `${unread} unread` : 'All caught up!'}</p>
        </div>
        <button onClick={fetchNotifs}
          className="p-2.5 rounded-xl border border-gray-200 dark:border-white/10 hover:bg-gray-100 dark:hover:bg-white/10 text-gray-500 dark:text-gray-400">
          <RefreshCw size={14} />
        </button>
        {unread > 0 && (
          <button onClick={markAllRead} disabled={marking}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm text-white transition-all hover:-translate-y-0.5"
            style={{ background: 'linear-gradient(135deg,#1A237E,#10B981)' }}>
            <CheckCheck size={14} /> Mark all read
          </button>
        )}
      </div>

      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-5 space-y-3">
            {[1,2,3,4,5].map(i => <div key={i} className="h-16 bg-gray-100 dark:bg-white/5 rounded-xl animate-pulse" />)}
          </div>
        ) : notifs.length === 0 ? (
          <div className="py-16 text-center text-gray-400">
            <Bell size={36} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">No notifications yet</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50 dark:divide-white/[0.04]">
            {notifs.map((n) => (
              <div key={n.id}
                className={cn('flex items-start gap-4 px-5 py-4 transition-colors', !n.isRead && 'bg-blue-50/50 dark:bg-blue-900/10')}>
                <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center text-base flex-shrink-0 mt-0.5',
                  n.type === 'ESCALATION' ? 'bg-red-100 dark:bg-red-900/30'
                    : n.type === 'APPOINTMENT' ? 'bg-blue-100 dark:bg-blue-900/30'
                    : n.type === 'CONFIRMATION' ? 'bg-green-100 dark:bg-green-900/30'
                    : n.type === 'MESSAGE' ? 'bg-purple-100 dark:bg-purple-900/30'
                    : 'bg-gray-100 dark:bg-white/10')}>
                  {TYPE_EMOJI[n.type] || '🔔'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-3 mb-0.5">
                    <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full', TYPE_COLORS[n.type] || TYPE_COLORS.SYSTEM)}>
                      {n.type}
                    </span>
                    <span className="text-[10px] text-gray-400 flex-shrink-0">{timeAgo(n.createdAt)}</span>
                  </div>
                  <p className="text-xs font-bold text-gray-700 dark:text-white mb-0.5">{n.title}</p>
                  <p className={cn('text-xs leading-relaxed', n.isRead ? 'text-gray-400 dark:text-gray-500' : 'text-gray-600 dark:text-gray-300')}>
                    {n.body}
                  </p>
                  {n.href && (
                    <Link href={n.href} className="text-[10px] text-blue-500 font-semibold hover:underline mt-1 inline-block">
                      View →
                    </Link>
                  )}
                </div>
                {!n.isRead && <div className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0 mt-2" />}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
