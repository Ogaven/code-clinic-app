'use client'

import { CheckCircle2 } from 'lucide-react'
import NeedsAttentionPanel from '@/components/leads/NeedsAttentionPanel'

export default function NeedsAttentionPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-extrabold text-gray-800 dark:text-white">Needs Attention</h1>
        <p className="text-sm text-gray-500 dark:text-white/50">Every category here reads directly from existing lead, appointment and treatment-plan state — nothing is scored or inferred.</p>
      </div>
      <NeedsAttentionPanel
        onSelectLead={id => { window.location.href = `/leads?open=${id}` }}
        emptyState={
          <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 p-10 text-center">
            <CheckCircle2 size={28} className="text-emerald-500" />
            <p className="text-sm font-semibold text-gray-700 dark:text-white/80">Nothing needs attention right now.</p>
            <p className="text-xs text-gray-400 dark:text-white/40">New leads, overdue follow-ups, no-shows and treatment opportunities will show up here.</p>
          </div>
        }
      />
    </div>
  )
}
