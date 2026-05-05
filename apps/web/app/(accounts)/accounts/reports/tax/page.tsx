'use client'
import { useEffect, useState } from 'react'
import { RefreshCw, AlertCircle, Info } from 'lucide-react'

function QBConnect() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-14 h-14 rounded-2xl bg-[#2CA01C] flex items-center justify-center text-white font-black text-lg mb-4">QB</div>
      <h3 className="text-base font-bold text-gray-800 dark:text-white mb-2">Connect QuickBooks</h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-5 max-w-xs">Connect your QuickBooks account to view tax-related expenses.</p>
      <a href="/api-proxy/accounts/quickbooks/connect"
        className="px-5 py-2.5 rounded-xl text-sm font-bold text-white bg-[#2CA01C] hover:bg-[#228016] transition-colors">
        Connect QuickBooks
      </a>
    </div>
  )
}

const TAX_KEYWORDS = ['paye', 'vat', 'nssf', 'tax', 'withholding', 'income tax', 'payroll tax']

export default function TaxReportPage() {
  const [connected, setConnected] = useState<boolean | null>(null)
  const [expenses, setExpenses]   = useState<any[]>([])
  const [loading, setLoading]     = useState(true)

  const tok = () => typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null

  async function load() {
    setLoading(true)
    try {
      const st = await fetch('/api-proxy/accounts/quickbooks/status', { headers: { Authorization: `Bearer ${tok()}` } }).then(r => r.json())
      setConnected(st.connected)
      if (!st.connected) { setLoading(false); return }
      const res = await fetch('/api-proxy/accounts/quickbooks/expenses', { headers: { Authorization: `Bearer ${tok()}` } }).then(r => r.json())
      setExpenses(res.data || [])
    } catch {}
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const taxExpenses = expenses.filter(e => {
    const desc = ((e.PrivateNote || '') + (e.EntityRef?.name || '')).toLowerCase()
    return TAX_KEYWORDS.some(k => desc.includes(k))
  })

  const categories: Record<string, number> = {}
  taxExpenses.forEach(e => {
    const label = (e.PrivateNote || e.EntityRef?.name || 'Other').slice(0, 40)
    categories[label] = (categories[label] || 0) + Number(e.TotalAmt || 0)
  })

  const paye  = taxExpenses.filter(e => ((e.PrivateNote || '') + (e.EntityRef?.name || '')).toLowerCase().includes('paye')).reduce((s, e) => s + Number(e.TotalAmt || 0), 0)
  const vat   = taxExpenses.filter(e => ((e.PrivateNote || '') + (e.EntityRef?.name || '')).toLowerCase().includes('vat')).reduce((s, e) => s + Number(e.TotalAmt || 0), 0)
  const nssf  = taxExpenses.filter(e => ((e.PrivateNote || '') + (e.EntityRef?.name || '')).toLowerCase().includes('nssf')).reduce((s, e) => s + Number(e.TotalAmt || 0), 0)
  const other = taxExpenses.reduce((s, e) => s + Number(e.TotalAmt || 0), 0) - paye - vat - nssf

  if (connected === null || loading) return <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-14 bg-gray-100 dark:bg-white/10 rounded-xl animate-pulse" />)}</div>
  if (!connected) return <QBConnect />

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 px-4 py-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl text-xs text-amber-700 dark:text-amber-300">
        <Info size={14} className="flex-shrink-0" />
        Uganda-specific: PAYE and NSSF are statutory deductions. VAT is 18%. Consult a certified accountant for filing obligations under URA.
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'PAYE',  value: paye,  color: 'text-blue-600' },
          { label: 'VAT',   value: vat,   color: 'text-purple-600' },
          { label: 'NSSF',  value: nssf,  color: 'text-orange-600' },
          { label: 'Other', value: other, color: 'text-gray-600' },
        ].map(c => (
          <div key={c.label} className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 p-4 text-center">
            <p className="text-[10px] text-gray-400 uppercase font-semibold mb-1">{c.label}</p>
            <p className={`text-sm font-bold ${c.color}`}>UGX {c.value.toLocaleString()}</p>
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <button onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-200">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-50 dark:border-white/5">
          <p className="text-xs font-bold text-gray-800 dark:text-white">Tax-Related Expenses</p>
          <p className="text-[10px] text-gray-400 mt-0.5">Filtered by PAYE, VAT, NSSF, and tax keywords</p>
        </div>
        {taxExpenses.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-gray-400"><AlertCircle size={28} className="mb-2 opacity-40" /><p className="text-sm">No tax-related expenses found</p><p className="text-[10px] mt-1 max-w-xs text-center">Tag your QB expenses with PAYE, VAT, or NSSF in the description to see them here.</p></div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-white/5 text-[10px] font-semibold text-gray-400 uppercase">
                <th className="text-left px-4 py-2.5">Date</th>
                <th className="text-left px-3 py-2.5">Description</th>
                <th className="text-right px-4 py-2.5">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-white/5">
              {taxExpenses.map((e: any) => (
                <tr key={e.Id} className="hover:bg-blue-50/30 dark:hover:bg-white/5">
                  <td className="px-4 py-2.5 text-[11px] text-gray-500">{e.TxnDate || '—'}</td>
                  <td className="px-3 py-2.5 text-xs text-gray-800 dark:text-gray-200">{e.PrivateNote || e.EntityRef?.name || '—'}</td>
                  <td className="px-4 py-2.5 text-right text-xs font-bold text-red-500">{Number(e.TotalAmt || 0).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
