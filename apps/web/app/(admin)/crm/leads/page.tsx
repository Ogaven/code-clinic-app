'use client'

import { useEffect, useState } from 'react'
import { Plus, Phone, Mail, Tag, TrendingUp } from 'lucide-react'
import { cn, formatPhone } from '@/lib/utils'

interface Lead {
  id: string; name: string; phone?: string; email?: string
  source: string; stage: string; score: number; notes?: string; createdAt: string
}

const STAGES = ['NEW', 'CONTACTED', 'QUALIFIED', 'BOOKED', 'CONVERTED', 'LOST']
const STAGE_COLOURS: Record<string, string> = {
  NEW: '#3B82F6', CONTACTED: '#8B5CF6', QUALIFIED: '#F59E0B',
  BOOKED: '#10B981', CONVERTED: '#059669', LOST: '#EF4444',
}
const SOURCE_LABELS: Record<string, string> = {
  WEBSITE_POPUP: 'Website', QR: 'QR Code', SOCIAL: 'Social',
  QUIZ: 'Quiz', REFERRAL: 'Referral', WALK_IN: 'Walk-in', PHONE: 'Phone',
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null

  useEffect(() => {
    fetch(`/api-proxy/crm/leads`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json()).then(d => setLeads(Array.isArray(d) ? d : d.data || [])).catch(() => {}).finally(() => setLoading(false))
  }, [])

  async function moveStage(id: string, stage: string) {
    await fetch(`/api-proxy/crm/leads/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ stage }),
    })
    setLeads(ls => ls.map(l => l.id === id ? { ...l, stage } : l))
  }

  const byStage = (stage: string) => leads.filter(l => l.stage === stage)

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-clinic-navy">CRM — Leads</h2>
          <p className="text-sm text-gray-400 mt-0.5">{leads.length} leads total</p>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-clinic-blue text-white text-sm font-semibold rounded-lg hover:opacity-90">
          <Plus size={16} /> Add Lead
        </button>
      </div>

      {/* Kanban board */}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {STAGES.map(stage => (
          <div key={stage} className="flex-shrink-0 w-72">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2.5 h-2.5 rounded-full" style={{ background: STAGE_COLOURS[stage] }} />
              <span className="text-xs font-bold text-gray-600 uppercase tracking-wide">{stage}</span>
              <span className="ml-auto text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">
                {byStage(stage).length}
              </span>
            </div>

            <div className="space-y-2 min-h-[200px]">
              {loading ? (
                Array.from({ length: 2 }).map((_, i) => (
                  <div key={i} className="h-28 bg-gray-100 rounded-xl animate-pulse" />
                ))
              ) : byStage(stage).map(lead => (
                <div key={lead.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <p className="text-sm font-semibold text-clinic-navy leading-tight">{lead.name}</p>
                    <div className="flex items-center gap-0.5">
                      {Array.from({ length: Math.min(Math.round(lead.score / 2), 5) }).map((_, i) => (
                        <div key={i} className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
                      ))}
                    </div>
                  </div>
                  {lead.phone && (
                    <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1">
                      <Phone size={10} /> {formatPhone(lead.phone)}
                    </div>
                  )}
                  {lead.email && (
                    <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
                      <Mail size={10} /> {lead.email}
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] bg-blue-50 text-clinic-blue px-2 py-0.5 rounded-full font-medium">
                      {SOURCE_LABELS[lead.source] || lead.source}
                    </span>
                    <select
                      value={lead.stage}
                      onChange={e => moveStage(lead.id, e.target.value)}
                      className="text-[10px] border border-gray-200 rounded-lg px-1.5 py-1 text-gray-600 focus:outline-none focus:ring-1 focus:ring-clinic-blue bg-white"
                    >
                      {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {showAdd && <AddLeadModal onClose={() => setShowAdd(false)} onAdded={(l: Lead) => { setLeads(ls => [l, ...ls]); setShowAdd(false) }} token={token} />}
    </div>
  )
}

function AddLeadModal({ onClose, onAdded, token }: any) {
  const [form, setForm] = useState({ name: '', phone: '', email: '', source: 'WALK_IN', notes: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await fetch(`/api-proxy/crm/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
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
            <h2 className="text-lg font-bold text-clinic-navy">Add Lead</h2>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400">✕</button>
          </div>
          <form onSubmit={submit} className="px-6 py-5 space-y-4">
            {[
              { key: 'name', label: 'Full Name *' },
              { key: 'phone', label: 'Phone', type: 'tel' },
              { key: 'email', label: 'Email', type: 'email' },
            ].map(({ key, label, type = 'text' }) => (
              <div key={key}>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">{label}</label>
                <input type={type} value={(form as any)[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-clinic-blue" />
              </div>
            ))}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Source</label>
              <select value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-clinic-blue bg-white">
                {['WALK_IN','PHONE','WEBSITE_POPUP','QR','SOCIAL','QUIZ','REFERRAL'].map(s => (
                  <option key={s} value={s}>{s.replace(/_/g,' ')}</option>
                ))}
              </select>
            </div>
            {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-gray-200 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-50">Cancel</button>
              <button type="submit" disabled={loading} className="flex-1 py-2.5 bg-clinic-blue text-white text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-60">
                {loading ? 'Adding...' : 'Add Lead'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}
