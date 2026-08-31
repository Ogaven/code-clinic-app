'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { CalendarDays, ClipboardList, Stethoscope, Users } from 'lucide-react'
import MultiDoctorCalendar from '@/components/scheduling/MultiDoctorCalendar'
import AdminAppointmentsList from '@/components/scheduling/AdminAppointmentsList'
import { cn } from '@/lib/utils'

type Tab = 'calendar' | 'appointments' | 'doctors' | 'services'

function Directory({ type }: { type: 'doctors' | 'services' }) {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const token = localStorage.getItem('cc_token')
    fetch(`/api-proxy/${type}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async response => response.ok ? response.json() : [])
      .then(data => setRows(Array.isArray(data) ? data : data?.[type] || []))
      .catch(() => setRows([])).finally(() => setLoading(false))
  }, [type])
  if (loading) return <div className="grid place-items-center py-20 text-sm text-muted-foreground">Loading directory…</div>
  return <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
    {rows.map(row => {
      const name = type === 'doctors' ? `${row.user?.firstName || row.firstName || ''} ${row.user?.lastName || row.lastName || ''}`.trim() : row.name
      return <article key={row.id} className="rounded-2xl border bg-card p-5 shadow-sm">
        <div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-xl bg-cyan-50 text-cyan-700 dark:bg-cyan-400/10">{type === 'doctors' ? <Users size={20}/> : <Stethoscope size={20}/>}</div><div><h3 className="font-semibold">{name || 'Unnamed'}</h3><p className="text-xs text-muted-foreground">{type === 'doctors' ? row.specialization || row.title || 'Dental provider' : `${row.durationMins || '—'} minutes`}</p></div></div>
        {type === 'services' && row.description && <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{row.description}</p>}
      </article>
    })}
    {!rows.length && <div className="col-span-full rounded-2xl border border-dashed p-12 text-center text-sm text-muted-foreground">No {type} are available.</div>}
  </div>
}

function ScheduleWorkspace() {
  const params = useSearchParams(), router = useRouter()
  const requested = params.get('tab') as Tab | null
  const tab: Tab = requested && ['calendar','appointments','doctors','services'].includes(requested) ? requested : 'calendar'
  const tabs = [
    { key: 'calendar' as const, label: 'Calendar', icon: CalendarDays },
    { key: 'appointments' as const, label: 'My Appointments', icon: ClipboardList },
    { key: 'doctors' as const, label: 'Doctors', icon: Users },
    { key: 'services' as const, label: 'Services', icon: Stethoscope },
  ]
  return <section className="overflow-hidden rounded-3xl border bg-card shadow-sm">
    <div className="flex gap-1 overflow-x-auto border-b px-3 pt-3">{tabs.map(item => <button key={item.key} onClick={() => router.replace(`/doctor/schedule?tab=${item.key}`)} className={cn('flex items-center gap-2 whitespace-nowrap rounded-t-xl border-b-2 px-4 py-3 text-sm transition', tab === item.key ? 'border-cyan-500 bg-cyan-50 font-semibold text-cyan-700 dark:bg-cyan-400/10 dark:text-cyan-300' : 'border-transparent text-muted-foreground hover:text-foreground')}><item.icon size={16}/>{item.label}</button>)}</div>
    <div className={cn(tab === 'calendar' && 'h-[calc(100vh-12rem)] min-h-[620px]')}>{tab === 'calendar' && <MultiDoctorCalendar/>}{tab === 'appointments' && <div className="p-4"><AdminAppointmentsList userRole="DOCTOR"/></div>}{tab === 'doctors' && <Directory type="doctors"/>}{tab === 'services' && <Directory type="services"/>}</div>
  </section>
}

export default function DoctorSchedulePage() { return <Suspense fallback={<div className="p-12 text-center text-sm text-muted-foreground">Loading appointments…</div>}><ScheduleWorkspace/></Suspense> }
