import type { Prisma } from '@prisma/client'

type PatientConsentTx = Pick<Prisma.TransactionClient, 'patient' | 'patientConsent'>

export async function createPatientWithBotConsent(
  tx: PatientConsentTx,
  patientData: Prisma.PatientUncheckedCreateInput,
  consentBotComms: boolean,
) {
  const patient = await tx.patient.create({ data: patientData })
  await tx.patientConsent.create({
    data: { patientId: patient.id, consentType: 'BOT_COMMUNICATION', granted: consentBotComms },
  })
  return patient
}
