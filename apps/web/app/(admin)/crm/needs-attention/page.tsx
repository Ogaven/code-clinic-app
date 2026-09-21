'use client'

import NeedsAttentionWorkspace from '@/components/crm/NeedsAttentionWorkspace'
import FollowUpsWorkspace from '@/components/crm/FollowUpsWorkspace'

// Follow-up tasks were previously a separate top-level CRM nav destination
// (/crm/follow-ups, preserved for compatibility — still a real, working
// route). They're consolidated here because Needs Attention is meant to be
// the one work queue for leads requiring staff action — reusing
// FollowUpsWorkspace as-is rather than reimplementing its Task-model logic.
export default function NeedsAttentionPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-extrabold text-gray-800 dark:text-white">Needs Attention</h1>
        <p className="text-sm text-gray-500 dark:text-white/50">Every category here reads directly from existing lead, appointment and treatment-plan state — nothing is scored or inferred.</p>
      </div>
      <NeedsAttentionWorkspace
        leadsHref="/leads"
        patientHref={id => `/patients/${id}`}
        inboxHref={phone => `/ai-suite/inbox?phone=${encodeURIComponent(phone)}`}
      />
      <FollowUpsWorkspace leadsHref="/leads" />
    </div>
  )
}
