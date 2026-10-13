import { describe, expect, it } from 'vitest'
import { eligibleVerifiedLead, verifiedLeadPhoneMatches, verifiedPatientNameMatches } from './verified-booking-guards'

describe('staff-verified patient booking safeguards', () => {
  it('requires the exact patient full name but tolerates case and extra spaces', () => {
    expect(verifiedPatientNameMatches('  JANE   DOE ', 'Jane', 'Doe')).toBe(true)
    expect(verifiedPatientNameMatches('Jane Smith', 'Jane', 'Doe')).toBe(false)
    expect(verifiedPatientNameMatches('Jane', 'Jane', 'Doe')).toBe(false)
  })

  it('rejects missing and unrelated lead phone numbers', () => {
    expect(verifiedLeadPhoneMatches(null, '+256700123456')).toBe(false)
    expect(verifiedLeadPhoneMatches('+256700123456', '+256700999999')).toBe(false)
    expect(verifiedLeadPhoneMatches('+256700123456', '+256700123456')).toBe(true)
  })

  it.each(['NEW', 'CONTACTED', 'QUALIFIED'])('allows unlinked %s leads', status => {
    expect(eligibleVerifiedLead({ status, convertedToPatientId: null })).toBe(true)
  })

  it('rejects linked and terminal leads', () => {
    expect(eligibleVerifiedLead({ status: 'NEW', convertedToPatientId: 'patient-id' })).toBe(false)
    expect(eligibleVerifiedLead({ status: 'CONVERTED', convertedToPatientId: null })).toBe(false)
    expect(eligibleVerifiedLead({ status: 'LOST', convertedToPatientId: null })).toBe(false)
  })
})
