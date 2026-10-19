type LeadSnapshot = { id: string; status: string; stage: string }
type LinkedLead = { id: string }
type TransactionClient<T extends LinkedLead> = {
  lead: {
    updateMany(args: { where: { id: string; convertedToPatientId: string | null; status: string; stage: string }; data: { convertedToPatientId: string; status: 'CONVERTED'; stage: 'CONVERTED' } }): Promise<{ count: number }>
    findUniqueOrThrow(args: { where: { id: string } }): Promise<T>
  }
  leadStageHistory: {
    create(args: { data: { leadId: string; fromStage: string; toStage: 'CONVERTED'; changedBy: string; trigger: 'MANUAL'; reason: 'staff_verified_patient_booking' } }): Promise<unknown>
  }
}

export async function linkVerifiedBookingInTransaction<T extends LinkedLead>(
  tx: TransactionClient<T>, lead: LeadSnapshot, patientId: string, staffId: string, existingPatientId: string | null = null,
): Promise<T | null> {
  const linked = await tx.lead.updateMany({
    where: { id: lead.id, convertedToPatientId: existingPatientId, status: lead.status, stage: lead.stage },
    data: { convertedToPatientId: patientId, status: 'CONVERTED', stage: 'CONVERTED' },
  })
  if (linked.count !== 1) return null
  await tx.leadStageHistory.create({
    data: {
      leadId: lead.id, fromStage: lead.status, toStage: 'CONVERTED',
      changedBy: staffId, trigger: 'MANUAL', reason: 'staff_verified_patient_booking',
    },
  })
  return tx.lead.findUniqueOrThrow({ where: { id: lead.id } })
}
