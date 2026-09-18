'use client'

import LeadsPipeline from '@/components/leads/LeadsPipeline'
import NeedsAttentionPanel from '@/components/leads/NeedsAttentionPanel'

export default function LeadsPage() {
  return <>
    <NeedsAttentionPanel />
    <LeadsPipeline inboxPath="/ai-suite/inbox" />
  </>
}
