'use client'

import RecallWorkspace from '@/components/crm/RecallWorkspace'

export default function ReceptionistRecallPage() {
  return <RecallWorkspace patientHref={id => `/receptionist/patients/${id}`} />
}
