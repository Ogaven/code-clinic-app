'use client'
import { useEffect, useState } from 'react'
import { RefreshCw, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react'

function QBConnect() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-14 h-14 rounded-2xl bg-[#2CA01C] flex items-center justify-center text-white font-black text-lg mb-4">QB</div>
      <h3 className="text-base font-bold text-gray-800 dark:text-white mb-2">Connect QuickBooks</h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-5 max-w-xs">Connect your QuickBooks account to view journal entries.</p>
      <a href="/api-proxy/accounts/quickbooks/connect"
        className="px-5 py-2.5 rounded-xl text-sm font-bold text-white bg-[#2CA01C] hover:bg-[#228016] transition-colors">
        Connect QuickBooks
      </a>
    </div>
  )
}

export default function JournalEntriesPage() {
  const [connected, setConnected] = useState<boolean | null>(null)
  const [entries, setEntries]     = useState<any[]>([])
  const [loading, setLoading]     = useState(true)
  const [expanded, setExpanded]   = useState<Set<string>>(new Set())

  const tok = () => typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null

  async function load() {
    setLoading(true)
    try {
      const st = await fetch('/api-proxy/accounts/quickbooks/status', { headers: { Authorization: `Bearer ${tok()}` } }).then(r => r.json())
      setConnected(st.connected)
      if (!st.connected) { setLoading(false); return }
      const res = await fetch('/api-proxy/accounts/quickbooks/journal-entries', { headers: { Authorization: `Bearer ${tok()}` } }).then(r => r.json())
      setEntries(res.data || [])
    } catch {}
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function toggle(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  if (connected === null || loading) return <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-10 bg-gray-100 dark:bg-white/10 rounded-xl animate-pulse" />)}</div>
  if (!connected) return <QBConnect />

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-200">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 flex flex-col items-center py-16 text-gray-400">
          <AlertCircle size={28} className="mb-2 opacity-40" /><p className="text-sm">No journal entries found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((je: any) => {
            const open = expanded.has(je.Id)
            const lines: any[] = je.Line || []
            return (
              <div key={je.Id} className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 overflow-hidden">
                <button onClick={() => toggle(je.Id)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors text-left">
                  {open ? <ChevronDown size={14} className="text-gray-400 flex-shrink-0" /> : <ChevronRight size={14} className="text-gray-400 flex-shrink-0" />}
                  <span className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex-1">{je.DocNumber || `JE-${je.Id}`}</span>
                  <span className="text-[11px] text-gray-500">{je.TxnDate}</span>
                  <span className="text-[11px] text-gray-500 hidden md:block ml-4 max-w-[200px] truncate">{je.PrivateNote || '—'}</span>
                </button>
                {open && lines.length > 0 && (
                  <div className="border-t border-gray-50 dark:border-white/5">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-gray-50 dark:bg-white/5 text-[10px] font-semibold text-gray-400 uppercase">
                          <th className="text-left px-6 py-2">Account</th>
                          <th className="text-right px-4 py-2">Debit</th>
                          <th className="text-right px-4 py-2">Credit</th>
                          <th className="text-left px-4 py-2 hidden md:table-cell">Description</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                        {lines.filter((l: any) => l.JournalEntryLineDetail).map((l: any, idx: number) => {
                          const d = l.JournalEntryLineDetail
                          const isDebit = d.PostingType === 'Debit'
                          return (
                            <tr key={idx} className="hover:bg-blue-50/20">
                              <td className="px-6 py-2 text-gray-700 dark:text-gray-300">{d.AccountRef?.name || '—'}</td>
                              <td className="px-4 py-2 text-right text-emerald-600 font-semibold">{isDebit ? Number(l.Amount || 0).toLocaleString() : '—'}</td>
                              <td className="px-4 py-2 text-right text-red-500 font-semibold">{!isDebit ? Number(l.Amount || 0).toLocaleString() : '—'}</td>
                              <td className="px-4 py-2 text-gray-500 hidden md:table-cell">{l.Description || '—'}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
