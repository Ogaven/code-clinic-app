'use client'
import { useEffect, useState } from 'react'
import { RefreshCw, AlertCircle, ExternalLink } from 'lucide-react'

function QBConnect() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-14 h-14 rounded-2xl bg-[#2CA01C] flex items-center justify-center text-white font-black text-lg mb-4">QB</div>
      <h3 className="text-base font-bold text-gray-800 dark:text-white mb-2">Connect QuickBooks</h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-5 max-w-xs">Connect your QuickBooks account to view invoices and sales.</p>
      <a href="/api-proxy/accounts/quickbooks/connect"
        className="px-5 py-2.5 rounded-xl text-sm font-bold text-white bg-[#2CA01C] hover:bg-[#228016] transition-colors">
        Connect QuickBooks
      </a>
    </div>
  )
}

function statusBadge(status: string) {
  if (!status) return null
  const s = status.toUpperCase()
  const map: Record<string, { backgroundColor: string; color: string }> = {
    PAID:    { backgroundColor: '#D1FAE5', color: '#059669' },
    OPEN:    { backgroundColor: '#FEE2E2', color: '#DC2626' },
    PARTIAL: { backgroundColor: '#FEF3C7', color: '#D97706' },
    VOIDED:  { backgroundColor: '#F3F4F6', color: '#6B7280' },
  }
  const style = map[s] || { backgroundColor: '#F3F4F6', color: '#6B7280' }
  return (
    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={style}>
      {s.charAt(0) + s.slice(1).toLowerCase()}
    </span>
  )
}

export default function InvoicesPage() {
  const [connected, setConnected] = useState<boolean | null>(null)
  const [invoices, setInvoices]   = useState<any[]>([])
  const [loading, setLoading]     = useState(true)

  const tok = () => typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null

  async function load() {
    setLoading(true)
    try {
      const st = await fetch('/api-proxy/accounts/quickbooks/status', { headers: { Authorization: `Bearer ${tok()}` } }).then(r => r.json())
      setConnected(st.connected)
      if (!st.connected) { setLoading(false); return }
      const res = await fetch('/api-proxy/accounts/quickbooks/invoices', { headers: { Authorization: `Bearer ${tok()}` } }).then(r => r.json())
      setInvoices(res.data || [])
    } catch {}
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const totalInvoiced  = invoices.reduce((s, i) => s + Number(i.TotalAmt || 0), 0)
  const totalPaid      = invoices.filter(i => i.Balance === 0).reduce((s, i) => s + Number(i.TotalAmt || 0), 0)
  const outstanding    = totalInvoiced - totalPaid

  if (connected === null || loading) return <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-10 bg-gray-100 dark:bg-white/10 rounded-xl animate-pulse" />)}</div>
  if (!connected) return <QBConnect />

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total Invoiced', value: totalInvoiced, color: 'text-blue-600' },
          { label: 'Total Paid',     value: totalPaid,     color: 'text-emerald-600' },
          { label: 'Outstanding',    value: outstanding,   color: 'text-red-500' },
        ].map(c => (
          <div key={c.label} className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 p-4 text-center">
            <p className="text-[10px] text-gray-400 uppercase font-semibold mb-1">{c.label}</p>
            <p className={`text-sm font-bold ${c.color}`}>UGX {c.value.toLocaleString()}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3">
        <a href="https://app.qbo.intuit.com/app/invoice" target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#2CA01C] text-white hover:bg-[#228016] transition-colors">
          <ExternalLink size={12} /> Create Invoice in QuickBooks
        </a>
        <button onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-200">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 overflow-hidden">
        {invoices.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-gray-400"><AlertCircle size={28} className="mb-2 opacity-40" /><p className="text-sm">No invoices found</p></div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-white/5 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                <th className="text-left px-4 py-2.5">Invoice #</th>
                <th className="text-left px-3 py-2.5 hidden md:table-cell">Patient / Customer</th>
                <th className="text-left px-3 py-2.5 hidden sm:table-cell">Date</th>
                <th className="text-left px-3 py-2.5 hidden lg:table-cell">Due Date</th>
                <th className="text-right px-3 py-2.5">Amount</th>
                <th className="text-right px-4 py-2.5">Balance</th>
                <th className="text-left px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-white/5">
              {invoices.map((inv: any) => (
                <tr key={inv.Id} className="hover:bg-blue-50/30 dark:hover:bg-white/5">
                  <td className="px-4 py-2.5 font-mono text-xs font-semibold text-gray-800 dark:text-gray-200">{inv.DocNumber || inv.Id}</td>
                  <td className="px-3 py-2.5 text-[11px] text-gray-500 dark:text-gray-400 hidden md:table-cell">{inv.CustomerRef?.name || '—'}</td>
                  <td className="px-3 py-2.5 text-[11px] text-gray-500 hidden sm:table-cell">{inv.TxnDate || '—'}</td>
                  <td className="px-3 py-2.5 text-[11px] text-gray-500 hidden lg:table-cell">{inv.DueDate || '—'}</td>
                  <td className="px-3 py-2.5 text-right text-xs font-bold text-gray-800 dark:text-gray-200">{Number(inv.TotalAmt || 0).toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right text-xs font-bold text-red-500">{Number(inv.Balance || 0).toLocaleString()}</td>
                  <td className="px-4 py-2.5">{statusBadge(Number(inv.Balance) === 0 ? 'PAID' : 'OPEN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
