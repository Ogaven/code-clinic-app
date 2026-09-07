import type { Prisma } from '@prisma/client'

type AppointmentDeleteTx = Pick<Prisma.TransactionClient, 'invoice' | 'patientFeedback' | 'appointment'>

// Permanent, admin-only removal of an appointment. Never sends any patient
// communication. Invoice and PatientFeedback are optional, unique FKs onto
// Appointment — both records are preserved, only their link to this specific
// appointment is cleared, so the delete itself never trips a foreign key
// constraint. Everything else (Patient, TreatmentPlan, Payment, clinical and
// audit history) has no FK relationship to Appointment at all and is
// untouched by construction.
export async function deleteAppointmentPermanently(tx: AppointmentDeleteTx, appointmentId: string) {
  await tx.invoice.updateMany({
    where: { appointmentId },
    data:  { appointmentId: null },
  })
  await tx.patientFeedback.updateMany({
    where: { appointmentId },
    data:  { appointmentId: null },
  })
  await tx.appointment.delete({ where: { id: appointmentId } })
}