'use client'

import Link from 'next/link'
import { TrendingUp, Scale, Activity, FileBarChart, ChevronRight } from 'lucide-react'

const REPORTS = [
  {
    href:        '/accounts/reports/pl',
    icon:        TrendingUp,
    iconBg:      'bg-emerald-100 dark:bg-emerald-900/30',
    iconColor:   'text-emerald-600 dark:text-emerald-400',
    accentColor: '#059669',
    title:       'Profit & Loss',
    description: 'Revenue vs. expenses for any period — see net profit, cost of services, and gross margin.',
  },
  {
    href:        '/accounts/reports/balance',
    icon:        Scale,
    iconBg:      'bg-blue-100 dark:bg-blue-900/30',
    iconColor:   'text-blue-600 dark:text-blue-400',
    accentColor: '#2563eb',
    title:       'Balance Sheet',
    description: 'Snapshot of assets, liabilities, and equity at any point in time.',
  },
  {
    href:        '/accounts/reports/cashflow',
    icon:        Activity,
    iconBg:      'bg-cyan-100 dark:bg-cyan-900/30',
    iconColor:   'text-cyan-600 dark:text-cyan-400',
    accentColor: '#0891b2',
    title:       'Cash Flow',
    description: 'Money in vs. money out — track operating, investing, and financing cash movements.',
  },
  {
    href:        '/accounts/reports/tax',
    icon:        FileBarChart,
    iconBg:      'bg-violet-100 dark:bg-violet-900/30',
    iconColor:   'text-violet-600 dark:text-violet-400',
    accentColor: '#7c3aed',
    title:       'Tax Report',
    description: 'VAT, withholding tax, and other tax obligations summarised for filing.',
  },
]

export default function AccountsReportsPage() {
  return (
    <div className="space-y-6 animate-fade-in p-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-clinic-navy dark:text-white leading-none">Financial Reports</h1>
        <p className="text-sm text-gray-400 mt-0.5">Practice financial performance and compliance</p>
      </div>

      {/* Report cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 max-w-3xl">
        {REPORTS.map(({ href, icon: Icon, iconBg, iconColor, accentColor, title, description }) => (
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
            <span className="text-sm font-semibold transition-colors" style={{ color: accentColor }}>
              View report →
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}
