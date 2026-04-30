'use client'

import { useEffect, useState } from 'react'
import { Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed, Loader2, Play } from 'lucide-react'
import { cn } from '@/lib/utils'

type CallLog = {
  id: string
  callSid: string
  channel: string
  direction: string
  status: string
  createdAt: string
  patient: { firstName: string; lastName: string; phone: string } | null
  recording: { r2Key: string | null; transcriptText: string | null; durationSec: number | null } | null
}

export default function CallLogsPage() {
  const API   = '/api-proxy'
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const authH = { Authorization: `Bearer ${token}` }

  const [logs, setLogs]       = useState<CallLog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchLogs() }, [])

  async function fetchLogs() {
    setLoading(true)
    try {
      const res = await fetch(`${API}/ai-suite/voice/calls`, { headers: authH })
      if (res.ok) setLogs(await res.json())
    } catch {} finally { setLoading(false) }
  }

  function fmtDuration(sec: number | null) {
    if (!sec) return '—'
    const m = Math.floor(sec / 60), s = sec % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  return (
    <div className="p-6 space-y-5 max-w-4xl">
      <div>
        <h1 className="text-xl font-black text-gray-800 dark:text-white">Call Logs</h1>
        <p className="text-sm text-gray-400 mt-0.5">AI-initiated and inbound call history</p>
      </div>

      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={24} className="animate-spin text-cyan-500" />
          </div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Phone size={36} className="text-gray-200 dark:text-white/10" />
            <p className="font-medium text-gray-400 dark:text-white/40">No calls yet</p>
            <p className="text-sm text-gray-300 dark:text-white/20">Calls will appear here once agents are active</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-white/5">
                  {['Patient', 'Phone', 'Direction', 'Duration', 'Date', 'Recording'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-black text-gray-400 dark:text-white/40 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                {logs.map(log => {
                  const dirIcon = log.direction === 'inbound'
                    ? <PhoneIncoming size={14} className="text-emerald-500" />
                    : log.status === 'no-answer'
                    ? <PhoneMissed size={14} className="text-red-400" />
                    : <PhoneOutgoing size={14} className="text-cyan-500" />
                  const name = log.patient
                    ? `${log.patient.firstName} ${log.patient.lastName}`
                    : 'Unknown'
                  const date = new Date(log.createdAt).toLocaleString('en-UG', {
                    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                    hour12: true, timeZone: 'Africa/Nairobi',
                  })
                  return (
                    <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                      <td className="px-4 py-3 font-medium text-gray-800 dark:text-white/90">{name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500 dark:text-white/50">
                        {log.patient?.phone || '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-1.5">
                          {dirIcon}
                          <span className="text-xs text-gray-600 dark:text-white/60 capitalize">{log.direction || 'outbound'}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500 dark:text-white/50">
                        {fmtDuration(log.recording?.durationSec ?? null)}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 dark:text-white/50">{date}</td>
                      <td className="px-4 py-3">
                        {log.recording?.r2Key ? (
                          <button className={cn(
                            'flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold transition-colors',
                            'bg-cyan-50 dark:bg-cyan-900/20 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-100',
                          )}>
                            <Play size={11} /> Play
                          </button>
                        ) : (
                          <span className="text-xs text-gray-300 dark:text-white/20">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
