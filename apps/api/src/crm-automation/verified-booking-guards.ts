import { phoneVariants } from '../utils/phone'

export function verifiedPatientNameMatches(typedName: string, firstName: string | null, lastName: string | null): boolean {
  const normalize = (value: string) => value.trim().replace(/\\s+/g, ' ').toLowerCase()
  const expected = [firstName, lastName].filter(Boolean).join(' ')
  return normalize(typedName) === normalize(expected)
}

export function verifiedLeadPhoneMatches(leadPhone: string | null, patientPhone: string): boolean {
  return !!leadPhone && phoneVariants(leadPhone).includes(patientPhone)
}

export function eligibleVerifiedLead(lead: { status: string; convertedToPatientId: string | null }): boolean {
  return !lead.convertedToPatientId && ['NEW', 'CONTACTED', 'QUALIFIED'].includes(lead.status)
}
