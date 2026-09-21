'use client'

import NeedsAttentionWorkspace from '@/components/crm/NeedsAttentionWorkspace'
import FollowUpsWorkspace from '@/components/crm/FollowUpsWorkspace'

// Follow-up tasks were previously a separate top-level CRM nav destination
// (/receptionist/crm/follow-ups, preserved for compatibility). Consolidated
// here so Needs Attention is the one work queue for leads requiring staff
// action — reusing FollowUpsWorkspace as-is.
export default function ReceptionistNeedsAttentionPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-extrabold text-gray-800 dark:text-white">Needs Attention</h1>
        <p className="text-sm text-gray-500 dark:text-white/50">Every category here reads directly from existing lead, appointment and treatment-plan state — nothing is scored or inferred.</p>
      </div>
      <NeedsAttentionWorkspace
        leadsHref="/receptionist/leads"
        patientHref={id => `/receptionist/patients/${id}`}
        inboxHref={phone => `/receptionist/ai-suite/inbox?phone=${encodeURIComponent(phone)}`}
      />
      <FollowUpsWorkspace leadsHref="/receptionist/leads" />
    </div>
  )
}
