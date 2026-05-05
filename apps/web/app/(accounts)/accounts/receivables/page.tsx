'use client'
import { useEffect, useState } from 'react'
import { RefreshCw, AlertCircle } from 'lucide-react'

function QBConnect() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-14 h-14 rounded-2xl bg-[#2CA01C] flex items-center justify-center text-white font-black text-lg mb-4">QB</div>
      <h3 className="text-base font-bold text-gray-800 dark:text-white mb-2">Connect QuickBooks</h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-5 max-w-xs">Connect your QuickBooks account to view patient balances.</p>
      <a href="/api-proxy/accounts/quickbooks/connect"
        className="px-5 py-2.5 rounded-xl text-sm font-bold text-white bg-[#2CA01C] hover:bg-[#228016] transition-colors">
        Connect QuickBooks
      </a>
    </div>
  )
}

export default function PatientBalancesPage() {
  const [connected, setConnected]   = useState<boolean | null>(null)
  const [customers, setCustomers]   = useState<any[]>([])
  const [loading, setLoading]       = useState(true)
  const [search, setSearch]         = useState('')

  const tok = () => typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null

  async function load() {
    setLoading(true)
    try {
      const st = await fetch('/api-proxy/accounts/quickbooks/status', { headers: { Authorization: `Bearer ${tok()}` } }).then(r => r.json())
      setConnected(st.connected)
      if (!st.connected) { setLoading(false); return }
      const res = await fetch('/api-proxy/accounts/quickbooks/customers', { headers: { Authorization: `Bearer ${tok()}` } }).then(r => r.json())
      setCustomers(res.data || [])
    } catch {}
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const filtered = customers.filter(c =>
    !search || (c.DisplayName || '').toLowerCase().includes(search.toLowerCase())
  )
  const totalBalance = customers.reduce((s, c) => s + Number(c.Balance || 0), 0)

  if (connected === null || loading) return <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-10 bg-gray-100 dark:bg-white/10 rounded-xl animate-pulse" />)}</div>
  if (!connected) return <QBConnect />

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 p-4 text-center inline-block">
        <p className="text-[10px] text-gray-400 uppercase font-semibold mb-1">Total Outstanding</p>
        <p className="text-sm font-bold text-red-500">UGX {totalBalance.toLocaleString()}</p>
      </div>

      <div className="flex items-center gap-3">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search patient..."
          className="flex-1 max-w-xs px-3 py-2 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-xs dark:text-white focus:outline-none focus:border-clinic-blue" />
        <button onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-200">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-gray-400"><AlertCircle size={28} className="mb-2 opacity-40" /><p className="text-sm">No customers found</p></div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-white/5 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                <th className="text-left px-4 py-2.5">Name</th>
                <th className="text-left px-3 py-2.5 hidden md:table-cell">Email</th>
                <th className="text-left px-3 py-2.5 hidden lg:table-cell">Phone</th>
                <th className="text-right px-4 py-2.5">Balance</th>
                <th className="text-left px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-white/5">
              {filtered.map((c: any) => (
                <tr key={c.Id} className="hover:bg-blue-50/30 dark:hover:bg-white/5">
                  <td className="px-4 py-2.5 text-xs font-medium text-gray-800 dark:text-gray-200">{c.DisplayName}</td>
                  <td className="px-3 py-2.5 text-[11px] text-gray-500 hidden md:table-cell">{c.PrimaryEmailAddr?.Address || '—'}</td>
                  <td className="px-3 py-2.5 text-[11px] text-gray-500 hidden lg:table-cell">{c.PrimaryPhone?.FreeFormNumber || '—'}</td>
                  <td className="px-4 py-2.5 text-right text-xs font-bold text-red-500">{Number(c.Balance || 0).toLocaleString()}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${c.Active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                      {c.Active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
