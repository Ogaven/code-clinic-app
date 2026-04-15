'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, MessageSquare, Check, CheckCheck, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

function timeAgo(dateStr: string) {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return new Date(dateStr).toLocaleDateString('en-UG', { day: 'numeric', month: 'short' })
}

const ROLE_COLORS: Record<string, string> = {
  ADMIN: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  RECEPTIONIST: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  SYSTEM: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-400',
  DOCTOR: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
}

export default function DoctorMessagesPage() {
  const [notifications, setNotifs] = useState<any[]>([])
  const [selected, setSelected]    = useState<any | null>(null)
  const [unread, setUnread]        = useState(0)
  const [loading, setLoading]      = useState(true)
  const [marking, setMarking]      = useState(false)

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

  async function markOne(n: any) {
    setSelected(n)
    if (!n.isRead && token) {
      // Mark all as read for simplicity (no single-mark endpoint in current API)
      setNotifs(prev => prev.map(x => x.id === n.id ? { ...x, isRead: true } : x))
      setUnread(u => Math.max(0, u - 1))
    }
  }

  return (
    <div className="flex flex-col md:flex-row h-[calc(100vh-56px)] animate-fade-in">

      {/* LEFT: message list */}
      <div className={cn('flex flex-col border-r border-gray-100 dark:border-white/[0.06] bg-white dark:bg-[#0d1526]',
        selected ? 'hidden md:flex md:w-80 lg:w-96' : 'flex flex-1 md:w-80 lg:w-96')}>

        {/* List header */}
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-gray-50 dark:border-white/[0.06]">
          <div className="flex items-center gap-2">
            <Link href="/doctor/dashboard" className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 text-gray-400 md:hidden">
              <ArrowLeft size={15} />
            </Link>
            <div>
              <h1 className="font-bold text-gray-800 dark:text-white text-sm">Messages</h1>
              {unread > 0 && <p className="text-[10px] text-blue-500 font-semibold">{unread} unread</p>}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={fetchNotifs} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 text-gray-400">
              <RefreshCw size={13} />
            </button>
            {unread > 0 && (
              <button onClick={markAllRead} disabled={marking}
                className="text-[10px] font-semibold text-blue-500 hover:underline px-2 py-1">
                Mark all read
              </button>
            )}
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 space-y-2">
              {[1,2,3,4].map(i => <div key={i} className="h-16 bg-gray-100 dark:bg-white/5 rounded-xl animate-pulse" />)}
            </div>
          ) : notifications.length === 0 ? (
            <div className="py-16 text-center text-gray-400">
              <MessageSquare size={32} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">No messages yet</p>
            </div>
          ) : (
            notifications.map((n) => {
              const isSelected = selected?.id === n.id
              const senderRole = n.type === 'SYSTEM' ? 'SYSTEM' : 'ADMIN'
              return (
                <button key={n.id} onClick={() => markOne(n)}
                  className={cn(
                    'w-full text-left px-4 py-3.5 border-b border-gray-50 dark:border-white/[0.04] transition-colors',
                    isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-gray-50 dark:hover:bg-white/[0.03]',
                    !n.isRead && 'bg-blue-50/50 dark:bg-blue-900/10',
                  )}>
                  <div className="flex items-start gap-3">
                    {/* Sender avatar */}
                    <div className={cn('w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5',
                      senderRole === 'SYSTEM' ? 'bg-gray-100 dark:bg-white/10 text-gray-500' : 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300')}>
                      {senderRole === 'SYSTEM' ? '⚙️' : '👤'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full', ROLE_COLORS[senderRole] || ROLE_COLORS.SYSTEM)}>
                          {n.title || senderRole}
                        </span>
                        <span className="text-[9px] text-gray-400 flex-shrink-0">{timeAgo(n.createdAt)}</span>
                      </div>
                      <p className={cn('text-xs truncate', n.isRead ? 'text-gray-500 dark:text-gray-400' : 'text-gray-800 dark:text-white font-semibold')}>
                        {n.body}
                      </p>
                    </div>
                    {!n.isRead && <div className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0 mt-1.5" />}
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* RIGHT: message thread / detail */}
      <div className={cn('flex-1 flex flex-col bg-gray-50 dark:bg-[#0A0F1E]', !selected && 'hidden md:flex')}>
        {selected ? (
          <>
            <div className="flex items-center gap-3 px-5 py-3.5 bg-white dark:bg-[#0d1526] border-b border-gray-100 dark:border-white/[0.06]">
              <button onClick={() => setSelected(null)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 text-gray-400 md:hidden">
                <ArrowLeft size={15} />
              </button>
              <div className="flex-1">
                <p className="font-bold text-gray-800 dark:text-white text-sm">{selected.title || 'Notification'}</p>
                <p className="text-[10px] text-gray-400">{timeAgo(selected.createdAt)}</p>
              </div>
              {selected.isRead
                ? <CheckCheck size={15} className="text-blue-400" />
                : <Check size={15} className="text-gray-400" />}
            </div>
            <div className="flex-1 overflow-y-auto p-6 flex items-start justify-center">
              <div className="bg-white dark:bg-[#0d1526] rounded-2xl border border-gray-100 dark:border-white/10 p-6 max-w-lg w-full shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                  <span className={cn('text-xs font-bold px-2.5 py-1 rounded-full', ROLE_COLORS[selected.type] || ROLE_COLORS.SYSTEM)}>
                    {selected.type}
                  </span>
                  <span className="text-xs text-gray-400">{new Date(selected.createdAt).toLocaleString('en-UG', { timeZone: 'Africa/Kampala' })}</span>
                </div>
                <h2 className="font-bold text-gray-800 dark:text-white mb-3">{selected.title}</h2>
                <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{selected.body}</p>
                {selected.href && (
                  <Link href={selected.href} className="inline-flex items-center gap-1.5 mt-4 text-sm font-semibold text-blue-600 hover:underline">
                    View details →
                  </Link>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-center text-gray-400 p-8">
            <div>
              <MessageSquare size={48} className="mx-auto mb-3 opacity-20" />
              <p className="text-base font-semibold">Select a message to read</p>
              <p className="text-sm mt-1">Choose from the list on the left</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
