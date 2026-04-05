'use client'

import { useEffect, useState } from 'react'
import { Plus, Trash2, Receipt } from 'lucide-react'
import { cn, formatUGX } from '@/lib/utils'

interface Expense {
  id: string
  category: string
  amountUGX: number
  description?: string
  date: string
  recorder?: { firstName: string; lastName: string }
}

const CATEGORIES = [
  'RENT', 'UTILITIES', 'SALARIES', 'SUPPLIES', 'EQUIPMENT',
  'MARKETING', 'INSURANCE', 'MAINTENANCE', 'TRANSPORT', 'OTHER',
]

const CATEGORY_COLOURS: Record<string, string> = {
  RENT: '#3B82F6', UTILITIES: '#F59E0B', SALARIES: '#8B5CF6',
  SUPPLIES: '#10B981', EQUIPMENT: '#29ABE2', MARKETING: '#EF4444',
  INSURANCE: '#1A237E', MAINTENANCE: '#6B7280', TRANSPORT: '#F97316', OTHER: '#9CA3AF',
}

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [filterCategory, setFilterCategory] = useState('')
  const [monthFilter, setMonthFilter] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null

  function fetchExpenses(cat = filterCategory, month = monthFilter) {
    setLoading(true)
    const params = new URLSearchParams()
    if (cat) params.set('category', cat)
    if (month) {
      params.set('from', `${month}-01`)
      const end = new Date(`${month}-01`)
      end.setMonth(end.getMonth() + 1)
      params.set('to', end.toISOString().split('T')[0])
    }
    fetch(`/api-proxy/accounts/expenses?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json()).then(d => setExpenses(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => setLoading(false))
  }

  useEffect(() => { fetchExpenses() }, [])

  const total = expenses.reduce((s, e) => s + e.amountUGX, 0)

  // Category breakdown
  const byCategory = CATEGORIES.map(cat => ({
    cat,
    total: expenses.filter(e => e.category === cat).reduce((s, e) => s + e.amountUGX, 0),
  })).filter(c => c.total > 0).sort((a, b) => b.total - a.total)

  async function deleteExpense(id: string) {
    await fetch(`/api-proxy/accounts/expenses/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    setExpenses(es => es.filter(e => e.id !== id))
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-clinic-navy">Expenses</h2>
          <p className="text-sm text-gray-400 mt-0.5">Total this month: {formatUGX(total)}</p>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-clinic-blue text-white text-sm font-semibold rounded-lg hover:opacity-90">
          <Plus size={16} /> Record Expense
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex items-center gap-3 flex-wrap">
        <input type="month" value={monthFilter} onChange={e => { setMonthFilter(e.target.value); fetchExpenses(filterCategory, e.target.value) }}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-clinic-blue" />
        <select value={filterCategory} onChange={e => { setFilterCategory(e.target.value); fetchExpenses(e.target.value, monthFilter) }}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-clinic-blue">
          <option value="">All Categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Category breakdown */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h3 className="font-semibold text-clinic-navy mb-4 text-sm">By Category</h3>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-8 bg-gray-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : byCategory.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">No expenses recorded</p>
          ) : (
            <div className="space-y-3">
              {byCategory.map(({ cat, total: catTotal }) => (
                <div key={cat}>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs font-medium text-gray-600">{cat}</span>
                    <span className="text-xs font-bold text-gray-800">{formatUGX(catTotal)}</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.round((catTotal / total) * 100)}%`,
                        backgroundColor: CATEGORY_COLOURS[cat] || '#9CA3AF',
                      }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Expenses table */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  {['Date', 'Category', 'Description', 'Amount', ''].map(h => (
                    <th key={h} className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-3.5">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>{Array.from({ length: 5 }).map((_, j) => (
                      <td key={j} className="px-5 py-4"><div className="h-4 bg-gray-100 rounded animate-pulse w-20" /></td>
                    ))}</tr>
                  ))
                ) : expenses.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-10 text-center text-gray-400">
                      <Receipt size={32} className="mx-auto mb-2 opacity-30" />
                      <p className="text-sm">No expenses for this period</p>
                    </td>
                  </tr>
                ) : expenses.map(exp => (
                  <tr key={exp.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-5 py-3.5 text-sm text-gray-400">
                      {new Date(exp.date).toLocaleDateString('en-UG')}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-xs font-semibold px-2.5 py-1 rounded-full text-white"
                        style={{ backgroundColor: CATEGORY_COLOURS[exp.category] || '#9CA3AF' }}>
                        {exp.category}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-gray-600 max-w-[180px] truncate">
                      {exp.description || '—'}
                    </td>
                    <td className="px-5 py-3.5 text-sm font-bold text-clinic-navy">
                      {formatUGX(exp.amountUGX)}
                    </td>
                    <td className="px-5 py-3.5">
                      <button onClick={() => deleteExpense(exp.id)}
                        className="text-gray-300 hover:text-red-400 transition-colors">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showAdd && (
        <AddExpenseModal
          onClose={() => setShowAdd(false)}
          onAdded={(e: Expense) => { setExpenses(es => [e, ...es]); setShowAdd(false) }}
          token={token}
        />
      )}
    </div>
  )
}

function AddExpenseModal({ onClose, onAdded, token }: any) {
  const [form, setForm] = useState({ category: 'SUPPLIES', amountUGX: '', description: '', date: new Date().toISOString().split('T')[0] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api-proxy/accounts/expenses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...form, amountUGX: parseInt(form.amountUGX) }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error); return }
      onAdded(data)
    } catch { setError('Network error') } finally { setLoading(false) }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl animate-fade-in">
          <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
            <h2 className="text-lg font-bold text-clinic-navy">Record Expense</h2>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400">✕</button>
          </div>
          <form onSubmit={submit} className="px-6 py-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Category *</label>
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-clinic-blue">
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Amount (UGX) *</label>
              <input type="number" required value={form.amountUGX} onChange={e => setForm(f => ({ ...f, amountUGX: e.target.value }))}
                placeholder="e.g. 500000"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-clinic-blue font-mono" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Description</label>
              <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Brief description..."
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-clinic-blue" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Date *</label>
              <input type="date" required value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-clinic-blue" />
            </div>
            {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-gray-200 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Cancel</button>
              <button type="submit" disabled={loading} className="flex-1 py-2.5 bg-clinic-navy text-white text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-60">
                {loading ? 'Saving...' : 'Record Expense'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}
