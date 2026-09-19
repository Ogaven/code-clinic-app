'use client'

import CrmDashboard from '@/components/crm/CrmDashboard'

export default function CrmDashboardPage() {
  return (
    <CrmDashboard
      role="ADMIN"
      leadsHref="/leads"
      needsAttentionHref="/crm/needs-attention"
      followUpsHref="/crm/follow-ups"
      sourcesHref="/crm/sources"
      revenueHref="/crm/revenue"
      campaignsHref="/campaigns"
    />
  )
}
