'use client'

import ReactivationWorkspace from '@/components/crm/ReactivationWorkspace'

export default function ReactivationPage() {
  return <ReactivationWorkspace patientHref={id => `/patients/${id}`} />
}
