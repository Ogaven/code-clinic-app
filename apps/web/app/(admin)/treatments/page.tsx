'use client'

import { useEffect, useState } from 'react'
import { Stethoscope, Search } from 'lucide-react'
import { cn, formatUGX } from '@/lib/utils'
import Avatar from '@/components/ui/Avatar'

interface Appointment {
  id: string
  status: string
  startAt: string
  endAt: string
  notes?: string
  patient: { id: string; firstName: string; lastName: string; avatarUrl?: string | null }
  service: { name: string; durationMins: number; priceUGX: number; colour: string }
  doctor: { colour: string; user: { firstName: string; lastName: string } }
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  PENDING:    { label: 'Pending',     cls: 'bg-yellow-100 text-yellow-700' },
  CONFIRMED:  { label: 'Confirmed',   cls: 'bg-blue-100 text-blue-700' },
  COMPLETED:  { label: 'Completed',   cls: 'bg-green-100 text-green-700' },
  CANCELLED:  { label: 'Cancelled',   cls: 'bg-red-100 text-red-700' },
  NO_SHOW:    { label: 'No Show',     cls: 'bg-gray-100 text-gray-500' },
}

const STATUS_TABS = ['ALL', 'CONFIRMED', 'COMPLETED', 'PENDING', 'CANCELLED']

export default function TreatmentsPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('ALL')
  const [search, setSearch] = useState('')
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null

  useEffect(() => {
    const today = new Date().toISOString().split('T')[0]
    fetch(`${process.env.NEXT_PUBLIC_API_URL || '/api-proxy'}/scheduling/calendar?date=${today}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then((data: any) => {
        // Calendar returns grouped by doctor; flatten all appointments
        const all: Appointment[] = []
        if (Array.isArray(data)) {
          data.forEach((col: any) => {
            if (Array.isArray(col.appointments)) all.push(...col.appointments)
          })
        }
        setAppointments(all)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const filtered = appointments.filter(a => {
    if (tab !== 'ALL' && a.status !== tab) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        a.patient?.firstName?.toLowerCase().includes(q) ||
        a.patient?.lastName?.toLowerCase().includes(q) ||
        a.service?.name?.toLowerCase().includes(q)
      )
    }
    return true
  })

  async function updateStatus(id: string, status: string) {
    await fetch(`${process.env.NEXT_PUBLIC_API_URL || '/api-proxy'}/scheduling/appointments/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status }),
    })
    setAppointments(as => as.map(a => a.id === id ? { ...a, status } : a))
  }

  const counts = STATUS_TABS.reduce((acc, s) => {
    acc[s] = s === 'ALL' ? appointments.length : appointments.filter(a => a.status === s).length
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="space-y-4 animate-fade-in">
      <div>
        <h2 className="text-2xl font-bold text-clinic-navy">Treatments</h2>
        <p className="text-sm text-gray-400 mt-0.5">Today's appointments & treatment status</p>
      </div>

      {/* Status tabs (clone Zendeta 085000) */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
        <div className="flex border-b border-gray-100 overflow-x-auto">
          {STATUS_TABS.map(s => (
            <button key={s} onClick={() => setTab(s)}
              className={cn(
                'flex items-center gap-2 px-5 py-3.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors',
                tab === s ? 'border-clinic-blue text-clinic-navy' : 'border-transparent text-gray-400 hover:text-gray-600',
              )}>
              {s === 'ALL' ? 'All Treatments' : STATUS_BADGE[s]?.label || s}
              <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full',
                tab === s ? 'bg-clinic-blue text-white' : 'bg-gray-100 text-gray-400')}>
                {counts[s] || 0}
              </span>
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="p-4 border-b border-gray-50">
          <div className="relative max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search patient or treatment..."
              className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-clinic-blue" />
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                {['Patient', 'Treatment', 'Doctor', 'Price (UGX)', 'Duration', 'Time', 'Status', 'Actions'].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-3.5 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>{Array.from({ length: 8 }).map((_, j) => (
                    <td key={j} className="px-5 py-4"><div className="h-4 bg-gray-100 rounded animate-pulse w-20" /></td>
                  ))}</tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-14 text-center text-gray-400">
                    <Stethoscope size={36} className="mx-auto mb-3 opacity-20" />
                    <p className="text-sm">{search ? `No results for "${search}"` : 'No treatments for today'}</p>
                  </td>
                </tr>
              ) : filtered.map(appt => {
                const badge = STATUS_BADGE[appt.status] || { label: appt.status, cls: 'bg-gray-100 text-gray-500' }
                const startTime = new Date(appt.startAt).toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit' })
                return (
                  <tr key={appt.id} className="hover:bg-blue-50/20 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <Avatar
                          firstName={appt.patient?.firstName}
                          lastName={appt.patient?.lastName}
                          avatarUrl={appt.patient?.avatarUrl}
                          size="sm"
                        />
                        <span className="text-sm font-medium text-gray-800">
                          {appt.patient?.firstName} {appt.patient?.lastName}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: appt.service?.colour || '#29ABE2' }} />
                        <span className="text-sm text-gray-700">{appt.service?.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-gray-500">
                      Dr. {appt.doctor?.user?.firstName} {appt.doctor?.user?.lastName}
                    </td>
                    <td className="px-5 py-3.5 text-sm font-semibold text-clinic-navy font-mono">
                      {appt.service?.priceUGX ? formatUGX(appt.service.priceUGX) : '—'}
                    </td>
                    <td className="px-5 py-3.5 text-sm text-gray-500">
                      {appt.service?.durationMins}min
                    </td>
                    <td className="px-5 py-3.5 text-sm text-gray-500 font-mono">{startTime}</td>
                    <td className="px-5 py-3.5">
                      <span className={cn('text-xs font-semibold px-2.5 py-1 rounded-full', badge.cls)}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        {appt.status === 'CONFIRMED' && (
                          <button onClick={() => updateStatus(appt.id, 'COMPLETED')}
                            className="text-xs text-green-600 hover:underline font-medium">
                            Complete
                          </button>
                        )}
                        {appt.status === 'PENDING' && (
                          <button onClick={() => updateStatus(appt.id, 'CONFIRMED')}
                            className="text-xs text-clinic-blue hover:underline font-medium">
                            Confirm
                          </button>
                        )}
                        {(appt.status === 'PENDING' || appt.status === 'CONFIRMED') && (
                          <button onClick={() => updateStatus(appt.id, 'NO_SHOW')}
                            className="text-xs text-gray-400 hover:text-red-400 font-medium">
                            No Show
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
