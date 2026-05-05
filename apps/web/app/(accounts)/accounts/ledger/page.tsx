'use client'
import { useEffect, useState } from 'react'
import { RefreshCw, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react'

function QBConnect() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-14 h-14 rounded-2xl bg-[#2CA01C] flex items-center justify-center text-white font-black text-lg mb-4">QB</div>
      <h3 className="text-base font-bold text-gray-800 dark:text-white mb-2">Connect QuickBooks</h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-5 max-w-xs">Connect your QuickBooks account to view the general ledger.</p>
      <a href="/api-proxy/accounts/quickbooks/connect"
        className="px-5 py-2.5 rounded-xl text-sm font-bold text-white bg-[#2CA01C] hover:bg-[#228016] transition-colors">
        Connect QuickBooks
      </a>
    </div>
  )
}

export default function GeneralLedgerPage() {
  const [connected, setConnected]   = useState<boolean | null>(null)
  const [accounts, setAccounts]     = useState<any[]>([])
  const [entries, setEntries]       = useState<any[]>([])
  const [loading, setLoading]       = useState(true)
  const [expanded, setExpanded]     = useState<Set<string>>(new Set())

  const tok = () => typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null

  async function load() {
    setLoading(true)
    try {
      const st = await fetch('/api-proxy/accounts/quickbooks/status', { headers: { Authorization: `Bearer ${tok()}` } }).then(r => r.json())
      setConnected(st.connected)
      if (!st.connected) { setLoading(false); return }
      const [accRes, jeRes] = await Promise.all([
        fetch('/api-proxy/accounts/quickbooks/chart-of-accounts', { headers: { Authorization: `Bearer ${tok()}` } }).then(r => r.json()),
        fetch('/api-proxy/accounts/quickbooks/journal-entries',   { headers: { Authorization: `Bearer ${tok()}` } }).then(r => r.json()),
      ])
      setAccounts(accRes.data || [])
      setEntries(jeRes.data || [])
    } catch {}
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function toggle(id: string) {
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  // Group JE lines by account name
  const ledger: Record<string, { date: string; ref: string; desc: string; debit: number; credit: number }[]> = {}
  entries.forEach((je: any) => {
    (je.Line || []).forEach((l: any) => {
      const d = l.JournalEntryLineDetail
      if (!d) return
      const acct = d.AccountRef?.name || 'Unknown'
      if (!ledger[acct]) ledger[acct] = []
      ledger[acct].push({
        date:   je.TxnDate || '',
        ref:    je.DocNumber || je.Id,
        desc:   l.Description || '',
        debit:  d.PostingType === 'Debit'  ? Number(l.Amount || 0) : 0,
        credit: d.PostingType === 'Credit' ? Number(l.Amount || 0) : 0,
      })
    })
  })

  if (connected === null || loading) return <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-10 bg-gray-100 dark:bg-white/10 rounded-xl animate-pulse" />)}</div>
  if (!connected) return <QBConnect />

  const accountNames = Object.keys(ledger).sort()

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">{accountNames.length} accounts with transactions</p>
        <button onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-200">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {accountNames.length === 0 ? (
        <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 flex flex-col items-center py-16 text-gray-400">
          <AlertCircle size={28} className="mb-2 opacity-40" /><p className="text-sm">No ledger entries found</p>
        </div>
      ) : (
        accountNames.map(name => {
          const lines = ledger[name]
          const open  = expanded.has(name)
          const totalDebit  = lines.reduce((s, l) => s + l.debit, 0)
          const totalCredit = lines.reduce((s, l) => s + l.credit, 0)
          return (
            <div key={name} className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 overflow-hidden">
              <button onClick={() => toggle(name)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors text-left">
                {open ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
                <span className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex-1">{name}</span>
                <span className="text-[11px] text-emerald-600 font-semibold hidden sm:block">Dr {totalDebit.toLocaleString()}</span>
                <span className="text-[11px] text-red-500 font-semibold ml-4 hidden sm:block">Cr {totalCredit.toLocaleString()}</span>
                <span className="text-[10px] text-gray-400 ml-4">{lines.length} txn{lines.length !== 1 ? 's' : ''}</span>
              </button>
              {open && (
                <div className="border-t border-gray-50 dark:border-white/5">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 dark:bg-white/5 text-[10px] font-semibold text-gray-400 uppercase">
                        <th className="text-left px-6 py-2">Date</th>
                        <th className="text-left px-4 py-2">Reference</th>
                        <th className="text-left px-4 py-2 hidden md:table-cell">Description</th>
                        <th className="text-right px-4 py-2">Debit</th>
                        <th className="text-right px-4 py-2">Credit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                      {lines.map((l, idx) => (
                        <tr key={idx} className="hover:bg-blue-50/20">
                          <td className="px-6 py-2 text-gray-500">{l.date}</td>
                          <td className="px-4 py-2 font-mono text-gray-700 dark:text-gray-300">{l.ref}</td>
                          <td className="px-4 py-2 text-gray-500 hidden md:table-cell">{l.desc || '—'}</td>
                          <td className="px-4 py-2 text-right text-emerald-600 font-semibold">{l.debit ? l.debit.toLocaleString() : '—'}</td>
                          <td className="px-4 py-2 text-right text-red-500 font-semibold">{l.credit ? l.credit.toLocaleString() : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}
