'use client'

import { useState } from 'react'
import { CalendarDays, Users, Stethoscope, Plug, Settings, X, Upload } from 'lucide-react'
import { cn } from '@/lib/utils'
import MultiDoctorCalendar  from '@/components/scheduling/MultiDoctorCalendar'
import BookingDrawer        from '@/components/scheduling/BookingDrawer'
import AppointmentModal     from '@/components/scheduling/AppointmentModal'
import DoctorsTab           from '@/components/scheduling/DoctorsTab'
import ServicesTab          from '@/components/scheduling/ServicesTab'
import WorkingHoursTab      from '@/components/scheduling/WorkingHoursTab'
import ProvidersScheduleTab from '@/components/scheduling/ProvidersScheduleTab'
import SpecialDaysTab       from '@/components/scheduling/SpecialDaysTab'
import ImportTab            from '@/components/scheduling/ImportTab'
import ConnectionsTab       from '@/components/scheduling/ConnectionsTab'
import BookingSettingsTab   from '@/components/scheduling/BookingSettingsTab'

type Tab = 'calendar' | 'doctors' | 'services' | 'connections' | 'settings'
type SettingsSub = 'working-hours' | 'doctors-schedule' | 'special-days' | 'booking'

const TABS: { key: Tab; label: string; Icon: React.ElementType }[] = [
  { key: 'calendar',    label: 'Calendar',    Icon: CalendarDays },
  { key: 'doctors',     label: 'Doctors',     Icon: Users        },
  { key: 'services',    label: 'Services',    Icon: Stethoscope  },
  { key: 'connections', label: 'Connections', Icon: Plug         },
  { key: 'settings',    label: 'Settings',    Icon: Settings     },
]

const SETTINGS_SUBS: { key: SettingsSub; label: string }[] = [
  { key: 'working-hours',    label: 'Working Hours'    },
  { key: 'doctors-schedule', label: 'Doctors Schedule' },
  { key: 'special-days',     label: 'Special Days'     },
  { key: 'booking',          label: 'Booking Rules'    },
]

export default function AppointmentsPage() {
  const [tab,             setTab]             = useState<Tab>('calendar')
  const [settingsSub,     setSettingsSub]     = useState<SettingsSub>('working-hours')
  const [importOpen,      setImportOpen]      = useState(false)
  const [drawerOpen,      setDrawerOpen]      = useState(false)
  const [prefillDoctorId, setPrefillDoctorId] = useState<string | undefined>()
  const [prefillStartAt,  setPrefillStartAt]  = useState<Date | undefined>()
  const [prefillPatient,  setPrefillPatient]  = useState<{ id: string; firstName: string; lastName: string; phone: string } | undefined>()
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

        {tab === 'calendar' && (
          <div className="ml-auto flex items-center gap-2 mb-1 flex-shrink-0">
            <button
              onClick={() => setImportOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold border border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-all">
              <Upload size={13} />
              Import
            </button>
            <button
              onClick={() => { setPrefillDoctorId(undefined); setPrefillStartAt(undefined); setDrawerOpen(true) }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5 hover:shadow-md"
              style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)', boxShadow: '0 4px 12px rgba(41,171,226,0.3)' }}>
              + Book Appointment
            </button>
          </div>
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
        {tab === 'doctors'     && <DoctorsTab />}
        {tab === 'services'    && <ServicesTab />}
        {tab === 'connections' && <ConnectionsTab />}
        {tab === 'settings' && (
          <div className="flex flex-col flex-1 overflow-hidden">
            <div className="flex-shrink-0 flex gap-1 border-b border-gray-100 dark:border-white/8 px-4 bg-white dark:bg-white/3">
              {SETTINGS_SUBS.map(({ key, label }) => (
                <button key={key} onClick={() => setSettingsSub(key)}
                  className={cn(
                    'px-3 py-2 text-xs font-semibold border-b-2 transition-all -mb-px whitespace-nowrap',
                    settingsSub === key
                      ? 'border-cyan-500 text-cyan-600 dark:text-cyan-400'
                      : 'border-transparent text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300',
                  )}>
                  {label}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-hidden">
              {settingsSub === 'working-hours'    && <WorkingHoursTab />}
              {settingsSub === 'doctors-schedule' && <ProvidersScheduleTab />}
              {settingsSub === 'special-days'     && <SpecialDaysTab />}
              {settingsSub === 'booking'          && <BookingSettingsTab />}
            </div>
          </div>
        )}
      </div>

      <BookingDrawer
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setPrefillPatient(undefined) }}
        prefillDoctorId={prefillDoctorId}
        prefillStartAt={prefillStartAt}
        prefillPatient={prefillPatient}
        onBooked={() => { setRefreshKey(k => k + 1); setDrawerOpen(false) }}
      />

      {selectedAppt && (
        <AppointmentModal
          appointment={selectedAppt}
          onClose={() => setSelectedAppt(null)}
          onStatusChange={() => { setRefreshKey(k => k + 1); setSelectedAppt(null) }}
          onBookFollowUp={(patient, doctorId) => {
            setSelectedAppt(null)
            setPrefillPatient(patient)
            setPrefillDoctorId(doctorId)
            setPrefillStartAt(undefined)
            setDrawerOpen(true)
          }}
          userRole="RECEPTIONIST"
        />
      )}

      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#0f1729] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col border border-gray-100 dark:border-white/10">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/8 flex-shrink-0">
              <h2 className="font-black text-gray-800 dark:text-white">Import Appointments</h2>
              <button onClick={() => setImportOpen(false)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-white/8 transition-colors">
                <X size={16} className="text-gray-400" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <ImportTab />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
