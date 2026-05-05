'use client'
import { useEffect, useState } from 'react'
import { RefreshCw, AlertCircle } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'

function QBConnect() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-14 h-14 rounded-2xl bg-[#2CA01C] flex items-center justify-center text-white font-black text-lg mb-4">QB</div>
      <h3 className="text-base font-bold text-gray-800 dark:text-white mb-2">Connect QuickBooks</h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-5 max-w-xs">Connect your QuickBooks account to view your Profit & Loss report.</p>
      <a href="/api-proxy/accounts/quickbooks/connect"
        className="px-5 py-2.5 rounded-xl text-sm font-bold text-white bg-[#2CA01C] hover:bg-[#228016] transition-colors">
        Connect QuickBooks
      </a>
    </div>
  )
}

const PERIODS = ['This Month', 'This Quarter', 'This Year', 'Custom'] as const
type Period = typeof PERIODS[number]

function periodDates(p: Period): { start: string; end: string } {
  const now   = new Date()
  const year  = now.getFullYear()
  const month = now.getMonth()
  const fmt   = (d: Date) => d.toISOString().split('T')[0]
  if (p === 'This Month')   return { start: fmt(new Date(year, month, 1)),    end: fmt(now) }
  if (p === 'This Quarter') { const q = Math.floor(month / 3); return { start: fmt(new Date(year, q * 3, 1)), end: fmt(now) } }
  if (p === 'This Year')    return { start: fmt(new Date(year, 0, 1)),          end: fmt(now) }
  return { start: fmt(new Date(year, 0, 1)), end: fmt(now) }
}

// Parse QB P&L report rows into chart data
function parseRows(rows: any[], colCount: number): { month: string; revenue: number; expenses: number }[] {
  const result: { month: string; revenue: number; expenses: number }[] = []
  for (let col = 0; col < colCount; col++) {
    let revenue = 0, expenses = 0
    rows?.forEach((row: any) => {
      if (!row?.ColData) return
      const label = (row.ColData[0]?.value || '').toLowerCase()
      const val   = parseFloat(row.ColData[col + 1]?.value || '0') || 0
      if (label.includes('income') || label.includes('revenue')) revenue += val
      if (label.includes('expense') || label.includes('cost'))   expenses += val
    })
    result.push({ month: `Col${col + 1}`, revenue, expenses })
  }
  return result
}

export default function ProfitLossPage() {
  const [connected, setConnected] = useState<boolean | null>(null)
  const [report, setReport]       = useState<any>(null)
  const [loading, setLoading]     = useState(true)
  const [period, setPeriod]       = useState<Period>('This Year')
  const [customStart, setCustomStart] = useState('')
  const [customEnd,   setCustomEnd]   = useState('')

  const tok = () => typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null

  async function load() {
    setLoading(true)
    try {
      const st = await fetch('/api-proxy/accounts/quickbooks/status', { headers: { Authorization: `Bearer ${tok()}` } }).then(r => r.json())
      setConnected(st.connected)
      if (!st.connected) { setLoading(false); return }
      const { start, end } = period === 'Custom'
        ? { start: customStart, end: customEnd }
        : periodDates(period)
      const res = await fetch(`/api-proxy/accounts/quickbooks/profit-loss?start_date=${start}&end_date=${end}`, {
        headers: { Authorization: `Bearer ${tok()}` }
      }).then(r => r.json())
      setReport(res.data || null)
    } catch {}
    setLoading(false)
  }

  useEffect(() => { load() }, [period])

  if (connected === null || loading) return <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 bg-gray-100 dark:bg-white/10 rounded-xl animate-pulse" />)}</div>
  if (!connected) return <QBConnect />

  const columns: any[]  = report?.Columns?.Column || []
  const rows: any[]     = report?.Rows?.Row || []
  const colCount        = Math.max(0, columns.length - 1)
  const chartData       = parseRows(rows, colCount)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1">
          {PERIODS.map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${period === p ? 'bg-clinic-navy text-white' : 'bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-200'}`}>
              {p}
            </button>
          ))}
        </div>
        {period === 'Custom' && (
          <div className="flex items-center gap-2">
            <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
              className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-xs dark:text-white" />
            <span className="text-xs text-gray-400">to</span>
            <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
              className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-xs dark:text-white" />
            <button onClick={load} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-clinic-navy text-white">Apply</button>
          </div>
        )}
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
          {chartData.length > 0 && (
            <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 p-4">
              <p className="text-xs font-bold text-gray-800 dark:text-white mb-4">Revenue vs Expenses</p>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} barSize={12}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 9, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <Tooltip formatter={(v: number) => `UGX ${v.toLocaleString()}`} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 9 }} />
                  <Bar dataKey="revenue"  fill="#29ABE2" radius={[4,4,0,0]} name="Revenue" />
                  <Bar dataKey="expenses" fill="#EF4444" radius={[4,4,0,0]} name="Expenses" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-white/5 text-[10px] font-semibold text-gray-400 uppercase">
                  <th className="text-left px-4 py-2.5">Line Item</th>
                  {columns.slice(1).map((c: any, i: number) => (
                    <th key={i} className="text-right px-3 py-2.5">{c.ColTitle || c.ColType}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                {rows.map((row: any, i: number) => {
                  const data = row.ColData || []
                  const isSummary = row.type === 'Section' || (data[0]?.value || '').toLowerCase().includes('total')
                  return (
                    <tr key={i} className={`hover:bg-blue-50/20 ${isSummary ? 'font-bold bg-gray-50/50 dark:bg-white/5' : ''}`}>
                      {data.map((cell: any, j: number) => (
                        <td key={j} className={`px-${j === 0 ? 4 : 3} py-2 text-xs ${j === 0 ? 'text-gray-800 dark:text-gray-200' : 'text-right text-gray-600 dark:text-gray-400'}`}>
                          {cell.value}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
