'use client'
import { useEffect, useState } from 'react'
import { RefreshCw, AlertCircle } from 'lucide-react'

const TABS = ['All', 'Asset', 'Liability', 'Income', 'Expense', 'Equity'] as const
type Tab = typeof TABS[number]

// QB Classification uses "Revenue" for income accounts — map our label accordingly
const TAB_KEYWORDS: Record<Tab, string[]> = {
  All:       [],
  Asset:     ['asset'],
  Liability: ['liability'],
  Income:    ['income', 'revenue'],   // QB stores as "Revenue"
  Expense:   ['expense'],
  Equity:    ['equity'],
}

function QBConnect() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-14 h-14 rounded-2xl bg-[#2CA01C] flex items-center justify-center text-white font-black text-lg mb-4">QB</div>
      <h3 className="text-base font-bold text-gray-800 dark:text-white mb-2">Connect QuickBooks</h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-5 max-w-xs">Connect your QuickBooks account to view your Chart of Accounts.</p>
      <a href="/api-proxy/accounts/quickbooks/connect"
        className="px-5 py-2.5 rounded-xl text-sm font-bold text-white bg-[#2CA01C] hover:bg-[#228016] transition-colors">
        Connect QuickBooks
      </a>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="h-10 bg-gray-100 dark:bg-white/10 rounded-xl animate-pulse" />
      ))}
    </div>
  )
}

export default function ChartOfAccountsPage() {
  const [connected, setConnected] = useState<boolean | null>(null)
  const [accounts, setAccounts]   = useState<any[]>([])
  const [loading, setLoading]     = useState(true)
  const [tab, setTab]             = useState<Tab>('All')
  const [fetchError, setFetchError] = useState<string | null>(null)

  const tok = () => typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null

  async function load() {
    setLoading(true)
    setFetchError(null)
    try {
      const st = await fetch('/api-proxy/accounts/quickbooks/status', {
        headers: { Authorization: `Bearer ${tok()}` },
      }).then(r => r.json())
      setConnected(st.connected)
      if (!st.connected) { setLoading(false); return }

      const raw = await fetch('/api-proxy/accounts/quickbooks/chart-of-accounts', {
        headers: { Authorization: `Bearer ${tok()}` },
      })
      const res = await raw.json()
      console.log('[Chart of Accounts] raw response:', res)

      if (!raw.ok || res.error) {
        setFetchError(res.error || `HTTP ${raw.status}`)
      } else {
        setAccounts(res.data || [])
      }
    } catch (e: any) {
      console.error('[Chart of Accounts] fetch error:', e)
      setFetchError(e?.message || 'Failed to load accounts')
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const keywords = TAB_KEYWORDS[tab]
  const filtered = tab === 'All'
    ? accounts
    : accounts.filter(a => {
        const haystack = `${a.Classification || ''} ${a.AccountType || ''}`.toLowerCase()
        return keywords.some(kw => haystack.includes(kw))
      })

  if (connected === null || loading) return <Skeleton />
  if (!connected) return <QBConnect />

  if (fetchError) return (
    <div className="flex flex-col items-center justify-center py-20 text-center gap-4">
      <AlertCircle size={32} className="text-red-400" />
      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Failed to load accounts</p>
      <p className="text-xs text-gray-400 max-w-xs">{fetchError}</p>
      <button onClick={load}
        className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-clinic-navy text-white hover:bg-blue-900 transition-colors">
        <RefreshCw size={12} /> Retry
      </button>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-1 flex-wrap">
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${tab === t ? 'bg-clinic-navy text-white' : 'bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/20'}`}>
              {t}
            </button>
          ))}
        </div>
        <button onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-200">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-gray-400">
            <AlertCircle size={28} className="mb-2 opacity-40" />
            <p className="text-sm">No accounts found</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-white/5 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                <th className="text-left px-4 py-2.5">Name</th>
                <th className="text-left px-3 py-2.5 hidden md:table-cell">Type</th>
                <th className="text-left px-3 py-2.5 hidden lg:table-cell">SubType</th>
                <th className="text-right px-4 py-2.5">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-white/5">
              {filtered.map((a: any) => (
                <tr key={a.Id} className="hover:bg-blue-50/30 dark:hover:bg-white/5">
                  <td className="px-4 py-2.5 font-medium text-gray-800 dark:text-gray-200 text-xs">{a.Name}</td>
                  <td className="px-3 py-2.5 text-[11px] text-gray-500 dark:text-gray-400 hidden md:table-cell">{a.AccountType}</td>
                  <td className="px-3 py-2.5 text-[11px] text-gray-500 dark:text-gray-400 hidden lg:table-cell">{a.AccountSubType}</td>
                  <td className="px-4 py-2.5 text-right text-xs font-bold text-gray-800 dark:text-gray-200">
                    {a.CurrentBalance != null ? `UGX ${Number(a.CurrentBalance).toLocaleString()}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-[10px] text-gray-400 text-right">{filtered.length} account{filtered.length !== 1 ? 's' : ''}</p>
    </div>
  )
}
