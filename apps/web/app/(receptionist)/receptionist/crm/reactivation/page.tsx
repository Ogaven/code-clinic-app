'use client'

import ReactivationWorkspace from '@/components/crm/ReactivationWorkspace'

export default function ReceptionistReactivationPage() {
  return <ReactivationWorkspace patientHref={id => `/receptionist/patients/${id}`} />
}
