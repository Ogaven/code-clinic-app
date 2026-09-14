'use client'

// Same-day Waitlist (Part 7/8) — explicit per-patient requests, additive and
// self-contained; does not touch the existing Scheduling/Appointments UI.

import { useEffect, useState } from 'react'
import { Plus, Search, X, CheckCircle2, AlertCircle, Loader2, ListChecks, Pause, Check, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'

const API = '/api-proxy'
const token = () => typeof window !== 'undefined' ? localStorage.getItem('cc_token') : ''
const authHeaders = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` })

interface WaitlistEntry {
  id: string
  patient: { id: string; firstName: string; lastName: string; phone: string }
  service: { id: string; name: string }
  preferredDoctor: { id: string; user: { firstName: string; lastName: string } } | null
  preferredDateFrom: string | null
  preferredDateTo: string | null
  timePreference: string | null
  notes: string | null
  requestedAt: string
}

interface Service { id: string; name: string }
interface Doctor { id: string; user: { firstName: string; lastName: string } }
interface PatientHit { id: string; firstName: string; lastName: string; phone: string }

export default function WaitlistPage() {
  const [entries, setEntries] = useState<WaitlistEntry[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [saving, setSaving] = useState(false)

  const [patientQuery, setPatientQuery] = useState('')
  const [patientResults, setPatientResults] = useState<PatientHit[]>([])
  const [form, setForm] = useState({
    patientId: '', patientLabel: '', serviceId: '', preferredDoctorId: '', preferredDateFrom: '', preferredDateTo: '', timePreference: '', notes: '',
  })

  function showToast(msg: string, ok = true) { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500) }

  function load() {
    setLoading(true)
    fetch(`${API}/crm-automation/waitlist`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : [])
      .then(d => setEntries(Array.isArray(d) ? d : []))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    fetch(`${API}/services`, { headers: authHeaders() }).then(r => r.ok ? r.json() : []).then(d => setServices(Array.isArray(d) ? d : (d?.services ?? [])))
    fetch(`${API}/doctors`, { headers: authHeaders() }).then(r => r.ok ? r.json() : []).then(d => setDoctors(Array.isArray(d) ? d : []))
  }, [])

  useEffect(() => {
    if (patientQuery.trim().length < 2) { setPatientResults([]); return }
    const t = setTimeout(() => {
      fetch(`${API}/patients?q=${encodeURIComponent(patientQuery)}`, { headers: authHeaders() })
        .then(r => r.ok ? r.json() : [])
        .then(d => setPatientResults(Array.isArray(d) ? d.slice(0, 8) : (d?.patients ?? []).slice(0, 8)))
        .catch(() => {})
    }, 250)
    return () => clearTimeout(t)
  }, [patientQuery])

  async function addEntry() {
    if (!form.patientId || !form.serviceId) { showToast('Patient and service are required', false); return }
    setSaving(true)
    try {
      const r = await fetch(`${API}/crm-automation/waitlist`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({
          patientId: form.patientId, serviceId: form.serviceId,
          preferredDoctorId: form.preferredDoctorId || undefined,
          preferredDateFrom: form.preferredDateFrom || undefined,
          preferredDateTo: form.preferredDateTo || undefined,
          timePreference: form.timePreference || undefined,
          notes: form.notes || undefined,
        }),
      })
      if (r.ok) {
        showToast('Added to waitlist')
        setShowAdd(false)
        setForm({ patientId: '', patientLabel: '', serviceId: '', preferredDoctorId: '', preferredDateFrom: '', preferredDateTo: '', timePreference: '', notes: '' })
        setPatientQuery('')
        load()
      } else { const d = await r.json(); showToast(d.error || 'Failed to add', false) }
    } catch { showToast('Network error', false) }
    setSaving(false)
  }

  async function pauseEntry(id: string) {
    await fetch(`${API}/crm-automation/waitlist/${id}/pause`, { method: 'POST', headers: authHeaders() })
    showToast('Request paused'); load()
  }
  async function cancelEntry(id: string) {
    if (!confirm('Remove this waitlist request?')) return
    await fetch(`${API}/crm-automation/waitlist/${id}/cancel`, { method: 'POST', headers: authHeaders() })
    showToast('Request removed'); load()
  }
  async function fulfillEntry(id: string) {
    await fetch(`${API}/crm-automation/waitlist/${id}/fulfilled`, { method: 'POST', headers: authHeaders() })
    showToast('Marked fulfilled'); load()
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-4xl">
      {toast && (
        <div className={cn('fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-2xl shadow-xl text-sm font-bold text-white', toast.ok ? 'bg-emerald-500' : 'bg-red-500')}>
          {toast.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          {toast.msg}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-gray-800 dark:text-white flex items-center gap-2"><ListChecks size={20} className="text-cyan-500" /> Same-Day Waitlist</h1>
          <p className="text-xs text-gray-400 mt-0.5">Explicit patient requests — used to safely target who gets notified when a slot opens up</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white bg-cyan-600 hover:bg-cyan-700 transition-colors">
          <Plus size={14} /> Add to Waitlist
        </button>
      </div>

      {loading ? <div className="flex justify-center py-10"><Loader2 className="animate-spin text-gray-400" /></div> : (
        <div className="space-y-2">
          {entries.length === 0 && <p className="text-sm text-gray-400 text-center py-10 bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10">No active waitlist requests.</p>}
          {entries.map(e => (
            <div key={e.id} className="bg-white dark:bg-white/5 border border-gray-100 dark:border-white/10 rounded-2xl p-4 flex items-center justify-between gap-4">
              <div>
                <p className="font-bold text-sm text-gray-800 dark:text-white">{e.patient.firstName} {e.patient.lastName} <span className="text-gray-400 font-normal text-xs">— {e.service.name}</span></p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {e.preferredDoctor ? `Dr ${e.preferredDoctor.user.firstName} ${e.preferredDoctor.user.lastName} · ` : ''}
                  {e.preferredDateFrom || e.preferredDateTo ? `${e.preferredDateFrom ? new Date(e.preferredDateFrom).toLocaleDateString() : '…'} – ${e.preferredDateTo ? new Date(e.preferredDateTo).toLocaleDateString() : '…'} · ` : ''}
                  {e.timePreference ? `${e.timePreference} · ` : ''}
                  Requested {new Date(e.requestedAt).toLocaleDateString()}
                </p>
                {e.notes && <p className="text-xs text-gray-400 italic mt-1">{e.notes}</p>}
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button onClick={() => fulfillEntry(e.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20" title="Mark fulfilled">
                  <Check size={14} />
                </button>
                <button onClick={() => pauseEntry(e.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20" title="Pause">
                  <Pause size={14} />
                </button>
                <button onClick={() => cancelEntry(e.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20" title="Remove">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowAdd(false)}>
          <div className="bg-white dark:bg-[#152040] rounded-3xl shadow-2xl w-full max-w-md p-6 space-y-4 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-800 dark:text-white">Add to Waitlist</h2>
              <button onClick={() => setShowAdd(false)}><X size={18} className="text-gray-400" /></button>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Patient</label>
              {form.patientId ? (
                <div className="flex items-center justify-between px-3 py-2 text-sm border border-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-xl">
                  {form.patientLabel}
                  <button onClick={() => setForm(f => ({ ...f, patientId: '', patientLabel: '' }))}><X size={14} className="text-gray-400" /></button>
                </div>
              ) : (
                <div className="relative">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input value={patientQuery} onChange={e => setPatientQuery(e.target.value)} placeholder="Search patient by name or phone…"
                    className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-xl" />
                  {patientResults.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full bg-white dark:bg-[#152040] border border-gray-200 dark:border-white/10 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                      {patientResults.map(p => (
                        <button key={p.id} onClick={() => { setForm(f => ({ ...f, patientId: p.id, patientLabel: `${p.firstName} ${p.lastName} (${p.phone})` })); setPatientQuery('') }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-white/10 text-gray-700 dark:text-white/70">
                          {p.firstName} {p.lastName} — {p.phone}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Service</label>
              <select value={form.serviceId} onChange={e => setForm(f => ({ ...f, serviceId: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-xl">
                <option value="">Select a service…</option>
                {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Preferred Doctor (optional)</label>
              <select value={form.preferredDoctorId} onChange={e => setForm(f => ({ ...f, preferredDoctorId: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-xl">
                <option value="">Any doctor</option>
                {doctors.map(d => <option key={d.id} value={d.id}>Dr {d.user.firstName} {d.user.lastName}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">From (optional)</label>
                <input type="date" value={form.preferredDateFrom} onChange={e => setForm(f => ({ ...f, preferredDateFrom: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-xl" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">To (optional)</label>
                <input type="date" value={form.preferredDateTo} onChange={e => setForm(f => ({ ...f, preferredDateTo: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-xl" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Time preference (optional)</label>
              <input value={form.timePreference} onChange={e => setForm(f => ({ ...f, timePreference: e.target.value }))} placeholder="e.g. mornings, after 3pm"
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-xl" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Notes (optional)</label>
              <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-xl" />
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setShowAdd(false)} className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-white/10 text-sm font-bold text-gray-600 dark:text-white/60">Cancel</button>
              <button onClick={addEntry} disabled={saving} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white bg-cyan-600 hover:bg-cyan-700 disabled:opacity-60">
                {saving ? 'Saving…' : 'Add to Waitlist'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
