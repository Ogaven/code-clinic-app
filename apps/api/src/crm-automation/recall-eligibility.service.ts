// Fail-closed clinical eligibility gate for outbound recall sequences.
// Staff-set interval AND latest completed qualifying hygiene visit are required.
// The dashboard's read-only estimated recalls never pass this gate.
import { prisma } from '../lib/prisma'

export async function isConfirmedRecallDue(patientId: string, now = new Date()): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ eligible: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM patients p
      JOIN LATERAL (
        SELECT MAX(a."startAt") AS "lastHygieneAt"
        FROM appointments a
        JOIN services s ON s.id = a."serviceId"
        WHERE a."patientId" = p.id AND a.status = 'COMPLETED'
          AND LOWER(TRIM(REGEXP_REPLACE(TRIM(s.name), '[^a-zA-Z0-9]+', ' ', 'g'))) IN (
            'periodontal maintenance', 'recall hygiene visit',
            'periodontal maintenance recall hygiene visit'
          )
      ) hygiene ON true
      WHERE p.id = ${patientId}
        AND p."isActive" = true
        AND p."recallInterval" IN ('THREE_MONTH', 'SIX_MONTH', 'TWELVE_MONTH')
        AND hygiene."lastHygieneAt" IS NOT NULL
        AND hygiene."lastHygieneAt" +
          (CASE p."recallInterval"
            WHEN 'THREE_MONTH' THEN 90
            WHEN 'SIX_MONTH' THEN 180
            ELSE 365 END) * INTERVAL '1 day' <= ${now}
    ) AS eligible
  `
  return rows[0]?.eligible === true
}
