// Each role owns its own patient-detail route (middleware.ts / role layout
// guards enforce this server- and client-side) -- there is no single shared
// "/patients/:id" every role can land on. A calendar/appointment view that
// hardcodes the ADMIN-only path bounces RECEPTIONIST straight back to their
// dashboard the instant they click a patient link (apps/web/app/(admin)/
// layout.tsx redirects any non-ADMIN role away from routes under the
// (admin) group).
export function patientProfileBase(userRole: string): string {
  if (userRole === 'RECEPTIONIST') return '/receptionist/patients'
  if (userRole === 'DOCTOR') return '/doctor/patients'
  return '/patients'
}
