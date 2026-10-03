// Regression coverage for the production crash: Treatment Pipeline cards
// threw "Cannot read properties of undefined (reading 'firstName')" on
// open because TreatmentPipelineBoard.tsx assumed GET /doctors returns a
// nested `{ user: { firstName, lastName } }` shape, when the real response
// (apps/api/src/routes/doctors.ts's formatDoctor()) is flat —
// { id, firstName, lastName, ... }. doctorLabel/findDoctorIdByLabel are the
// single place this contract is now encoded; these tests pin it down.

import { describe, expect, it } from 'vitest'
import { doctorLabel, findDoctorIdByLabel, type DoctorLite } from '../doctorLabel'

const drSteven: DoctorLite = { id: 'doc_1', firstName: 'Steven', lastName: 'Kato' }
const drAisha: DoctorLite = { id: 'doc_2', firstName: 'Aisha', lastName: 'Nabirye' }

describe('doctorLabel', () => {
  it('formats "Dr. First Last" for a real doctor', () => {
    expect(doctorLabel(drSteven)).toBe('Dr. Steven Kato')
  })

  it('renders "Unassigned" for an undefined doctor (treatment with no doctorId) instead of crashing', () => {
    expect(doctorLabel(undefined)).toBe('Unassigned')
  })

  it('renders "Unassigned" for a null doctor instead of crashing', () => {
    expect(doctorLabel(null)).toBe('Unassigned')
  })

  it('renders "Unassigned" rather than throwing for a malformed/old-shape doctor object (e.g. a stray { user: {...} } with no top-level firstName)', () => {
    const malformed = { id: 'doc_3', user: { firstName: 'Ghost', lastName: 'Doctor' } } as unknown as DoctorLite
    expect(() => doctorLabel(malformed)).not.toThrow()
    expect(doctorLabel(malformed)).toBe('Unassigned')
  })
})

describe('findDoctorIdByLabel', () => {
  const doctors = [drSteven, drAisha]

  it('resolves the correct doctor id from a previously-rendered label', () => {
    expect(findDoctorIdByLabel(doctors, 'Dr. Aisha Nabirye')).toBe('doc_2')
  })

  it('returns "" for "Unassigned" (no selection), never a crash', () => {
    expect(findDoctorIdByLabel(doctors, 'Unassigned')).toBe('')
  })

  it('returns "" for null/undefined label', () => {
    expect(findDoctorIdByLabel(doctors, null)).toBe('')
    expect(findDoctorIdByLabel(doctors, undefined)).toBe('')
  })

  it('returns "" for a label that matches no doctor in the list, instead of throwing', () => {
    expect(findDoctorIdByLabel(doctors, 'Dr. Nobody Here')).toBe('')
  })

  it('is safe against an empty doctors list', () => {
    expect(findDoctorIdByLabel([], 'Dr. Steven Kato')).toBe('')
  })

  it('round-trips with doctorLabel: every doctor in a list resolves back to its own id via its own label', () => {
    for (const d of doctors) {
      expect(findDoctorIdByLabel(doctors, doctorLabel(d))).toBe(d.id)
    }
  })

  it('never crashes when the doctors list itself contains a malformed entry alongside valid ones (the exact production scenario — one bad doctor record used to crash every card, not just its own)', () => {
    const mixedList = [drSteven, { id: 'doc_bad', user: { firstName: 'X', lastName: 'Y' } } as unknown as DoctorLite, drAisha]
    expect(() => findDoctorIdByLabel(mixedList, 'Dr. Aisha Nabirye')).not.toThrow()
    expect(findDoctorIdByLabel(mixedList, 'Dr. Aisha Nabirye')).toBe('doc_2')
  })
})
