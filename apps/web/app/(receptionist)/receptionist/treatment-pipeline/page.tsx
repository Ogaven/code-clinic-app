'use client'

// Reuses the exact same Treatment Pipeline implementation as Admin
// (apps/web/components/treatment-pipeline/TreatmentPipelineBoard.tsx) — same
// calculations, periods, stages, search/filters, pagination and financial
// semantics. Only the two internal navigation targets differ, via role-aware
// props, so a Receptionist clicking a patient/scheduling link lands on a
// real Receptionist route instead of an Admin one that would bounce them
// back to their own dashboard.

import TreatmentPipelineBoard from '@/components/treatment-pipeline/TreatmentPipelineBoard'

export default function ReceptionistTreatmentPipelinePage() {
  return (
    <TreatmentPipelineBoard
      patientBasePath="/receptionist/patients"
      schedulingBasePath="/receptionist/scheduling"
    />
  )
}
