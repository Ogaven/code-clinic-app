'use client'

import TreatmentPipelineBoard from '@/components/treatment-pipeline/TreatmentPipelineBoard'

export default function DoctorTreatmentPipelinePage() {
  return <TreatmentPipelineBoard patientBasePath="/doctor/patients" schedulingBasePath="/doctor/schedule" canDelete={false} />
}
