'use client'

import { useEffect, useState } from 'react'
import { Plus, Package, AlertTriangle, Pencil, Trash2 } from 'lucide-react'
import { cn, formatUGX } from '@/lib/utils'

interface StockItem {
  id: string
  name: string
  category: string
  quantity: number
  unit: string
  reorderLevel: number
  unitCost: number
  supplier?: string | null
}

const CATEGORIES = ['DENTAL SUPPLIES', 'ANAESTHESIA', 'STERILISATION', 'CONSUMABLES', 'EQUIPMENT', 'MEDICATIONS', 'OTHER']

const CATEGORY_COLOURS: Record<string, string> = {
  'DENTAL SUPPLIES': '#29ABE2',
  ANAESTHESIA:       '#8B5CF6',
  STERILISATION:     '#10B981',
  CONSUMABLES:       '#F59E0B',
  EQUIPMENT:         '#1A237E',
  MEDICATIONS:       '#EF4444',
  OTHER:             '#9CA3AF',
}

export default function StocksPage() {
  const [items, setItems]       = useState<StockItem[]>([])
  const [loading, setLoading]   = useState(true)
  const [filterCat, setFilterCat] = useState('')
  const [showAdd, setShowAdd]   = useState(false)
  const [editing, setEditing]   = useState<StockItem | null>(null)
  const [deleting, setDeleting] = useState<StockItem | null>(null)
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null

  useEffect(() => {
    fetch('/api-proxy/stocks/items', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => setItems(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [token])

  async function handleDelete(item: StockItem) {
    await fetch(`/api-proxy/stocks/items/${item.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    setItems(s => s.filter(i => i.id !== item.id))
    setDeleting(null)
  }

  const filtered   = filterCat ? items.filter(i => i.category === filterCat) : items
  const lowStock   = items.filter(i => i.quantity <= i.reorderLevel)
  const totalValue = items.reduce((s, i) => s + i.quantity * i.unitCost, 0)

  const catTotals = CATEGORIES.map(cat => ({
    cat,
    count: items.filter(i => i.category === cat).length,
    value: items.filter(i => i.category === cat).reduce((s, i) => s + i.quantity * i.unitCost, 0),
  })).filter(c => c.count > 0)

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-clinic-navy dark:text-white">Stocks & Inventory</h2>
          <p className="text-sm text-gray-400 mt-0.5">{items.length} products · Total value: {formatUGX(totalValue)}</p>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-clinic-blue text-white text-sm font-semibold rounded-lg hover:opacity-90">
          <Plus size={16} /> Add Item
        </button>
      </div>

      {lowStock.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3 flex items-center gap-3">
          <AlertTriangle size={16} className="text-yellow-600 flex-shrink-0" />
          <p className="text-sm text-yellow-700">
            <strong>{lowStock.length} items</strong> are at or below reorder level:{' '}
            {lowStock.map(i => i.name).join(', ')}
          </p>
        </div>
      )}

      {catTotals.length > 0 && totalValue > 0 && (
        <div className="bg-white dark:bg-white/5 rounded-xl border border-gray-100 dark:border-white/10 shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-clinic-navy dark:text-white">Category Breakdown</h3>
            <span className="text-xs text-gray-400">{formatUGX(totalValue)} total asset value</span>
          </div>
          <div className="flex h-4 rounded-full overflow-hidden gap-0.5">
            {catTotals.map(({ cat, value }) => (
              <div key={cat}
                style={{ width: `${Math.round((value / totalValue) * 100)}%`, backgroundColor: CATEGORY_COLOURS[cat] || '#9CA3AF' }}
                title={`${cat}: ${formatUGX(value)}`}
                className="transition-all" />
            ))}
          </div>
          <div className="flex flex-wrap gap-4 mt-3">
            {catTotals.map(({ cat, count }) => (
              <button key={cat} onClick={() => setFilterCat(f => f === cat ? '' : cat)}
                className={cn('flex items-center gap-1.5 text-xs font-medium transition-opacity',
                  filterCat && filterCat !== cat ? 'opacity-40' : 'opacity-100')}>
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CATEGORY_COLOURS[cat] || '#9CA3AF' }} />
                {cat} ({count})
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-white/5 rounded-xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 dark:bg-white/5 border-b border-gray-200 dark:border-white/10">
                {['Product', 'Category', 'Quantity', 'Unit Cost', 'Reorder At', 'Supplier', 'Status', ''].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-3.5 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-white/5">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {Array.from({ length: 8 }).map((__, j) => (
                      <td key={j} className="px-5 py-4"><div className="h-4 bg-gray-100 dark:bg-white/5 rounded w-3/4" /></td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center text-gray-400">
                    <Package size={36} className="mx-auto mb-2 opacity-30" />
                    <p className="text-sm">
                      {items.length === 0 ? 'No stock items yet — click "+ Add Item" to start' : 'No items in this category'}
                    </p>
                  </td>
                </tr>
              ) : filtered.map(item => {
                const isLow      = item.quantity <= item.reorderLevel
                const isCritical = item.quantity <= Math.floor(item.reorderLevel * 0.5)
                return (
                  <tr key={item.id} className={cn(
                    'hover:bg-blue-50/20 dark:hover:bg-white/5 transition-colors',
                    isLow ? 'bg-amber-50/40 dark:bg-yellow-900/10' : '',
                  )}>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                          style={{ backgroundColor: (CATEGORY_COLOURS[item.category] || '#9CA3AF') + '20' }}>
                          <Package size={14} style={{ color: CATEGORY_COLOURS[item.category] || '#9CA3AF' }} />
                        </div>
                        <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{item.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-xs font-semibold px-2.5 py-1 rounded-full text-white"
                        style={{ backgroundColor: CATEGORY_COLOURS[item.category] || '#9CA3AF' }}>
                        {item.category}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={cn('text-sm font-bold',
                        isCritical ? 'text-red-600' : isLow ? 'text-yellow-600' : 'text-gray-800 dark:text-gray-200')}>
                        {item.quantity} {item.unit}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-sm font-semibold text-clinic-navy dark:text-white font-mono">
                      {formatUGX(item.unitCost)}
                    </td>
                    <td className="px-5 py-3.5 text-sm text-gray-400">
                      {item.reorderLevel} {item.unit}
                    </td>
                    <td className="px-5 py-3.5 text-sm text-gray-500 dark:text-gray-400">
                      {item.supplier || '—'}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1.5">
                        {isLow && <AlertTriangle size={12} className={isCritical ? 'text-red-500' : 'text-yellow-500'} />}
                        <div className={cn('w-2 h-2 rounded-full',
                          isCritical ? 'bg-red-500' : isLow ? 'bg-yellow-500' : 'bg-green-500')} />
                        <span className={cn('text-xs font-semibold',
                          isCritical ? 'text-red-600' : isLow ? 'text-yellow-600' : 'text-green-600')}>
                          {isCritical ? 'Critical' : isLow ? 'Low' : 'OK'}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1">
                        <button onClick={() => setEditing(item)}
                          className="p-1.5 rounded-lg hover:bg-blue-100 dark:hover:bg-white/10 text-gray-400 hover:text-clinic-blue transition-colors"
                          title="Edit item">
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => setDeleting(item)}
                          className="p-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-600 transition-colors"
                          title="Delete item">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showAdd && (
        <ItemModal
          onClose={() => setShowAdd(false)}
          onSaved={item => { setItems(s => [item, ...s]); setShowAdd(false) }}
          token={token}
        />
      )}

      {editing && (
        <ItemModal
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={updated => { setItems(s => s.map(i => i.id === updated.id ? updated : i)); setEditing(null) }}
          token={token}
        />
      )}

      {deleting && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setDeleting(null)} />
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <div className="w-full max-w-sm bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6 animate-fade-in">
              <h2 className="text-lg font-bold text-clinic-navy dark:text-white mb-2">Delete Item?</h2>
              <p className="text-sm text-gray-500 mb-6">
                Permanently delete <strong>{deleting.name}</strong>? This cannot be undone.
              </p>
              <div className="flex gap-3">
                <button onClick={() => setDeleting(null)}
                  className="flex-1 py-2.5 border border-gray-200 text-gray-600 text-sm rounded-lg hover:bg-gray-50">
                  Cancel
                </button>
                <button onClick={() => handleDelete(deleting)}
                  className="flex-1 py-2.5 bg-red-600 text-white text-sm font-semibold rounded-lg hover:opacity-90">
                  Delete
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function ItemModal({ item, onClose, onSaved, token }: {
  item?: StockItem; onClose: () => void; onSaved: (i: StockItem) => void; token: string | null
}) {
  const [form, setForm] = useState({
    name:         item?.name         ?? '',
    category:     item?.category     ?? 'CONSUMABLES',
    quantity:     item?.quantity     ?? 0,
    unit:         item?.unit         ?? 'pieces',
    reorderLevel: item?.reorderLevel ?? 10,
    unitCost:     item?.unitCost     ?? 0,
    supplier:     item?.supplier     ?? '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const isEdit = !!item

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(null)
    try {
      const url    = isEdit ? `/api-proxy/stocks/items/${item!.id}` : '/api-proxy/stocks/items'
      const method = isEdit ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          ...form,
          quantity:     Number(form.quantity),
          reorderLevel: Number(form.reorderLevel),
          unitCost:     Number(form.unitCost),
          supplier:     form.supplier || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Save failed'); return }
      onSaved(data)
    } catch { setError('Network error') } finally { setLoading(false) }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-2xl animate-fade-in">
          <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 dark:border-white/10">
            <h2 className="text-lg font-bold text-clinic-navy dark:text-white">
              {isEdit ? 'Edit Stock Item' : 'Add Stock Item'}
            </h2>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 text-gray-400">✕</button>
          </div>
          <form onSubmit={submit} className="px-6 py-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Item Name *</label>
              <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-clinic-blue" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Category</label>
                <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-clinic-blue">
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Unit</label>
                <input value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
                  placeholder="pieces, boxes, bottles…"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-clinic-blue" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Quantity</label>
                <input type="number" min="0" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: Number(e.target.value) }))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-clinic-blue" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Reorder At</label>
                <input type="number" min="0" value={form.reorderLevel} onChange={e => setForm(f => ({ ...f, reorderLevel: Number(e.target.value) }))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-clinic-blue" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Unit Cost (UGX)</label>
                <input type="number" min="0" value={form.unitCost} onChange={e => setForm(f => ({ ...f, unitCost: Number(e.target.value) }))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-clinic-blue" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Supplier</label>
              <input value={form.supplier ?? ''} onChange={e => setForm(f => ({ ...f, supplier: e.target.value }))}
                placeholder="Optional supplier name"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-clinic-blue" />
            </div>
            {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose}
                className="flex-1 py-2.5 border border-gray-200 text-gray-600 text-sm rounded-lg hover:bg-gray-50">
                Cancel
              </button>
              <button type="submit" disabled={loading}
                className="flex-1 py-2.5 bg-clinic-blue text-white text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-60">
                {loading ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Item'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}
