'use client'

import CrmReportingWorkspace from '@/components/crm/CrmReportingWorkspace'

export default function CrmReportsPage() {
  return <CrmReportingWorkspace revenueHref="/crm/revenue" referralsHref="/crm/referrals" />
}
