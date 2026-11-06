-- Durable inbox for Facebook/Instagram webhook events. No clinical data is copied.
-- Apply before enabling the queue-backed webhook handlers.
CREATE TABLE "meta_webhook_events" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseUntil" TIMESTAMP(3),
  "lastError" TEXT,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "meta_webhook_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "meta_webhook_events_provider_check" CHECK ("provider" IN ('FACEBOOK', 'INSTAGRAM')),
  CONSTRAINT "meta_webhook_events_status_check" CHECK ("status" IN ('PENDING', 'PROCESSING', 'DONE', 'FAILED')),
  CONSTRAINT "meta_webhook_events_attempts_check" CHECK ("attempts" >= 0)
);
CREATE UNIQUE INDEX "meta_webhook_events_provider_eventKey_key" ON "meta_webhook_events" ("provider", "eventKey");
CREATE INDEX "meta_webhook_events_claim_idx" ON "meta_webhook_events" ("status", "nextAttemptAt", "leaseUntil");
-- Do not acknowledge webhook delivery until the transaction inserting the event commits.
-- Worker claims must use FOR UPDATE SKIP LOCKED with an expiring lease.
-- External comment publishing requires a separate idempotency/reconciliation guard.
