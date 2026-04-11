'use client'

import { useEffect, useState } from 'react'
import { Plus, Loader2, Save, X, Check, Pencil, Power } from 'lucide-react'
import { cn, formatUGX } from '@/lib/utils'

interface Service {
  id: string; name: string; category: string
  description?: string; durationMins: number
  priceUGX: number; colour: string
  vatApplicable: boolean; isActive: boolean
}

const CATEGORIES = ['Consultation','Preventive','Restorative','Periodontal','Endodontics','Oral Surgery','Cosmetic','Orthodontics','Prosthodontics','Paediatric','General']
const COLOURS    = ['#3498DB','#2ECC71','#E74C3C','#F39C12','#9B59B6','#E8A838','#1ABC9C','#4A90D9','#29ABE2','#E91E63','#27AE60','#8E44AD','#C0392B','#34495E']

const inputCls = [
  'w-full px-3 py-2.5 text-sm border rounded-xl transition-all',
  'border-gray-200 bg-gray-50 text-gray-800',
  'focus:outline-none focus:ring-2 focus:ring-clinic-blue/20 focus:border-clinic-blue focus:bg-white',
  'dark:border-white/10 dark:bg-white/5 dark:text-gray-100',
  'dark:focus:border-clinic-blue dark:focus:bg-white/10',
].join(' ')

const emptyForm = () => ({
  name: '', category: 'General', description: '',
  durationMins: 30, priceUGX: 0, colour: '#29ABE2', vatApplicable: true,
})

export default function ServicesTab() {
  const token   = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const API     = '/api-proxy'

  const [services,    setServices]    = useState<Service[]>([])
  const [loading,     setLoading]     = useState(true)
  const [saving,      setSaving]      = useState(false)
  const [editId,      setEditId]      = useState<string | null>(null)
  const [panelOpen,   setPanelOpen]   = useState(false)
  const [toast,       setToast]       = useState<{ msg: string; ok: boolean } | null>(null)
  const [filterCat,   setFilterCat]   = useState('All')
  const [searchQ,     setSearchQ]     = useState('')
  const [form,        setForm]        = useState(emptyForm())

  useEffect(() => { fetchServices() }, [])

  async function fetchServices() {
    setLoading(true)
    try {
      const res  = await fetch(`${API}/services`, { headers })
      const data = await res.json()
      setServices(Array.isArray(data) ? data : [])
    } catch { } finally { setLoading(false) }
  }

  function openNew() { setEditId(null); setForm(emptyForm()); setPanelOpen(true) }

  function openEdit(s: Service) {
    setEditId(s.id)
    setForm({ name: s.name, category: s.category, description: s.description || '', durationMins: s.durationMins, priceUGX: s.priceUGX, colour: s.colour, vatApplicable: s.vatApplicable })
    setPanelOpen(true)
  }

  async function handleSave() {
    if (!form.name || !form.priceUGX) { showToast('Name and price are required', false); return }
    setSaving(true)
    try {
      const url    = editId ? `${API}/services/${editId}` : `${API}/services`
      const method = editId ? 'PATCH' : 'POST'
      const res    = await fetch(url, { method, headers, body: JSON.stringify({ ...form, priceUGX: Number(form.priceUGX), durationMins: Number(form.durationMins) }) })
      if (res.ok) { showToast(editId ? 'Service updated' : 'Service created', true); setPanelOpen(false); fetchServices() }
      else { const d = await res.json(); showToast(d.error || 'Failed', false) }
    } catch { showToast('Network error', false) } finally { setSaving(false) }
  }

  async function toggleActive(s: Service) {
    await fetch(`${API}/services/${s.id}`, { method: 'PATCH', headers, body: JSON.stringify({ isActive: !s.isActive }) })
    fetchServices()
  }

  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok }); setTimeout(() => setToast(null), 3000)
  }

  const categories = ['All', ...CATEGORIES.filter(c => services.some(s => s.category === c))]
  const filtered   = services
    .filter(s => filterCat === 'All' || s.category === filterCat)
    .filter(s => !searchQ || s.name.toLowerCase().includes(searchQ.toLowerCase()))

  const grouped = CATEGORIES.reduce<Record<string, Service[]>>((acc, cat) => {
    const list = filtered.filter(s => s.category === cat)
    if (list.length) acc[cat] = list
    return acc
  }, {})

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <Loader2 size={28} className="animate-spin text-clinic-blue" />
    </div>
  )

  return (
    <div className="flex h-full relative">
      {/* Toast */}
      {toast && (
        <div className={cn(
          'fixed top-5 right-5 z-50 flex items-center gap-2 px-4 py-3 rounded-2xl text-sm font-semibold text-white shadow-xl',
          toast.ok ? 'bg-emerald-500' : 'bg-red-500',
        )}>
          {toast.ok ? <Check size={16} /> : <X size={16} />}
          {toast.msg}
        </div>
      )}

      {/* Service list */}
      <div className={cn('flex-1 flex flex-col overflow-hidden transition-all', panelOpen ? 'mr-[380px]' : '')}>
        {/* Toolbar */}
        <div className="flex-shrink-0 flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-white/5 bg-white dark:bg-white/5 flex-wrap gap-y-2">
          <input value={searchQ} onChange={e => setSearchQ(e.target.value)}
            placeholder="Search services..."
            className="px-3 py-2 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-clinic-blue/20 w-48 dark:placeholder-gray-500" />
          <div className="flex gap-1 flex-wrap">
            {categories.map(c => (
              <button key={c} onClick={() => setFilterCat(c)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
                  filterCat === c
                    ? 'bg-clinic-navy text-white'
                    : 'bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/15',
                )}>
                {c}
              </button>
            ))}
          </div>
          <button onClick={openNew}
            className="ml-auto flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5 hover:shadow-md"
            style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
            <Plus size={14} /> Add Service
          </button>
        </div>

        {/* Stats row */}
        <div className="flex-shrink-0 flex gap-4 px-4 py-2.5 border-b border-gray-100 dark:border-white/5 bg-gray-50/50 dark:bg-black/20">
          <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">{services.length} total</span>
          <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">{services.filter(s => s.isActive).length} active</span>
          <span className="text-xs text-gray-400 font-medium">{services.filter(s => !s.isActive).length} inactive</span>
        </div>

        {/* Services grid */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {Object.entries(grouped).map(([cat, list]) => (
            <div key={cat}>
              <h3 className="text-xs font-black uppercase tracking-wider text-gray-400 dark:text-gray-600 mb-2 flex items-center gap-2">
                <span className="flex-1 h-px bg-gray-100 dark:bg-white/5" />
                {cat}
                <span className="flex-1 h-px bg-gray-100 dark:bg-white/5" />
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                {list.map(s => (
                  <div key={s.id}
                    className={cn(
                      'bg-white dark:bg-white/5 border rounded-xl p-3 transition-all group',
                      'dark:backdrop-blur-sm',
                      s.isActive
                        ? 'border-gray-100 dark:border-white/8 hover:shadow-sm hover:border-gray-200 dark:hover:border-white/15 dark:hover:bg-white/8'
                        : 'border-gray-100 dark:border-white/5 opacity-40',
                    )}>
                    <div className="flex items-start justify-between mb-2">
                      {/* Colour swatch with service initial */}
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-sm font-bold shadow-sm"
                        style={{ background: s.colour }}>
                        {s.name[0]}
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => openEdit(s)}
                          className="p-1 rounded-lg text-gray-400 hover:text-clinic-blue hover:bg-blue-50 dark:hover:bg-clinic-blue/10 transition-colors">
                          <Pencil size={12} />
                        </button>
                        <button onClick={() => toggleActive(s)}
                          className={cn(
                            'p-1 rounded-lg transition-colors',
                            s.isActive
                              ? 'text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10'
                              : 'text-gray-300 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-500/10',
                          )}>
                          <Power size={12} />
                        </button>
                      </div>
                    </div>
                    <p className="text-xs font-bold text-gray-800 dark:text-gray-100 leading-tight mb-1">{s.name}</p>
                    <p className="text-[10px] text-gray-400 dark:text-gray-500">{s.durationMins} min</p>
                    <p className="text-xs font-bold mt-1" style={{ color: s.colour }}>
                      {formatUGX(s.priceUGX)}
                    </p>
                    {s.vatApplicable && <span className="text-[9px] text-gray-300 dark:text-gray-600 font-medium">+VAT</span>}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center h-32 text-gray-400">
              <div className="text-3xl mb-2">🦷</div>
              <p className="text-sm">No services found</p>
            </div>
          )}
        </div>
      </div>

      {/* Edit / Create panel */}
      {panelOpen && (
        <div className="fixed right-0 top-[4.5rem] bottom-0 w-[380px] bg-white dark:bg-gray-900/95 dark:backdrop-blur-xl border-l border-gray-100 dark:border-white/8 shadow-2xl z-20 flex flex-col">
          {/* Panel header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/8">
            <h3 className="font-bold text-clinic-navy dark:text-clinic-blue text-sm">{editId ? 'Edit Service' : 'New Service'}</h3>
            <button onClick={() => setPanelOpen(false)} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">
              <X size={16} />
            </button>
          </div>

          {/* Form */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Service Name *</label>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Teeth Whitening" className={inputCls} />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Category</label>
              <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className={inputCls}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Description</label>
              <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                rows={2} placeholder="Short description..." className={cn(inputCls, 'resize-none')} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Duration (min)</label>
                <input type="number" min="5" step="5" value={form.durationMins} onChange={e => setForm({ ...form, durationMins: +e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Price (UGX) *</label>
                <input type="number" min="0" step="1000" value={form.priceUGX} onChange={e => setForm({ ...form, priceUGX: +e.target.value })} className={inputCls} />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Colour</label>
              <div className="flex flex-wrap gap-2">
                {COLOURS.map(c => (
                  <button key={c} onClick={() => setForm({ ...form, colour: c })}
                    className="w-8 h-8 rounded-full transition-all hover:scale-110 border-2"
                    style={{
                      background: c,
                      borderColor: form.colour === c ? '#1A237E' : 'transparent',
                      boxShadow: form.colour === c ? `0 0 0 3px ${c}44` : 'none',
                    }} />
                ))}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <div className="w-6 h-6 rounded-lg flex items-center justify-center text-white text-xs font-bold"
                  style={{ background: form.colour }}>
                  {form.name[0] || '?'}
                </div>
                <span className="text-xs text-gray-400">{form.colour}</span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <input type="checkbox" id="vat" checked={form.vatApplicable}
                onChange={e => setForm({ ...form, vatApplicable: e.target.checked })}
                className="w-4 h-4 rounded accent-clinic-blue" />
              <label htmlFor="vat" className="text-sm font-medium text-gray-700 dark:text-gray-300">VAT applicable (18%)</label>
            </div>

            {form.priceUGX > 0 && (
              <div className="bg-gray-50 dark:bg-white/5 rounded-xl p-3 text-sm border border-gray-100 dark:border-white/8">
                <div className="flex justify-between text-gray-500 dark:text-gray-400">
                  <span>Subtotal</span>
                  <span>{formatUGX(form.priceUGX)}</span>
                </div>
                {form.vatApplicable && (
                  <div className="flex justify-between text-gray-500 dark:text-gray-400 mt-1">
                    <span>VAT 18%</span>
                    <span>{formatUGX(Math.round(form.priceUGX * 0.18))}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-clinic-navy dark:text-clinic-blue mt-2 pt-2 border-t border-gray-200 dark:border-white/10">
                  <span>Total</span>
                  <span>{formatUGX(form.vatApplicable ? Math.round(form.priceUGX * 1.18) : form.priceUGX)}</span>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex-shrink-0 px-5 py-4 border-t border-gray-100 dark:border-white/8 flex gap-3">
            <button onClick={() => setPanelOpen(false)}
              className="px-4 py-2.5 text-sm font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10 rounded-xl transition-colors">
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold text-white text-sm transition-all hover:-translate-y-0.5 hover:shadow-md disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {editId ? 'Update Service' : 'Create Service'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
