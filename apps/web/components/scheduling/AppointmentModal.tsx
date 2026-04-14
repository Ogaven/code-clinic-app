'use client'

import { useState } from 'react'
import Link from 'next/link'
import { X, Phone, Clock, Stethoscope, User, Check, XCircle, AlertTriangle, Loader2, ExternalLink } from 'lucide-react'
import { cn, formatPhone, formatUGX } from '@/lib/utils'
import Avatar from '@/components/ui/Avatar'

interface Appointment {
  id: string
  startAt: string
  endAt: string
  status: string
  notes?: string
  patient: { id: string; firstName: string; lastName: string; phone: string }
  doctor: { user: { firstName: string; lastName: string } }
  service: { name: string; colour: string; priceUGX?: number }
}

interface Props {
  appointment: Appointment | null
  onClose: () => void
  onStatusChange?: (id: string, status: string) => void
  userRole?: string
}

const statusLabels: Record<string, { label: string; className: string }> = {
  PENDING:        { label: 'Scheduled',           className: 'bg-slate-100 text-slate-700' },
  CONFIRMED:      { label: 'Confirmed',            className: 'bg-blue-100 text-blue-700' },
  CHECKED_IN:     { label: 'Checked In',           className: 'bg-yellow-100 text-yellow-700' },
  IN_CHAIR:       { label: 'In Chair',             className: 'bg-orange-100 text-orange-700' },
  WITH_PROVIDER:  { label: 'With Provider',        className: 'bg-teal-100 text-teal-700' },
  READY_CHECKOUT: { label: 'Ready for Checkout',   className: 'bg-purple-100 text-purple-700' },
  COMPLETED:      { label: 'Checkout Complete',    className: 'bg-green-100 text-green-700' },
  NO_SHOW:        { label: 'Missed / No-Show',     className: 'bg-red-100 text-red-700' },
  CANCELLED:      { label: 'Cancelled',            className: 'bg-slate-100 text-slate-400' },
}

// Sequential status flow
const STATUS_NEXT: Record<string, { status: string; label: string; colour: string }> = {
  PENDING:        { status: 'CONFIRMED',      label: 'Confirm',              colour: 'bg-blue-600' },
  CONFIRMED:      { status: 'CHECKED_IN',     label: 'Check In',             colour: 'bg-yellow-500' },
  CHECKED_IN:     { status: 'IN_CHAIR',       label: 'Seat in Chair',        colour: 'bg-orange-500' },
  IN_CHAIR:       { status: 'WITH_PROVIDER',  label: 'With Provider',        colour: 'bg-teal-600' },
  WITH_PROVIDER:  { status: 'READY_CHECKOUT', label: 'Ready for Checkout',   colour: 'bg-purple-600' },
  READY_CHECKOUT: { status: 'COMPLETED',      label: 'Complete Checkout',    colour: 'bg-green-600' },
}

export default function AppointmentModal({ appointment, onClose, onStatusChange, userRole = 'ADMIN' }: Props) {
  const [loading, setLoading] = useState<string | null>(null)
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null

  if (!appointment) return null

  const s = statusLabels[appointment.status] || statusLabels.PENDING
  const start = new Date(appointment.startAt)
  const end = new Date(appointment.endAt)

  async function changeStatus(status: string) {
    setLoading(status)
    try {
      const res = await fetch(
        `/api-proxy/scheduling/appointments/${appointment!.id}/status`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ status }),
        },
      )
      if (res.ok) {
        onStatusChange?.(appointment!.id, status)
        onClose()
      }
    } finally { setLoading(null) }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40 animate-fade-in" onClick={onClose} />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-2xl animate-fade-in overflow-hidden">

          {/* Header — coloured by service */}
          <div className="px-6 py-5 flex items-center justify-between" style={{ background: appointment.service.colour + '20', borderBottom: `3px solid ${appointment.service.colour}` }}>
            <div>
              <span className={cn('text-xs font-semibold px-2.5 py-1 rounded-full', s.className)}>{s.label}</span>
              <h2 className="text-lg font-bold text-clinic-navy dark:text-white mt-1">{appointment.service.name}</h2>
            </div>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/60 text-gray-500 transition-colors">
              <X size={18} />
            </button>
          </div>

          <div className="px-6 py-5 space-y-4">
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

            {/* Details grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-start gap-2">
                <Clock size={14} className="text-clinic-blue mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs text-gray-400">Time</p>
                  <p className="text-sm font-semibold text-clinic-navy dark:text-white">
                    {start.toLocaleTimeString('en-UG', { timeZone: 'Africa/Kampala', hour: '2-digit', minute: '2-digit', hour12: true })}
                    {' – '}
                    {end.toLocaleTimeString('en-UG', { timeZone: 'Africa/Kampala', hour: '2-digit', minute: '2-digit', hour12: true })}
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

            {/* Action buttons */}
            {appointment.status !== 'CANCELLED' && appointment.status !== 'COMPLETED' && appointment.status !== 'NO_SHOW' && (
              <div className="flex flex-wrap gap-2 pt-2">
                {/* Primary: advance to next status */}
                {STATUS_NEXT[appointment.status] && (() => {
                  const next = STATUS_NEXT[appointment.status]
                  return (
                    <button
                      onClick={() => changeStatus(next.status)}
                      disabled={!!loading}
                      className={cn('flex items-center gap-1.5 px-3 py-2 text-white text-xs font-semibold rounded-lg hover:opacity-90 transition-opacity disabled:opacity-60', next.colour)}
                    >
                      {loading === next.status ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                      {next.label}
                    </button>
                  )
                })()}

                {/* Secondary: no-show */}
                <button
                  onClick={() => changeStatus('NO_SHOW')}
                  disabled={!!loading}
                  className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 text-xs font-semibold rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-60"
                >
                  {loading === 'NO_SHOW' ? <Loader2 size={12} className="animate-spin" /> : <AlertTriangle size={12} />}
                  No-Show
                </button>

                {/* Danger: cancel */}
                <button
                  onClick={() => changeStatus('CANCELLED')}
                  disabled={!!loading}
                  className="flex items-center gap-1.5 px-3 py-2 bg-red-50 text-red-700 text-xs font-semibold rounded-lg hover:bg-red-100 transition-colors disabled:opacity-60"
                >
                  {loading === 'CANCELLED' ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
