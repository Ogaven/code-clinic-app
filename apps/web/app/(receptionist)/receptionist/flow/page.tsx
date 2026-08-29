'use client'

// Consolidated onto the same ReceptionistLiveFlow board used on the
// Dashboard's compact summary (apps/web/components/scheduling/
// ReceptionistLiveFlow.tsx) — this page used to maintain a second, separate
// stage/status implementation with its own (incorrect) status mapping,
// which risked drifting from the real ARRIVED/WAITING/IN_OPERATORY/
// READY_CHECKOUT semantics used everywhere else. One real board, reused
// here at full size instead of duplicated business logic.

import ReceptionistLiveFlow from '@/components/scheduling/ReceptionistLiveFlow'

export default function LiveFlowPage() {
  return (
    <div className="p-5 max-w-[1400px] mx-auto space-y-4 overflow-x-hidden">
      <ReceptionistLiveFlow refreshInterval={20000} />
    </div>
  )
}
