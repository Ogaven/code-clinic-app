'use client'

import WalkInIntakePanel from '@/components/patients/WalkInIntakePanel'

// Admin's own route group (AdminLayout) already redirects any non-ADMIN
// user away before this ever renders, but requiredRoles is passed anyway
// so the panel's own gate is explicit rather than implicit.
export default function AdminWalkInIntakePage() {
  return <WalkInIntakePanel basePath="/patients" requiredRoles={['ADMIN']} fallbackHref="/dashboard" />
}
