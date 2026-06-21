'use client'

import { useState } from 'react'
import Link from 'next/link'
import { X, Phone, Clock, Stethoscope, User, Check, XCircle, AlertTriangle, Loader2, ExternalLink, Edit2, Save, CalendarDays } from 'lucide-react'
import { cn, formatPhone, formatUGX } from '@/lib/utils'
import Avatar from '@/components/ui/Avatar'

interface Appointment {
  id: string
  startAt: string
  endAt: string
  status: string
  notes?: string
  patient: { id: string; firstName: string; lastName: string; phone: string }
  doctor: { id?: string; user: { firstName: string; lastName: string } }
  service: { name: string; colour: string; priceUGX?: number }
}

interface Props {
  appointment: Appointment | null
  onClose: () => void
  onStatusChange?: (id: string, status: string) => void
  onBookFollowUp?: (patient: { id: string; firstName: string; lastName: string; phone: string }, doctorId?: string) => void
  userRole?: string
}

const statusLabels: Record<string, { label: string; className: string }> = {
  IMPORTED:       { label: 'Needs Review',         className: 'bg-amber-100 text-amber-700' },
  PENDING:        { label: 'Scheduled',            className: 'bg-slate-100 text-slate-700' },
  CONFIRMED:      { label: 'Confirmed',            className: 'bg-blue-100 text-blue-700' },
  CHECKED_IN:     { label: 'Checked In',           className: 'bg-yellow-100 text-yellow-700' },
  IN_CHAIR:       { label: 'In Chair',             className: 'bg-orange-100 text-orange-700' },
  WITH_PROVIDER:  { label: 'With Provider',        className: 'bg-teal-100 text-teal-700' },
  READY_CHECKOUT: { label: 'Ready for Checkout',   className: 'bg-purple-100 text-purple-700' },
  COMPLETED:      { label: 'Checkout Complete',    className: 'bg-green-100 text-green-700' },
  NO_SHOW:        { label: 'Missed / No-Show',     className: 'bg-red-100 text-red-700' },
  CANCELLED:             { label: 'Cancelled',              className: 'bg-slate-100 text-slate-400' },
  CANCELLED_RESCHEDULED: { label: 'Cancelled & Rescheduled', className: 'bg-amber-100 text-amber-700' },
}

const STATUS_NEXT: Record<string, { status: string; label: string; colour: string }> = {
  IMPORTED:       { status: 'CONFIRMED',      label: 'Confirm',              colour: 'bg-blue-600' },
  PENDING:        { status: 'CONFIRMED',      label: 'Confirm',              colour: 'bg-blue-600' },
  CONFIRMED:      { status: 'CHECKED_IN',     label: 'Check In',             colour: 'bg-yellow-500' },
  CHECKED_IN:     { status: 'IN_CHAIR',       label: 'Seat in Chair',        colour: 'bg-orange-500' },
  IN_CHAIR:       { status: 'WITH_PROVIDER',  label: 'With Provider',        colour: 'bg-teal-600' },
  WITH_PROVIDER:  { status: 'READY_CHECKOUT', label: 'Ready for Checkout',   colour: 'bg-purple-600' },
  READY_CHECKOUT: { status: 'COMPLETED',      label: 'Complete Checkout',    colour: 'bg-green-600' },
}

export default function AppointmentModal({ appointment, onClose, onStatusChange, onBookFollowUp, userRole = 'ADMIN' }: Props) {
  const [loading,      setLoading]      = useState<string | null>(null)
  const [editMode,     setEditMode]     = useState(false)
  const [doctors,      setDoctors]      = useState<any[]>([])
  const [services,     setServices]     = useState<any[]>([])
  const [editDate,     setEditDate]     = useState('')
  const [editTime,     setEditTime]     = useState('')
  const [editDoctor,   setEditDoctor]   = useState('')
  const [editService,  setEditService]  = useState('')
  const [editDuration, setEditDuration] = useState(30)
  const [editNotes,    setEditNotes]    = useState('')
  const [saving,       setSaving]       = useState(false)
  const [saveError,    setSaveError]    = useState('')
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null

  if (!appointment) return null

  const s = statusLabels[appointment.status] || statusLabels.PENDING
  const start = new Date(appointment.startAt)
  const end   = new Date(appointment.endAt)
  const canEdit = !['COMPLETED', 'CANCELLED', 'CANCELLED_RESCHEDULED', 'NO_SHOW'].includes(appointment.status)

  async function openEdit() {
    const d = new Date(appointment!.startAt)
    setEditDate(d.toISOString().slice(0, 10))
    setEditTime(`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`)
    setEditDoctor(appointment!.doctor.id || '')
    setEditService((appointment!.service as any).id || '')
    const durMins = Math.round((new Date(appointment!.endAt).getTime() - new Date(appointment!.startAt).getTime()) / 60000)
    setEditDuration(durMins > 0 ? durMins : 30)
    setEditNotes(appointment!.notes || '')
    setSaveError('')
    setEditMode(true)
    const [docRes, svcRes] = await Promise.all([
      doctors.length === 0  ? fetch('/api-proxy/doctors',  { headers: { Authorization: `Bearer ${token}` } }) : Promise.resolve(null),
      services.length === 0 ? fetch('/api-proxy/services', { headers: { Authorization: `Bearer ${token}` } }) : Promise.resolve(null),
    ])
    if (docRes?.ok) { const data = await docRes.json(); setDoctors(Array.isArray(data) ? data : []) }
    if (svcRes?.ok) { const data = await svcRes.json(); setServices(Array.isArray(data) ? data : []) }
  }

  async function changeStatus(status: string) {
    setLoading(status)
    try {
      const res = await fetch(`/api-proxy/scheduling/appointments/${appointment!.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status }),
      })
      if (res.ok) { onStatusChange?.(appointment!.id, status); onClose() }
    } finally { setLoading(null) }
  }

  async function saveReschedule() {
    if (!editDate || !editTime) { setSaveError('Date and time are required'); return }
    setSaving(true); setSaveError('')
    try {
      const [hh, mm] = editTime.split(':')
      const startAt = new Date(`${editDate}T${hh}:${mm}:00`)
      const endAt   = new Date(startAt.getTime() + editDuration * 60000)
      const body: any = { startAt: startAt.toISOString(), endAt: endAt.toISOString(), notes: editNotes }
      if (editDoctor)  body.doctorId  = editDoctor
      if (editService) body.serviceId = editService
      const res = await fetch(`/api-proxy/scheduling/appointments/${appointment!.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      })
      if (res.ok) { onStatusChange?.(appointment!.id, appointment!.status); onClose() }
      else { const d = await res.json(); setSaveError(d.error || 'Failed to save') }
    } catch { setSaveError('Network error') } finally { setSaving(false) }
  }

  const inputCls = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all'

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40 animate-fade-in" onClick={onClose} />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-2xl animate-fade-in overflow-hidden">

          {/* Header */}
          <div className="px-6 py-5 flex items-center justify-between" style={{ background: appointment.service.colour + '20', borderBottom: `3px solid ${appointment.service.colour}` }}>
            <div>
              <span className={cn('text-xs font-semibold px-2.5 py-1 rounded-full', s.className)}>{s.label}</span>
              <h2 className="text-lg font-bold text-clinic-navy dark:text-white mt-1">{appointment.service.name}</h2>
            </div>
            <div className="flex items-center gap-2">
              {canEdit && !editMode && (
                <button onClick={openEdit}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-white/70 text-gray-700 hover:bg-white transition-colors border border-white/50">
                  <Edit2 size={12} /> Edit
                </button>
              )}
              <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/60 text-gray-500 transition-colors">
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
            {/* Patient */}
            <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-white/5 rounded-xl">
              <Avatar firstName={appointment.patient.firstName} lastName={appointment.patient.lastName} colour={appointment.service.colour} size="md" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-clinic-navy dark:text-white">{appointment.patient.firstName} {appointment.patient.lastName}</p>
                  <Link href={`/patients/${appointment.patient.id}?tab=dental`} onClick={onClose}
                    className="flex items-center gap-1 text-[10px] font-bold text-clinic-blue hover:underline">
                    <ExternalLink size={10} /> View Chart
                  </Link>
                  <Link href={`/patients/${appointment.patient.id}`} onClick={onClose}
                    className="flex items-center gap-1 text-[10px] font-bold text-slate-500 hover:underline">
                    Full Profile
                  </Link>
                </div>
                <div className="flex items-center gap-1 text-xs text-gray-400 mt-0.5">
                  <Phone size={11} />
                  {formatPhone(appointment.patient.phone)}
                </div>
              </div>
            </div>

            {/* ── VIEW MODE ── */}
            {!editMode && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex items-start gap-2">
                    <Clock size={14} className="text-clinic-blue mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-xs text-gray-400">Time</p>
                      <p className="text-sm font-semibold text-clinic-navy dark:text-white">
                        {start.toLocaleTimeString('en-UG', { timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit', hour12: true })}
                        {' – '}
                        {end.toLocaleTimeString('en-UG', { timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit', hour12: true })}
                      </p>
                      <p className="text-xs text-gray-400">
                        {start.toLocaleDateString('en-UG', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Nairobi' })}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <User size={14} className="text-clinic-blue mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-xs text-gray-400">Doctor</p>
                      <p className="text-sm font-semibold text-clinic-navy dark:text-white">
                        Dr. {appointment.doctor.user.firstName} {appointment.doctor.user.lastName}
                      </p>
                    </div>
                  </div>
                  {appointment.service.priceUGX && (
                    <div className="flex items-start gap-2 col-span-2">
                      <Stethoscope size={14} className="text-clinic-blue mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-xs text-gray-400">Service Fee</p>
                        <p className="text-sm font-semibold text-clinic-navy dark:text-white">{formatUGX(appointment.service.priceUGX)}</p>
                      </div>
                    </div>
                  )}
                </div>

                {appointment.notes && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 text-xs text-yellow-700">
                    <span className="font-semibold">Notes: </span>{appointment.notes}
                  </div>
                )}

                {canEdit && (
                  <div className="flex flex-wrap gap-2 pt-2">
                    {STATUS_NEXT[appointment.status] && (() => {
                      const next = STATUS_NEXT[appointment.status]
                      return (
                        <button onClick={() => changeStatus(next.status)} disabled={!!loading}
                          className={cn('flex items-center gap-1.5 px-3 py-2 text-white text-xs font-semibold rounded-lg hover:opacity-90 transition-opacity disabled:opacity-60', next.colour)}>
                          {loading === next.status ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                          {next.label}
                        </button>
                      )
                    })()}
                    <button onClick={() => changeStatus('NO_SHOW')} disabled={!!loading}
                      className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 text-xs font-semibold rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-60">
                      {loading === 'NO_SHOW' ? <Loader2 size={12} className="animate-spin" /> : <AlertTriangle size={12} />}
                      No-Show
                    </button>
                    <button onClick={() => changeStatus('CANCELLED')} disabled={!!loading}
                      className="flex items-center gap-1.5 px-3 py-2 bg-red-50 text-red-700 text-xs font-semibold rounded-lg hover:bg-red-100 transition-colors disabled:opacity-60">
                      {loading === 'CANCELLED' ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
                      Cancel
                    </button>
                    <button onClick={() => changeStatus('CANCELLED_RESCHEDULED')} disabled={!!loading}
                      className="flex items-center gap-1.5 px-3 py-2 bg-amber-50 text-amber-700 text-xs font-semibold rounded-lg hover:bg-amber-100 transition-colors disabled:opacity-60">
                      {loading === 'CANCELLED_RESCHEDULED' ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
                      Cancel &amp; Rescheduled
                    </button>
                  </div>
                )}

                {onBookFollowUp && (
                  <div className="pt-2 border-t border-gray-100 dark:border-white/8">
                    <button
                      onClick={() => { onBookFollowUp(appointment.patient, appointment.doctor.id); onClose() }}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5 hover:shadow-md"
                      style={{ background: 'linear-gradient(135deg,#0d9488,#0891b2)', boxShadow: '0 4px 12px rgba(8,145,178,0.25)' }}>
                      <CalendarDays size={14} />
                      Book Next Appointment
                    </button>
                  </div>
                )}
              </>
            )}

            {/* ── EDIT / RESCHEDULE MODE ── */}
            {editMode && (
              <div className="space-y-3">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                  <CalendarDays size={12} /> Reschedule Appointment
                </p>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-gray-500 block mb-1">Date</label>
                    <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 block mb-1">Time</label>
                    <input type="time" value={editTime} onChange={e => setEditTime(e.target.value)} className={inputCls} />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-500 block mb-1">Doctor</label>
                  <select value={editDoctor} onChange={e => setEditDoctor(e.target.value)} className={inputCls}>
                    <option value="">Keep current (Dr. {appointment.doctor.user.firstName} {appointment.doctor.user.lastName})</option>
                    {doctors.map(d => (
                      <option key={d.id} value={d.id}>Dr. {d.firstName} {d.lastName}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-500 block mb-1">Service</label>
                  <select value={editService} onChange={e => setEditService(e.target.value)} className={inputCls}>
                    <option value="">Keep current ({appointment.service.name})</option>
                    {services.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-500 block mb-1">Duration</label>
                  <div className="flex flex-wrap gap-1.5">
                    {[10, 15, 20, 30, 45, 60, 90, 120].map(mins => (
                      <button key={mins} type="button" onClick={() => setEditDuration(mins)}
                        className={cn('px-2.5 py-1 rounded-lg border text-xs font-semibold transition-colors',
                          editDuration === mins
                            ? 'border-cyan-500 bg-cyan-50 text-cyan-700'
                            : 'border-gray-200 text-gray-500 hover:border-gray-300')}>
                        {mins < 60 ? `${mins}m` : `${mins / 60}h`}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-500 block mb-1">Notes</label>
                  <textarea rows={2} value={editNotes} onChange={e => setEditNotes(e.target.value)}
                    className={cn(inputCls, 'resize-none')} placeholder="Add notes..." />
                </div>

                {saveError && (
                  <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{saveError}</p>
                )}

                <div className="flex gap-2 pt-1">
                  <button onClick={saveReschedule} disabled={saving}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white disabled:opacity-60 transition-all hover:-translate-y-0.5"
                    style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
                    {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                    Save Changes
                  </button>
                  <button onClick={() => setEditMode(false)}
                    className="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
