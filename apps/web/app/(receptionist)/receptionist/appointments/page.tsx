'use client'

import { useEffect, useState } from 'react'
import { ListChecks, Plus, Edit3, Loader2, X, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import BookingDrawer from '@/components/scheduling/BookingDrawer'

type AppointmentStatus = 'ALL' | 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'RESCHEDULED' | 'NO_SHOW' | 'COMPLETED'

type Appointment = {
  id: string
  startAt: string
  endAt: string
  status: string
  notes: string | null
  patient: { id: string; firstName: string; lastName: string; phone: string }
  doctor: { id: string; user: { firstName: string; lastName: string } }
  service: { id: string; name: string; colour: string; durationMins: number; priceUGX: number }
}

const TABS: { key: AppointmentStatus; label: string }[] = [
  { key: 'ALL',         label: 'All'         },
  { key: 'CONFIRMED',   label: 'Confirmed'   },
  { key: 'CANCELLED',   label: 'Cancelled'   },
  { key: 'RESCHEDULED', label: 'Rescheduled' },
  { key: 'NO_SHOW',     label: 'No Show'     },
  { key: 'COMPLETED',   label: 'Completed'   },
]

const STATUS_COLORS: Record<string, string> = {
  PENDING:          'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400',
  CONFIRMED:        'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400',
  CANCELLED:        'bg-red-50 text-red-500 dark:bg-red-900/20 dark:text-red-400',
  RESCHEDULED:      'bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400',
  NO_SHOW:          'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/50',
  COMPLETED:        'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400',
  ARRIVED:          'bg-teal-50 text-teal-600 dark:bg-teal-900/20 dark:text-teal-400',
  WAITING:          'bg-cyan-50 text-cyan-600 dark:bg-cyan-900/20 dark:text-cyan-400',
  IN_OPERATORY:     'bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400',
  WITH_PROVIDER:    'bg-violet-50 text-violet-600 dark:bg-violet-900/20 dark:text-violet-400',
  SESSION_COMPLETE: 'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400',
  CHECKOUT:         'bg-orange-50 text-orange-600 dark:bg-orange-900/20 dark:text-orange-400',
  DEPARTED:         'bg-slate-50 text-slate-600 dark:bg-slate-900/20 dark:text-slate-400',
}

const EDIT_STATUSES = [
  'PENDING', 'CONFIRMED', 'ARRIVED', 'WAITING', 'IN_OPERATORY', 'WITH_PROVIDER',
  'SESSION_COMPLETE', 'CHECKOUT', 'DEPARTED', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED',
]

export default function AppointmentsPage() {
  const API   = '/api-proxy'
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const authH = { Authorization: `Bearer ${token}` }

  const [tab,        setTab]       = useState<AppointmentStatus>('ALL')
  const [appts,      setAppts]     = useState<Appointment[]>([])
  const [loading,    setLoading]   = useState(true)
  const [search,     setSearch]    = useState('')
  const [drawerOpen, setDrawerOpen]= useState(false)
  const [refreshKey, setRefreshKey]= useState(0)

  // Edit modal
  const [editAppt,      setEditAppt]     = useState<Appointment | null>(null)
  const [editStatus,    setEditStatus]   = useState('')
  const [editDate,      setEditDate]     = useState('')
  const [editDoctorId,  setEditDoctorId] = useState('')
  const [editServiceId, setEditServiceId]= useState('')
  const [editNotes,     setEditNotes]    = useState('')
  const [saving,        setSaving]       = useState(false)
  const [doctors,       setDoctors]      = useState<{ id: string; firstName: string; lastName: string }[]>([])
  const [services,      setServices]     = useState<{ id: string; name: string }[]>([])

  useEffect(() => { fetchAppts() }, [tab, refreshKey])
  useEffect(() => { fetchMeta()  }, [])

  function dateRange() {
    const now   = new Date()
    const start = new Date(now); start.setDate(start.getDate() - 90)
    const end   = new Date(now); end.setDate(end.getDate() + 180)
    return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) }
  }

  async function fetchAppts() {
    setLoading(true)
    const { startDate, endDate } = dateRange()
    const sp = tab !== 'ALL' ? `&status=${tab}` : ''
    try {
      const res = await fetch(`${API}/scheduling/appointments?startDate=${startDate}&endDate=${endDate}${sp}`, { headers: authH })
      if (res.ok) setAppts(await res.json())
    } catch {} finally { setLoading(false) }
  }

  async function fetchMeta() {
    try {
      const today = new Date().toISOString().slice(0, 10)
      const [calRes, svcRes] = await Promise.all([
        fetch(`${API}/scheduling/calendar?date=${today}`, { headers: authH }),
        fetch(`${API}/services`, { headers: authH }),
      ])
      if (calRes.ok) {
        const d = await calRes.json()
        setDoctors((d.calendar || []).map((c: any) => ({
          id: c.doctor.id,
          firstName: c.doctor.firstName,
          lastName:  c.doctor.lastName,
        })))
      }
      if (svcRes.ok) {
        const s = await svcRes.json()
        setServices(Array.isArray(s) ? s : s.services ?? [])
      }
    } catch {}
  }

  function openEdit(appt: Appointment) {
    setEditAppt(appt)
    setEditStatus(appt.status)
    setEditDate(new Date(appt.startAt).toISOString().slice(0, 16))
    setEditDoctorId(appt.doctor.id)
    setEditServiceId(appt.service.id)
    setEditNotes(appt.notes || '')
  }

  async function saveEdit() {
    if (!editAppt) return
    setSaving(true)
    try {
      const res = await fetch(`${API}/scheduling/appointments/${editAppt.id}`, {
        method: 'PATCH',
        headers: { ...authH, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status:      editStatus,
          scheduledAt: editDate ? new Date(editDate).toISOString() : undefined,
          doctorId:    editDoctorId,
          serviceId:   editServiceId,
          notes:       editNotes,
        }),
      })
      if (res.ok) { setEditAppt(null); setRefreshKey(k => k + 1) }
    } catch {} finally { setSaving(false) }
  }

  const filtered = appts.filter(a => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      `${a.patient.firstName} ${a.patient.lastName}`.toLowerCase().includes(q) ||
      a.patient.phone.includes(q) ||
      `${a.doctor.user.firstName} ${a.doctor.user.lastName}`.toLowerCase().includes(q) ||
      a.service.name.toLowerCase().includes(q)
    )
  })

  return (
    <div className="p-6 space-y-5 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ListChecks size={20} className="text-cyan-500" />
          <div>
            <h1 className="text-xl font-black text-gray-800 dark:text-white">Appointments</h1>
            <p className="text-sm text-gray-400 mt-0.5">All scheduled appointments · last 90 days + next 6 months</p>
          </div>
        </div>
        <button
          onClick={() => setDrawerOpen(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5 hover:shadow-lg"
          style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)', boxShadow: '0 4px 12px rgba(41,171,226,0.25)' }}>
          <Plus size={15} />
          Book Appointment
        </button>
      </div>

      {/* Tabs + Search */}
      <div className="flex items-end justify-between gap-4 border-b border-gray-100 dark:border-white/8">
        <div className="flex gap-0 overflow-x-auto">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold border-b-2 transition-all -mb-px whitespace-nowrap',
                tab === t.key
                  ? 'border-cyan-500 text-cyan-600 dark:text-cyan-400'
                  : 'border-transparent text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300',
              )}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="relative mb-0.5 flex-shrink-0">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search patient, doctor, service..."
            className="pl-8 pr-4 py-2 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-white dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 w-64"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={24} className="animate-spin text-cyan-500" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <ListChecks size={36} className="text-gray-200 dark:text-white/10" />
            <p className="font-medium text-gray-400 dark:text-white/40">No appointments found</p>
            <p className="text-sm text-gray-300 dark:text-white/20">
              {appts.length === 0 ? 'No appointments in this period' : 'No results match your search'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-white/5">
                  {['Patient', 'Doctor', 'Service', 'Date & Time', 'Status', 'Notes', ''].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-black text-gray-400 dark:text-white/40 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                {filtered.map(appt => {
                  const date = new Date(appt.startAt).toLocaleString('en-UG', {
                    day: 'numeric', month: 'short', year: 'numeric',
                    hour: '2-digit', minute: '2-digit', hour12: true,
                    timeZone: 'Africa/Kampala',
                  })
                  return (
                    <tr key={appt.id} className="hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-gray-800 dark:text-white">
                          {appt.patient.firstName} {appt.patient.lastName}
                        </p>
                        <p className="text-xs text-gray-400 font-mono">{appt.patient.phone}</p>
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-white/70">
                        Dr. {appt.doctor.user.firstName} {appt.doctor.user.lastName}
                      </td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-1.5">
                          {appt.service.colour && (
                            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                              style={{ background: appt.service.colour }} />
                          )}
                          <span className="text-gray-700 dark:text-white/80">{appt.service.name}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 dark:text-white/50 font-mono whitespace-nowrap">
                        {date}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          'text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap',
                          STATUS_COLORS[appt.status] || 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/50',
                        )}>
                          {appt.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400 dark:text-white/40 max-w-[160px] truncate">
                        {appt.notes || '—'}
                      </td>
                      <td className="px-4 py-3">
                        <button onClick={() => openEdit(appt)}
                          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-white/8 transition-colors">
                          <Edit3 size={14} className="text-gray-400" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit modal */}
      {editAppt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#0f1729] rounded-2xl shadow-2xl w-full max-w-md border border-gray-100 dark:border-white/10">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/8">
              <h3 className="font-bold text-gray-800 dark:text-white">Edit Appointment</h3>
              <button onClick={() => setEditAppt(null)}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-white/8 transition-colors">
                <X size={15} className="text-gray-400" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="p-3 bg-gray-50 dark:bg-white/5 rounded-xl">
                <p className="text-sm font-semibold text-gray-800 dark:text-white">
                  {editAppt.patient.firstName} {editAppt.patient.lastName}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {editAppt.service.name} · Dr. {editAppt.doctor.user.firstName} {editAppt.doctor.user.lastName}
                </p>
              </div>

              <div>
                <label className="text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide">Status</label>
                <select value={editStatus} onChange={e => setEditStatus(e.target.value)}
                  className="mt-1 w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500">
                  {EDIT_STATUSES.map(s => (
                    <option key={s} value={s} className="dark:bg-gray-800">{s.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide">Date &amp; Time</label>
                <input type="datetime-local" value={editDate} onChange={e => setEditDate(e.target.value)}
                  className="mt-1 w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500" />
              </div>

              {doctors.length > 0 && (
                <div>
                  <label className="text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide">Doctor</label>
                  <select value={editDoctorId} onChange={e => setEditDoctorId(e.target.value)}
                    className="mt-1 w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500">
                    {doctors.map(d => (
                      <option key={d.id} value={d.id} className="dark:bg-gray-800">Dr. {d.firstName} {d.lastName}</option>
                    ))}
                  </select>
                </div>
              )}

              {services.length > 0 && (
                <div>
                  <label className="text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide">Service</label>
                  <select value={editServiceId} onChange={e => setEditServiceId(e.target.value)}
                    className="mt-1 w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500">
                    {services.map(s => (
                      <option key={s.id} value={s.id} className="dark:bg-gray-800">{s.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide">Notes</label>
                <textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} rows={3}
                  className="mt-1 w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-white dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 resize-none" />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 pb-5">
              <button onClick={() => setEditAppt(null)}
                className="px-4 py-2.5 rounded-xl text-sm font-bold text-gray-500 hover:bg-gray-100 dark:hover:bg-white/8 transition-colors">
                Cancel
              </button>
              <button onClick={saveEdit} disabled={saving}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
                {saving && <Loader2 size={13} className="animate-spin" />}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      <BookingDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onBooked={() => { setDrawerOpen(false); setRefreshKey(k => k + 1) }}
      />
    </div>
  )
}
