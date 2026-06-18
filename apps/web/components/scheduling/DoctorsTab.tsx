'use client'

import { useEffect, useState, useRef } from 'react'
import { Loader2, Save, Camera, Check, X, Plus, Ban, Trash2, AlertTriangle } from 'lucide-react'
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

interface BlockedTime { id: string; startAt: string; endAt: string; reason?: string }

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
  const token    = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const authH    = { Authorization: `Bearer ${token}` }
  const jsonH    = { ...authH, 'Content-Type': 'application/json' }
  const API      = '/api-proxy'

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

  // Delete doctor state
  const [deleteTarget,  setDeleteTarget]  = useState<Doctor | null>(null)
  const [deleteCount,   setDeleteCount]   = useState<number | null>(null)
  const [deleting,      setDeleting]      = useState(false)

  // Add doctor modal
  const [showAdd,   setShowAdd]   = useState(false)
  const [addSaving, setAddSaving] = useState(false)
  const [addPreview, setAddPreview] = useState<string | null>(null)
  const [addFile,   setAddFile]   = useState<File | null>(null)
  const [addForm,   setAddForm]   = useState({ firstName: '', lastName: '', email: '', phone: '', specialisation: '' })
  const addFileRef = useRef<HTMLInputElement>(null)

  // Active/inactive filter for sidebar
  const [showInactive, setShowInactive] = useState(false)

  // Block-time state
  const [blockedTimes, setBlockedTimes] = useState<BlockedTime[]>([])
  const [blkDate,      setBlkDate]      = useState('')
  const [blkStart,     setBlkStart]     = useState('09:00')
  const [blkEnd,       setBlkEnd]       = useState('10:00')
  const [blkReason,    setBlkReason]    = useState('')
  const [blkSaving,    setBlkSaving]    = useState(false)

  useEffect(() => {
    fetchDoctors()
    fetchServices()
  }, [])

  async function fetchDoctors() {
    setLoading(true)
    try {
      const res  = await fetch(`${API}/doctors/all`, { headers: jsonH })
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
    fetchBlockedTimes(d.id)
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

  async function fetchBlockedTimes(doctorId: string) {
    try {
      const res = await fetch(`${API}/scheduling/doctors/${doctorId}/block-time`, { headers: authH })
      if (res.ok) setBlockedTimes(await res.json())
      else setBlockedTimes([])
    } catch { setBlockedTimes([]) }
  }

  async function addBlock() {
    if (!selected || !blkDate || !blkStart || !blkEnd) return
    setBlkSaving(true)
    try {
      const startAt = new Date(`${blkDate}T${blkStart}`).toISOString()
      const endAt   = new Date(`${blkDate}T${blkEnd}`).toISOString()
      const res = await fetch(`${API}/scheduling/doctors/${selected.id}/block-time`, {
        method: 'POST', headers: jsonH,
        body: JSON.stringify({ startAt, endAt, reason: blkReason || undefined }),
      })
      if (res.ok) { showToast('Time blocked', true); fetchBlockedTimes(selected.id); setBlkReason('') }
      else showToast('Failed to block time', false)
    } catch { showToast('Network error', false) } finally { setBlkSaving(false) }
  }

  async function addDoctor(e: React.FormEvent) {
    e.preventDefault()
    if (!addForm.firstName || !addForm.lastName || !addForm.email) return
    setAddSaving(true)
    try {
      const res = await fetch(`${API}/doctors`, {
        method: 'POST', headers: jsonH,
        body: JSON.stringify(addForm),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        showToast(d.error || 'Failed to create doctor', false)
        return
      }
      const newDoc = await res.json()
      if (addFile) {
        const form = new FormData()
        form.append('avatar', addFile)
        await fetch(`${API}/doctors/${newDoc.id}/avatar`, { method: 'POST', headers: authH, body: form }).catch(() => {})
      }
      showToast('Doctor added', true)
      setShowAdd(false)
      setAddForm({ firstName: '', lastName: '', email: '', phone: '', specialisation: '' })
      setAddPreview(null); setAddFile(null)
      fetchDoctors()
    } catch { showToast('Network error', false) }
    finally { setAddSaving(false) }
  }

  async function deleteBlock(blockId: string) {
    if (!selected) return
    try {
      const res = await fetch(`${API}/scheduling/doctors/${selected.id}/block-time/${blockId}`, {
        method: 'DELETE', headers: authH,
      })
      if (res.ok) { showToast('Block removed', true); fetchBlockedTimes(selected.id) }
      else showToast('Failed to remove block', false)
    } catch { showToast('Network error', false) }
  }

  async function openDeleteConfirm(d: Doctor, e: React.MouseEvent) {
    e.stopPropagation()
    setDeleteTarget(d)
    setDeleteCount(null)
    try {
      const params = new URLSearchParams({ doctorId: d.id, startDate: '2000-01-01', endDate: '2099-12-31', limit: '1' })
      const res = await fetch(`${API}/scheduling/appointments?${params}`, { headers: authH })
      if (res.ok) {
        const data = await res.json()
        setDeleteCount(typeof data.total === 'number' ? data.total : (Array.isArray(data) ? data.length : 0))
      }
    } catch { setDeleteCount(0) }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`${API}/doctors/${deleteTarget.id}`, { method: 'DELETE', headers: authH })
      if (res.ok) {
        showToast(`Dr. ${deleteTarget.firstName} ${deleteTarget.lastName} deleted`, true)
        if (selected?.id === deleteTarget.id) setSelected(null)
        setDeleteTarget(null)
        fetchDoctors()
        window.dispatchEvent(new Event('doctor-updated'))
      } else {
        const d = await res.json().catch(() => ({}))
        showToast(d.error || 'Delete failed', false)
      }
    } catch { showToast('Network error', false) }
    finally { setDeleting(false) }
  }

  async function handleToggleActive() {
    if (!selected) return
    setSaving(true)
    try {
      const newActive = !selected.isActive
      const res = await fetch(`${API}/doctors/${selected.id}`, {
        method: 'PATCH', headers: jsonH,
        body: JSON.stringify({ isActive: newActive }),
      })
      if (res.ok) {
        showToast(newActive ? 'Doctor reactivated' : 'Doctor deactivated', true)
        setSelected(prev => prev ? { ...prev, isActive: newActive } : null)
        setDoctors(prev => prev.map(d => d.id === selected.id ? { ...d, isActive: newActive } : d))
        window.dispatchEvent(new Event('doctor-updated'))
      } else {
        const d = await res.json().catch(() => ({}))
        showToast(d.error || 'Update failed', false)
      }
    } catch { showToast('Network error', false) }
    finally { setSaving(false) }
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

  const activeDoctors   = doctors.filter(d => d.isActive)
  const inactiveCount   = doctors.filter(d => !d.isActive).length
  const displayedDoctors = showInactive ? doctors : activeDoctors

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

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#0f1729] rounded-2xl shadow-2xl w-full max-w-sm border border-red-100 dark:border-red-900/30 overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-red-100 dark:border-red-900/20">
              <div className="w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center flex-shrink-0">
                <AlertTriangle size={15} className="text-red-500" />
              </div>
              <h3 className="font-black text-gray-800 dark:text-white">Delete Doctor</h3>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-sm text-gray-700 dark:text-gray-200">
                Delete <span className="font-bold">Dr. {deleteTarget.firstName} {deleteTarget.lastName}</span>?
                This will permanently delete{' '}
                <span className="font-bold text-red-500">
                  {deleteCount === null ? '…' : `${deleteCount} appointment${deleteCount !== 1 ? 's' : ''}`}
                </span>.{' '}
                This cannot be undone.
              </p>
              <p className="text-xs text-gray-400">The doctor's user account and all their data will also be removed.</p>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 pb-5">
              <button onClick={() => setDeleteTarget(null)} disabled={deleting}
                className="px-4 py-2.5 rounded-xl text-sm font-bold text-gray-500 hover:bg-gray-100 dark:hover:bg-white/8 transition-colors disabled:opacity-50">
                Cancel
              </button>
              <button onClick={handleDelete} disabled={deleting || deleteCount === null}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white bg-red-500 hover:bg-red-600 disabled:opacity-50 transition-all hover:-translate-y-0.5">
                {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                {deleting ? 'Deleting…' : 'Delete Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Doctor modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <form onSubmit={addDoctor} className="bg-white dark:bg-[#0f1729] rounded-2xl shadow-2xl w-full max-w-md border border-gray-100 dark:border-white/10 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/8">
              <h3 className="font-black text-gray-800 dark:text-white">Add Doctor</h3>
              <button type="button" onClick={() => { setShowAdd(false); setAddPreview(null); setAddFile(null) }}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-white/8 transition-colors">
                <X size={15} className="text-gray-400" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {/* Photo preview */}
              <div className="flex items-center gap-4">
                <div className="relative group cursor-pointer flex-shrink-0" onClick={() => addFileRef.current?.click()}>
                  <div className="w-16 h-16 rounded-2xl overflow-hidden bg-gradient-to-br from-[#1A237E] to-[#29ABE2] flex items-center justify-center text-white font-bold text-lg">
                    {addPreview
                      ? <img src={addPreview} alt="" className="w-full h-full object-cover" />
                      : <span>{(addForm.firstName[0] || '') + (addForm.lastName[0] || '') || '+'}</span>
                    }
                  </div>
                  <div className="absolute inset-0 rounded-2xl bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <Camera size={16} className="text-white" />
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-600 dark:text-white/70">Profile photo (optional)</p>
                  <button type="button" onClick={() => addFileRef.current?.click()}
                    className="text-xs text-cyan-500 hover:text-cyan-600 mt-0.5">Choose photo</button>
                  <input ref={addFileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                    onChange={e => {
                      const f = e.target.files?.[0]
                      if (f) { setAddFile(f); setAddPreview(URL.createObjectURL(f)) }
                    }} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide mb-1 block">First Name *</label>
                  <input value={addForm.firstName} onChange={e => setAddForm(f => ({ ...f, firstName: e.target.value }))} required className={inputCls} placeholder="John" />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide mb-1 block">Last Name *</label>
                  <input value={addForm.lastName} onChange={e => setAddForm(f => ({ ...f, lastName: e.target.value }))} required className={inputCls} placeholder="Smith" />
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide mb-1 block">Email *</label>
                <input type="email" value={addForm.email} onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))} required className={inputCls} placeholder="doctor@codeclinic.ug" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide mb-1 block">Phone</label>
                  <input value={addForm.phone} onChange={e => setAddForm(f => ({ ...f, phone: e.target.value }))} className={inputCls} placeholder="+256 7xx xxx xxx" />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide mb-1 block">Specialization</label>
                  <input value={addForm.specialisation} onChange={e => setAddForm(f => ({ ...f, specialisation: e.target.value }))} className={inputCls} placeholder="General Dentistry" />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 pb-5">
              <button type="button" onClick={() => { setShowAdd(false); setAddPreview(null); setAddFile(null) }}
                className="px-4 py-2.5 rounded-xl text-sm font-bold text-gray-500 hover:bg-gray-100 dark:hover:bg-white/8 transition-colors">
                Cancel
              </button>
              <button type="submit" disabled={addSaving}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-60 transition-all hover:-translate-y-0.5"
                style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
                {addSaving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                {addSaving ? 'Adding...' : 'Add Doctor'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Doctor list — left sidebar */}
      <div className="w-72 flex-shrink-0 border-r border-gray-100 dark:border-white/5 overflow-y-auto bg-gray-50/50 dark:bg-black/20">
        <div className="p-4 border-b border-gray-100 dark:border-white/5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-clinic-navy dark:text-clinic-blue">Doctors ({activeDoctors.length})</h3>
              <p className="text-xs text-gray-400 mt-0.5">Select to edit profile & schedule</p>
              {inactiveCount > 0 && (
                <button onClick={() => setShowInactive(v => !v)}
                  className="text-[10px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 mt-1 underline underline-offset-2 transition-colors">
                  {showInactive ? 'Hide inactive' : `+${inactiveCount} inactive`}
                </button>
              )}
            </div>
            <button onClick={() => setShowAdd(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-bold text-white flex-shrink-0"
              style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
              <Plus size={11} /> Add
            </button>
          </div>
        </div>
        <div className="p-2 space-y-1">
          {displayedDoctors.map(d => (
            <div key={d.id} className={cn('relative group', !d.isActive && 'opacity-60')}>
              <button onClick={() => selectDoctor(d)}
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
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-bold text-clinic-navy dark:text-gray-100 truncate">Dr. {d.firstName} {d.lastName}</p>
                    {!d.isActive && (
                      <span className="text-[9px] px-1.5 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-500 rounded-full font-bold flex-shrink-0">Inactive</span>
                    )}
                  </div>
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
              <button
                onClick={e => openDeleteConfirm(d, e)}
                title="Delete doctor"
                className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-lg bg-red-50 dark:bg-red-900/20 text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-all">
                <Trash2 size={13} />
              </button>
            </div>
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
            <div className="flex flex-wrap gap-3 pt-2">
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-white text-sm transition-all hover:-translate-y-0.5 hover:shadow-lg disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)', boxShadow: '0 4px 14px rgba(41,171,226,0.3)' }}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save Changes
              </button>
              <button onClick={handleToggleActive} disabled={saving}
                className={cn(
                  'flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-bold border transition-all disabled:opacity-60',
                  selected.isActive
                    ? 'text-red-500 border-red-200 dark:border-red-900/30 hover:bg-red-50 dark:hover:bg-red-900/10'
                    : 'text-emerald-600 border-emerald-200 dark:border-emerald-900/30 hover:bg-emerald-50 dark:hover:bg-emerald-900/10',
                )}>
                {selected.isActive ? <><Ban size={14} /> Deactivate</> : <><Check size={14} /> Reactivate</>}
              </button>
            </div>

            {/* ─── Block Time Slots ─── */}
            <div className="pt-2">
              <div className="flex items-center gap-2 mb-1">
                <Ban size={14} className="text-red-400" />
                <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Block Time Slots</label>
              </div>
              <p className="text-xs text-gray-400 mb-3">Mark off times when this doctor is unavailable</p>

              <div className="bg-gray-50 dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/8 p-4 mb-3 space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">Date</label>
                    <input type="date" value={blkDate} onChange={e => setBlkDate(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">From</label>
                    <input type="time" value={blkStart} onChange={e => setBlkStart(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">To</label>
                    <input type="time" value={blkEnd} onChange={e => setBlkEnd(e.target.value)} className={inputCls} />
                  </div>
                </div>
                <input value={blkReason} onChange={e => setBlkReason(e.target.value)}
                  placeholder="Reason (optional — e.g. Lunch break, Training)" className={inputCls} />
                <button onClick={addBlock} disabled={blkSaving || !blkDate}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-white disabled:opacity-50 transition-all hover:-translate-y-0.5"
                  style={{ background: 'linear-gradient(135deg,#dc2626,#ef4444)', boxShadow: '0 4px 12px rgba(239,68,68,0.25)' }}>
                  {blkSaving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                  Block This Time
                </button>
              </div>

              {blockedTimes.length > 0 ? (
                <div className="space-y-2">
                  {blockedTimes.map(b => {
                    const start = new Date(b.startAt)
                    const end   = new Date(b.endAt)
                    const date  = start.toLocaleDateString('en-UG', { weekday: 'short', day: 'numeric', month: 'short' })
                    const s     = start.toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit', hour12: true })
                    const e     = end.toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit', hour12: true })
                    return (
                      <div key={b.id} className="flex items-center gap-3 p-3 rounded-xl bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/20">
                        <Ban size={13} className="text-red-400 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-red-700 dark:text-red-400">{date}</p>
                          <p className="text-[10px] text-red-500">{s} – {e}{b.reason ? ` · ${b.reason}` : ''}</p>
                        </div>
                        <button onClick={() => deleteBlock(b.id)}
                          className="w-7 h-7 flex items-center justify-center rounded-lg bg-red-100 dark:bg-red-900/20 text-red-500 hover:bg-red-200 dark:hover:bg-red-900/30 transition-colors">
                          <X size={12} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-xs text-gray-300 dark:text-gray-600 pl-1">No blocked slots — doctor available during all working hours</p>
              )}
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
