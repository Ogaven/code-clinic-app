'use client'

import { useEffect, useState, useRef } from 'react'
import { Loader2, Save, Camera, Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Doctor {
  id: string; userId: string
  firstName: string; lastName: string
  email: string; phone?: string
  specialisation?: string
  colour: string
  workingDays: string
  workingHours: string
  serviceIds?: string
  avatarUrl?: string | null
  isActive: boolean
}

interface Service {
  id: string; name: string; category: string; colour: string; isActive: boolean
}

interface DaySchedule { active: boolean; start: string; end: string }

const DAYS    = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const COLOURS = ['#4A90D9','#E8A838','#9B59B6','#2ECC71','#E74C3C','#1ABC9C','#F39C12','#3498DB','#29ABE2','#E91E63']
const CATEGORIES = ['Consultation','Preventive','Restorative','Periodontal','Endodontics','Oral Surgery','Cosmetic','Orthodontics','Prosthodontics','Paediatric','General']

const inputCls = [
  'w-full px-3 py-2.5 text-sm border rounded-xl transition-all',
  'border-gray-200 bg-gray-50 text-gray-800',
  'focus:outline-none focus:ring-2 focus:ring-clinic-blue/20 focus:border-clinic-blue focus:bg-white',
  'dark:border-white/10 dark:bg-white/5 dark:text-gray-100',
  'dark:focus:border-clinic-blue dark:focus:bg-white/10',
].join(' ')

function parseSchedule(workingDays: string, workingHours: string): DaySchedule[] {
  let days: number[] = [1,2,3,4,5]
  let hours: any = { start: '08:00', end: '18:00' }
  try { days  = JSON.parse(workingDays) } catch {}
  try { hours = JSON.parse(workingHours) } catch {}
  // Determine if it's per-day format (keys are "0"-"6") or legacy global {start, end}
  const isPerDay = hours['1'] !== undefined || hours['0'] !== undefined

  return DAYS.map((_, i) => {
    const active = days.includes(i)
    if (!active) return { active: false, start: '08:00', end: '18:00' }
    if (isPerDay && hours[String(i)]) {
      return { active: true, start: hours[String(i)].start, end: hours[String(i)].end }
    }
    // Legacy global format
    return { active: true, start: hours.start ?? '08:00', end: hours.end ?? '18:00' }
  })
}

export default function DoctorsTab() {
  const token   = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const authH   = { Authorization: `Bearer ${token}` }
  const jsonH   = { ...authH, 'Content-Type': 'application/json' }
  const API     = '/api-proxy'

  const [doctors,   setDoctors]   = useState<Doctor[]>([])
  const [services,  setServices]  = useState<Service[]>([])
  const [loading,   setLoading]   = useState(true)
  const [selected,  setSelected]  = useState<Doctor | null>(null)
  const [saving,    setSaving]    = useState(false)
  const [uploading, setUploading] = useState(false)
  const [toast,     setToast]     = useState<{ msg: string; ok: boolean } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Edit fields
  const [firstName,        setFirstName]        = useState('')
  const [lastName,         setLastName]         = useState('')
  const [email,            setEmail]            = useState('')
  const [phone,            setPhone]            = useState('')
  const [description,      setDescription]      = useState('')
  const [colour,           setColour]           = useState('#4A90D9')
  const [schedule,         setSchedule]         = useState<DaySchedule[]>(
    DAYS.map((_, i) => ({ active: i >= 1 && i <= 5, start: '08:00', end: '18:00' }))
  )
  const [selectedServices, setSelectedServices] = useState<string[]>([])
  const [localAvatar,      setLocalAvatar]      = useState<string | null>(null)

  useEffect(() => {
    fetchDoctors()
    fetchServices()
  }, [])

  async function fetchDoctors() {
    setLoading(true)
    try {
      const res  = await fetch(`${API}/doctors`, { headers: jsonH })
      const data = await res.json()
      setDoctors(Array.isArray(data) ? data : [])
    } catch { } finally { setLoading(false) }
  }

  async function fetchServices() {
    try {
      const res  = await fetch(`${API}/services`, { headers: jsonH })
      const data = await res.json()
      setServices(Array.isArray(data) ? data : [])
    } catch { }
  }

  function selectDoctor(d: Doctor) {
    setSelected(d)
    setFirstName(d.firstName)
    setLastName(d.lastName)
    setEmail(d.email)
    setPhone(d.phone || '')
    setDescription(d.specialisation || '')
    setColour(d.colour)
    setSchedule(parseSchedule(d.workingDays, d.workingHours))
    setSelectedServices(d.serviceIds ? JSON.parse(d.serviceIds) : [])
    setLocalAvatar(d.avatarUrl || null)
  }

  async function handleSave() {
    if (!selected) return
    setSaving(true)
    try {
      const activeDays = schedule.map((d, i) => d.active ? i : -1).filter(i => i >= 0)
      const perDayHours: Record<string, { start: string; end: string }> = {}
      schedule.forEach((d, i) => {
        if (d.active) perDayHours[String(i)] = { start: d.start, end: d.end }
      })

      const res = await fetch(`${API}/doctors/${selected.id}`, {
        method: 'PATCH', headers: jsonH,
        body: JSON.stringify({
          firstName, lastName, phone, email, description, colour,
          workingDays: activeDays,
          workingHours: perDayHours,
          serviceIds: selectedServices,
        }),
      })
      if (res.ok) { showToast('Doctor updated', true); fetchDoctors() }
      else { const d = await res.json(); showToast(d.error || 'Update failed', false) }
    } catch { showToast('Network error', false) } finally { setSaving(false) }
  }

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !selected) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      showToast('Only JPG, PNG or WebP files allowed', false)
      return
    }
    setUploading(true)
    try {
      const form = new FormData()
      form.append('avatar', file)
      const res = await fetch(`${API}/doctors/${selected.id}/avatar`, {
        method: 'POST', headers: authH, body: form,
      })
      if (res.ok) {
        const { avatarUrl } = await res.json()
        setLocalAvatar(avatarUrl)
        showToast('Photo uploaded', true)
        fetchDoctors()
      } else {
        const d = await res.json().catch(() => ({}))
        showToast(d.error || 'Upload failed', false)
      }
    } catch { showToast('Upload failed', false) } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function toggleService(id: string) {
    setSelectedServices(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  function updateDay(i: number, patch: Partial<DaySchedule>) {
    setSchedule(prev => prev.map((d, idx) => idx === i ? { ...d, ...patch } : d))
  }

  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok }); setTimeout(() => setToast(null), 3000)
  }

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <Loader2 size={28} className="animate-spin text-clinic-blue" />
    </div>
  )

  const servicesByCategory = CATEGORIES.reduce<Record<string, Service[]>>((acc, cat) => {
    const list = services.filter(s => s.category === cat)
    if (list.length) acc[cat] = list
    return acc
  }, {})

  return (
    <div className="flex h-full">
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

      {/* Doctor list — left sidebar */}
      <div className="w-72 flex-shrink-0 border-r border-gray-100 dark:border-white/5 overflow-y-auto bg-gray-50/50 dark:bg-black/20">
        <div className="p-4 border-b border-gray-100 dark:border-white/5">
          <h3 className="text-sm font-bold text-clinic-navy dark:text-clinic-blue">Doctors ({doctors.length})</h3>
          <p className="text-xs text-gray-400 mt-0.5">Select to edit profile & schedule</p>
        </div>
        <div className="p-2 space-y-1">
          {doctors.map(d => (
            <button key={d.id} onClick={() => selectDoctor(d)}
              className={cn(
                'w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all',
                selected?.id === d.id
                  ? 'bg-white dark:bg-white/10 shadow-sm border border-clinic-blue/20 dark:border-clinic-blue/30'
                  : 'hover:bg-white dark:hover:bg-white/5 hover:shadow-sm',
              )}>
              {d.avatarUrl ? (
                <img src={d.avatarUrl} alt="" className="w-10 h-10 rounded-full object-cover flex-shrink-0 ring-2 ring-white dark:ring-white/10" />
              ) : (
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
                  style={{ background: d.colour }}>
                  {d.firstName[0]}{d.lastName[0]}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm font-bold text-clinic-navy dark:text-gray-100 truncate">Dr. {d.firstName} {d.lastName}</p>
                <p className="text-xs text-gray-400 truncate">{d.specialisation || 'General Dentistry'}</p>
                <p className="text-[10px] text-gray-300 dark:text-gray-600 mt-0.5">
                  {(() => {
                    try {
                      const days = JSON.parse(d.workingDays) as number[]
                      return days.map(n => ['Su','Mo','Tu','We','Th','Fr','Sa'][n]).join(' · ')
                    } catch { return 'Mon–Fri' }
                  })()}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Edit panel — right */}
      {selected ? (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-2xl space-y-6 pb-10">

            {/* ─── Profile: photo + name/email/phone ─── */}
            <div className="flex items-start gap-5">
              {/* Photo upload */}
              <div className="flex-shrink-0 flex flex-col items-center gap-1.5">
                <div className="relative group cursor-pointer" onClick={() => fileRef.current?.click()}>
                  <div className="w-24 h-24 rounded-2xl overflow-hidden shadow-lg"
                    style={{ background: colour }}>
                    {localAvatar ? (
                      <img src={localAvatar} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-white text-2xl font-bold">
                        {firstName[0]}{lastName[0]}
                      </div>
                    )}
                  </div>
                  {/* Camera overlay */}
                  <div className="absolute inset-0 rounded-2xl bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    {uploading
                      ? <Loader2 size={22} className="animate-spin text-white" />
                      : <Camera size={22} className="text-white" />
                    }
                  </div>
                </div>
                <p className="text-[10px] text-gray-400 text-center">Hover to change photo</p>
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                  onChange={handlePhotoUpload} />
              </div>

              {/* Name / email / phone grid */}
              <div className="flex-1 grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">First Name</label>
                  <input value={firstName} onChange={e => setFirstName(e.target.value)} className={inputCls} placeholder="First name" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Last Name</label>
                  <input value={lastName} onChange={e => setLastName(e.target.value)} className={inputCls} placeholder="Last name" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Email</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={inputCls} placeholder="email@codeclinic.ug" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Phone</label>
                  <input value={phone} onChange={e => setPhone(e.target.value)} className={inputCls} placeholder="+256 700 000 000" />
                </div>
              </div>
            </div>

            {/* ─── Description ─── */}
            <div>
              <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Description</label>
              <textarea value={description} onChange={e => setDescription(e.target.value)}
                rows={2} placeholder="Specialisation, experience, approach to patient care..."
                className={cn(inputCls, 'resize-none')} />
            </div>

            {/* ─── Calendar colour ─── */}
            <div>
              <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Calendar Colour</label>
              <div className="flex flex-wrap gap-2">
                {COLOURS.map(c => (
                  <button key={c} onClick={() => setColour(c)}
                    className="w-8 h-8 rounded-full transition-all hover:scale-110 border-2"
                    style={{
                      background: c,
                      borderColor: colour === c ? '#1A237E' : 'transparent',
                      boxShadow:   colour === c ? `0 0 0 3px ${c}44` : 'none',
                    }} />
                ))}
              </div>
            </div>

            {/* ─── Weekly schedule — SimplyBook style ─── */}
            <div>
              <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Weekly Schedule</label>
              <div className="rounded-2xl border border-gray-100 dark:border-white/8 overflow-hidden bg-white dark:bg-white/5 backdrop-blur-sm">
                {DAYS.map((day, i) => (
                  <div key={day} className={cn(
                    'flex items-center gap-4 px-4 py-3 transition-colors',
                    i > 0 && 'border-t border-gray-50 dark:border-white/5',
                    schedule[i].active ? 'bg-white dark:bg-white/5' : 'bg-gray-50/60 dark:bg-black/10',
                  )}>
                    {/* Toggle switch */}
                    <button
                      onClick={() => updateDay(i, { active: !schedule[i].active })}
                      className={cn(
                        'relative w-10 h-[22px] rounded-full flex-shrink-0 transition-all',
                        schedule[i].active ? 'bg-clinic-blue shadow-sm shadow-clinic-blue/30' : 'bg-gray-200 dark:bg-white/15',
                      )}>
                      <span className={cn(
                        'absolute top-[3px] w-4 h-4 rounded-full bg-white shadow-sm transition-all',
                        schedule[i].active ? 'left-[22px]' : 'left-[3px]',
                      )} />
                    </button>

                    {/* Day label */}
                    <span className={cn(
                      'text-xs font-bold w-7 flex-shrink-0 transition-colors',
                      schedule[i].active ? 'text-clinic-navy dark:text-gray-100' : 'text-gray-300 dark:text-gray-600',
                    )}>
                      {day}
                    </span>

                    {/* Time range */}
                    {schedule[i].active ? (
                      <div className="flex items-center gap-2 flex-1">
                        <input type="time" value={schedule[i].start}
                          onChange={e => updateDay(i, { start: e.target.value })}
                          className="px-2.5 py-1.5 text-xs font-semibold border border-gray-200 dark:border-white/10 rounded-lg bg-gray-50 dark:bg-white/10 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-clinic-blue/20 focus:border-clinic-blue transition-all" />
                        {/* Track line */}
                        <div className="flex-1 relative flex items-center">
                          <div className="w-full h-[3px] rounded-full" style={{ background: colour + '40' }} />
                          <div className="absolute inset-0 flex items-center">
                            <div className="h-[3px] rounded-full flex-1" style={{ background: colour }} />
                          </div>
                        </div>
                        <input type="time" value={schedule[i].end}
                          onChange={e => updateDay(i, { end: e.target.value })}
                          className="px-2.5 py-1.5 text-xs font-semibold border border-gray-200 dark:border-white/10 rounded-lg bg-gray-50 dark:bg-white/10 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-clinic-blue/20 focus:border-clinic-blue transition-all" />
                      </div>
                    ) : (
                      <div className="flex-1 flex items-center gap-2">
                        <div className="flex-1 h-[2px] bg-gray-100 dark:bg-white/5 rounded-full" />
                        <span className="text-xs text-gray-300 dark:text-gray-600 font-medium">Day off</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-2">
                Active days: <span className="font-semibold text-clinic-navy dark:text-clinic-blue">
                  {schedule.filter(d => d.active).length} / 7
                </span>
              </p>
            </div>

            {/* ─── Services offered ─── */}
            <div>
              <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Services Offered</label>
              <p className="text-xs text-gray-400 mb-3">Select which services this doctor performs</p>

              {Object.entries(servicesByCategory).map(([cat, list]) => (
                <div key={cat} className="mb-4">
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-300 dark:text-gray-600 mb-2">{cat}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {list.map(s => {
                      const active = selectedServices.includes(s.id)
                      return (
                        <button key={s.id} onClick={() => toggleService(s.id)}
                          className={cn(
                            'px-3 py-1 rounded-lg text-xs font-medium transition-all border',
                            active
                              ? 'text-white border-transparent shadow-sm'
                              : 'bg-gray-50 dark:bg-white/5 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-white/10 hover:border-gray-300 dark:hover:border-white/20',
                          )}
                          style={active ? { background: s.colour, borderColor: s.colour } : {}}>
                          {s.name}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}

              {selectedServices.length > 0 && (
                <p className="text-xs text-clinic-blue font-semibold">
                  ✓ {selectedServices.length} service{selectedServices.length > 1 ? 's' : ''} selected
                </p>
              )}
            </div>

            {/* ─── Save button ─── */}
            <div className="flex gap-3 pt-2">
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-white text-sm transition-all hover:-translate-y-0.5 hover:shadow-lg disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)', boxShadow: '0 4px 14px rgba(41,171,226,0.3)' }}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="text-6xl mb-4">👨‍⚕️</div>
            <p className="font-bold text-gray-500 dark:text-gray-400">Select a doctor</p>
            <p className="text-sm text-gray-400 mt-1">Edit profile, schedule & services</p>
          </div>
        </div>
      )}
    </div>
  )
}
