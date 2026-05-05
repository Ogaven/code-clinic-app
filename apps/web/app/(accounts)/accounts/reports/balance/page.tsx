'use client'
import { useEffect, useState } from 'react'
import { RefreshCw, AlertCircle } from 'lucide-react'

function QBConnect() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-14 h-14 rounded-2xl bg-[#2CA01C] flex items-center justify-center text-white font-black text-lg mb-4">QB</div>
      <h3 className="text-base font-bold text-gray-800 dark:text-white mb-2">Connect QuickBooks</h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-5 max-w-xs">Connect your QuickBooks account to view the Balance Sheet.</p>
      <a href="/api-proxy/accounts/quickbooks/connect"
        className="px-5 py-2.5 rounded-xl text-sm font-bold text-white bg-[#2CA01C] hover:bg-[#228016] transition-colors">
        Connect QuickBooks
      </a>
    </div>
  )
}

function ReportSection({ title, rows, color }: { title: string; rows: any[]; color: string }) {
  if (!rows?.length) return null
  return (
    <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-50 dark:border-white/5" style={{ background: color + '15' }}>
        <p className="text-xs font-bold" style={{ color }}>{title}</p>
      </div>
      <table className="w-full text-sm">
        <tbody className="divide-y divide-gray-50 dark:divide-white/5">
          {rows.map((row: any, i: number) => {
            const data     = row.ColData || []
            const isSummary = (data[0]?.value || '').toLowerCase().includes('total')
            return (
              <tr key={i} className={`hover:bg-blue-50/20 ${isSummary ? 'font-bold bg-gray-50/50 dark:bg-white/5' : ''}`}>
                <td className="px-4 py-2 text-xs text-gray-800 dark:text-gray-200 pl-6">{data[0]?.value || ''}</td>
                <td className="px-4 py-2 text-right text-xs font-semibold text-gray-700 dark:text-gray-300">{data[1]?.value || ''}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function BalanceSheetPage() {
  const [connected, setConnected] = useState<boolean | null>(null)
  const [report, setReport]       = useState<any>(null)
  const [loading, setLoading]     = useState(true)
  const [asOf, setAsOf]           = useState(new Date().toISOString().split('T')[0])

  const tok = () => typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null

  async function load() {
    setLoading(true)
    try {
      const st = await fetch('/api-proxy/accounts/quickbooks/status', { headers: { Authorization: `Bearer ${tok()}` } }).then(r => r.json())
      setConnected(st.connected)
      if (!st.connected) { setLoading(false); return }
      const res = await fetch(`/api-proxy/accounts/quickbooks/balance-sheet?as_of=${asOf}`, {
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
  // Partition rows by header keywords
  const assetRows     = rows.filter((r: any) => (r.Header?.ColData?.[0]?.value || r.ColData?.[0]?.value || '').toLowerCase().includes('asset'))
  const liabilityRows = rows.filter((r: any) => (r.Header?.ColData?.[0]?.value || r.ColData?.[0]?.value || '').toLowerCase().includes('liabilit'))
  const equityRows    = rows.filter((r: any) => (r.Header?.ColData?.[0]?.value || r.ColData?.[0]?.value || '').toLowerCase().includes('equity'))
  const allRows       = rows.flatMap((r: any) => r.Rows?.Row || [r])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-gray-500">As of:</label>
          <input type="date" value={asOf} onChange={e => setAsOf(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-xs dark:text-white focus:outline-none" />
          <button onClick={load} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-clinic-navy text-white">Apply</button>
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
        <>
          <ReportSection title="ASSETS"      rows={assetRows.flatMap((r: any) => r.Rows?.Row || [r])}      color="#2563EB" />
          <ReportSection title="LIABILITIES" rows={liabilityRows.flatMap((r: any) => r.Rows?.Row || [r])} color="#DC2626" />
          <ReportSection title="EQUITY"      rows={equityRows.flatMap((r: any) => r.Rows?.Row || [r])}     color="#059669" />
          {assetRows.length === 0 && liabilityRows.length === 0 && (
            <ReportSection title="BALANCE SHEET" rows={allRows} color="#6366F1" />
          )}
        </>
      )}
    </div>
  )
}
