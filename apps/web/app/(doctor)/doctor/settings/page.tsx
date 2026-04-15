'use client'

import Link from 'next/link'
import { ArrowLeft, UserCircle, HelpCircle, Download, Shield } from 'lucide-react'

const LINKS = [
  { icon: UserCircle, label: 'Edit Profile',       sub: 'Photo, name, availability, password', href: '/doctor/profile' },
  { icon: Shield,     label: 'Privacy & Security', sub: 'Change password, session management',  href: '/doctor/profile' },
  { icon: HelpCircle, label: 'Help & Support',     sub: 'FAQs, contact admin, Sarah AI',        href: '/doctor/support' },
  { icon: Download,   label: 'Download App',       sub: 'Install the PWA on your phone',        href: '/doctor/download' },
]

export default function DoctorSettingsPage() {
  return (
    <div className="space-y-4 p-4 md:p-6 pb-24 md:pb-6 animate-fade-in max-w-xl">
      <div className="flex items-center gap-3">
        <Link href="/doctor/dashboard" className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-white/10 text-gray-400 transition-colors">
          <ArrowLeft size={16} />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-white">Settings</h1>
          <p className="text-sm text-gray-400 mt-0.5">Manage your account and preferences</p>
        </div>
      </div>

      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden divide-y divide-gray-50 dark:divide-white/[0.04]">
        {LINKS.map(({ icon: Icon, label, sub, href }) => (
          <Link key={label} href={href}
            className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50 dark:hover:bg-white/[0.03] transition-colors group">
            <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
              <Icon size={18} className="text-blue-500 dark:text-blue-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-800 dark:text-white">{label}</p>
              <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
            </div>
            <span className="text-gray-300 dark:text-white/20 group-hover:text-gray-400 transition-colors">›</span>
          </Link>
        ))}
      </div>

      <p className="text-center text-xs text-gray-300 dark:text-white/20 pt-2">
        Code Clinic · Doctor Portal
      </p>
    </div>
  )
}
