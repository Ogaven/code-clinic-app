// ─────────────────────────────────────────────────────────────────────────
// CRM Automation — collections / treatment-plan follow-up (Part E).
// CollectionsCase rows are created/closed automatically by
// patient-tags.service.ts's syncCollectionsCase() whenever
// balanceStatus=OWING AND treatmentPlanStatus=INCOMPLETE. This file covers
// the staff-accountability half: assigning and reassigning an owner so
// these patients are never treated as generic marketing contacts.
// ─────────────────────────────────────────────────────────────────────────
import { prisma } from '../lib/prisma'

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