import { prisma } from '../lib/prisma'
import { phoneVariants } from '../utils/phone'
import { classifyHistoricalReconciliation } from './historical-reconciliation-classifier'

/**
 * Full historical lead scan. Read-only by construction.
 * Existing patient links have no verified-provenance column in the schema:
 * never assert patientLinkVerified from a bare convertedToPatientId.
 */
export async function previewHistoricalReconciliation() {
  const summary = { scanned: 0, eligible: 0, manualReview: 0, unmatched: 0, skipped: 0 }
  const reasons: Record<string, number> = {}
  let cursor: string | undefined
  while (true) {
    const leads = await prisma.lead.findMany({
      select: { id: true, status: true, stage: true, convertedToPatientId: true, createdAt: true, phone: true },
      orderBy: { id: 'asc' }, take: 200,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
    if (!leads.length) break
    for (const lead of leads) {
      let appointmentPatientId: string | null = null
      let appointmentCreatedAt: Date | null = null
      let appointmentStatus: string | null = null
      let phoneCandidateCount = 0
      if (['NEW', 'CONTACTED', 'QUALIFIED'].includes(lead.status) && lead.status === lead.stage) {
        if (lead.convertedToPatientId) {
          const appointment = await prisma.appointment.findFirst({
            where: { patientId: lead.convertedToPatientId, createdAt: { gte: lead.createdAt },
              status: { notIn: ['CANCELLED', 'CANCELLED_RESCHEDULED', 'NO_SHOW'] } },
            select: { patientId: true, createdAt: true, status: true }, orderBy: { createdAt: 'asc' },
          })
          if (appointment) {
            appointmentPatientId = appointment.patientId
            appointmentCreatedAt = appointment.createdAt
            appointmentStatus = appointment.status
          }
        } else if (lead.phone && /^(?:\+?256[0-9]{9}|0[0-9]{9})$/.test(lead.phone)) {
          // Count every phone candidate, never use a limited result to assert uniqueness.
          phoneCandidateCount = await prisma.patient.count({ where: { phone: { in: phoneVariants(lead.phone) } } })
        }
      }
      const decision = classifyHistoricalReconciliation({
        status: lead.status, stage: lead.stage, convertedToPatientId: lead.convertedToPatientId,
        patientLinkVerified: false, // No independent provenance is recorded in the current schema.
        appointmentPatientId, appointmentCreatedAt, appointmentStatus,
        leadCreatedAt: lead.createdAt, phoneCandidateCount,
      })
      summary.scanned++
      if (decision.classification === 'ELIGIBLE') summary.eligible++
      else if (decision.classification === 'MANUAL_REVIEW') summary.manualReview++
      else if (decision.classification === 'UNMATCHED') summary.unmatched++
      else summary.skipped++
      reasons[decision.reason] = (reasons[decision.reason] ?? 0) + 1
    }
    cursor = leads[leads.length - 1].id
  }
  return { readOnly: true as const, autoConversionEnabled: false as const,
    ...summary, reasons, provenanceStatus: 'NOT_AVAILABLE_IN_CURRENT_SCHEMA' as const }
}
