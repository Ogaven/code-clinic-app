/** Conservative non-patient intent filter for inbound channel lead creation.
 * A conversation remains visible to staff even when it is not a patient lead.
 * Ambiguous enquiries are deliberately left for the normal patient flow.
 */
export function classifyNonPatientEnquiry(value: string): 'JOB' | 'SUPPLIER' | null {
  const text = value.trim().toLowerCase()
  if (/\b(?:job|jobs|vacanc(?:y|ies)|employment|recruitment|internship|industrial attachment|hiring|apply for (?:a |the )?(?:job|position)|send (?:my |a )?cv)\b/.test(text)) return 'JOB'
  if (/\b(?:we|i) (?:sell|supply|offer|provide|distribute|market)\b|\b(?:our|my) (?:products|services|catalogue|quotation|proposal)\b|\b(?:supplier|vendor|wholesale|distributor|marketing agency|advertising services)\b/.test(text) &&
      !/\b(?:i need|i want|my tooth|my teeth|toothache|dental appointment|book an appointment)\b/.test(text)) return 'SUPPLIER'
  return null
}
export const JOB_ENQUIRY_REPLY = 'Thank you for your interest in working with Code Clinic. Please send your application or CV to dentist@codeclinic.ug.'
export const SUPPLIER_ENQUIRY_REPLY = 'Thank you for contacting Code Clinic. This channel is for patient enquiries; our reception team can review relevant business proposals separately.'
