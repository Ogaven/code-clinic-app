'use client'

import Link from 'next/link'
import { FileBarChart, ArrowUpRight } from 'lucide-react'

const REPORTS = [
  'Response-Time Leaderboard', 'Stage Conversion Rates', 'Stale Leads', 'Weekly Cold Leads',
  'Case Acceptance', 'Sequence Performance', 'Aging Receivables', 'Call Performance',
  'Acquisition Revenue Attribution',
]

// Deliberately not a second reporting UI — CRM Automation Settings already
// has a full Reporting tab wired to every report below. This page is the
// CRM shell's front door to it, per "reuse existing CRM reporting
// services/components... do not duplicate existing reports unnecessarily."
export default function CrmReportsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-extrabold text-gray-800 dark:text-white">Reports</h1>
        <p className="text-sm text-gray-500 dark:text-white/50">Every CRM report already lives in CRM Automation Settings — this links straight there instead of duplicating it.</p>
      </div>

      <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 p-5">
        <div className="flex items-center gap-2 mb-3">
          <FileBarChart size={18} className="text-blue-600 dark:text-blue-400" />
          <p className="font-bold text-gray-800 dark:text-white">Available reports</p>
        </div>
        <ul className="grid grid-cols-1 gap-1.5 text-sm text-gray-600 dark:text-white/60 sm:grid-cols-2 mb-4">
          {REPORTS.map(r => <li key={r} className="flex items-center gap-1.5">· {r}</li>)}
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
