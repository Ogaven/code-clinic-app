'use client'

import Link from 'next/link'
import { ArrowLeft, Activity, TrendingUp, ChevronRight, ClipboardList } from 'lucide-react'

const REPORTS = [
  {
    href:        '/reports/clinical',
    icon:        ClipboardList,
    iconBg:      'bg-emerald-100 dark:bg-emerald-900/30',
    iconColor:   'text-emerald-600 dark:text-emerald-400',
    accentColor: '#059669',
    title:       'Daily / Weekly Clinical Report',
    description: 'Patients seen, new vs. returning, cancellations, no-shows, and a follow-up list with WhatsApp shortcuts.',
    cta:         'View report',
  },
  {
    href:        '/reports/patient-flow',
    icon:        Activity,
    iconBg:      'bg-blue-100 dark:bg-blue-900/30',
    iconColor:   'text-blue-600 dark:text-blue-400',
    accentColor: '#2563eb',
    title:       'Patient Flow',
    description: "Today's patient journey through all clinical stages — arrivals, wait times, chair time, and departures.",
    cta:         'View report',
  },
  {
    href:        '/reports/case-acceptance',
    icon:        TrendingUp,
    iconBg:      'bg-cyan-100 dark:bg-cyan-900/30',
    iconColor:   'text-cyan-600 dark:text-cyan-400',
    accentColor: '#0891b2',
    title:       'Case Acceptance Rate',
    description: 'Treatment plans presented vs. accepted by month, with per-doctor breakdown and follow-up tracking.',
    cta:         'View report',
  },
]

export default function ReportsHubPage() {
  return (
    <div className="space-y-6 animate-fade-in p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/dashboard"
          className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-white/10 transition-colors text-gray-400">
          <ArrowLeft size={16} />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-clinic-navy dark:text-white leading-none">Clinical Reports</h1>
          <p className="text-sm text-gray-400 mt-0.5">Practice performance at a glance</p>
        </div>
      </div>

      {/* Report cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 max-w-3xl">
        {REPORTS.map(({ href, icon: Icon, iconBg, iconColor, accentColor, title, description, cta }) => (
          <Link key={href} href={href}
            className="group bg-white dark:bg-white/5 border border-gray-100 dark:border-white/10 rounded-2xl p-6 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all flex flex-col gap-4">
            <div className="flex items-start justify-between">
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${iconBg}`}>
                <Icon size={20} className={iconColor} />
              </div>
              <ChevronRight size={16} className="text-gray-300 dark:text-white/20 group-hover:text-gray-500 dark:group-hover:text-white/50 transition-colors mt-1" />
            </div>
            <div className="flex-1">
              <h2 className="text-base font-bold text-gray-800 dark:text-white">{title}</h2>
              <p className="text-sm text-gray-400 dark:text-white/50 mt-1 leading-relaxed">{description}</p>
            </div>
            <span className="text-sm font-semibold transition-colors"
              style={{ color: accentColor }}>
              {cta} →
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}
