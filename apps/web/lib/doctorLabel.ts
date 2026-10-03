// Single source of truth for turning a /doctors API row into a display
// label, and back. GET /doctors (apps/api/src/routes/doctors.ts's
// formatDoctor()) returns a FLAT shape — { id, firstName, lastName, ... } —
// never a nested `user` object. A previous pass in
// TreatmentPipelineBoard.tsx assumed the nested shape (`doctor.user.
// firstName`), which is `undefined.firstName` for every doctor record,
// every time — the exact "Cannot read properties of undefined (reading
// 'firstName')" crash on opening ANY treatment card. Extracted here (rather
// than left inline) so the doctor-record shape has exactly one place to
// get right, and so it's actually testable — this repo has no component-
// test harness, so a pure function is the only practical way to pin this
// contract down.
export interface DoctorLite {
  id: string
  firstName: string
  lastName: string
}

// Defensive on purpose: `doctor` can be null/undefined (no doctor assigned)
// or — if the API's shape ever drifts again — missing firstName entirely.
// Either way this renders the same intentional "Unassigned" fallback
// instead of throwing.
export function doctorLabel(doctor: DoctorLite | null | undefined): string {
  if (!doctor || !doctor.firstName) return 'Unassigned'
  return `Dr. ${doctor.firstName} ${doctor.lastName}`
}

// Reverse lookup: given a previously-rendered label (e.g. Plan.doctorName,
// which the API computes server-side from the same "Dr. First Last" /
// "Unassigned" convention), find the matching doctor's id in a /doctors
// list. Returns '' (no selection) for 'Unassigned', an unmatched label, or
// an empty doctors list -- never throws.
export function findDoctorIdByLabel(doctors: DoctorLite[], label: string | null | undefined): string {
  if (!label) return ''
  return doctors.find(d => doctorLabel(d) === label)?.id ?? ''
}
