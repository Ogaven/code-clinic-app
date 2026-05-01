'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  LayoutDashboard, Users, CalendarDays,
  Settings, UserCheck, DollarSign,
} from 'lucide-react'

const QUICK_LINKS = [
  { label: 'Full Dashboard',  href: '/dashboard',          icon: LayoutDashboard },
  { label: 'Scheduling',      href: '/scheduling',         icon: CalendarDays },
  { label: 'Patients',        href: '/patients',           icon: Users },
  { label: 'Staff',           href: '/employees',          icon: UserCheck },
  { label: 'Accounts',        href: '/accounts/dashboard', icon: DollarSign },
  { label: 'Settings',        href: '/settings',           icon: Settings },
]

export default function AdminDashboardPage() {
  const [name, setName] = useState('Admin')

  useEffect(() => {
    try {
      const u = JSON.parse(localStorage.getItem('cc_user') || 'null')
      if (u?.firstName) setName(`${u.firstName} ${u.lastName || ''}`.trim())
    } catch {}
  }, [])

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white font-[Plus_Jakarta_Sans]">
          Welcome back, {name}
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Admin Portal — Code Clinic Management System
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {QUICK_LINKS.map(({ label, href, icon: Icon }) => (
          <Link key={href} href={href}
            className="flex items-center gap-3 rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 px-4 py-4 hover:bg-gray-50 dark:hover:bg-white/10 transition-colors">
            <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
              <Icon size={18} className="text-blue-600 dark:text-blue-400" />
            </div>
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-200 leading-tight">{label}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
