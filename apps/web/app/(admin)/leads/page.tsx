'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import LeadsPipeline from '@/components/leads/LeadsPipeline'

function LeadsPageContent() {
  const params = useSearchParams()
  const openLeadId = params.get('open')
  const initialSource = params.get('source')
  return <LeadsPipeline inboxPath="/ai-suite/inbox" initialLeadId={openLeadId} initialSource={initialSource} />
}

export default function LeadsPage() {
  return (
    <Suspense>
      <LeadsPageContent />
    </Suspense>
  )
}
