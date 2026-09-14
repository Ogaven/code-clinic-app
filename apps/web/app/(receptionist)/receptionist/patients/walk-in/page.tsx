'use client'

import WalkInIntakePanel from '@/components/patients/WalkInIntakePanel'

// The shared (receptionist) layout admits both RECEPTIONIST and DOCTOR, but
// Walk-In Intake is Admin + Receptionist only (not Doctor) per spec — the
// panel's own requiredRoles gate enforces that here since the layout won't.
export default function ReceptionistWalkInIntakePage() {
  return <WalkInIntakePanel basePath="/receptionist/patients" requiredRoles={['RECEPTIONIST']} fallbackHref="/receptionist/dashboard" />
}