'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { UserCog, Shield, ScrollText, Settings2 } from 'lucide-react'

export default function SettingsPage() {
  const [user, setUser] = useState<any>(null)

  useEffect(() => {
    const stored = localStorage.getItem('cc_user')
    if (stored) setUser(JSON.parse(stored))
  }, [])

  if (!user) return null

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">

      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold text-clinic-navy dark:text-white">Settings</h2>
        <p className="text-sm text-gray-400 mt-0.5">Clinic and application configuration</p>
      </div>

      {user.role === 'ADMIN' ? (
        <section className="bg-white dark:bg-white/5 rounded-2xl shadow-sm border border-gray-100 dark:border-white/10 p-6">
          <h3 className="font-semibold text-clinic-navy dark:text-white mb-1">Practice Administration</h3>
          <p className="text-xs text-gray-400 mb-4">Manage staff access and review operational activity.</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { href: '/employees', label: 'Staff List', icon: UserCog },
              { href: '/admin/staff/permissions', label: 'Staff Permissions', icon: Shield },
              { href: '/audit-log', label: 'Audit Log', icon: ScrollText },
            ].map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href}
                className="flex items-center gap-3 rounded-xl border border-gray-100 dark:border-white/10 p-3 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:border-cyan-300 hover:bg-cyan-50/50 dark:hover:bg-cyan-400/5 transition-colors">
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-cyan-50 dark:bg-cyan-400/10 text-cyan-600 dark:text-cyan-300"><Icon size={16} /></span>
                {label}
              </Link>
            ))}
          </div>
        </section>
      ) : (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 py-16 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-gray-50 text-gray-300 dark:bg-white/5 dark:text-slate-500">
            <Settings2 size={20} />
          </span>
          <p className="text-sm font-semibold text-gray-600 dark:text-slate-300">No clinic settings for your role</p>
          <p className="max-w-xs text-xs text-gray-400">Looking for your personal details or password? Open My Profile from the profile menu.</p>
        </div>
      )}

    </div>
  )
}
