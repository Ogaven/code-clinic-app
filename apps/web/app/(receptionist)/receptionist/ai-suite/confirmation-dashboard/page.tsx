'use client'

import ConfirmationDashboard from '@/components/ai-suite/ConfirmationDashboard'

export default function ReceptionistConfirmationDashboardPage() {
  return <ConfirmationDashboard canSend inboxBasePath="/receptionist/ai-suite/inbox" />
}
