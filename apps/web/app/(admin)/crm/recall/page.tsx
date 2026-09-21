'use client'

import RecallWorkspace from '@/components/crm/RecallWorkspace'

export default function RecallPage() {
  return <RecallWorkspace patientHref={id => `/patients/${id}`} />
}
