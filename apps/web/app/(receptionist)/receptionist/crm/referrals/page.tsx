'use client'

import ReferralsWorkspace from '@/components/crm/ReferralsWorkspace'

export default function ReceptionistReferralsPage() {
  return <ReferralsWorkspace patientHref={id => `/receptionist/patients/${id}`} />
}
