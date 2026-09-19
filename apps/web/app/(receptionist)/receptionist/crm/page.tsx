'use client'

import CrmDashboard from '@/components/crm/CrmDashboard'

export default function ReceptionistCrmDashboardPage() {
  return (
    <CrmDashboard
      role="RECEPTIONIST"
      leadsHref="/receptionist/leads"
      needsAttentionHref="/receptionist/crm/needs-attention"
      followUpsHref="/receptionist/crm/follow-ups"
      sourcesHref="/receptionist/crm/sources"
      revenueHref="#"
      campaignsHref="/receptionist/campaigns"
    />
  )
}
