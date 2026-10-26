import { describe, expect, it } from 'vitest'
import { PATIENT_DECISIONS, isPatientDecision, eligibleForRoutineTreatmentFollowUp } from '../utils/treatment-decision'

describe('Stage 1 treatment decisions', () => {
  it('supports all five decisions required by the clinic', () => {
    expect(PATIENT_DECISIONS).toEqual(['Accepted', 'Partially Accepted', 'Undecided', 'Deferred', 'Declined'])
    for (const decision of PATIENT_DECISIONS) expect(isPatientDecision(decision)).toBe(true)
    expect(isPatientDecision('Planned')).toBe(false)
    expect(isPatientDecision(null)).toBe(false)
  })
  it('never permits routine sales follow-up for declined or deferred cases', () => {
    expect(eligibleForRoutineTreatmentFollowUp('Declined', true)).toBe(false)
    expect(eligibleForRoutineTreatmentFollowUp('Deferred', true)).toBe(false)
    expect(eligibleForRoutineTreatmentFollowUp('Accepted', true)).toBe(false)
  })
  it('honours contact permission for unresolved decisions', () => {
    expect(eligibleForRoutineTreatmentFollowUp('Undecided', false)).toBe(false)
    expect(eligibleForRoutineTreatmentFollowUp('Partially Accepted', false)).toBe(false)
    expect(eligibleForRoutineTreatmentFollowUp('Undecided', true)).toBe(true)
  })
})
