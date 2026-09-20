// Regression coverage for the calendar-click-bounces-to-dashboard bug:
// AppointmentModal's "Full Profile"/"View Chart" links used to be hardcoded
// to the ADMIN-only /patients/:id route regardless of who was viewing the
// modal. A RECEPTIONIST clicking a calendar appointment landed on that
// route, got bounced by apps/web/app/(admin)/layout.tsx's role guard, and
// ended up back on their own dashboard -- exactly the reported symptom.
// Each role must get its own real, non-guarded patient-detail route.

import { describe, expect, it } from 'vitest'
import { patientProfileBase } from '../patientRoutes'

describe('patientProfileBase — role-scoped patient profile route', () => {
  it('RECEPTIONIST resolves to the receptionist patient route, not the admin-only one', () => {
    expect(patientProfileBase('RECEPTIONIST')).toBe('/receptionist/patients')
  })

  it('DOCTOR resolves to the doctor patient route', () => {
    expect(patientProfileBase('DOCTOR')).toBe('/doctor/patients')
  })

  it('ADMIN (and any other/unknown role) resolves to the admin patient route', () => {
    expect(patientProfileBase('ADMIN')).toBe('/patients')
    expect(patientProfileBase('DEVELOPER')).toBe('/patients')
  })
})
