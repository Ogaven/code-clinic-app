import { prisma } from '../../lib/prisma'

export async function updatePatientStatuses(): Promise<void> {
  const now  = new Date()
  const d90  = new Date(now.getTime() - 90  * 86_400_000)
  const d180 = new Date(now.getTime() - 180 * 86_400_000)
  const d365 = new Date(now.getTime() - 365 * 86_400_000)
  const d14  = new Date(now.getTime() - 14  * 86_400_000)

  // Use $executeRawUnsafe to avoid complex TS type inference on tagged template literals.
  // Parameters: $1=d14, $2=d90, $3=now, $4=d180, $5=d90(dup), $6=d365, $7=d180(dup), $8=d365(dup)
  const sql = `
    UPDATE patients SET status = CASE
      WHEN EXISTS (
        SELECT 1 FROM invoices i
        WHERE i."patientId" = patients.id
          AND i.status IN ('UNPAID','PARTIAL','OVERDUE')
          AND i."createdAt" < $1
      ) THEN 'BALANCE_OWING'::"PatientStatus"
      WHEN EXISTS (
        SELECT 1 FROM appointments a
        WHERE a."patientId" = patients.id
          AND a.status = 'COMPLETED'
          AND a."startAt" >= $2
      ) THEN 'ACTIVE'::"PatientStatus"
      WHEN EXISTS (
        SELECT 1 FROM appointments a
        WHERE a."patientId" = patients.id
          AND a.status NOT IN ('CANCELLED','NO_SHOW','COMPLETED','RESCHEDULED')
          AND a."startAt" > $3
      ) THEN 'UPCOMING'::"PatientStatus"
      WHEN EXISTS (
        SELECT 1 FROM appointments a
        WHERE a."patientId" = patients.id
          AND a.status = 'COMPLETED'
          AND a."startAt" >= $4
          AND a."startAt" < $5
      ) THEN 'DUE_RECALL'::"PatientStatus"
      WHEN EXISTS (
        SELECT 1 FROM appointments a
        WHERE a."patientId" = patients.id
          AND a.status = 'COMPLETED'
          AND a."startAt" >= $6
          AND a."startAt" < $7
      ) THEN 'LAPSED'::"PatientStatus"
      WHEN EXISTS (
        SELECT 1 FROM appointments a
        WHERE a."patientId" = patients.id
          AND a.status = 'COMPLETED'
          AND a."startAt" < $8
      ) THEN 'DORMANT'::"PatientStatus"
      ELSE 'NEW_LEAD'::"PatientStatus"
    END
  `
  const count = await prisma.$executeRawUnsafe(sql, d14, d90, now, d180, d90, d365, d180, d365)
  console.log(`[PatientStatus] Classified ${count} patients at ${new Date().toISOString()}`)
}
