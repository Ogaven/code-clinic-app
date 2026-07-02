'use client'

import { useCallback, useEffect, useState } from 'react'
import { Plus, Search, RefreshCw, UserCheck, X, CheckCircle2, AlertCircle, Eye, Phone, Mail, MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Lead {
  id: string
  name:        string | null
  phone:       string | null
  email:       string | null
  source:      string
  status:      string
  notes:       string | null
  lastMessage: string | null
  convertedToPatientId: string | null
  createdAt:   string
  updatedAt:   string
}

const SOURCES  = ['WHATSAPP', 'FACEBOOK', 'INSTAGRAM', 'WEBSITE', 'WALKIN', 'OTHER'] as const
const STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'LOST'] as const

const SOURCE_STYLE: Record<string, string> = {
  WHATSAPP:  'bg-green-100 text-green-700',
  FACEBOOK:  'bg-blue-100 text-blue-700',
  INSTAGRAM: 'bg-pink-100 text-pink-700',
  WEBSITE:   'bg-purple-100 text-purple-700',
  WALKIN:    'bg-amber-100 text-amber-700',
  OTHER:     'bg-gray-100 text-gray-600',
}

const SOURCE_LABEL: Record<string, string> = {
  WHATSAPP:  'WhatsApp',
  FACEBOOK:  'Facebook',
  INSTAGRAM: 'Instagram',
  WEBSITE:   'Website',
  WALKIN:    'Walk-in',
  OTHER:     'Other',
}

const STATUS_STYLE: Record<string, string> = {
  NEW:       'bg-slate-100 text-slate-600',
  CONTACTED: 'bg-blue-100 text-blue-600',
  QUALIFIED: 'bg-cyan-100 text-cyan-700',
  CONVERTED: 'bg-emerald-100 text-emerald-700',
  LOST:      'bg-red-100 text-red-500',
}

function fmtDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function waLink(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  const normalized = digits.startsWith('0') && digits.length === 10 ? '256' + digits.slice(1) : digits
  return `https://wa.me/${normalized}`
}

function WhatsAppIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  )
}

export default function LeadsPage() {
  const API   = '/api-proxy'
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const authH = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  const [leads,     setLeads]     = useState<Lead[]>([])
  const [loading,   setLoading]   = useState(true)
  const [search,    setSearch]    = useState('')
  const [srcFilter, setSrcFilter] = useState('all')
  const [stFilter,  setStFilter]  = useState('all')
  const [toast,     setToast]     = useState<{ msg: string; ok: boolean } | null>(null)

  const [showAdd,    setShowAdd]   = useState(false)
  const [converting, setConverting]= useState<Lead | null>(null)
  const [viewLead,   setViewLead]  = useState<Lead | null>(null)
  const [busy,       setBusy]      = useState(false)

  const [form, setForm] = useState({ name: '', phone: '', email: '', source: 'WALKIN', notes: '' })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (srcFilter !== 'all') params.set('source', srcFilter)
      if (stFilter  !== 'all') params.set('status', stFilter)
      if (search.trim())       params.set('q', search.trim())
      const r = await fetch(`${API}/crm/leads?${params}`, { headers: authH as any })
      const d = await r.json()
      setLeads(Array.isArray(d) ? d : [])
    } catch { setLeads([]) }
    setLoading(false)
  }, [srcFilter, stFilter, search, token]) // eslint-disable-line

  useEffect(() => { load() }, [load])

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  async function addLead() {
    if (!form.source) return
    setBusy(true)
    try {
      const r = await fetch(`${API}/crm/leads`, {
        method: 'POST', headers: authH as any,
        body: JSON.stringify({ ...form, name: form.name || null, phone: form.phone || null, email: form.email || null }),
      })
      if (r.ok) {
        showToast('Lead added')
        setShowAdd(false)
        setForm({ name: '', phone: '', email: '', source: 'WALKIN', notes: '' })
        load()
      } else { const d = await r.json(); showToast(d.error || 'Failed', false) }
    } catch { showToast('Network error', false) }
    setBusy(false)
  }

  async function updateStatus(lead: Lead, status: string) {
    try {
      await fetch(`${API}/crm/leads/${lead.id}`, {
        method: 'PATCH', headers: authH as any,
        body: JSON.stringify({ status }),
      })
      setLeads(ls => ls.map(l => l.id === lead.id ? { ...l, status } : l))
    } catch { showToast('Update failed', false) }
  }

  async function convertLead() {
    if (!converting) return
    setBusy(true)
    try {
      const r = await fetch(`${API}/crm/leads/${converting.id}/convert`, { method: 'POST', headers: authH as any })
      if (r.ok) { showToast(`${converting.name || 'Lead'} converted to patient`); setConverting(null); load() }
      else { const d = await r.json(); showToast(d.error || 'Conversion failed', false) }
    } catch { showToast('Network error', false) }
    setBusy(false)
  }

  const inputCls = 'w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all'

  return (
    <div className="p-4 sm:p-5 space-y-4">

      {toast && (
        <div className={cn(
          'fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-2xl shadow-xl text-sm font-bold',
          toast.ok ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white',
        )}>
          {toast.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-gray-800">Leads</h1>
          <p className="text-xs text-gray-400 mt-0.5">Enquiries from WhatsApp, Facebook, Instagram, and walk-ins</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5 hover:shadow-lg"
          style={{ background: 'linear-gradient(135deg,#0c1e50,#29ABE2)' }}>
          <Plus size={14} /> Add Lead
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, phone, or email..."
            className="w-full pl-8 pr-4 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all"
          />
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="flex flex-wrap gap-1.5">
            <span className="text-[10px] font-black uppercase text-gray-400 self-center mr-1">Source</span>
            {(['all', ...SOURCES] as string[]).map(s => (
              <button key={s} onClick={() => setSrcFilter(s)}
                className={cn('px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all',
                  srcFilter === s ? 'bg-cyan-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200')}>
                {s === 'all' ? 'All' : SOURCE_LABEL[s] ?? s}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <span className="text-[10px] font-black uppercase text-gray-400 self-center mr-1">Status</span>
            {(['all', ...STATUSES] as string[]).map(s => (
              <button key={s} onClick={() => setStFilter(s)}
                className={cn('px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all',
                  stFilter === s ? 'bg-cyan-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200')}>
                {s === 'all' ? 'All' : s.charAt(0) + s.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 p-12 text-gray-300">
            <RefreshCw size={18} className="animate-spin" /> Loading…
          </div>
        ) : leads.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-gray-300">
            <UserCheck size={36} className="mb-3 opacity-30" />
            <p className="text-sm font-medium">No leads found</p>
            <p className="text-xs mt-1">Enquiries from messaging channels appear here automatically</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-5 py-3 text-left text-[10px] font-black uppercase tracking-widest text-gray-400">Name / Phone</th>
                  <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-gray-400">Source</th>
                  <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-gray-400">Status</th>
                  <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-gray-400 hidden md:table-cell">Last Message</th>
                  <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-gray-400 hidden sm:table-cell">Date</th>
                  <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-widest text-gray-400">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {leads.map(lead => (
                  <tr
                    key={lead.id}
                    onClick={() => setViewLead(lead)}
                    className="hover:bg-gray-50/60 transition-colors cursor-pointer"
                  >
                    <td className="px-5 py-3.5">
                      <p className="font-semibold text-gray-800">
                        {lead.name || <span className="italic text-gray-400">Unknown</span>}
                      </p>
                      {lead.phone && <p className="text-xs text-gray-400 mt-0.5">{lead.phone}</p>}
                      {lead.email && <p className="text-xs text-gray-400">{lead.email}</p>}
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={cn('px-2.5 py-1 rounded-full text-[11px] font-bold', SOURCE_STYLE[lead.source] ?? 'bg-gray-100 text-gray-600')}>
                        {SOURCE_LABEL[lead.source] ?? lead.source}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <select
                        value={lead.status}
                        onClick={e => e.stopPropagation()}
                        onChange={e => { e.stopPropagation(); updateStatus(lead, e.target.value) }}
                        disabled={lead.status === 'CONVERTED'}
                        className={cn(
                          'text-[11px] font-bold px-2.5 py-1 rounded-full border-0 cursor-pointer outline-none',
                          STATUS_STYLE[lead.status] ?? 'bg-gray-100 text-gray-600',
                          lead.status === 'CONVERTED' && 'cursor-not-allowed opacity-80',
                        )}
                      >
                        {STATUSES.map(s => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3.5 hidden md:table-cell max-w-[200px]">
                      {lead.lastMessage ? (
                        <p className="text-xs text-gray-500 line-clamp-2">{lead.lastMessage}</p>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 hidden sm:table-cell text-xs text-gray-400 whitespace-nowrap">
                      {fmtDate(lead.updatedAt)}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center justify-end gap-1.5" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => setViewLead(lead)}
                          className="p-1.5 rounded-lg text-gray-300 hover:text-cyan-500 hover:bg-cyan-50 transition-colors">
                          <Eye size={13} />
                        </button>
                        {lead.phone && !lead.phone.startsWith('ws_') && (
                          <a
                            href={waLink(lead.phone)}
                            target="_blank" rel="noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="p-1.5 rounded-lg text-gray-300 hover:text-green-600 hover:bg-green-50 transition-colors">
                            <WhatsAppIcon size={13} />
                          </a>
                        )}
                        {lead.status !== 'CONVERTED' && lead.status !== 'LOST' && (
                          <button
                            onClick={() => setConverting(lead)}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors whitespace-nowrap">
                            <UserCheck size={12} /> Convert
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-5 py-2.5 border-t border-gray-50 text-xs text-gray-400">
              {leads.length} lead{leads.length !== 1 ? 's' : ''}
            </div>
          </div>
        )}
      </div>

      {/* ── Lead detail modal ────────────────────────────────── */}
      {viewLead && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setViewLead(null)}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-black text-gray-800">Lead Details</h2>
              <button onClick={() => setViewLead(null)} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-gray-100 transition-colors">
                <X size={16} className="text-gray-400" />
              </button>
            </div>

            <div className="space-y-2">
              <p className="text-lg font-black text-gray-800">{viewLead.name || <span className="italic text-gray-400">Unknown name</span>}</p>
              {viewLead.phone && !viewLead.phone.startsWith('ws_') && (
                <a href={waLink(viewLead.phone)} target="_blank" rel="noreferrer"
                  className="flex items-center gap-2 text-sm text-green-600 font-semibold hover:underline">
                  <Phone size={13} /> {viewLead.phone}
                </a>
              )}
              {viewLead.email && (
                <a href={`mailto:${viewLead.email}`} className="flex items-center gap-2 text-sm text-blue-600 font-semibold hover:underline">
                  <Mail size={13} /> {viewLead.email}
                </a>
              )}
            </div>

            <div className="flex items-center gap-2">
              <span className={cn('px-2.5 py-1 rounded-full text-[11px] font-bold', SOURCE_STYLE[viewLead.source] ?? 'bg-gray-100 text-gray-600')}>
                {SOURCE_LABEL[viewLead.source] ?? viewLead.source}
              </span>
              <span className={cn('px-2.5 py-1 rounded-full text-[11px] font-bold', STATUS_STYLE[viewLead.status] ?? 'bg-gray-100 text-gray-600')}>
                {viewLead.status.charAt(0) + viewLead.status.slice(1).toLowerCase()}
              </span>
              <span className="text-[10px] text-gray-400 ml-auto">{fmtDate(viewLead.createdAt)}</span>
            </div>

            {viewLead.lastMessage && (
              <div className="bg-gray-50 rounded-2xl p-4">
                <div className="flex items-center gap-1.5 mb-2">
                  <MessageSquare size={12} className="text-gray-400" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Message</span>
                </div>
                <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{viewLead.lastMessage}</p>
              </div>
            )}

            {viewLead.notes && (
              <div className="bg-amber-50 rounded-2xl p-4">
                <span className="text-[10px] font-black uppercase tracking-widest text-amber-500 block mb-2">Notes</span>
                <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{viewLead.notes}</p>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              {viewLead.status !== 'CONVERTED' && viewLead.status !== 'LOST' && (
                <button
                  onClick={() => { setViewLead(null); setConverting(viewLead) }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors">
                  <UserCheck size={14} /> Convert to Patient
                </button>
              )}
              <button
                onClick={() => setViewLead(null)}
                className="px-4 py-2.5 rounded-xl text-sm font-bold border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Lead modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-black text-gray-800">Add Lead</h2>
              <button onClick={() => setShowAdd(false)}
                className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-gray-100 transition-colors">
                <X size={16} className="text-gray-400" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Full Name</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={inputCls} placeholder="e.g. Jane Doe" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Phone</label>
                <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className={inputCls} placeholder="+256 700 000 000" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Email</label>
                <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Source *</label>
                <select value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))} className={inputCls}>
                  {SOURCES.map(s => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Notes</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2}
                  className={inputCls} placeholder="What did they enquire about?" />
              </div>
              <div className="flex gap-3 pt-1">
                <button onClick={() => setShowAdd(false)}
                  className="flex-1 py-3 rounded-xl border border-gray-200 text-sm font-bold text-gray-600 hover:bg-gray-50 transition-colors">
                  Cancel
                </button>
                <button onClick={addLead} disabled={busy}
                  className="flex-1 py-3 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-60"
                  style={{ background: 'linear-gradient(135deg,#0c1e50,#29ABE2)' }}>
                  {busy ? 'Adding…' : 'Add Lead'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Convert confirmation */}
      {converting && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-2xl bg-emerald-100 flex items-center justify-center flex-shrink-0">
                <UserCheck size={18} className="text-emerald-600" />
              </div>
              <h2 className="text-base font-black text-gray-800">Convert to Patient</h2>
            </div>
            <p className="text-sm text-gray-600 mb-6 leading-relaxed">
              Create a patient record for <strong>{converting.name || converting.phone || 'this lead'}</strong>?
              The lead will be marked as Converted.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConverting(null)} disabled={busy}
                className="flex-1 py-3 rounded-xl border border-gray-200 text-sm font-bold text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50">
                Cancel
              </button>
              <button onClick={convertLead} disabled={busy}
                className="flex-1 py-3 rounded-xl text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors disabled:opacity-60">
                {busy ? 'Converting…' : 'Convert'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
