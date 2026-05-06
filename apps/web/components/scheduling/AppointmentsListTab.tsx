'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2, Search, Calendar, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Appointment {
  id: string
  startAt: string
  status: string
  patient: { id: string; firstName: string; lastName: string; phone: string }
  doctor:  { id: string; user: { firstName: string; lastName: string } }
  service: { id: string; name: string; colour: string; durationMins: number; priceUGX: number }
}

interface Doctor { id: string; user: { firstName: string; lastName: string } }

const API = '/api-proxy'
function hdr() {
  const t = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  return { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }
}

const STATUS_COLOURS: Record<string, string> = {
  PENDING:          'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  CONFIRMED:        'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  ARRIVED:          'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
  WAITING:          'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  WITH_PROVIDER:    'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  SESSION_COMPLETE: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  COMPLETED:        'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  CANCELLED:        'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  NO_SHOW:          'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
}

function today() { return new Date().toISOString().slice(0, 10) }

export default function AppointmentsListTab() {
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [doctors,      setDoctors]      = useState<Doctor[]>([])
  const [loading,      setLoading]      = useState(true)
  const [search,       setSearch]       = useState('')
  const [startDate,    setStartDate]    = useState(today())
  const [endDate,      setEndDate]      = useState(today())
  const [doctorId,     setDoctorId]     = useState('')
  const [status,       setStatus]       = useState('')

  useEffect(() => {
    fetch(`${API}/doctors`, { headers: hdr() })
      .then(r => r.json()).then(d => setDoctors(Array.isArray(d) ? d : [])).catch(() => {})
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ startDate, endDate })
      if (doctorId) params.set('doctorId', doctorId)
      if (status)   params.set('status',   status)
      const r = await fetch(`${API}/scheduling/appointments?${params}`, { headers: hdr() })
      const d = await r.json()
      setAppointments(Array.isArray(d) ? d : [])
    } catch { setAppointments([]) }
    finally { setLoading(false) }
  }, [startDate, endDate, doctorId, status])

  useEffect(() => { load() }, [load])

  const filtered = appointments.filter(a => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      `${a.patient.firstName} ${a.patient.lastName}`.toLowerCase().includes(q) ||
      a.patient.phone.includes(q) ||
      a.service.name.toLowerCase().includes(q) ||
      `${a.doctor.user.firstName} ${a.doctor.user.lastName}`.toLowerCase().includes(q)
    )
  })

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Filters ── */}
      <div className="flex-shrink-0 flex flex-wrap items-center gap-2 px-3 sm:px-4 py-3 border-b border-gray-100 dark:border-white/8 bg-gray-50/50 dark:bg-black/10">
        {/* Date range */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <Calendar size={13} className="text-gray-400 flex-shrink-0" />
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
            className="px-2 py-1.5 text-xs border border-gray-200 dark:border-white/10 rounded-lg bg-white dark:bg-white/5 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 transition-all w-32 sm:w-auto" />
          <span className="text-xs text-gray-400">—</span>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
            className="px-2 py-1.5 text-xs border border-gray-200 dark:border-white/10 rounded-lg bg-white dark:bg-white/5 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 transition-all w-32 sm:w-auto" />
        </div>

        {/* Doctor filter */}
        <div className="relative flex-shrink-0">
          <select value={doctorId} onChange={e => setDoctorId(e.target.value)}
            className="appearance-none pl-2.5 pr-6 py-1.5 text-xs border border-gray-200 dark:border-white/10 rounded-lg bg-white dark:bg-white/5 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 transition-all max-w-[130px] sm:max-w-none">
            <option value="">All doctors</option>
            {doctors.map(d => <option key={d.id} value={d.id}>Dr. {d.user.firstName} {d.user.lastName}</option>)}
          </select>
          <ChevronDown size={11} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        </div>

        {/* Status filter */}
        <div className="relative flex-shrink-0">
          <select value={status} onChange={e => setStatus(e.target.value)}
            className="appearance-none pl-2.5 pr-6 py-1.5 text-xs border border-gray-200 dark:border-white/10 rounded-lg bg-white dark:bg-white/5 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 transition-all max-w-[120px] sm:max-w-none">
            <option value="">All statuses</option>
            {['PENDING','CONFIRMED','ARRIVED','WAITING','WITH_PROVIDER','SESSION_COMPLETE','COMPLETED','CANCELLED','NO_SHOW'].map(s => (
              <option key={s} value={s}>{s.replace(/_/g,' ')}</option>
            ))}
          </select>
          <ChevronDown size={11} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-[140px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
            className="w-full pl-7 pr-2.5 py-1.5 text-xs border border-gray-200 dark:border-white/10 rounded-lg bg-white dark:bg-white/5 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 transition-all" />
        </div>

        <span className="text-xs text-gray-400 font-medium ml-auto flex-shrink-0 hidden sm:block">
          {filtered.length} appt{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 size={24} className="animate-spin text-cyan-500" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-center">
            <Calendar size={32} className="text-gray-200 dark:text-gray-700 mb-3" />
            <p className="text-sm font-semibold text-gray-400">No appointments found</p>
            <p className="text-xs text-gray-300 dark:text-gray-600 mt-1">Try adjusting your filters</p>
          </div>
        ) : (
          <>
            {/* ── Mobile card list (hidden on sm+) ── */}
            <div className="sm:hidden divide-y divide-gray-50 dark:divide-white/5">
              {filtered.map(a => {
                const start   = new Date(a.startAt)
                const dateStr = start.toLocaleDateString('en-UG', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Nairobi' })
                const timeStr = start.toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi' })
                return (
                  <div key={a.id} className="px-4 py-3 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-bold text-gray-800 dark:text-gray-100">
                          {a.patient.firstName} {a.patient.lastName}
                        </p>
                        <p className="text-xs text-gray-400">{a.patient.phone}</p>
                      </div>
                      <span className={cn('inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide flex-shrink-0', STATUS_COLOURS[a.status] || 'bg-gray-100 text-gray-500')}>
                        {a.status.replace(/_/g,' ')}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-500 dark:text-gray-400">
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: a.service.colour }} />
                        {a.service.name}
                      </span>
                      <span>Dr. {a.doctor.user.firstName} {a.doctor.user.lastName}</span>
                      <span className="font-semibold text-gray-600 dark:text-gray-300">{dateStr} · {timeStr}</span>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* ── Desktop table (hidden on mobile) ── */}
            <table className="w-full text-sm hidden sm:table">
              <thead className="sticky top-0 bg-gray-50 dark:bg-[#0a0f1e] border-b border-gray-100 dark:border-white/8">
                <tr>
                  {['Patient', 'Doctor', 'Service', 'Date & Time', 'Status'].map(col => (
                    <th key={col} className="text-left text-[10px] font-black uppercase tracking-wide text-gray-400 px-4 py-2.5">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((a, i) => {
                  const start   = new Date(a.startAt)
                  const dateStr = start.toLocaleDateString('en-UG', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Nairobi' })
                  const timeStr = start.toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi' })
                  return (
                    <tr key={a.id} className={cn('border-b border-gray-50 dark:border-white/5 hover:bg-gray-50/60 dark:hover:bg-white/3 transition-colors', i % 2 !== 0 && 'bg-gray-50/30 dark:bg-white/[0.01]')}>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-gray-800 dark:text-gray-100">{a.patient.firstName} {a.patient.lastName}</p>
                        <p className="text-xs text-gray-400">{a.patient.phone}</p>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-200">
                        Dr. {a.doctor.user.firstName} {a.doctor.user.lastName}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium">
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: a.service.colour }} />
                          {a.service.name}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-300">
                        <p className="font-semibold">{dateStr}</p>
                        <p className="text-gray-400">{timeStr}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide', STATUS_COLOURS[a.status] || 'bg-gray-100 text-gray-500')}>
                          {a.status.replace(/_/g,' ')}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  )
}
