'use client'

import DoctorsTab from '@/components/scheduling/DoctorsTab'

export default function DoctorsPage() {
  return (
    <div className="h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="flex-shrink-0 px-6 py-4 border-b border-gray-100 dark:border-white/8 bg-white dark:bg-white/5 dark:backdrop-blur-sm">
        <h1 className="text-xl font-black text-gray-800 dark:text-white">Doctors</h1>
        <p className="text-xs text-gray-400 mt-0.5">Manage profiles, schedules, availability and blocked time slots</p>
      </div>
      <div className="flex-1 overflow-hidden">
        <DoctorsTab />
      </div>
    </div>
  )
}
