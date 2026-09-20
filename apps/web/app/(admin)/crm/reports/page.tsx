'use client'

import Link from 'next/link'
import { FileBarChart, ArrowUpRight } from 'lucide-react'

// Each report's real destination — kept explicit per-item after an audit
// found two of these advertised as living in "CRM Automation Settings" when
// they actually don't: Case Acceptance now does (added to the Reporting tab
// below), but Acquisition Revenue Attribution genuinely lives on the
// dedicated Revenue workspace instead, which has a richer by-source
// breakdown than a single reporting tab would. Linking each report to where
// it actually is beats a single button that silently under-delivers on two
// of nine items.
const REPORTS: Array<{ label: string; href: string }> = [
  { label: 'Response-Time Leaderboard',        href: '/admin/crm-automation?tab=reporting' },
  { label: 'Stage Conversion Rates',           href: '/admin/crm-automation?tab=reporting' },
  { label: 'Stale Leads',                      href: '/admin/crm-automation?tab=reporting' },
  { label: 'Weekly Cold Leads',                href: '/admin/crm-automation?tab=reporting' },
  { label: 'Case Acceptance (CRM Tags)',       href: '/admin/crm-automation?tab=reporting' },
  { label: 'Sequence Performance',             href: '/admin/crm-automation?tab=reporting' },
  { label: 'Aging Receivables',                href: '/admin/crm-automation?tab=reporting' },
  { label: 'Call Performance',                 href: '/admin/crm-automation?tab=reporting' },
  { label: 'Acquisition Revenue Attribution',  href: '/crm/revenue' },
]

// Deliberately not a second reporting UI — CRM Automation Settings already
// has a full Reporting tab wired to most reports below; the one exception
// (Revenue) is linked directly to its own dedicated workspace instead of
// pretending it lives somewhere it doesn't. Per "reuse existing CRM
// reporting services/components... do not duplicate existing reports
// unnecessarily."
export default function CrmReportsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-extrabold text-gray-800 dark:text-white">Reports</h1>
        <p className="text-sm text-gray-500 dark:text-white/50">Every CRM report links straight to where it actually lives — either CRM Automation Settings' Reporting tab, or its own dedicated workspace.</p>
      </div>

      <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 p-5">
        <div className="flex items-center gap-2 mb-3">
          <FileBarChart size={18} className="text-blue-600 dark:text-blue-400" />
          <p className="font-bold text-gray-800 dark:text-white">Available reports</p>
        </div>
        <ul className="grid grid-cols-1 gap-1.5 text-sm mb-4 sm:grid-cols-2">
          {REPORTS.map(r => (
            <li key={r.label}>
              <Link href={r.href} className="flex items-center gap-1.5 text-gray-600 dark:text-white/60 hover:text-blue-600 dark:hover:text-blue-400">
                · {r.label} <ArrowUpRight size={12} className="opacity-50" />
              </Link>
            </li>
          ))}
        </ul>
        <Link href="/admin/crm-automation?tab=reporting"
          className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold text-white transition-all"
          style={{ background: 'linear-gradient(135deg,#0c1e50,#29ABE2)' }}>
          Open Full Reporting <ArrowUpRight size={14} />
        </Link>
      </div>
    </div>
  )
}
