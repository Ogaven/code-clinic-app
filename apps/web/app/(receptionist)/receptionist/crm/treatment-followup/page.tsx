'use client'

import TreatmentFollowUpWorkspace from '@/components/crm/TreatmentFollowUpWorkspace'

export default function ReceptionistTreatmentFollowUpPage() {
  return <TreatmentFollowUpWorkspace patientHref={id => `/receptionist/patients/${id}`} />
}
