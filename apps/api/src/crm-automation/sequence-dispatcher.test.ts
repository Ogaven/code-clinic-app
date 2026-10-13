import { describe, expect, it } from 'vitest'
import { shouldStopLeadNurture } from './sequence-dispatcher'

describe('converted lead nurture eligibility', () => {
  it('fails closed when the lead was deleted or cannot be found', () => {
    expect(shouldStopLeadNurture(null)).toBe(true)
  })

  it('blocks a converted lead even when patient linkage is missing', () => {
    expect(shouldStopLeadNurture({ status: 'CONVERTED', convertedToPatientId: null })).toBe(true)
  })

  it('blocks a linked patient even if the lead stage is stale', () => {
    expect(shouldStopLeadNurture({ status: 'CONTACTED', convertedToPatientId: 'patient-1' })).toBe(true)
  })

  it.each(['NEW', 'CONTACTED', 'QUALIFIED'])('allows unlinked active %s leads', status => {
    expect(shouldStopLeadNurture({ status, convertedToPatientId: null })).toBe(false)
  })
})
