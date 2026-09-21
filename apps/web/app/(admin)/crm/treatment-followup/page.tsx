'use client'

import TreatmentFollowUpWorkspace from '@/components/crm/TreatmentFollowUpWorkspace'

export default function TreatmentFollowUpPage() {
  return <TreatmentFollowUpWorkspace patientHref={id => `/patients/${id}`} />
}
