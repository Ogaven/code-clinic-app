'use client'

import { useEffect, useState } from 'react'
import { Search, Plus, Phone, Mail, Calendar, ChevronRight, X, User } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Patient {
  id: string; firstName: string; lastName: string; phone: string
  email?: string; gender?: string; dob?: string; isActive: boolean
  createdAt: string; _count?: { appointments: number }
}

const COLORS = ['#29ABE2','#9B59B6','#2ECC71','#E8A838','#E74C3C','#1ABC9C','#F39C12','#3498DB']

function avatarColor(name: string) {
  let h = 0; for (const c of name) h = c.charCodeAt(0) + ((h << 5) - h)
  return COLORS[Math.abs(h) % COLORS.length]
}

export default function PatientsPage() {
  const API   = process.env.NEXT_PUBLIC_API_URL || '/api-proxy'
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const authH = { Authorization: `Bearer ${token}` }

  const [patients, setPatients]   = useState<Patient[]>([])
  const [filtered, setFiltered]   = useState<Patient[]>([])
  const [search, setSearch]       = useState('')
  const [loading, setLoading]     = useState(true)
  const [selected, setSelected]   = useState<Patient | null>(null)
  const [appts, setAppts]         = useState<any[]>([])
  const [showAdd, setShowAdd]     = useState(false)
  const [filter, setFilter]       = useState<'all' | 'new' | 'active'>('all')

  // Add patient form
  const [form, setForm] = useState({ firstName: '', lastName: '', phone: '', email: '', gender: 'FEMALE', dob: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  useEffect(() => { fetchPatients() }, [])

  useEffect(() => {
    let list = patients
    if (search) list = list.filter(p =>
      `${p.firstName} ${p.lastName}`.toLowerCase().includes(search.toLowerCase()) ||
      p.phone.includes(search) || (p.email || '').toLowerCase().includes(search.toLowerCase())
    )
    if (filter === 'new') {
      const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7)
      list = list.filter(p => new Date(p.createdAt) > weekAgo)
    } else if (filter === 'active') {
      list = list.filter(p => (p._count?.appointments || 0) > 1)
    }
    setFiltered(list)
  }, [patients, search, filter])

  async function fetchPatients() {
    setLoading(true)
    try {
      const res = await fetch(`${API}/patients?limit=200`, { headers: authH })
      if (res.ok) { const json = await res.json(); setPatients(Array.isArray(json) ? json : json.data || json.patients || []) }
    } catch {} finally { setLoading(false) }
  }

  async function selectPatient(p: Patient) {
    setSelected(p)
    try {
      const res = await fetch(`${API}/scheduling/appointments?patientId=${p.id}&limit=10`, { headers: authH })
      if (res.ok) setAppts(await res.json())
    } catch { setAppts([]) }
  }

  async function addPatient() {
    if (!form.firstName || !form.lastName || !form.phone) { setError('Name and phone are required'); return }
    setSaving(true); setError('')
    try {
      const res = await fetch(`${API}/patients`, {
        method: 'POST', headers: { ...authH, 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (res.ok) { fetchPatients(); setShowAdd(false); setForm({ firstName: '', lastName: '', phone: '', email: '', gender: 'FEMALE', dob: '' }) }
      else { const d = await res.json(); setError(d.error || 'Failed to add patient') }
    } catch { setError('Network error') } finally { setSaving(false) }
  }

  const inputCls = 'w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all'

  return (
    <div className="flex h-full">
      {/* Patient list */}
      <div className={cn('flex flex-col border-r border-gray-100 bg-white transition-all', selected ? 'w-96' : 'flex-1')}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="text-lg font-black text-gray-800">Patients</h1>
              <p className="text-xs text-gray-400">{patients.length} total</p>
            </div>
            <button onClick={() => setShowAdd(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-white transition-all hover:-translate-y-0.5 hover:shadow-lg"
              style={{ background: 'linear-gradient(135deg,#0c1e50,#29ABE2)' }}>
              <Plus size={13} /> Add Patient
            </button>
          </div>
          {/* Search */}
          <div className="relative mb-3">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search patients..." className="w-full pl-8 pr-4 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all" />
          </div>
          {/* Filters */}
          <div className="flex gap-2">
            {(['all', 'new', 'active'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={cn('px-3 py-1 rounded-lg text-xs font-bold capitalize transition-all',
                  filter === f ? 'bg-cyan-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200')}>
                {f === 'all' ? 'All' : f === 'new' ? 'New (7d)' : 'Returning'}
              </button>
            ))}
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-400">
              <User size={28} className="mb-2 text-gray-200" />
              <p className="text-sm">No patients found</p>
            </div>
          ) : filtered.map(p => (
            <button key={p.id} onClick={() => selectPatient(p)}
              className={cn('w-full flex items-center gap-3 px-5 py-3 border-b border-gray-50 text-left hover:bg-gray-50 transition-colors',
                selected?.id === p.id && 'bg-cyan-50 border-l-4 border-l-cyan-500')}>
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
                style={{ background: avatarColor(`${p.firstName}${p.lastName}`) }}>
                {p.firstName?.[0]}{p.lastName?.[0]}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-800 truncate">{p.firstName} {p.lastName}</p>
                <p className="text-xs text-gray-400 truncate">{p.phone}</p>
              </div>
              <div className="flex-shrink-0">
                {(p._count?.appointments || 0) > 1 && (
                  <span className="text-[9px] font-bold bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded-full">Returning</span>
                )}
                <ChevronRight size={14} className="text-gray-300 mt-1" />
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Patient detail panel */}
      {selected && (
        <div className="flex-1 overflow-y-auto bg-slate-50 p-6">
          <div className="max-w-lg space-y-4">
            {/* Profile card */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-white text-xl font-black"
                    style={{ background: avatarColor(`${selected.firstName}${selected.lastName}`) }}>
                    {selected.firstName?.[0]}{selected.lastName?.[0]}
                  </div>
                  <div>
                    <h2 className="text-lg font-black text-gray-800">{selected.firstName} {selected.lastName}</h2>
                    <p className="text-sm text-gray-400">{selected.gender || 'N/A'} · {selected.dob ? new Date().getFullYear() - new Date(selected.dob).getFullYear() + ' yrs' : 'Age N/A'}</p>
                  </div>
                </div>
                <button onClick={() => setSelected(null)} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-gray-100 transition-colors">
                  <X size={16} className="text-gray-400" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">
                  <Phone size={13} className="text-cyan-500 flex-shrink-0" />
                  <span className="text-sm text-gray-700 truncate">{selected.phone}</span>
                </div>
                <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">
                  <Mail size={13} className="text-cyan-500 flex-shrink-0" />
                  <span className="text-sm text-gray-700 truncate">{selected.email || 'No email'}</span>
                </div>
              </div>
            </div>

            {/* Appointment history */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-50">
                <h3 className="text-sm font-bold text-gray-800">Appointment History</h3>
              </div>
              {appts.length === 0 ? (
                <div className="px-4 py-6 text-center">
                  <Calendar size={24} className="mx-auto mb-2 text-gray-200" />
                  <p className="text-sm text-gray-400">No appointments found</p>
                </div>
              ) : appts.map((a: any) => {
                const d = new Date(a.startAt)
                const statusColor: Record<string, string> = {
                  CONFIRMED: 'text-blue-600 bg-blue-50',
                  COMPLETED: 'text-emerald-600 bg-emerald-50',
                  CANCELLED: 'text-red-500 bg-red-50',
                  PENDING: 'text-amber-600 bg-amber-50',
                }
                return (
                  <div key={a.id} className="flex items-center gap-3 px-4 py-3 border-b border-gray-50 last:border-0">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-[10px] font-black flex-shrink-0"
                      style={{ background: a.service?.colour || '#29ABE2' }}>
                      {d.getDate()}<br />{d.toLocaleDateString('en-UG', { month: 'short' })}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{a.service?.name}</p>
                      <p className="text-xs text-gray-400">Dr. {a.doctor?.user?.firstName} · {d.toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit', hour12: true })}</p>
                    </div>
                    <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', statusColor[a.status] || 'bg-gray-50 text-gray-500')}>{a.status}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Add patient modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6 animate-fade-in">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-black text-gray-800">New Patient</h2>
              <button onClick={() => setShowAdd(false)} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-gray-100 transition-colors">
                <X size={16} className="text-gray-400" />
              </button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">First Name *</label>
                  <input value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} className={inputCls} placeholder="John" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Last Name *</label>
                  <input value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} className={inputCls} placeholder="Doe" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Phone *</label>
                <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className={inputCls} placeholder="+256 700 000 000" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Email</label>
                <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className={inputCls} placeholder="email@example.com" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Gender</label>
                  <select value={form.gender} onChange={e => setForm(f => ({ ...f, gender: e.target.value }))} className={inputCls}>
                    <option value="FEMALE">Female</option>
                    <option value="MALE">Male</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Date of Birth</label>
                  <input type="date" value={form.dob} onChange={e => setForm(f => ({ ...f, dob: e.target.value }))} className={inputCls} />
                </div>
              </div>
              {error && <p className="text-xs text-red-500 font-medium">{error}</p>}
              <div className="flex gap-3 pt-2">
                <button onClick={() => setShowAdd(false)} className="flex-1 py-3 rounded-xl border border-gray-200 text-sm font-bold text-gray-600 hover:bg-gray-50 transition-colors">Cancel</button>
                <button onClick={addPatient} disabled={saving}
                  className="flex-1 py-3 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5 hover:shadow-lg disabled:opacity-60"
                  style={{ background: 'linear-gradient(135deg,#0c1e50,#29ABE2)' }}>
                  {saving ? 'Adding...' : 'Add Patient'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
