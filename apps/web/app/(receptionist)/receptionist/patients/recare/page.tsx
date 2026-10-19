'use client'

import RecareCallsWorkspace from '@/components/recare/RecareCallsWorkspace'

// Reuse the same live patient recare tracker as Admin so records stay shared.
export default function ReceptionistRecarePage() {
  return <RecareCallsWorkspace />
}
