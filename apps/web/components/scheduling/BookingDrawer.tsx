'use client'

import { useEffect, useState } from 'react'
import { X, Search, Loader2, Plus, User, Phone } from 'lucide-react'
import { cn, formatPhone } from '@/lib/utils'
import Avatar from '@/components/ui/Avatar'

interface Service  { id: string; name: string; durationMins: number; priceUGX: number; colour: string; category?: string; isActive?: boolean }
interface Doctor   { id: string; firstName: string; lastName: string; colour: string; specialisation?: string }
interface Patient  { id: string; firstName: string; lastName: string; phone: string }

interface Props {
  open:             boolean
  onClose:          () => void
  prefillDoctorId?:  string
  prefillStartAt?:   Date
  prefillPatient?:   Patient
  onBooked?:         () => void
}

export default function BookingDrawer({ open, onClose, prefillDoctorId, prefillStartAt, prefillPatient, onBooked }: Props) {
  const token   = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const API     = '/api-proxy'

  const [services,  setServices]  = useState<Service[]>([])
  const [doctors,   setDoctors]   = useState<Doctor[]>([])
  const [patients,  setPatients]  = useState<Patient[]>([])
  const [searching, setSearching] = useState(false)
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  // Form state
  const [patientQ,    setPatientQ]    = useState('')
  const [selPatient,  setSelPatient]  = useState<Patient | null>(null)
  const [selService,  setSelService]  = useState<Service | null>(null)
  const [selDoctor,   setSelDoctor]   = useState<Doctor | null>(null)
  const [selDate,     setSelDate]     = useState('')
  const [selTime,     setSelTime]     = useState('09:00')
  const [selDuration, setSelDuration] = useState(30)
  const [notes,       setNotes]       = useState('')
  const [showNewPt,   setShowNewPt]   = useState(false)

  // New patient form
  const [newFirst,    setNewFirst]    = useState('')
  const [newLast,     setNewLast]     = useState('')
  const [newPhone,    setNewPhone]    = useState('')
  const [newEmail,    setNewEmail]    = useState('')
  const [newGender,   setNewGender]   = useState('MALE')
  const [newDob,      setNewDob]      = useState('')
  const [newDistrict, setNewDistrict] = useState('')
  const [creatingPt, setCreatingPt] = useState(false)

  // On open — load services & doctors
  useEffect(() => {
    if (!open) return
    setError(null)
    // Pre-fill date/time from slot click
    if (prefillStartAt) {
      const eat = new Date(prefillStartAt.getTime() + 3 * 60 * 60 * 1000)
      setSelDate(eat.toISOString().slice(0, 10))
      const h = String(eat.getUTCHours()).padStart(2, '0')
      const m = String(eat.getUTCMinutes()).padStart(2, '0')
      setSelTime(`${h}:${m}`)
    } else {
      setSelDate(new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10))
    }

    // Pre-fill patient from follow-up booking
    if (prefillPatient) {
      setSelPatient(prefillPatient)
      setPatientQ(`${prefillPatient.firstName} ${prefillPatient.lastName}`)
    }

    fetch(`${API}/services`, { headers }).then((r) => r.json()).then((d) => setServices(Array.isArray(d) ? d : [])).catch(() => {})
    fetch(`${API}/doctors`, { headers }).then((r) => r.json()).then((d) => {
      const list = Array.isArray(d) ? d : []
      setDoctors(list)
      if (prefillDoctorId) {
        const doc = list.find((x: Doctor) => x.id === prefillDoctorId)
        if (doc) setSelDoctor(doc)
      }
    }).catch(() => {})
  }, [open])

  // Sync duration when service changes
  useEffect(() => { if (selService) setSelDuration(selService.durationMins) }, [selService])

  // Patient search
  useEffect(() => {
    if (!patientQ || patientQ.length < 2) { setPatients([]); return }
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const res  = await fetch(`${API}/patients?q=${encodeURIComponent(patientQ)}&limit=8`, { headers })
        const data = await res.json()
        setPatients(data.data || data || [])
      } catch { } finally { setSearching(false) }
    }, 300)
    return () => clearTimeout(t)
  }, [patientQ])

  async function createPatient() {
    if (!newFirst || !newLast || !newPhone) { setError('Name and phone are required'); return }
    setCreatingPt(true)
    try {
      const res  = await fetch(`${API}/patients`, {
        method: 'POST', headers,
        body: JSON.stringify({ firstName: newFirst, lastName: newLast, phone: newPhone, email: newEmail || undefined, gender: newGender, dob: newDob || undefined, district: newDistrict || undefined }),
      })
      const data = await res.json()
      if (res.ok) {
        setSelPatient(data)
        setPatientQ(`${data.firstName} ${data.lastName}`)
        setShowNewPt(false)
        setNewFirst(''); setNewLast(''); setNewPhone(''); setNewEmail(''); setNewDob(''); setNewDistrict('')
        setError(null)
      } else { setError(data.error || 'Failed to create patient') }
    } catch { setError('Network error') } finally { setCreatingPt(false) }
  }

  async function handleBook() {
    if (!selPatient)   { setError('Select a patient'); return }
    if (!selService)   { setError('Select a service'); return }
    if (!selDoctor)    { setError('Select a doctor'); return }
    if (!selDate)      { setError('Select a date'); return }
    setError(null)
    setLoading(true)
    try {
      const startAt = new Date(`${selDate}T${selTime}:00+03:00`).toISOString()
      const endAt   = new Date(new Date(startAt).getTime() + selDuration * 60000).toISOString()
      const res  = await fetch(`${API}/scheduling/appointments`, {
        method: 'POST', headers,
        body: JSON.stringify({ patientId: selPatient.id, doctorId: selDoctor.id, serviceId: selService.id, startAt, endAt, notes }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Booking failed'); return }
      window.dispatchEvent(new Event('appointment-updated'))
      onBooked?.()
      handleClose()
    } catch { setError('Network error') } finally { setLoading(false) }
  }

  function handleClose() {
    onClose()
    setTimeout(() => {
      setSelPatient(null); setSelService(null); setSelDoctor(null)
      setPatientQ(''); setPatients([]); setNotes(''); setError(null)
      setShowNewPt(false)
      setNewFirst(''); setNewLast(''); setNewPhone(''); setNewEmail(''); setNewDob(''); setNewDistrict('')
    }, 300)
  }

  // Group services by category
  const categories = [...new Set(services.map((s) => s.category || 'General'))].sort()

  const inputCls = "w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-clinic-blue/20 focus:border-clinic-blue focus:bg-white dark:focus:bg-gray-600 transition-all"

  return (
    <>
      {open && <div className="fixed inset-0 bg-black/30 z-40" onClick={handleClose} />}
      <div className={cn(
        'fixed right-0 top-0 bottom-0 w-full max-w-[420px] bg-white dark:bg-gray-900 shadow-2xl z-50 flex flex-col transition-transform duration-300',
        open ? 'translate-x-0' : 'translate-x-full',
      )}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/10">
          <div>
            <h2 className="text-base font-bold text-clinic-navy dark:text-white">New Appointment</h2>
            <p className="text-xs text-gray-400 mt-0.5">Book a patient visit</p>
          </div>
          <button onClick={handleClose} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-white/10 text-gray-400 transition-colors">
            <X size={17} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* ── Patient ── */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wide">Patient</label>
              <button
                onClick={() => setShowNewPt(!showNewPt)}
                className="flex items-center gap-1 text-xs font-semibold text-clinic-blue hover:text-clinic-navy transition-colors">
                <Plus size={12} /> New patient
              </button>
            </div>

            {/* New patient mini form — shown when toggled or when search returns 0 results */}
            {(showNewPt || (patientQ.length >= 2 && !searching && patients.length === 0 && !selPatient)) && (
              <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-xl space-y-2">
                <p className="text-xs font-semibold text-clinic-navy">
                  {patientQ.length >= 2 && !showNewPt && patients.length === 0
                    ? `No patient found for "${patientQ}" — create new?`
                    : 'Quick Add Patient'}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <input value={newFirst} onChange={(e) => setNewFirst(e.target.value)}
                    placeholder="First name *" className={cn(inputCls, 'text-xs py-2')} />
                  <input value={newLast} onChange={(e) => setNewLast(e.target.value)}
                    placeholder="Last name *" className={cn(inputCls, 'text-xs py-2')} />
                </div>
                <input value={newPhone} onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="+256... (required)" className={cn(inputCls, 'text-xs py-2')} />
                <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="Email (optional)" className={cn(inputCls, 'text-xs py-2')} />
                <div className="grid grid-cols-2 gap-2">
                  <input value={newDob} onChange={(e) => setNewDob(e.target.value)}
                    type="date" placeholder="Date of birth" className={cn(inputCls, 'text-xs py-2')} />
                  <input value={newDistrict} onChange={(e) => setNewDistrict(e.target.value)}
                    placeholder="District (optional)" className={cn(inputCls, 'text-xs py-2')} />
                </div>
                <select value={newGender} onChange={(e) => setNewGender(e.target.value)}
                  className={cn(inputCls, 'text-xs py-2')}>
                  <option value="MALE">Male</option>
                  <option value="FEMALE">Female</option>
                  <option value="OTHER">Other</option>
                </select>
                <button onClick={createPatient} disabled={creatingPt}
                  className="w-full py-2 bg-clinic-blue text-white text-xs font-bold rounded-lg hover:opacity-90 transition-opacity disabled:opacity-60 flex items-center justify-center gap-1">
                  {creatingPt ? <Loader2 size={12} className="animate-spin" /> : <User size={12} />}
                  Create & Select
                </button>
              </div>
            )}

            {/* Search */}
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={patientQ} onChange={(e) => setPatientQ(e.target.value)}
                placeholder="Search name or phone..."
                className={cn(inputCls, 'pl-9 pr-8')} />
              {searching && <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" />}
            </div>

            {/* Dropdown results */}
            {patients.length > 0 && !selPatient && (
              <div className="mt-1 border border-gray-200 dark:border-white/10 rounded-xl overflow-hidden shadow-lg bg-white dark:bg-gray-800">
                {patients.map((p) => (
                  <button key={p.id}
                    onClick={() => { setSelPatient(p); setPatientQ(`${p.firstName} ${p.lastName}`); setPatients([]) }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-blue-50 dark:hover:bg-white/5 transition-colors border-b border-gray-100 dark:border-white/5 last:border-0 text-left">
                    <Avatar firstName={p.firstName} lastName={p.lastName} size="sm" />
                    <div>
                      <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{p.firstName} {p.lastName}</p>
                      <p className="text-xs text-gray-400 flex items-center gap-1"><Phone size={10} />{p.phone}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Selected patient chip */}
            {selPatient && (
              <div className="mt-2 flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                <Avatar firstName={selPatient.firstName} lastName={selPatient.lastName} size="sm" colour="#10B981" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-emerald-800 truncate">{selPatient.firstName} {selPatient.lastName}</p>
                  <p className="text-xs text-emerald-600">{formatPhone(selPatient.phone)}</p>
                </div>
                <button onClick={() => { setSelPatient(null); setPatientQ('') }}
                  className="text-emerald-500 hover:text-emerald-700 transition-colors flex-shrink-0">
                  <X size={14} />
                </button>
              </div>
            )}
          </div>

          {/* ── Service ── */}
          <div>
            <label className="block text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-1.5">Service</label>
            {categories.map((cat) => (
              <div key={cat} className="mb-2">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">{cat}</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {services.filter((s) => (s.category || 'General') === cat && s.isActive !== false).map((s) => (
                    <button key={s.id} onClick={() => setSelService(s)}
                      className={cn(
                        'p-2.5 rounded-xl border-2 text-left transition-all',
                        selService?.id === s.id
                          ? 'border-clinic-blue bg-blue-50 dark:bg-blue-900/20'
                          : 'border-gray-200 dark:border-white/10 hover:border-gray-300 dark:hover:border-white/20 bg-white dark:bg-white/5',
                      )}>
                      <div className="w-5 h-5 rounded-lg mb-1.5" style={{ background: s.colour }} />
                      <p className="text-[11px] font-semibold text-gray-800 dark:text-gray-200 leading-tight">{s.name}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">{s.durationMins} min · {(s.priceUGX / 1000).toFixed(0)}k</p>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {selService && selService.priceUGX > 0 && (
              <p className="text-xs font-semibold text-clinic-blue dark:text-blue-400 mt-1.5">
                Fee: UGX {selService.priceUGX.toLocaleString()}
              </p>
            )}
          </div>

          {/* ── Doctor ── */}
          <div>
            <label className="block text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-1.5">Doctor</label>
            <div className="grid grid-cols-2 gap-1.5">
              {doctors.map((d) => (
                <button key={d.id} onClick={() => setSelDoctor(d)}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 text-left transition-all',
                    selDoctor?.id === d.id
                      ? 'border-clinic-blue bg-blue-50 dark:bg-blue-900/20'
                      : 'border-gray-200 dark:border-white/10 hover:border-gray-300 dark:hover:border-white/20 bg-white dark:bg-white/5',
                  )}>
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0"
                    style={{ background: d.colour }}>
                    {d.firstName[0]}{d.lastName[0]}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate">Dr. {d.firstName}</p>
                    {d.specialisation && <p className="text-[10px] text-gray-400 truncate">{d.specialisation.split(' ')[0]}</p>}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* ── Date & Time ── */}
          <div>
            <label className="block text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-1.5">Date & Time</label>
            <div className="grid grid-cols-2 gap-3">
              <input type="date" value={selDate} onChange={(e) => setSelDate(e.target.value)} className={inputCls} />
              <input type="time" value={selTime} onChange={(e) => setSelTime(e.target.value)} step="1800" className={inputCls} />
            </div>
          </div>

          {/* ── Duration ── */}
          <div>
            <label className="block text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-1.5">Duration</label>
            <div className="grid grid-cols-4 gap-1.5">
              {[10, 15, 20, 30, 45, 60, 90, 120].map((mins) => (
                <button key={mins} onClick={() => setSelDuration(mins)}
                  className={cn(
                    'py-2 rounded-xl border-2 text-xs font-semibold transition-all',
                    selDuration === mins
                      ? 'border-clinic-blue bg-blue-50 dark:bg-blue-900/20 text-clinic-blue'
                      : 'border-gray-200 dark:border-white/10 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-white/20',
                  )}>
                  {mins < 60 ? `${mins}m` : `${mins / 60}h`}
                </button>
              ))}
            </div>
          </div>

          {/* ── Notes ── */}
          <div>
            <label className="block text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-1.5">Notes (optional)</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
              placeholder="Special instructions or clinical notes..."
              className={cn(inputCls, 'resize-none')} />
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>
          )}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 px-5 py-4 border-t border-gray-100 dark:border-white/10 space-y-2">
          {/* Summary row */}
          {(selPatient || selService || selDoctor) && (
            <div className="flex items-center gap-2 text-xs text-gray-500 mb-3 flex-wrap">
              {selPatient && <span className="bg-gray-100 dark:bg-white/10 dark:text-gray-300 px-2 py-1 rounded-lg font-medium">{selPatient.firstName} {selPatient.lastName}</span>}
              {selService && <span className="px-2 py-1 rounded-lg font-medium text-white" style={{ background: selService.colour }}>{selService.name}</span>}
              {selDoctor  && <span className="bg-gray-100 dark:bg-white/10 dark:text-gray-300 px-2 py-1 rounded-lg font-medium">Dr. {selDoctor.firstName}</span>}
              {selDate    && <span className="bg-gray-100 dark:bg-white/10 dark:text-gray-300 px-2 py-1 rounded-lg font-medium">{selDate} {selTime}</span>}
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={handleClose}
              className="px-4 py-3 text-sm font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-white/10 rounded-xl transition-colors">
              Cancel
            </button>
            <button onClick={handleBook} disabled={loading || !selPatient || !selService || !selDoctor || !selDate}
              className="flex-1 py-3 text-sm font-bold text-white rounded-xl transition-all hover:shadow-lg hover:-translate-y-0.5 disabled:opacity-50 disabled:transform-none flex items-center justify-center gap-2"
              style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)', boxShadow: '0 4px 14px rgba(41,171,226,0.3)' }}>
              {loading && <Loader2 size={14} className="animate-spin" />}
              {loading ? 'Booking...' : 'Confirm Booking'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
