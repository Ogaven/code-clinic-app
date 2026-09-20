// ─────────────────────────────────────────────────────────────────────────
// CRM Automation — shared conflictGroup keys for PATIENT sequences.
//
// SequenceDefinition.conflictGroup already exists (schema.prisma) purely to
// stop a patient/lead holding two ACTIVE enrollments in sequences that
// "tell the same story" at once. Reused here for a second purpose: scoping
// exitActiveEnrollments() so resolving one concern (e.g. booking an
// appointment) only stops the sequence that concern applies to, not every
// active enrollment a patient happens to be in. A patient legitimately
// enrolled in both a recall reminder AND an unrelated treatment-follow-up
// sequence at once must not have the treatment sequence silently cancelled
// just because they booked a routine cleaning.
// ─────────────────────────────────────────────────────────────────────────
export const PATIENT_RECALL_CONFLICT_GROUP = 'PATIENT_RECALL'
export const PATIENT_TREATMENT_FOLLOWUP_CONFLICT_GROUP = 'PATIENT_TREATMENT_FOLLOWUP'
