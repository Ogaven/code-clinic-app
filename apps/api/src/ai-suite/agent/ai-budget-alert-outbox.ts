import type { PrismaClient } from '@prisma/client'

export type PendingAiBudgetAlert = {
  id: string
  monthKey: string
  level: 'warning' | 'critical'
  createdAt: Date
}

/**
 * Read-only alert outbox access for a future authenticated staff notification
 * dispatcher. Does not mark records SENT before confirmed delivery.
 */
export async function listPendingAiBudgetAlerts(
  db: Pick<PrismaClient, 'aiBudgetAlert'>,
  limit = 50,
): Promise<PendingAiBudgetAlert[]> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('Invalid alert batch size')
  }
  const rows = await db.aiBudgetAlert.findMany({
    where: { status: 'PENDING' },
    select: { id: true, monthKey: true, level: true, createdAt: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: limit,
  })
  return rows.map(row => {
    if (row.level !== 'warning' && row.level !== 'critical') {
      throw new Error('Unknown AI budget alert level')
    }
    return { ...row, level: row.level }
  })
}
