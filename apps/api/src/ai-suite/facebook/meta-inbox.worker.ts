import { randomUUID } from 'crypto'
import { prisma } from '../../lib/prisma'
import type { MetaInboxPayload, MetaInboxProvider } from './meta-inbox.types'

type InboxRow = { id: string; provider: MetaInboxProvider; payload: MetaInboxPayload; attempts: number }
let running = false

/** Store before acknowledging Meta; unique event keys make redelivery safe. */
export async function persistMetaEvents(
  provider: MetaInboxProvider,
  events: Array<{ key: string; payload: MetaInboxPayload }>,
): Promise<void> {
  await prisma.$transaction(async tx => {
    for (const event of events) {
      await tx.$executeRawUnsafe(
        `INSERT INTO "meta_webhook_events" ("id","provider","eventKey","payload","updatedAt")
         VALUES ($1,$2,$3,$4::jsonb,NOW())
         ON CONFLICT ("provider","eventKey") DO NOTHING`,
        randomUUID(), provider, event.key, JSON.stringify(event.payload),
      )
    }
  })
}

/** Process leased events; expired leases recover after a process crash. */
export async function drainMetaEvents(
  handle: (provider: MetaInboxProvider, payload: MetaInboxPayload) => Promise<void>,
): Promise<void> {
  if (running) return
  running = true
  try {
    for (let i = 0; i < 20; i++) {
      const rows = await prisma.$queryRawUnsafe<InboxRow[]>(`
        UPDATE "meta_webhook_events" SET "status"='PROCESSING',
          "leaseUntil"=NOW() + INTERVAL '2 minutes',
          "attempts"="attempts"+1,"updatedAt"=NOW()
        WHERE "id" IN (
          SELECT "id" FROM "meta_webhook_events"
          WHERE ("status"='PENDING' AND "nextAttemptAt"<=NOW())
             OR ("status"='PROCESSING' AND "leaseUntil"<NOW())
          ORDER BY "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED
        ) RETURNING "id","provider","payload","attempts"`)
      const row = rows[0]
      if (!row) break
      try {
        await handle(row.provider, row.payload)
        await prisma.$executeRawUnsafe(
          `UPDATE "meta_webhook_events" SET "status"='DONE',"processedAt"=NOW(),
           "leaseUntil"=NULL,"lastError"=NULL,"updatedAt"=NOW()
           WHERE "id"=$1 AND "status"='PROCESSING' AND "attempts"=$2`, row.id, row.attempts)
      } catch (error: any) {
        // A failed outbound Meta send may have been accepted remotely before
        // the connection failed. Never auto-retry an ambiguous delivery:
        // quarantine for manual reconciliation to avoid duplicate patient DMs.
        const ambiguousDelivery = String(error?.message ?? error).includes('META_DM_DELIVERY_UNCERTAIN')
        const delay = Math.min(3600, 10 * 2 ** Math.min(row.attempts, 8))
        await prisma.$executeRawUnsafe(
          `UPDATE "meta_webhook_events" SET
            "status"=CASE WHEN $5 OR "attempts">=12 THEN 'FAILED' ELSE 'PENDING' END,
            "nextAttemptAt"=NOW() + ($2 * INTERVAL '1 second'),
            "leaseUntil"=NULL,"lastError"=$3,"updatedAt"=NOW()
            WHERE "id"=$1 AND "status"='PROCESSING' AND "attempts"=$4`,
          row.id, delay, String(error?.message ?? error).slice(0, 1000), row.attempts, ambiguousDelivery)
      }
    }
  } finally {
    running = false
  }
}
