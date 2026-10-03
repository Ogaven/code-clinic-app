// Covers the shared follow-up field parser (apps/api/src/utils/treatment-followup.ts),
// extracted out of pipeline.ts in this milestone so clinical.ts's create/edit
// treatment-plan routes can reuse the exact same validation instead of a
// second copy. Pure function, no mocking needed.

import { describe, expect, it } from 'vitest'
import { parseFollowUpFields, NON_ACTIONABLE_STATUSES } from '../utils/treatment-followup'

describe('parseFollowUpFields', () => {
  it('leaves data empty when no follow-up keys are present in the body', () => {
    const { data, error } = parseFollowUpFields({ notes: 'unrelated field' })
    expect(data).toEqual({})
    expect(error).toBeUndefined()
  })

  it('parses a valid ISO date string into a real Date', () => {
    const { data, error } = parseFollowUpFields({ followUpAt: '2026-12-01' })
    expect(error).toBeUndefined()
    expect(data.followUpAt).toBeInstanceOf(Date)
    expect(isNaN((data.followUpAt as Date).getTime())).toBe(false)
  })

  it('rejects an invalid followUpAt date so a bad payload can never write "Invalid Date"', () => {
    const { error } = parseFollowUpFields({ followUpAt: 'not-a-date' })
    expect(error).toBe('Invalid followUpAt date')
  })

  it('treats an explicit null followUpAt as "clear the field"', () => {
    const { data } = parseFollowUpFields({ followUpAt: null })
    expect(data.followUpAt).toBeNull()
  })

  it('treats an empty-string followUpAt the same as null (clear)', () => {
    const { data } = parseFollowUpFields({ followUpAt: '' })
    expect(data.followUpAt).toBeNull()
  })

  it('passes through followUpReason and followUpNote, normalizing empty string to null', () => {
    const { data } = parseFollowUpFields({ followUpReason: 'Patient requested', followUpNote: '' })
    expect(data.followUpReason).toBe('Patient requested')
    expect(data.followUpNote).toBeNull()
  })

  it('normalizes an empty-string doctorId to null (unassign) but leaves a real id untouched', () => {
    const cleared = parseFollowUpFields({ doctorId: '' })
    expect(cleared.data.doctorId).toBeNull()
    const assigned = parseFollowUpFields({ doctorId: 'doctor_123' })
    expect(assigned.data.doctorId).toBe('doctor_123')
  })

  it('never touches a key that is absent from the body (undefined means "leave unchanged")', () => {
    const { data } = parseFollowUpFields({ followUpAt: '2026-12-01' })
    expect('followUpReason' in data).toBe(false)
    expect('doctorId' in data).toBe(false)
  })
})

describe('NON_ACTIONABLE_STATUSES', () => {
  it('matches the three terminal statuses the alert scheduler and Follow Up queue both exclude', () => {
    expect(NON_ACTIONABLE_STATUSES.sort()).toEqual(['Cancelled', 'Completed', 'Declined'].sort())
  })
})
