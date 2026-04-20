'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Stethoscope, Users, Plus, Edit2, Trash2, Save, X,
  CheckCircle2, AlertCircle, Clock, DollarSign, Palette,
  Phone, Mail, User,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type STab = 'services' | 'doctors'

function Toast({ msg, type, onClose }: { msg: string; type: 'ok' | 'err'; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 3500); return () => clearTimeout(t) }, [onClose])
  return (
    <div className={cn('fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-2xl shadow-xl text-sm font-bold animate-fade-in',
      type === 'ok' ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white')}>
      {type === 'ok' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
      {msg}
    </div>
  )
}

const SERVICE_COLORS = [
  '#29ABE2','#1A237E','#9B59B6','#E74C3C','#2ECC71','#F39C12',
  '#1ABC9C','#E67E22','#3498DB','#E91E63','#FF5722','#607D8B',
]

// ── Service Form ─────────────────────────────────────────────
function ServiceForm({ svc, onSave, onCancel }: { svc?: any; onSave: (d: any) => void; onCancel: () => void }) {
  const [name,     setName]     = useState(svc?.name     || '')
  const [desc,     setDesc]     = useState(svc?.description || '')
  const [duration, setDuration] = useState(svc?.duration  || 30)
  const [price,    setPrice]    = useState(svc?.price     || 0)
  const [colour,   setColour]   = useState(svc?.colour    || '#29ABE2')
  const [active,   setActive]   = useState(svc?.isActive  !== false)
  const [saving,   setSaving]   = useState(false)

  async function save() {
    if (!name.trim()) return
    setSaving(true)
    await onSave({ name: name.trim(), description: desc.trim(), duration: Number(duration), price: Number(price), colour, isActive: active })
    setSaving(false)
  }

  const inputCls = 'w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all'

  return (
    <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm p-5 space-y-4">
      <h3 className="text-sm font-black text-gray-800 dark:text-white">{svc ? 'Edit Service' : 'New Service'}</h3>
      <div>
        <label className="text-xs font-bold text-gray-500 dark:text-white/50 mb-1 block">Service Name *</label>
        <input value={name} onChange={e => setName(e.target.value)} className={inputCls} placeholder="e.g. Dental Cleaning" />
      </div>
      <div>
        <label className="text-xs font-bold text-gray-500 dark:text-white/50 mb-1 block">Description</label>
        <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2} className={cn(inputCls,'resize-none')} placeholder="Brief service description..." />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-bold text-gray-500 dark:text-white/50 mb-1 block">Duration (minutes)</label>
          <input type="number" min={5} step={5} value={duration} onChange={e => setDuration(Number(e.target.value))} className={inputCls} />
        </div>
        <div>
          <label className="text-xs font-bold text-gray-500 dark:text-white/50 mb-1 block">Price (UGX)</label>
          <input type="number" min={0} value={price} onChange={e => setPrice(Number(e.target.value))} className={inputCls} />
        </div>
      </div>
      <div>
        <label className="text-xs font-bold text-gray-500 dark:text-white/50 mb-2 block">Colour</label>
        <div className="flex flex-wrap gap-2">
          {SERVICE_COLORS.map(c => (
            <button key={c} onClick={() => setColour(c)} type="button"
              className={cn('w-7 h-7 rounded-lg transition-all hover:scale-110', colour === c && 'ring-2 ring-offset-2 ring-gray-400 scale-110')}
              style={{ background: c }} />
          ))}
          <input type="color" value={colour} onChange={e => setColour(e.target.value)} className="w-7 h-7 rounded-lg cursor-pointer border-0 p-0" title="Custom colour" />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <label className="text-sm font-semibold text-gray-700 dark:text-white/70">Active</label>
        <button onClick={() => setActive(a => !a)} type="button"
          className={cn('w-11 h-6 rounded-full transition-all relative', active ? 'bg-cyan-500' : 'bg-gray-200 dark:bg-white/10')}>
          <span className={cn('absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all', active ? 'left-6' : 'left-1')} />
        </button>
      </div>
      <div className="flex gap-3 pt-1">
        <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-white/10 text-sm font-bold text-gray-600 dark:text-white/60 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">Cancel</button>
        <button onClick={save} disabled={saving || !name.trim()}
          className="flex-1 py-2.5 rounded-xl text-sm font-black text-white disabled:opacity-50 transition-all"
          style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
          {saving ? 'Saving...' : <><Save size={13} className="inline mr-1" />{svc ? 'Update' : 'Create'}</>}
        </button>
      </div>
    </div>
  )
}

// ── Doctor Form ──────────────────────────────────────────────
function DoctorCard({ doctor, onEdit }: { doctor: any; onEdit: () => void }) {
  const initials = `${doctor.user?.firstName?.[0] || ''}${doctor.user?.lastName?.[0] || ''}`
  return (
    <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm p-4 flex items-center gap-4 hover:shadow-md transition-all group">
      <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-white font-bold text-base flex-shrink-0"
        style={{ background: doctor.colour || 'linear-gradient(135deg,#29ABE2,#1A237E)' }}>
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-gray-800 dark:text-white">Dr. {doctor.user?.firstName} {doctor.user?.lastName}</p>
        <p className="text-xs text-cyan-600 dark:text-cyan-400 font-semibold">{doctor.specialisation || 'General Dentist'}</p>
        {doctor.user?.email && (
          <p className="text-xs text-gray-400 dark:text-white/40 flex items-center gap-1 mt-0.5">
            <Mail size={10} /> {doctor.user.email}
          </p>
        )}
        {doctor.user?.phone && (
          <p className="text-xs text-gray-400 dark:text-white/40 flex items-center gap-1">
            <Phone size={10} /> {doctor.user.phone}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={onEdit}
          className="w-8 h-8 rounded-xl flex items-center justify-center bg-gray-100 dark:bg-white/10 hover:bg-cyan-100 dark:hover:bg-cyan-900/30 transition-colors">
          <Edit2 size={13} className="text-gray-500 dark:text-white/50" />
        </button>
      </div>
    </div>
  )
}

function DoctorEditForm({ doctor, onSave, onCancel }: { doctor: any; onSave: (d: any) => void; onCancel: () => void }) {
  const [spec,    setSpec]    = useState(doctor.specialisation || '')
  const [colour,  setColour]  = useState(doctor.colour        || '#29ABE2')
  const [saving,  setSaving]  = useState(false)

  async function save() {
    setSaving(true)
    await onSave({ specialisation: spec.trim(), colour })
    setSaving(false)
  }

  const inputCls = 'w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all'

  return (
    <div className="bg-white dark:bg-white/5 rounded-2xl border border-cyan-200 dark:border-cyan-500/30 shadow-sm p-4 space-y-3">
      <p className="text-sm font-bold text-gray-800 dark:text-white">Edit Dr. {doctor.user?.firstName} {doctor.user?.lastName}</p>
      <div>
        <label className="text-xs font-bold text-gray-500 dark:text-white/50 mb-1 block">Specialisation</label>
        <input value={spec} onChange={e => setSpec(e.target.value)} className={inputCls} placeholder="e.g. Orthodontist" />
      </div>
      <div>
        <label className="text-xs font-bold text-gray-500 dark:text-white/50 mb-2 block">Calendar Colour</label>
        <div className="flex flex-wrap gap-2">
          {SERVICE_COLORS.map(c => (
            <button key={c} onClick={() => setColour(c)} type="button"
              className={cn('w-6 h-6 rounded-lg transition-all hover:scale-110', colour === c && 'ring-2 ring-offset-1 ring-gray-400 scale-110')}
              style={{ background: c }} />
          ))}
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={onCancel} className="flex-1 py-2 rounded-xl border border-gray-200 dark:border-white/10 text-xs font-bold text-gray-500 dark:text-white/50 hover:bg-gray-50 dark:hover:bg-white/5">Cancel</button>
        <button onClick={save} disabled={saving}
          className="flex-1 py-2 rounded-xl text-xs font-black text-white disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────
export default function ServicesPage() {
  const API = '/api-proxy'
  const [tab, setTab]           = useState<STab>('services')
  const [services, setServices] = useState<any[]>([])
  const [doctors,  setDoctors]  = useState<any[]>([])
  const [loading,  setLoading]  = useState(true)
  const [showAdd,  setShowAdd]  = useState(false)
  const [editSvc,  setEditSvc]  = useState<any>(null)
  const [editDoc,  setEditDoc]  = useState<string | null>(null)
  const [toast,    setToast]    = useState<{ msg: string; type: 'ok' | 'err' } | null>(null)

  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const authH = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  const fetchAll = useCallback(async () => {
    try {
      const [s, d] = await Promise.all([
        fetch(`${API}/services`, { headers: authH }).then(r => r.json()),
        fetch(`${API}/doctors`,  { headers: authH }).then(r => r.json()),
      ])
      setServices(Array.isArray(s) ? s : s.data || [])
      setDoctors(Array.isArray(d) ? d : d.data || [])
    } catch {} finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  function showToast(msg: string, type: 'ok' | 'err') { setToast({ msg, type }) }

  async function createService(data: any) {
    try {
      const res = await fetch(`${API}/services`, { method: 'POST', headers: authH, body: JSON.stringify(data) })
      if (res.ok) { showToast('Service created', 'ok'); setShowAdd(false); fetchAll() }
      else showToast('Failed to create service', 'err')
    } catch { showToast('Network error', 'err') }
  }

  async function updateService(id: string, data: any) {
    try {
      const res = await fetch(`${API}/services/${id}`, { method: 'PATCH', headers: authH, body: JSON.stringify(data) })
      if (res.ok) { showToast('Service updated', 'ok'); setEditSvc(null); fetchAll() }
      else showToast('Failed to update', 'err')
    } catch { showToast('Network error', 'err') }
  }

  async function deleteService(id: string) {
    if (!confirm('Delete this service?')) return
    try {
      const res = await fetch(`${API}/services/${id}`, { method: 'DELETE', headers: authH })
      if (res.ok) { showToast('Service deleted', 'ok'); fetchAll() }
      else showToast('Cannot delete — service may be in use', 'err')
    } catch { showToast('Network error', 'err') }
  }

  async function updateDoctor(id: string, data: any) {
    try {
      const res = await fetch(`${API}/doctors/${id}`, { method: 'PATCH', headers: authH, body: JSON.stringify(data) })
      if (res.ok) { showToast('Doctor updated', 'ok'); setEditDoc(null); fetchAll() }
      else showToast('Failed to update', 'err')
    } catch { showToast('Network error', 'err') }
  }

  return (
    <div className="p-5 max-w-4xl mx-auto space-y-5">
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-800 dark:text-white">Services & Doctors</h1>
          <p className="text-xs text-gray-400 dark:text-white/40 mt-0.5">Manage clinic services and doctor profiles</p>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-2 bg-gray-100 dark:bg-white/5 rounded-2xl p-1 w-fit">
        {[
          { key: 'services' as STab, label: 'Services', icon: Stethoscope },
          { key: 'doctors'  as STab, label: 'Doctors',  icon: Users       },
        ].map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={cn(
              'flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all',
              tab === key
                ? 'bg-white dark:bg-white/10 text-gray-800 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-white/40 hover:text-gray-700 dark:hover:text-white/70',
            )}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-10 h-10 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : tab === 'services' ? (
        <div className="space-y-4">
          {/* Add service */}
          {!showAdd && !editSvc && (
            <button onClick={() => setShowAdd(true)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-black text-white hover:-translate-y-0.5 transition-all"
              style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
              <Plus size={15} /> Add Service
            </button>
          )}
          {showAdd  && <ServiceForm onSave={createService} onCancel={() => setShowAdd(false)} />}

          {/* Services grid */}
          <div className="grid gap-3 sm:grid-cols-2">
            {services.map(s => (
              editSvc?.id === s.id ? (
                <ServiceForm key={s.id} svc={s} onSave={(d) => updateService(s.id, d)} onCancel={() => setEditSvc(null)} />
              ) : (
                <div key={s.id} className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm p-4 hover:shadow-md transition-all group">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: s.colour || '#29ABE2' }}>
                        <Stethoscope size={16} className="text-white" />
                      </div>
                      <div>
                        <p className="font-bold text-gray-800 dark:text-white text-sm">{s.name}</p>
                        {s.description && <p className="text-xs text-gray-400 dark:text-white/40 truncate max-w-[160px]">{s.description}</p>}
                      </div>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => setEditSvc(s)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center bg-gray-100 dark:bg-white/10 hover:bg-cyan-100 dark:hover:bg-cyan-900/30 transition-colors">
                        <Edit2 size={12} className="text-gray-500 dark:text-white/50" />
                      </button>
                      <button onClick={() => deleteService(s.id)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center bg-gray-100 dark:bg-white/10 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors">
                        <Trash2 size={12} className="text-gray-500 hover:text-red-500 transition-colors" />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-white/50">
                      <Clock size={11} /> {s.duration || 30}min
                    </span>
                    {s.price > 0 && (
                      <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-white/50">
                        <DollarSign size={11} /> UGX {s.price?.toLocaleString()}
                      </span>
                    )}
                    <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full',
                      s.isActive !== false ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-gray-100 text-gray-500')}>
                      {s.isActive !== false ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                </div>
              )
            ))}
          </div>

          {services.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Stethoscope size={40} className="text-gray-200 dark:text-white/10 mb-3" />
              <p className="text-gray-400">No services configured yet</p>
              <button onClick={() => setShowAdd(true)} className="mt-3 text-sm text-cyan-600 hover:underline">Add your first service</button>
            </div>
          )}
        </div>
      ) : (
        /* Doctors tab */
        <div className="space-y-3">
          <p className="text-xs text-gray-400 dark:text-white/40">To add or remove doctors, use the Admin panel. You can update specialisation and calendar colour here.</p>
          {doctors.map(d => (
            editDoc === d.id ? (
              <DoctorEditForm key={d.id} doctor={d} onSave={(data) => updateDoctor(d.id, data)} onCancel={() => setEditDoc(null)} />
            ) : (
              <DoctorCard key={d.id} doctor={d} onEdit={() => setEditDoc(d.id)} />
            )
          ))}
          {doctors.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Users size={40} className="text-gray-200 dark:text-white/10 mb-3" />
              <p className="text-gray-400">No doctors found</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
