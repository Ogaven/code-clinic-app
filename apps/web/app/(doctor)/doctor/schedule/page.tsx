'use client'

import { useState } from 'react'
import { CalendarDays, Users, Stethoscope } from 'lucide-react'
import { cn } from '@/lib/utils'
import MultiDoctorCalendar from '@/components/scheduling/MultiDoctorCalendar'
import DoctorsTab from '@/components/scheduling/DoctorsTab'
import ServicesTab from '@/components/scheduling/ServicesTab'

type Tab = 'calendar' | 'doctors' | 'services'

export default function DoctorSchedulePage() {
  const [tab, setTab] = useState<Tab>('calendar')

  return (
    <div className="h-[calc(100vh-3.5rem)] flex flex-col">
      {/* Tab bar */}
      <div className="flex-shrink-0 flex items-center gap-1 px-4 pt-3 pb-0 bg-white dark:bg-white/5 dark:backdrop-blur-sm border-b border-gray-100 dark:border-white/8">
        {([
          { key: 'calendar', label: 'Calendar',  Icon: CalendarDays },
          { key: 'doctors',  label: 'Doctors',   Icon: Users        },
          { key: 'services', label: 'Services',  Icon: Stethoscope  },
        ] as { key: Tab; label: string; Icon: any }[]).map(({ key, label, Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-all -mb-px',
              tab === key
                ? 'border-cyan-500 text-cyan-600 dark:text-cyan-400'
                : 'border-transparent text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300',
            )}>
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      {/* Content — read-only view for doctors */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {tab === 'calendar' && <MultiDoctorCalendar />}
        {tab === 'doctors'  && <DoctorsTab />}
        {tab === 'services' && <ServicesTab />}
      </div>
    </div>
  )
}
