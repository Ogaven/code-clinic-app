// ─────────────────────────────────────────────────────────────────────────
// CRM Automation — collections / treatment-plan follow-up (Part E).
// CollectionsCase rows are created/closed automatically by
// patient-tags.service.ts's syncCollectionsCase() whenever
// balanceStatus=OWING AND treatmentPlanStatus=INCOMPLETE. This file covers
// the staff-accountability half: assigning and reassigning an owner so
// these patients are never treated as generic marketing contacts.
//
// KNOWN GAP (data/role-parity milestone): Patient.accountBalance — the
// field balanceStatus is derived from — is never incremented anywhere in
// the codebase (only ever decremented on full payment), so balanceStatus
// can essentially never become OWING and syncCollectionsCase can
// essentially never auto-open a case, no matter how much real unpaid
// Invoice debt exists. Fixing that increment is an Accounts/invoicing-flow
// change, out of scope here (this milestone touches CRM visibility, not
// billing mutation logic). Instead, realOutstandingBalancePatients() below
// gives staff a real, read-only view of who actually owes money — computed
// directly from Invoice rows, the genuinely populated source of truth —
// alongside the existing (currently near-empty, for the reason above)
// assigned-case workflow, without waiting on that fix.
// ─────────────────────────────────────────────────────────────────────────
import { prisma } from '../lib/prisma'

export interface RealOutstandingBalancePatient {
  id: string
  firstName: string
  lastName: string
  phone: string
  outstandingUGX: number
  unpaidInvoiceCount: number
  oldestUnpaidAt: Date
  hasOpenCollectionsCase: boolean
}

// Real, read-only view of patients with outstanding invoice balances —
// queries the Invoice table directly instead of the broken
// balanceStatus/accountBalance derivation. Never mutates anything.
export async function realOutstandingBalancePatients(): Promise<RealOutstandingBalancePatient[]> {
  const rows = await prisma.$queryRaw<Array<{
    id: string; firstName: string; lastName: string; phone: string
    outstandingUGX: bigint; unpaidInvoiceCount: bigint; oldestUnpaidAt: Date
  }>>`
    SELECT p.id, p."firstName", p."lastName", p.phone,
      SUM(i."totalUGX" - i."paidUGX")::bigint AS "outstandingUGX",
      COUNT(i.id)::bigint AS "unpaidInvoiceCount",
      MIN(i."createdAt") AS "oldestUnpaidAt"
    FROM patients p
    JOIN invoices i ON i."patientId" = p.id
    WHERE i.status IN ('UNPAID', 'SENT', 'PARTIAL', 'OVERDUE')
      AND p."isActive" = true
    GROUP BY p.id, p."firstName", p."lastName", p.phone
    HAVING SUM(i."totalUGX" - i."paidUGX") > 0
    ORDER BY "outstandingUGX" DESC
    LIMIT 500
  `
  if (rows.length === 0) return []

  const openCases = await prisma.collectionsCase.findMany({
    where:  { patientId: { in: rows.map(r => r.id) }, status: { not: 'CLOSED' } },
    select: { patientId: true },
  })
  const openCaseIds = new Set(openCases.map(c => c.patientId))

  return rows.map(r => ({
    id: r.id, firstName: r.firstName, lastName: r.lastName, phone: r.phone,
    outstandingUGX: Number(r.outstandingUGX), unpaidInvoiceCount: Number(r.unpaidInvoiceCount),
    oldestUnpaidAt: r.oldestUnpaidAt, hasOpenCollectionsCase: openCaseIds.has(r.id),
  }))
}

export async function assignCollectionsOwner(patientId: string, ownerId: string | null): Promise<void> {
  const existing = await prisma.collectionsCase.findUnique({ where: { patientId } })
  if (!existing) {
    throw new Error('No open collections case for this patient — nothing to assign')
  }
  await prisma.collectionsCase.update({
    where: { patientId },
    data:  { ownerId, status: existing.status === 'OPEN' && ownerId ? 'IN_PROGRESS' : existing.status },
  })
}

export async function listCollectionsCases(ownerId?: string) {
  return prisma.collectionsCase.findMany({
    where:   { status: { not: 'CLOSED' }, ...(ownerId ? { ownerId } : {}) },
    include: { patient: { select: { id: true, firstName: true, lastName: true, phone: true, accountBalance: true, balanceAgingBucket: true } }, owner: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { createdAt: 'asc' },
  })
}