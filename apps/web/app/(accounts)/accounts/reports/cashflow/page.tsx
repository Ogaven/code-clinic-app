'use client'
import { useEffect, useState } from 'react'
import { RefreshCw, AlertCircle } from 'lucide-react'

function QBConnect() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-14 h-14 rounded-2xl bg-[#2CA01C] flex items-center justify-center text-white font-black text-lg mb-4">QB</div>
      <h3 className="text-base font-bold text-gray-800 dark:text-white mb-2">Connect QuickBooks</h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-5 max-w-xs">Connect your QuickBooks account to view the Cash Flow Statement.</p>
      <a href="/api-proxy/accounts/quickbooks/connect"
        className="px-5 py-2.5 rounded-xl text-sm font-bold text-white bg-[#2CA01C] hover:bg-[#228016] transition-colors">
        Connect QuickBooks
      </a>
    </div>
  )
}

export default function CashFlowPage() {
  const [connected, setConnected] = useState<boolean | null>(null)
  const [report, setReport]       = useState<any>(null)
  const [loading, setLoading]     = useState(true)
  const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0]
  const today     = new Date().toISOString().split('T')[0]
  const [startDate, setStartDate] = useState(yearStart)
  const [endDate,   setEndDate]   = useState(today)

  const tok = () => typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null

  async function load() {
    setLoading(true)
    try {
      const st = await fetch('/api-proxy/accounts/quickbooks/status', { headers: { Authorization: `Bearer ${tok()}` } }).then(r => r.json())
      setConnected(st.connected)
      if (!st.connected) { setLoading(false); return }
      const res = await fetch(`/api-proxy/accounts/quickbooks/cash-flow?start_date=${startDate}&end_date=${endDate}`, {
        headers: { Authorization: `Bearer ${tok()}` }
      }).then(r => r.json())
      setReport(res.data || null)
    } catch {}
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  if (connected === null || loading) return <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-32 bg-gray-100 dark:bg-white/10 rounded-2xl animate-pulse" />)}</div>
  if (!connected) return <QBConnect />

  const rows: any[] = report?.Rows?.Row || []

  const sections = [
    { keyword: 'operating',   title: 'Operating Activities',   color: '#2563EB' },
    { keyword: 'investing',   title: 'Investing Activities',   color: '#D97706' },
    { keyword: 'financing',   title: 'Financing Activities',   color: '#7C3AED' },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-xs">
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 dark:text-white" />
          <span className="text-gray-400">to</span>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 dark:text-white" />
          <button onClick={load} className="px-3 py-1.5 rounded-lg font-semibold bg-clinic-navy text-white">Apply</button>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-200 ml-auto">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {!report ? (
        <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 flex flex-col items-center py-16 text-gray-400">
          <AlertCircle size={28} className="mb-2 opacity-40" /><p className="text-sm">No report data</p>
        </div>
      ) : (
        sections.map(sec => {
          const secRows = rows.filter((r: any) =>
            (r.Header?.ColData?.[0]?.value || r.ColData?.[0]?.value || '').toLowerCase().includes(sec.keyword)
          )
          const lineItems = secRows.flatMap((r: any) => r.Rows?.Row || [r])
          if (!lineItems.length) return null
          return (
            <div key={sec.keyword} className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-50 dark:border-white/5" style={{ background: sec.color + '15' }}>
                <p className="text-xs font-bold" style={{ color: sec.color }}>{sec.title}</p>
              </div>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                  {lineItems.map((row: any, i: number) => {
                    const data     = row.ColData || []
                    const isSummary = (data[0]?.value || '').toLowerCase().includes('total') || (data[0]?.value || '').toLowerCase().includes('net')
                    const val       = parseFloat(data[1]?.value || '0') || 0
                    return (
                      <tr key={i} className={`hover:bg-blue-50/20 ${isSummary ? 'font-bold bg-gray-50/50 dark:bg-white/5' : ''}`}>
                        <td className="px-4 py-2 text-xs text-gray-800 dark:text-gray-200 pl-6">{data[0]?.value}</td>
                        <td className={`px-4 py-2 text-right text-xs font-semibold ${val >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{data[1]?.value}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        })
      )}
    </div>
  )
}
