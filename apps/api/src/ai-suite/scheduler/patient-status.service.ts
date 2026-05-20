import { prisma } from '../../lib/prisma'

export async function updatePatientStatuses(): Promise<void> {
  const now  = new Date()
  const d90  = new Date(now.getTime() - 90  * 86_400_000)
  const d180 = new Date(now.getTime() - 180 * 86_400_000)
  const d365 = new Date(now.getTime() - 365 * 86_400_000)
  const d14  = new Date(now.getTime() - 14  * 86_400_000)

  const count = await prisma.$executeRaw`
    UPDATE patients SET status = CASE
      WHEN EXISTS (
        SELECT 1 FROM invoices i
        WHERE i."patientId" = patients.id
          AND i.status IN ('UNPAID','PARTIAL','OVERDUE')
          AND i."createdAt" < ${d14}
      ) THEN 'BALANCE_OWING'::"PatientStatus"
      WHEN EXISTS (
        SELECT 1 FROM appointments a
        WHERE a."patientId" = patients.id
          AND a.status = 'COMPLETED'
          AND a."startAt" >= ${d90}
      ) THEN 'ACTIVE'::"PatientStatus"
      WHEN EXISTS (
        SELECT 1 FROM appointments a
        WHERE a."patientId" = patients.id
          AND a.status NOT IN ('CANCELLED','NO_SHOW','COMPLETED','RESCHEDULED')
          AND a."startAt" > ${now}
      ) THEN 'UPCOMING'::"PatientStatus"
      WHEN EXISTS (
        SELECT 1 FROM appointments a
        WHERE a."patientId" = patients.id
          AND a.status = 'COMPLETED'
          AND a."startAt" >= ${d180}
          AND a."startAt" < ${d90}
      ) THEN 'DUE_RECALL'::"PatientStatus"
      WHEN EXISTS (
        SELECT 1 FROM appointments a
        WHERE a."patientId" = patients.id
          AND a.status = 'COMPLETED'
          AND a."startAt" >= ${d365}
          AND a."startAt" < ${d180}
      ) THEN 'LAPSED'::"PatientStatus"
      WHEN EXISTS (
        SELECT 1 FROM appointments a
        WHERE a."patientId" = patients.id
          AND a.status = 'COMPLETED'
      ) THEN 'DORMANT'::"PatientStatus"
      ELSE 'NEW_LEAD'::"PatientStatus"
    END
  `
  console.log(`[PatientStatus] Classified ${count} patients at ${new Date().toISOString()}`)
}
