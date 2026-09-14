// ─────────────────────────────────────────────────────────────────────────
// CRM Automation — reliable Lead -> Patient conversion matching (Part N).
//
// Preferred matching order, exactly as specified:
//   1. Explicit link — Lead.convertedToPatientId already points at this
//      patient (set by the manual /crm/leads/:id/convert endpoint, or by a
//      previous run of this same auto-conversion).
//   2. Normalized phone match — using the same phoneVariants() utility
//      already used everywhere else in this codebase for phone matching
//      (crm.ts search, missed-call.service.ts), never a raw string compare.
//   3. No match — leave the lead alone. Name-only matching is deliberately
//      NOT implemented; two different people sharing a first/last name is a
//      correctness risk this workstream will not introduce.
// ─────────────────────────────────────────────────────────────────────────
import { prisma } from '../lib/prisma'
import { phoneVariants } from '../utils/phone'
import { convertLeadOnBooking } from './lead-stage.service'
import type { Lead, Patient } from '@prisma/client'

export async function resolveQualifiedLeadForPatient(patient: Pick<Patient, 'id' | 'phone'>): Promise<Lead | null> {
  // Tier 1 — explicit link
  const explicit = await prisma.lead.findFirst({
    where:   { convertedToPatientId: patient.id, status: 'QUALIFIED' },
    orderBy: { updatedAt: 'desc' },
  })
  if (explicit) return explicit

  // Tier 2 — normalized phone match, QUALIFIED leads only (matching a
  // CONTACTED or NEW lead here would force-qualify it, which Part N
  // explicitly does not ask for — booking/treatment-start only converts a
  // lead that's already QUALIFIED).
  if (!patient.phone) return null
  const variants = phoneVariants(patient.phone)
  if (variants.length === 0) return null

  return prisma.lead.findFirst({
    where:   { phone: { in: variants }, status: 'QUALIFIED' },
    orderBy: { updatedAt: 'desc' },
  })
}

// Shared by both trigger points (appointment booked / treatment started) —
// same matching rule, same conversion action, per Part N: "appointment
// booked OR treatment started" both just mean "-> CONVERTED".
async function convertMatchingLead(patient: Pick<Patient, 'id' | 'phone'>): Promise<void> {
  const lead = await resolveQualifiedLeadForPatient(patient)
  if (!lead) return

  // Never steal a lead already explicitly linked to a different patient —
  // guards against two different patients happening to share a phone
  // variant (e.g. a shared family/reception line).
  if (lead.convertedToPatientId && lead.convertedToPatientId !== patient.id) return

  if (lead.convertedToPatientId !== patient.id) {
    await prisma.lead.update({ where: { id: lead.id }, data: { convertedToPatientId: patient.id } })
  }

  // convertLeadOnBooking -> transitionLeadStage no-ops when the lead is
  // already CONVERTED (same-stage guard), so calling this repeatedly for
  // the same lead (e.g. a patient books a second appointment) can never
  // create a duplicate LeadStageHistory row or double-fire the automation
  // event; exitActiveEnrollments is likewise a harmless no-op once nothing
  // is left ACTIVE.
  await convertLeadOnBooking(lead.id)
}

export async function checkAndConvertLeadOnBooking(patient: Pick<Patient, 'id' | 'phone'>): Promise<void> {
  await convertMatchingLead(patient)
}

export async function checkAndConvertLeadOnTreatmentStart(patient: Pick<Patient, 'id' | 'phone'>): Promise<void> {
  await convertMatchingLead(patient)
}

// Bulk variant — used by pipeline.ts's /treatment/bulk-status endpoint when
// multiple treatment plans move to "In Progress" at once. Runs the exact
// same per-patient matching + conversion as the single-plan path (so
// duplicate-conversion protection is identical), just fanned out over
// however many distinct patients were affected. Extracted here (rather than
// inlined in the route) so it's directly unit-testable without an HTTP harness.
export async function checkAndConvertLeadsForPatients(patients: Pick<Patient, 'id' | 'phone'>[]): Promise<void> {
  await Promise.all(patients.map(p => convertMatchingLead(p)))
}
