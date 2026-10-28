CREATE TABLE "meta_webhook_inbox" (
  "id" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseOwner" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "meta_webhook_inbox_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "meta_webhook_inbox_eventKey_key" ON "meta_webhook_inbox"("eventKey");
CREATE INDEX "meta_webhook_inbox_status_nextAttemptAt_idx" ON "meta_webhook_inbox"("status", "nextAttemptAt");
CREATE INDEX "meta_webhook_inbox_status_leaseUntil_idx" ON "meta_webhook_inbox"("status", "leaseUntil");
