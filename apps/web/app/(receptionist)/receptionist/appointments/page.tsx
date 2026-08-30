'use client'

// Thin wrapper — the real implementation now lives in
// apps/web/components/scheduling/ReceptionistAppointmentsList.tsx so it can
// be shared with the "Appointments" tab inside /receptionist/scheduling
// without duplicating the same ~700 lines in two places. This route keeps
// working exactly as before for existing bookmarks/links (e.g. the
// dashboard's "View all" link).

import ReceptionistAppointmentsList from '@/components/scheduling/ReceptionistAppointmentsList'

export default function AppointmentsPage() {
  return <ReceptionistAppointmentsList />
}
