'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import LeadsPipeline from '@/components/leads/LeadsPipeline'
import NeedsAttentionPanel from '@/components/leads/NeedsAttentionPanel'

function LeadsPageContent() {
  const openLeadId = useSearchParams().get('open')
  return <>
    <NeedsAttentionPanel />
    <LeadsPipeline inboxPath="/receptionist/ai-suite/inbox" initialLeadId={openLeadId} />
  </>
}

export default function LeadsPage() {
  return (
    <Suspense>
      <LeadsPageContent />
    </Suspense>
  )
}
