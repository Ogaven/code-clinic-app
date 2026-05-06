'use client'

import { useState } from 'react'
import { CalendarDays, List, Users, Clock, UserCog, Star, Upload, Plug } from 'lucide-react'
import { cn } from '@/lib/utils'
import MultiDoctorCalendar  from '@/components/scheduling/MultiDoctorCalendar'
import BookingDrawer        from '@/components/scheduling/BookingDrawer'
import AppointmentModal     from '@/components/scheduling/AppointmentModal'
import AppointmentsListTab  from '@/components/scheduling/AppointmentsListTab'
import DoctorsTab           from '@/components/scheduling/DoctorsTab'
import WorkingHoursTab      from '@/components/scheduling/WorkingHoursTab'
import ProvidersScheduleTab from '@/components/scheduling/ProvidersScheduleTab'
import SpecialDaysTab       from '@/components/scheduling/SpecialDaysTab'
import ImportTab            from '@/components/scheduling/ImportTab'
import ConnectionsTab       from '@/components/scheduling/ConnectionsTab'

type Tab = 'calendar' | 'appointments' | 'doctors' | 'working-hours' | 'providers-schedule' | 'special-days' | 'import' | 'connections'

const TABS: { key: Tab; label: string; Icon: React.ElementType }[] = [
  { key: 'calendar',           label: 'Calendar',           Icon: CalendarDays },
  { key: 'appointments',       label: 'Appointments',       Icon: List         },
  { key: 'doctors',            label: 'Doctors',            Icon: Users        },
  { key: 'working-hours',      label: 'Working Hours',      Icon: Clock        },
  { key: 'providers-schedule', label: 'Providers Schedule', Icon: UserCog      },
  { key: 'special-days',       label: 'Special Days',       Icon: Star         },
  { key: 'import',             label: 'Import',             Icon: Upload       },
  { key: 'connections',        label: 'Connections',        Icon: Plug         },
]

export default function AppointmentsPage() {
  const [tab,             setTab]             = useState<Tab>('calendar')
  const [drawerOpen,      setDrawerOpen]      = useState(false)
  const [prefillDoctorId, setPrefillDoctorId] = useState<string | undefined>()
  const [prefillStartAt,  setPrefillStartAt]  = useState<Date | undefined>()
  const [selectedAppt,    setSelectedAppt]    = useState<any | null>(null)
  const [refreshKey,      setRefreshKey]      = useState(0)

  function handleBookSlot(doctorId: string, startAt: Date) {
    setPrefillDoctorId(doctorId || undefined)
    setPrefillStartAt(startAt)
    setDrawerOpen(true)
  }

  return (
    <div className="h-[calc(100vh-3.5rem)] flex flex-col">
      {/* Tab bar */}
      <div className="flex-shrink-0 flex items-center gap-0.5 px-3 pt-3 pb-0 bg-white dark:bg-white/5 dark:backdrop-blur-sm border-b border-gray-100 dark:border-white/8 overflow-x-auto scrollbar-none">
        {TABS.map(({ key, label, Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 transition-all -mb-px whitespace-nowrap flex-shrink-0',
              tab === key
                ? 'border-cyan-500 text-cyan-600 dark:text-cyan-400'
                : 'border-transparent text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300',
            )}>
            <Icon size={13} />
            {label}
          </button>
        ))}

        {/* Book button — only on calendar */}
        {tab === 'calendar' && (
          <button
            onClick={() => { setPrefillDoctorId(undefined); setPrefillStartAt(undefined); setDrawerOpen(true) }}
            className="ml-auto mb-1 flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5 hover:shadow-md"
            style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)', boxShadow: '0 4px 12px rgba(41,171,226,0.3)' }}>
            + Book Appointment
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {tab === 'calendar' && (
          <MultiDoctorCalendar
            key={refreshKey}
            onBookSlot={handleBookSlot}
            onClickAppointment={setSelectedAppt}
          />
        )}
        {tab === 'appointments'       && <AppointmentsListTab />}
        {tab === 'doctors'            && <DoctorsTab />}
        {tab === 'working-hours'      && <WorkingHoursTab />}
        {tab === 'providers-schedule' && <ProvidersScheduleTab />}
        {tab === 'special-days'       && <SpecialDaysTab />}
        {tab === 'import'             && <ImportTab />}
        {tab === 'connections'        && <ConnectionsTab />}
      </div>

      {/* Booking drawer */}
      <BookingDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        prefillDoctorId={prefillDoctorId}
        prefillStartAt={prefillStartAt}
        onBooked={() => { setRefreshKey(k => k + 1); setDrawerOpen(false) }}
      />

      {/* Appointment detail modal */}
      {selectedAppt && (
        <AppointmentModal
          appointment={selectedAppt}
          onClose={() => setSelectedAppt(null)}
          onStatusChange={() => { setRefreshKey(k => k + 1); setSelectedAppt(null) }}
          userRole="RECEPTIONIST"
        />
      )}
    </div>
  )
}
