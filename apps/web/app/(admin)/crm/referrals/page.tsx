'use client'

import ReferralsWorkspace from '@/components/crm/ReferralsWorkspace'

export default function CrmReferralsPage() {
  return <ReferralsWorkspace patientHref={id => `/patients/${id}`} />
}
