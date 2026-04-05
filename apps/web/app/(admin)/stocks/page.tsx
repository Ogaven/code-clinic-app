'use client'

import { useEffect, useState } from 'react'
import { Plus, Package, AlertTriangle } from 'lucide-react'
import { cn, formatUGX } from '@/lib/utils'

// Stocks / Inventory — clone Zendeta Screenshot 085128
// Note: Stock model not in Phase 1 schema (it's referenced in spec as future)
// We build the full UI with local mock data for demo; backend route scaffolded

interface StockItem {
  id: string
  name: string
  category: string
  sku: string
  unitPriceUGX: number
  inStock: number
  reorderPoint: number
  unit: string
}

const CATEGORIES = ['DENTAL SUPPLIES', 'ANAESTHESIA', 'STERILISATION', 'CONSUMABLES', 'EQUIPMENT', 'MEDICATIONS']

const CATEGORY_COLOURS: Record<string, string> = {
  'DENTAL SUPPLIES': '#29ABE2',
  ANAESTHESIA:       '#8B5CF6',
  STERILISATION:     '#10B981',
  CONSUMABLES:       '#F59E0B',
  EQUIPMENT:         '#1A237E',
  MEDICATIONS:       '#EF4444',
}

// Demo stock items (replace with API when stock model is added)
const DEMO_ITEMS: StockItem[] = [
  { id: '1', name: 'Dental Gloves (L)', category: 'CONSUMABLES', sku: 'DG-L-100', unitPriceUGX: 25000, inStock: 45, reorderPoint: 20, unit: 'box' },
  { id: '2', name: 'Composite Resin A2', category: 'DENTAL SUPPLIES', sku: 'CR-A2-04G', unitPriceUGX: 180000, inStock: 8, reorderPoint: 5, unit: 'syringe' },
  { id: '3', name: 'Lidocaine 2% Cartridges', category: 'ANAESTHESIA', sku: 'LID-2-50', unitPriceUGX: 95000, inStock: 3, reorderPoint: 10, unit: 'pack' },
  { id: '4', name: 'Autoclave Pouches', category: 'STERILISATION', sku: 'AP-200', unitPriceUGX: 45000, inStock: 12, reorderPoint: 8, unit: 'pack' },
  { id: '5', name: 'Dental Burs (Round)', category: 'DENTAL SUPPLIES', sku: 'DB-R-10', unitPriceUGX: 35000, inStock: 30, reorderPoint: 15, unit: 'pack' },
  { id: '6', name: 'X-Ray Films', category: 'DENTAL SUPPLIES', sku: 'XF-100', unitPriceUGX: 120000, inStock: 6, reorderPoint: 10, unit: 'pack' },
  { id: '7', name: 'Sutures 3-0', category: 'CONSUMABLES', sku: 'SUT-30-12', unitPriceUGX: 55000, inStock: 18, reorderPoint: 10, unit: 'box' },
  { id: '8', name: 'Impression Material', category: 'DENTAL SUPPLIES', sku: 'IM-BASE-1K', unitPriceUGX: 250000, inStock: 4, reorderPoint: 3, unit: 'kg' },
  { id: '9', name: 'Ibuprofen 400mg', category: 'MEDICATIONS', sku: 'IBU-400-30', unitPriceUGX: 18000, inStock: 60, reorderPoint: 30, unit: 'pack' },
  { id: '10', name: 'LED Curing Light Bulb', category: 'EQUIPMENT', sku: 'LED-CL-B', unitPriceUGX: 320000, inStock: 2, reorderPoint: 1, unit: 'unit' },
]

export default function StocksPage() {
  const [items, setItems] = useState<StockItem[]>(DEMO_ITEMS)
  const [filterCat, setFilterCat] = useState('')
  const [showAdd, setShowAdd] = useState(false)

  const filtered = filterCat ? items.filter(i => i.category === filterCat) : items
  const lowStock = items.filter(i => i.inStock <= i.reorderPoint)
  const totalValue = items.reduce((s, i) => s + i.inStock * i.unitPriceUGX, 0)

  // Category summary for colour bar
  const catTotals = CATEGORIES.map(cat => ({
    cat,
    count: items.filter(i => i.category === cat).length,
    value: items.filter(i => i.category === cat).reduce((s, i) => s + i.inStock * i.unitPriceUGX, 0),
  })).filter(c => c.count > 0)

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-clinic-navy">Stocks & Inventory</h2>
          <p className="text-sm text-gray-400 mt-0.5">{items.length} products · Total value: {formatUGX(totalValue)}</p>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-clinic-blue text-white text-sm font-semibold rounded-lg hover:opacity-90">
          <Plus size={16} /> Add Item
        </button>
      </div>

      {/* Low stock alert */}
      {lowStock.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3 flex items-center gap-3">
          <AlertTriangle size={16} className="text-yellow-600 flex-shrink-0" />
          <p className="text-sm text-yellow-700">
            <strong>{lowStock.length} items</strong> are at or below reorder point:{' '}
            {lowStock.map(i => i.name).join(', ')}
          </p>
        </div>
      )}

      {/* Category colour bar (clone Zendeta 085128) */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-clinic-navy">Category Breakdown</h3>
          <span className="text-xs text-gray-400">{formatUGX(totalValue)} total asset value</span>
        </div>
        {/* Segmented bar */}
        <div className="flex h-4 rounded-full overflow-hidden gap-0.5">
          {catTotals.map(({ cat, value }) => (
            <div key={cat}
              style={{
                width: `${Math.round((value / totalValue) * 100)}%`,
                backgroundColor: CATEGORY_COLOURS[cat] || '#9CA3AF',
              }}
              title={`${cat}: ${formatUGX(value)}`}
              className="transition-all" />
          ))}
        </div>
        {/* Legend */}
        <div className="flex flex-wrap gap-4 mt-3">
          {catTotals.map(({ cat, count }) => (
            <button key={cat} onClick={() => setFilterCat(f => f === cat ? '' : cat)}
              className={cn('flex items-center gap-1.5 text-xs font-medium transition-opacity',
                filterCat && filterCat !== cat ? 'opacity-40' : 'opacity-100')}>
              <div className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: CATEGORY_COLOURS[cat] || '#9CA3AF' }} />
              {cat} ({count})
            </button>
          ))}
        </div>
      </div>

      {/* Stock table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {['Product', 'Category', 'SKU', 'Unit Price', 'In Stock', 'Reorder Point', 'Status'].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-3.5 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-gray-400">
                    <Package size={36} className="mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No items in this category</p>
                  </td>
                </tr>
              ) : filtered.map(item => {
                const isLow = item.inStock <= item.reorderPoint
                const isCritical = item.inStock <= Math.floor(item.reorderPoint * 0.5)
                return (
                  <tr key={item.id} className="hover:bg-blue-50/20 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                          style={{ backgroundColor: (CATEGORY_COLOURS[item.category] || '#9CA3AF') + '20' }}>
                          <Package size={14} style={{ color: CATEGORY_COLOURS[item.category] || '#9CA3AF' }} />
                        </div>
                        <span className="text-sm font-medium text-gray-800">{item.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-xs font-semibold px-2.5 py-1 rounded-full text-white"
                        style={{ backgroundColor: CATEGORY_COLOURS[item.category] || '#9CA3AF' }}>
                        {item.category}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-gray-400 font-mono">{item.sku}</td>
                    <td className="px-5 py-3.5 text-sm font-semibold text-clinic-navy font-mono">
                      {formatUGX(item.unitPriceUGX)}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={cn('text-sm font-bold',
                        isCritical ? 'text-red-600' : isLow ? 'text-yellow-600' : 'text-gray-800')}>
                        {item.inStock} {item.unit}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-gray-400">
                      {item.reorderPoint} {item.unit}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1.5">
                        <div className={cn('w-2 h-2 rounded-full',
                          isCritical ? 'bg-red-500' : isLow ? 'bg-yellow-500' : 'bg-green-500')} />
                        <span className={cn('text-xs font-semibold',
                          isCritical ? 'text-red-600' : isLow ? 'text-yellow-600' : 'text-green-600')}>
                          {isCritical ? 'Critical' : isLow ? 'Low' : 'OK'}
                        </span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showAdd && <AddItemModal onClose={() => setShowAdd(false)} onAdded={(i: StockItem) => { setItems(s => [i, ...s]); setShowAdd(false) }} />}
    </div>
  )
}

function AddItemModal({ onClose, onAdded }: any) {
  const [form, setForm] = useState({ name: '', category: 'CONSUMABLES', sku: '', unitPriceUGX: '', inStock: '', reorderPoint: '', unit: 'pack' })

  function submit(e: React.FormEvent) {
    e.preventDefault()
    onAdded({
      id: Date.now().toString(),
      ...form,
      unitPriceUGX: parseInt(form.unitPriceUGX) || 0,
      inStock: parseInt(form.inStock) || 0,
      reorderPoint: parseInt(form.reorderPoint) || 5,
    })
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl animate-fade-in">
          <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
            <h2 className="text-lg font-bold text-clinic-navy">Add Stock Item</h2>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400">✕</button>
          </div>
          <form onSubmit={submit} className="px-6 py-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Product Name *</label>
              <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-clinic-blue" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Category *</label>
                <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-clinic-blue">
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">SKU</label>
                <input value={form.sku} onChange={e => setForm(f => ({ ...f, sku: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-clinic-blue" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Unit Price (UGX)</label>
                <input type="number" value={form.unitPriceUGX} onChange={e => setForm(f => ({ ...f, unitPriceUGX: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-clinic-blue font-mono" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">In Stock</label>
                <input type="number" value={form.inStock} onChange={e => setForm(f => ({ ...f, inStock: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-clinic-blue" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Reorder At</label>
                <input type="number" value={form.reorderPoint} onChange={e => setForm(f => ({ ...f, reorderPoint: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-clinic-blue" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Unit</label>
              <input value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
                placeholder="e.g. pack, box, unit, kg"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-clinic-blue" />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-gray-200 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Cancel</button>
              <button type="submit" className="flex-1 py-2.5 bg-clinic-blue text-white text-sm font-semibold rounded-lg hover:opacity-90">Add Item</button>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}
