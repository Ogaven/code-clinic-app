'use client'
import { useEffect, useState } from 'react'
import { RefreshCw, AlertCircle } from 'lucide-react'

// ─── Expenses from QuickBooks (Purchase records) ──────────────────────────────
function QBExpensesTable({ expenses, loading, onRefresh }: {
  expenses: any[]
  loading:  boolean
  onRefresh: () => void
}) {
  const now        = new Date()
  const thisMonth  = expenses.filter(e => {
    const d = new Date(e.TxnDate || '')
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
  })
  const totalMonth = thisMonth.reduce((s, e) => s + Number(e.TotalAmt || 0), 0)
  const totalYear  = expenses.filter(e =>
    new Date(e.TxnDate || '').getFullYear() === now.getFullYear()
  ).reduce((s, e) => s + Number(e.TotalAmt || 0), 0)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'Total This Month', value: totalMonth },
          { label: 'Total This Year',  value: totalYear  },
        ].map(c => (
          <div key={c.label} className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 p-4 text-center">
            <p className="text-[10px] text-gray-400 uppercase font-semibold mb-1">{c.label}</p>
            <p className="text-sm font-bold text-red-500">UGX {c.value.toLocaleString()}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-gray-400 font-medium flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[#2CA01C] inline-block" />
          Synced from QuickBooks
        </p>
        <button onClick={onRefresh}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-200">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 overflow-hidden">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 bg-gray-100 dark:bg-white/10 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : expenses.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-gray-400">
            <AlertCircle size={28} className="mb-2 opacity-40" />
            <p className="text-sm">No expenses found in QuickBooks</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-white/5 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                <th className="text-left px-4 py-2.5">Date</th>
                <th className="text-left px-3 py-2.5">Description / Note</th>
                <th className="text-left px-3 py-2.5 hidden md:table-cell">Account</th>
                <th className="text-left px-3 py-2.5 hidden lg:table-cell">Payment</th>
                <th className="text-right px-4 py-2.5">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-white/5">
              {expenses.map((e: any, idx: number) => (
                <tr key={e.Id ?? idx} className="hover:bg-blue-50/30 dark:hover:bg-white/5">
                  <td className="px-4 py-2.5 text-[11px] text-gray-500 dark:text-gray-400">{e.TxnDate || '—'}</td>
                  <td className="px-3 py-2.5 text-xs text-gray-800 dark:text-gray-200 max-w-[200px] truncate">
                    {e.PrivateNote || e.Line?.[0]?.Description || e.EntityRef?.name || '—'}
                  </td>
                  <td className="px-3 py-2.5 text-[11px] text-gray-500 dark:text-gray-400 hidden md:table-cell">
                    {e.AccountRef?.name || '—'}
                  </td>
                  <td className="px-3 py-2.5 text-[11px] text-gray-500 hidden lg:table-cell">
                    {e.PaymentType || '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs font-bold text-red-500">
                    UGX {Number(e.TotalAmt || 0).toLocaleString()}
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

// ─── Local expenses from Code Clinic DB ──────────────────────────────────────
function LocalExpensesTable({ expenses, loading, onRefresh }: {
  expenses: any[]
  loading:  boolean
  onRefresh: () => void
}) {
  const now        = new Date()
  const thisMonth  = expenses.filter(e => {
    const d = new Date(e.date || '')
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
  })
  const totalMonth = thisMonth.reduce((s, e) => s + Number(e.amountUGX || 0), 0)
  const totalYear  = expenses.filter(e =>
    new Date(e.date || '').getFullYear() === now.getFullYear()
  ).reduce((s, e) => s + Number(e.amountUGX || 0), 0)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'Total This Month', value: totalMonth },
          { label: 'Total This Year',  value: totalYear  },
        ].map(c => (
          <div key={c.label} className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 p-4 text-center">
            <p className="text-[10px] text-gray-400 uppercase font-semibold mb-1">{c.label}</p>
            <p className="text-sm font-bold text-red-500">UGX {c.value.toLocaleString()}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-gray-400 font-medium">Local records — connect QuickBooks to sync</p>
        <button onClick={onRefresh}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-200">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 overflow-hidden">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 bg-gray-100 dark:bg-white/10 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : expenses.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-gray-400">
            <AlertCircle size={28} className="mb-2 opacity-40" />
            <p className="text-sm">No expenses recorded yet</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-white/5 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                <th className="text-left px-4 py-2.5">Date</th>
                <th className="text-left px-3 py-2.5">Category</th>
                <th className="text-left px-3 py-2.5">Description</th>
                <th className="text-left px-3 py-2.5 hidden md:table-cell">Recorded By</th>
                <th className="text-right px-4 py-2.5">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-white/5">
              {expenses.map((e: any) => (
                <tr key={e.id} className="hover:bg-blue-50/30 dark:hover:bg-white/5">
                  <td className="px-4 py-2.5 text-[11px] text-gray-500 dark:text-gray-400">
                    {new Date(e.date).toLocaleDateString('en-UG', { day: 'numeric', month: 'short', timeZone: 'Africa/Nairobi' })}
                  </td>
                  <td className="px-3 py-2.5 text-[11px] text-gray-600 dark:text-gray-300 font-medium">{e.category}</td>
                  <td className="px-3 py-2.5 text-xs text-gray-800 dark:text-gray-200 max-w-[200px] truncate">{e.description || '—'}</td>
                  <td className="px-3 py-2.5 text-[11px] text-gray-500 hidden md:table-cell">
                    {e.recordedBy ? `${e.recordedBy.firstName} ${e.recordedBy.lastName}` : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs font-bold text-red-500">
                    UGX {Number(e.amountUGX || 0).toLocaleString()}
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

// ─── Main page ────────────────────────────────────────────────────────────────
export default function ExpensesPage() {
  const [connected, setConnected]   = useState<boolean | null>(null)
  const [qbExpenses, setQbExpenses] = useState<any[]>([])
  const [localExpenses, setLocalExpenses] = useState<any[]>([])
  const [loading, setLoading]       = useState(true)

  const tok = () => typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null

  async function load() {
    setLoading(true)
    try {
      // Check QB connection status
      const st = await fetch('/api-proxy/accounts/quickbooks/status', {
        headers: { Authorization: `Bearer ${tok()}` },
      }).then(r => r.json())
      setConnected(st.connected)

      if (st.connected) {
        // Fetch QB expenses
        const res = await fetch('/api-proxy/accounts/quickbooks/expenses', {
          headers: { Authorization: `Bearer ${tok()}` },
        })
        const data = await res.json()
        console.log('[QB Expenses] raw response:', data)
        setQbExpenses(data.data || [])
      } else {
        // Fall back to local Code Clinic expenses
        const res = await fetch('/api-proxy/accounts/expenses', {
          headers: { Authorization: `Bearer ${tok()}` },
        })
        const data = await res.json()
        setLocalExpenses(Array.isArray(data) ? data : [])
      }
    } catch (e) {
      console.error('[Expenses] fetch error:', e)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  if (connected === null || loading) return (
    <div className="space-y-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-10 bg-gray-100 dark:bg-white/10 rounded-xl animate-pulse" />
      ))}
    </div>
  )

  if (connected) {
    return <QBExpensesTable expenses={qbExpenses} loading={loading} onRefresh={load} />
  }

  return <LocalExpensesTable expenses={localExpenses} loading={loading} onRefresh={load} />
}
